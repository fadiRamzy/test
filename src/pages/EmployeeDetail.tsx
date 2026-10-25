import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { navigate, useRoute } from '../state/router';
import {
  Badge,
  Button,
  Callout,
  Card,
  DefinitionList,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Tabs,
  Textarea,
} from '../components/ui';
import { deleteObservation, saveObservation } from '../db/repo';
import {
  MINUTE_STATUS_LABELS,
  OBSERVATION_STATUS_LABELS,
  VISIT_STATUS_LABELS,
  type Observation,
} from '../db/schema';
import { EVALUATION_CRITERIA } from '../db/schema';
import { countNoun, fmtAvg, fmtDate, fmtDateTime, fmtDurationShort, fmtNumber, monthLabel, NOUNS, todayInputValue, toDateInputValue } from '../lib/format';
import { minuteState, visitState } from '../lib/tracking';
import { summarizeScores } from '../lib/evaluation';

type TabId = 'overview' | 'minutes' | 'visits' | 'observations' | 'evaluations';

const TAB_LABELS: Record<TabId, string> = {
  overview: 'نظرة عامة',
  minutes: 'دقائق الصرف',
  visits: 'الزيارات والتقارير',
  observations: 'الملاحظات',
  evaluations: 'التقييمات',
};

interface ObsDraft {
  id?: string;
  date: string;
  type: string;
  text: string;
  status: 'open' | 'closed';
  resolution: string;
}

export function EmployeeDetailPage() {
  const route = useRoute();
  const employeeId = route.segments[1] ?? '';
  const { data, settings, runAction } = useApp();
  const [tab, setTab] = useState<TabId>('overview');
  const [obsType, setObsType] = useState('all');
  const [obsStatus, setObsStatus] = useState('all');
  const [obsFrom, setObsFrom] = useState('');
  const [obsTo, setObsTo] = useState('');
  const [draft, setDraft] = useState<ObsDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const employee = data.employees.find((row) => row.id === employeeId);

  const minutes = useMemo(
    () => data.minutes.filter((row) => row.employeeId === employeeId),
    [data.minutes, employeeId],
  );
  const visits = useMemo(() => data.visits.filter((row) => row.employeeId === employeeId), [data.visits, employeeId]);
  const observations = useMemo(
    () => data.observations.filter((row) => row.employeeId === employeeId),
    [data.observations, employeeId],
  );
  const evaluations = useMemo(
    () => data.evaluations.filter((row) => row.employeeId === employeeId),
    [data.evaluations, employeeId],
  );

  const filteredObservations = useMemo(
    () =>
      observations
        .filter((row) => (obsType === 'all' ? true : row.type === obsType))
        .filter((row) => (obsStatus === 'all' ? true : row.status === obsStatus))
        .filter((row) => (obsFrom ? row.date >= obsFrom : true))
        .filter((row) => (obsTo ? row.date <= obsTo : true))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [observations, obsType, obsStatus, obsFrom, obsTo],
  );

  if (!employee) {
    return (
      <Card>
        <EmptyState
          icon="search"
          title="الموظف غير موجود"
          description="ربما تم حذفه أو أن الرابط غير صحيح."
          action={
            <Button variant="primary" onClick={() => navigate('/employees')}>
              العودة لقائمة الموظفين
            </Button>
          }
        />
      </Card>
    );
  }

  const openMinutes = minutes.filter((row) => row.status === 'open');
  const overdueMinutes = minutes.filter((row) => minuteState(row, settings.deadlineMinutes).overdue);
  const pendingReports = visits.filter((row) => {
    const state = visitState(row, settings.deadlineMinutes);
    return state.reportPending || state.reportAwaitingReview;
  });

  const startObservation = (observation?: Observation) => {
    setErrors({});
    setDraft({
      id: observation?.id,
      date: observation ? toDateInputValue(observation.date) : todayInputValue(),
      type: observation?.type ?? settings.observationTypes[0] ?? 'أخرى',
      text: observation?.text ?? '',
      status: observation?.status ?? 'open',
      resolution: observation?.resolution ?? '',
    });
  };

  const submitObservation = async () => {
    if (!draft) return;
    try {
      await runAction(
        () =>
          saveObservation({
            id: draft.id,
            employeeId,
            date: draft.date,
            type: draft.type,
            text: draft.text,
            status: draft.status,
            resolution: draft.resolution,
            minuteId: null,
            visitId: null,
            cycleId: null,
          }),
        draft.id ? 'تم تحديث الملاحظة.' : 'تمت إضافة الملاحظة.',
      );
      setDraft(null);
    } catch (error) {
      if (error && typeof error === 'object' && 'errors' in error) {
        setErrors((error as { errors: Record<string, string> }).errors);
      }
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <a href="#/employees">الموظفون</a> <span>/</span> <span>{employee.name}</span>
          </>
        }
        title={employee.name}
        description={`${employee.jobTitle} — كود ${employee.code} — ${employee.sector} / ${employee.governorate}`}
        actions={
          <>
            <Button icon="plus" onClick={() => startObservation()}>
              ملاحظة جديدة
            </Button>
            <Button icon="print" variant="primary" onClick={() => navigate(`/reports?employee=${employee.id}`)}>
              تقرير الموظف
            </Button>
          </>
        }
      />

      {employee.archived ? <Callout tone="warning">هذا الموظف مؤرشف — سجلاته محفوظة لكنه مخفي من القوائم النشطة.</Callout> : null}

      <Tabs
        tabs={(Object.keys(TAB_LABELS) as TabId[]).map((id) => ({ id, label: TAB_LABELS[id] }))}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' ? (
        <div className="grid-2">
          <Card title="البيانات الأساسية">
            <DefinitionList
              items={[
                { label: 'الرقم التسلسلي', value: fmtNumber(employee.serial) },
                { label: 'كود الموظف', value: employee.code },
                { label: 'المسمى الوظيفي', value: employee.jobTitle },
                { label: 'القطاع', value: employee.sector },
                { label: 'المحافظة', value: employee.governorate },
                { label: 'تاريخ الالتحاق', value: fmtDate(employee.joiningDate) },
                { label: 'عدد الزيارات (يدوي)', value: fmtNumber(employee.visitCount) },
                { label: 'زيارات مسجلة بالنظام', value: fmtNumber(visits.length) },
                { label: 'ملاحظات عامة', value: employee.notes || '—' },
              ]}
            />
          </Card>
          <Card title="الحالة الحالية">
            <div className="stat-grid stat-grid--tight">
              <div className="stat stat--primary">
                <div className="stat__top">
                  <span className="stat__label">دقائق مفتوحة</span>
                </div>
                <div className="stat__value">{openMinutes.length}</div>
              </div>
              <div className="stat stat--danger">
                <div className="stat__top">
                  <span className="stat__label">دقائق متأخرة</span>
                </div>
                <div className="stat__value">{overdueMinutes.length}</div>
              </div>
              <div className="stat stat--info">
                <div className="stat__top">
                  <span className="stat__label">تقارير معلّقة</span>
                </div>
                <div className="stat__value">{pendingReports.length}</div>
              </div>
              <div className="stat stat--warning">
                <div className="stat__top">
                  <span className="stat__label">ملاحظات مفتوحة</span>
                </div>
                <div className="stat__value">{observations.filter((row) => row.status === 'open').length}</div>
              </div>
            </div>
            <Callout tone="info" title="آخر تقييم">
              {evaluations.length
                ? (() => {
                    const latest = [...evaluations].sort(
                      (a, b) => (a.year === b.year ? (b.month ?? 13) - (a.month ?? 13) : b.year - a.year),
                    )[0];
                    const summary = summarizeScores(latest.scores);
                    return `${monthLabel(latest.year, latest.month)} — المجموع ${summary.sum} من ${summary.count} معيارًا مسجلًا، المتوسط ${fmtAvg(summary.average)}`;
                  })()
                : 'لا يوجد تقييم مسجل بعد.'}
            </Callout>
          </Card>
        </div>
      ) : null}

      {tab === 'minutes' ? (
        <Card
          title="دقائق الصرف"
          subtitle={countNoun(minutes.length, NOUNS.minute)}
          padded={false}
          actions={<Button size="sm" onClick={() => navigate('/minutes')}>إدارة الدقائق</Button>}
        >
          {minutes.length ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>المرجع</th>
                    <th>الفرع / العميل</th>
                    <th>الورود</th>
                    <th>طلب الملف</th>
                    <th>استلام الملف</th>
                    <th>بدء المراجعة</th>
                    <th>الرد النهائي</th>
                    <th>انتظار الملف</th>
                    <th>زمن المراجعة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {minutes.map((row) => {
                    const state = minuteState(row, settings.deadlineMinutes);
                    return (
                      <tr key={row.id}>
                        <td className="mono">{row.refNo}</td>
                        <td>{row.branchRef}</td>
                        <td>{fmtDateTime(row.receivedAt)}</td>
                        <td>{fmtDateTime(row.fileRequestedAt)}</td>
                        <td>{fmtDateTime(row.fileReceivedAt)}</td>
                        <td>{fmtDateTime(row.reviewStartedAt)}</td>
                        <td>{fmtDateTime(row.finalResponseAt)}</td>
                        <td>{fmtDurationShort(state.waitingMinutes)}</td>
                        <td>
                          {fmtDurationShort(state.reviewMinutes)}{' '}
                          {state.overdue ? <Badge tone="danger">تجاوز +{fmtDurationShort(state.overdueBy)}</Badge> : null}
                        </td>
                        <td>
                          <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'info'}>
                            {MINUTE_STATUS_LABELS[row.status]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState icon="minutes" title="لا دقائق مسجلة" description="سجّل دقائق الصرف من صفحة دقائق الصرف." />
          )}
        </Card>
      ) : null}

      {tab === 'visits' ? (
        <Card title="الزيارات ومراجعة التقارير" subtitle={countNoun(visits.length, NOUNS.visit)} padded={false}>
          {visits.length ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>المرجع</th>
                    <th>الفرع / العميل</th>
                    <th>التحرك</th>
                    <th>الوصول</th>
                    <th>الإتمام</th>
                    <th>العودة</th>
                    <th>تسليم التقرير</th>
                    <th>مراجعة التقرير</th>
                    <th>البريد النهائي</th>
                    <th>دورات المراجعة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((row) => {
                    const state = visitState(row, settings.deadlineMinutes);
                    return (
                      <tr key={row.id}>
                        <td className="mono">{row.refNo}</td>
                        <td>{row.branchRef}</td>
                        <td>{fmtDateTime(row.departureAt)}</td>
                        <td>{fmtDateTime(row.arrivalAt)}</td>
                        <td>{fmtDateTime(row.completedAt)}</td>
                        <td>{fmtDateTime(row.returnAt)}</td>
                        <td>{fmtDateTime(row.reportSubmittedAt)}</td>
                        <td>{fmtDateTime(row.reportReviewedAt)}</td>
                        <td>{fmtDateTime(row.finalEmailAt)}</td>
                        <td className="num">{state.cycles}</td>
                        <td>
                          <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'info'}>
                            {VISIT_STATUS_LABELS[row.status]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState icon="visits" title="لا زيارات مسجلة" description="سجّل الزيارات من صفحة الزيارات والتقارير." />
          )}
        </Card>
      ) : null}

      {tab === 'observations' ? (
        <Card
          title="ملاحظات الموظف"
          subtitle="كل ملاحظة مؤرَّخة. استخدم عوامل التصفية للوصول إلى فترة أو نوع أو حالة محددة."
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => startObservation()}>
              ملاحظة
            </Button>
          }
        >
          <div className="toolbar">
            <Select value={obsType} onChange={(e) => setObsType(e.target.value)} aria-label="نوع الملاحظة">
              <option value="all">كل الأنواع</option>
              {Array.from(new Set([...settings.observationTypes, ...observations.map((row) => row.type)])).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
            <Select value={obsStatus} onChange={(e) => setObsStatus(e.target.value)} aria-label="حالة الملاحظة">
              <option value="all">كل الحالات</option>
              <option value="open">مفتوحة</option>
              <option value="closed">مغلقة</option>
            </Select>
            <Input type="date" value={obsFrom} onChange={(e) => setObsFrom(e.target.value)} aria-label="من تاريخ" />
            <Input type="date" value={obsTo} onChange={(e) => setObsTo(e.target.value)} aria-label="إلى تاريخ" />
            <Button
              size="sm"
              onClick={() => {
                setObsType('all');
                setObsStatus('all');
                setObsFrom('');
                setObsTo('');
              }}
            >
              مسح التصفية
            </Button>
          </div>

          {filteredObservations.length ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>الملاحظة</th>
                    <th>الحالة</th>
                    <th>المعالجة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredObservations.map((row) => (
                    <tr key={row.id}>
                      <td>{fmtDate(row.date)}</td>
                      <td>
                        <Badge tone="info">{row.type}</Badge>
                      </td>
                      <td className="wrap">{row.text}</td>
                      <td>
                        <Badge tone={row.status === 'open' ? 'warning' : 'success'}>{OBSERVATION_STATUS_LABELS[row.status]}</Badge>
                      </td>
                      <td className="wrap small">{row.resolution || '—'}</td>
                      <td className="cell-actions">
                        <IconButton icon="edit" label="تعديل" onClick={() => startObservation(row)} />
                        <IconButton
                          icon="trash"
                          label="حذف"
                          variant="danger"
                          onClick={() => runAction(() => deleteObservation(row.id), 'تم حذف الملاحظة.')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState icon="observations" title="لا ملاحظات مطابقة" description="أضف ملاحظة جديدة أو عدّل عوامل التصفية." />
          )}
        </Card>
      ) : null}

      {tab === 'evaluations' ? (
        <Card
          title="التقييمات"
          subtitle="تقييم شهري وسنوي على 8 معايير، كل معيار من 1 إلى 5."
          padded={false}
          actions={<Button size="sm" onClick={() => navigate('/evaluations')}>إدارة التقييمات</Button>}
        >
          {evaluations.length ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>الفترة</th>
                    <th>النوع</th>
                    {EVALUATION_CRITERIA.map((criterion, index) => (
                      <th key={criterion.id} title={criterion.name}>
                        م{index + 1}
                      </th>
                    ))}
                    <th>المجموع</th>
                    <th>المتوسط</th>
                    <th>تعليق عام</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map((row) => {
                    const summary = summarizeScores(row.scores);
                    return (
                      <tr key={row.id}>
                        <td>{monthLabel(row.year, row.month)}</td>
                        <td>{row.periodType === 'monthly' ? 'شهري' : 'سنوي'}</td>
                        {EVALUATION_CRITERIA.map((criterion) => (
                          <td key={criterion.id} className="num">
                            {row.scores?.[criterion.id] ?? '—'}
                          </td>
                        ))}
                        <td className="num">
                          {summary.sum} / {summary.count}
                        </td>
                        <td className="num">{fmtAvg(summary.average)}</td>
                        <td className="wrap small">{row.overallComment || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState icon="evaluations" title="لا تقييمات مسجلة" description="أضف تقييمًا شهريًا من صفحة التقييمات." />
          )}
        </Card>
      ) : null}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل ملاحظة' : 'ملاحظة جديدة'}
        subtitle={employee.name}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>إلغاء</Button>
            <Button variant="primary" icon="save" onClick={submitObservation}>
              حفظ
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="form-grid">
            <Field label="التاريخ" required error={errors.date} htmlFor="obs-date">
              <Input id="obs-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="النوع" required error={errors.type} htmlFor="obs-type">
              <Input
                id="obs-type"
                list="obs-types"
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              />
              <datalist id="obs-types">
                {settings.observationTypes.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
            <Field label="نص الملاحظة" required error={errors.text} htmlFor="obs-text" className="span-2">
              <Textarea id="obs-text" rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </Field>
            <Field label="الحالة" htmlFor="obs-status">
              <Select
                id="obs-status"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as 'open' | 'closed' })}
              >
                <option value="open">مفتوحة</option>
                <option value="closed">مغلقة</option>
              </Select>
            </Field>
            <Field label="المعالجة" htmlFor="obs-resolution">
              <Input
                id="obs-resolution"
                value={draft.resolution}
                onChange={(e) => setDraft({ ...draft, resolution: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
