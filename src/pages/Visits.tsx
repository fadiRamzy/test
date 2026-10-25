import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Table,
  TableWrap,
  Tabs,
  Textarea,
} from '../components/ui';
import { ValidationError, addReviewCycle, deleteVisit, saveObservation, saveVisit, updateReviewCycle } from '../db/repo';
import {
  REVIEW_OUTCOME_LABELS,
  VISIT_STATUS_LABELS,
  type ReviewOutcome,
  type Visit,
  type VisitStatus,
} from '../db/schema';
import {
  fmtDate,
  fmtDateTime,
  fmtDurationShort,
  fromDateTimeInputValue,
  nowDateTimeInputValue,
  toDateTimeInputValue,
  todayInputValue,
} from '../lib/format';
import { VISIT_FLAG_LABELS, visitState, type VisitFlag } from '../lib/tracking';

interface Draft {
  id?: string;
  employeeId: string;
  branchRef: string;
  departureAt: string;
  arrivalAt: string;
  completedAt: string;
  returnAt: string;
  reportSubmittedAt: string;
  reportReviewedAt: string;
  finalEmailAt: string;
  status: VisitStatus;
  observations: string;
}

const FLAGS: VisitFlag[] = ['all', 'in_progress', 'report_pending', 'awaiting_review', 'corrections', 'completed'];

const emptyDraft = (employeeId = ''): Draft => ({
  employeeId,
  branchRef: '',
  departureAt: nowDateTimeInputValue(),
  arrivalAt: '',
  completedAt: '',
  returnAt: '',
  reportSubmittedAt: '',
  reportReviewedAt: '',
  finalEmailAt: '',
  status: 'in_progress',
  observations: '',
});

function matchesFlag(visit: Visit, flag: VisitFlag, deadline: number): boolean {
  const state = visitState(visit, deadline);
  switch (flag) {
    case 'all':
      return true;
    case 'in_progress':
      return visit.status === 'in_progress';
    case 'report_pending':
      return state.reportPending;
    case 'awaiting_review':
      return state.reportAwaitingReview;
    case 'corrections':
      return state.needsCorrections;
    case 'completed':
      return visit.status === 'completed';
    default:
      return true;
  }
}

export function VisitsPage() {
  const { data, settings, runAction } = useApp();
  const [flag, setFlag] = useState<VisitFlag>('all');
  const [employee, setEmployee] = useState('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [cyclesFor, setCyclesFor] = useState<Visit | null>(null);
  const [cycleDraft, setCycleDraft] = useState<{ reviewedAt: string; observations: string; corrections: string; outcome: ReviewOutcome }>({
    reviewedAt: nowDateTimeInputValue(),
    observations: '',
    corrections: '',
    outcome: 'pending',
  });
  const [cycleError, setCycleError] = useState('');
  const [obsDraft, setObsDraft] = useState<{ visitId: string; cycleId: string | null; date: string; type: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Visit | null>(null);

  const employees = data.employees.filter((row) => !row.archived);
  const nameOf = (id: string | null) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const counts = useMemo(() => {
    const map = {} as Record<VisitFlag, number>;
    for (const item of FLAGS) {
      map[item] = data.visits.filter((row) => matchesFlag(row, item, settings.deadlineMinutes)).length;
    }
    return map;
  }, [data.visits, settings.deadlineMinutes]);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.visits
      .filter((row) => matchesFlag(row, flag, settings.deadlineMinutes))
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) => (!text ? true : `${row.refNo} ${row.branchRef} ${row.observations}`.toLowerCase().includes(text)))
      .sort((a, b) => ((a.departureAt ?? a.createdAt) < (b.departureAt ?? b.createdAt) ? 1 : -1));
  }, [data.visits, flag, employee, query, settings.deadlineMinutes]);

  const liveVisit = cyclesFor ? data.visits.find((row) => row.id === cyclesFor.id) ?? cyclesFor : null;

  const startNew = () => {
    setErrors({});
    setDraft(emptyDraft(employees[0]?.id ?? ''));
  };

  const startEdit = (visit: Visit) => {
    setErrors({});
    setDraft({
      id: visit.id,
      employeeId: visit.employeeId ?? '',
      branchRef: visit.branchRef,
      departureAt: toDateTimeInputValue(visit.departureAt),
      arrivalAt: toDateTimeInputValue(visit.arrivalAt),
      completedAt: toDateTimeInputValue(visit.completedAt),
      returnAt: toDateTimeInputValue(visit.returnAt),
      reportSubmittedAt: toDateTimeInputValue(visit.reportSubmittedAt),
      reportReviewedAt: toDateTimeInputValue(visit.reportReviewedAt),
      finalEmailAt: toDateTimeInputValue(visit.finalEmailAt),
      status: visit.status,
      observations: visit.observations,
    });
  };

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      await runAction(
        () =>
          saveVisit({
            id: draft.id,
            employeeId: draft.employeeId || null,
            branchRef: draft.branchRef,
            departureAt: fromDateTimeInputValue(draft.departureAt),
            arrivalAt: fromDateTimeInputValue(draft.arrivalAt),
            completedAt: fromDateTimeInputValue(draft.completedAt),
            returnAt: fromDateTimeInputValue(draft.returnAt),
            reportSubmittedAt: fromDateTimeInputValue(draft.reportSubmittedAt),
            reportReviewedAt: fromDateTimeInputValue(draft.reportReviewedAt),
            finalEmailAt: fromDateTimeInputValue(draft.finalEmailAt),
            status: draft.status,
            observations: draft.observations,
          }),
        draft.id ? 'تم تحديث الزيارة.' : 'تم تسجيل الزيارة.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  const submitCycle = async () => {
    if (!liveVisit) return;
    setCycleError('');
    if (!cycleDraft.reviewedAt) {
      setCycleError('وقت المراجعة مطلوب');
      return;
    }
    const reviewedAt = fromDateTimeInputValue(cycleDraft.reviewedAt);
    try {
      await runAction(
        () =>
          addReviewCycle(liveVisit.id, {
            reviewedAt: reviewedAt ?? '',
            observations: cycleDraft.observations,
            corrections: cycleDraft.corrections,
            outcome: cycleDraft.outcome,
          }),
        'تمت إضافة دورة مراجعة جديدة.',
      );
      setCycleDraft({ reviewedAt: nowDateTimeInputValue(), observations: '', corrections: '', outcome: 'pending' });
    } catch {
      /* الرسالة ظهرت في التنبيه */
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <>
      <PageHeader
        title="الزيارات والتقارير"
        description="تسجيل أوقات الزيارة ودورات مراجعة التقرير — كل دورة تُحفظ بترتيبها الزمني ولا تُستبدل."
        actions={
          <Button variant="primary" icon="plus" onClick={startNew} disabled={!employees.length}>
            تسجيل زيارة
          </Button>
        }
      />

      <Tabs
        tabs={FLAGS.map((item) => ({ id: item, label: VISIT_FLAG_LABELS[item], count: counts[item] }))}
        value={flag}
        onChange={setFlag}
      />

      <Card padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالمرجع أو الفرع…" />
          <Select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="تصفية بالموظف">
            <option value="all">كل الموظفين</option>
            {data.employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <span className="toolbar__count">{rows.length} زيارة</span>
        </div>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>الموظف</th>
                  <th>الفرع / العميل</th>
                  <th>التحرك</th>
                  <th>الوصول</th>
                  <th>الإتمام</th>
                  <th>العودة</th>
                  <th>تسليم التقرير</th>
                  <th>مراجعة التقرير</th>
                  <th>البريد النهائي</th>
                  <th>تأخر التقرير</th>
                  <th>دورات</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = visitState(row, settings.deadlineMinutes);
                  return (
                    <tr key={row.id} className={state.overdue ? 'row--danger' : undefined}>
                      <td className="mono">{row.refNo}</td>
                      <td>{nameOf(row.employeeId)}</td>
                      <td>{row.branchRef}</td>
                      <td>{fmtDateTime(row.departureAt)}</td>
                      <td>{fmtDateTime(row.arrivalAt)}</td>
                      <td>{fmtDateTime(row.completedAt)}</td>
                      <td>{fmtDateTime(row.returnAt)}</td>
                      <td>{fmtDateTime(row.reportSubmittedAt)}</td>
                      <td>{fmtDateTime(row.reportReviewedAt)}</td>
                      <td>{fmtDateTime(row.finalEmailAt)}</td>
                      <td>{fmtDurationShort(state.reportDelayMinutes)}</td>
                      <td className="num">{state.cycles}</td>
                      <td>
                        <div className="stack-sm">
                          <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'info'}>
                            {VISIT_STATUS_LABELS[row.status]}
                          </Badge>
                          {state.reportPending ? <Badge tone="warning">بانتظار التقرير</Badge> : null}
                          {state.reportAwaitingReview ? <Badge tone="info">بانتظار المراجعة</Badge> : null}
                          {state.needsCorrections ? <Badge tone="danger">تحتاج تصحيحًا</Badge> : null}
                        </div>
                      </td>
                      <td className="cell-actions">
                        <IconButton icon="reports" label="دورات المراجعة" onClick={() => setCyclesFor(row)} />
                        <IconButton icon="edit" label="تعديل" onClick={() => startEdit(row)} />
                        <IconButton icon="trash" label="حذف" variant="danger" onClick={() => setConfirmDelete(row)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="visits"
            title="لا زيارات مطابقة"
            description={data.visits.length ? 'جرّب تغيير التصفية.' : 'سجّل أول زيارة ميدانية.'}
            action={
              <Button variant="primary" icon="plus" onClick={startNew} disabled={!employees.length}>
                تسجيل زيارة
              </Button>
            }
          />
        )}
      </Card>

      {/* ------------------------------ نموذج الزيارة ------------------------------ */}
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل زيارة' : 'تسجيل زيارة ميدانية'}
        subtitle="كل الأوقات تُدخل يدويًا. لا يمكن أن يسبق وقتٌ الوقتَ الذي قبله في السلسلة."
        size="lg"
        footer={
          <>
            <Button onClick={() => setDraft(null)}>إلغاء</Button>
            <Button variant="primary" icon="save" loading={saving} onClick={submit}>
              حفظ
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="form-grid">
            <Field label="الموظف المسؤول" required error={errors.employeeId} htmlFor="vis-employee">
              <Select id="vis-employee" value={draft.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">— اختر —</option>
                {employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.serial} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الفرع / مرجع العميل" required error={errors.branchRef} htmlFor="vis-branch">
              <Input id="vis-branch" value={draft.branchRef} onChange={(e) => set('branchRef', e.target.value)} />
            </Field>
            <Field label="وقت التحرك" error={errors.departureAt} htmlFor="vis-departure">
              <Input id="vis-departure" type="datetime-local" value={draft.departureAt} onChange={(e) => set('departureAt', e.target.value)} />
            </Field>
            <Field label="وقت الوصول" error={errors.arrivalAt} htmlFor="vis-arrival">
              <Input id="vis-arrival" type="datetime-local" value={draft.arrivalAt} onChange={(e) => set('arrivalAt', e.target.value)} />
            </Field>
            <Field label="وقت إتمام الزيارة" error={errors.completedAt} htmlFor="vis-completed">
              <Input id="vis-completed" type="datetime-local" value={draft.completedAt} onChange={(e) => set('completedAt', e.target.value)} />
            </Field>
            <Field label="وقت العودة" error={errors.returnAt} htmlFor="vis-return">
              <Input id="vis-return" type="datetime-local" value={draft.returnAt} onChange={(e) => set('returnAt', e.target.value)} />
            </Field>
            <Field label="وقت تسليم التقرير" error={errors.reportSubmittedAt} htmlFor="vis-submitted">
              <Input id="vis-submitted" type="datetime-local" value={draft.reportSubmittedAt} onChange={(e) => set('reportSubmittedAt', e.target.value)} />
            </Field>
            <Field label="وقت مراجعة التقرير" error={errors.reportReviewedAt} htmlFor="vis-reviewed">
              <Input id="vis-reviewed" type="datetime-local" value={draft.reportReviewedAt} onChange={(e) => set('reportReviewedAt', e.target.value)} />
            </Field>
            <Field label="وقت البريد النهائي" error={errors.finalEmailAt} htmlFor="vis-email">
              <Input id="vis-email" type="datetime-local" value={draft.finalEmailAt} onChange={(e) => set('finalEmailAt', e.target.value)} />
            </Field>
            <Field label="حالة الزيارة" htmlFor="vis-status">
              <Select id="vis-status" value={draft.status} onChange={(e) => set('status', e.target.value as VisitStatus)}>
                <option value="in_progress">جارية</option>
                <option value="report_pending">بانتظار التقرير</option>
                <option value="completed">مكتملة</option>
                <option value="cancelled">ملغاة</option>
              </Select>
            </Field>
            <Field label="ملاحظات الزيارة" htmlFor="vis-notes" className="span-2">
              <Textarea id="vis-notes" rows={2} value={draft.observations} onChange={(e) => set('observations', e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Modal>

      {/* --------------------------- دورات مراجعة التقرير --------------------------- */}
      <Modal
        open={Boolean(liveVisit)}
        onClose={() => setCyclesFor(null)}
        title="دورات مراجعة التقرير"
        subtitle={liveVisit ? `${liveVisit.refNo} — ${liveVisit.branchRef} — ${nameOf(liveVisit.employeeId)}` : ''}
        size="lg"
        footer={<Button onClick={() => setCyclesFor(null)}>إغلاق</Button>}
      >
        {liveVisit ? (
          <>
            {liveVisit.reviewCycles.length ? (
              <ol className="cycles">
                {liveVisit.reviewCycles.map((cycle) => (
                  <li key={cycle.id} className="cycle">
                    <div className="cycle__head">
                      <strong>الدورة {cycle.seq}</strong>
                      <span className="small muted">{fmtDateTime(cycle.reviewedAt)}</span>
                      <Badge
                        tone={
                          cycle.outcome === 'accepted'
                            ? 'success'
                            : cycle.outcome === 'corrections'
                              ? 'warning'
                              : cycle.outcome === 'rejected'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {REVIEW_OUTCOME_LABELS[cycle.outcome]}
                      </Badge>
                    </div>
                    <div className="cycle__grid">
                      <div>
                        <span className="small muted">الملاحظات</span>
                        <p className="small wrap">{cycle.observations || '—'}</p>
                      </div>
                      <div>
                        <span className="small muted">التصحيحات المطلوبة</span>
                        <p className="small wrap">{cycle.corrections || '—'}</p>
                      </div>
                    </div>
                    <div className="cycle__foot">
                      <Select
                        aria-label="نتيجة الدورة"
                        value={cycle.outcome}
                        onChange={(e) =>
                          runAction(
                            () => updateReviewCycle(liveVisit.id, cycle.id, { outcome: e.target.value as ReviewOutcome }),
                            'تم تحديث نتيجة الدورة.',
                          )
                        }
                      >
                        {(Object.keys(REVIEW_OUTCOME_LABELS) as ReviewOutcome[]).map((outcome) => (
                          <option key={outcome} value={outcome}>
                            {REVIEW_OUTCOME_LABELS[outcome]}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        icon="plus"
                        onClick={() =>
                          setObsDraft({
                            visitId: liveVisit.id,
                            cycleId: cycle.id,
                            date: todayInputValue(),
                            type: settings.observationTypes[0] ?? 'أخرى',
                            text: '',
                          })
                        }
                      >
                        ملاحظة على الدورة
                      </Button>
                      <span className="small muted">
                        {data.observations.filter((row) => row.cycleId === cycle.id).length} ملاحظة مرتبطة
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="reports" title="لا دورات مراجعة بعد" description="أضف أول دورة عند مراجعة التقرير." />
            )}

            <div className="cycle-add">
              <h3>إضافة دورة مراجعة</h3>
              <div className="form-grid">
                <Field label="وقت المراجعة" required htmlFor="cyc-at">
                  <Input
                    id="cyc-at"
                    type="datetime-local"
                    value={cycleDraft.reviewedAt}
                    onChange={(e) => setCycleDraft({ ...cycleDraft, reviewedAt: e.target.value })}
                  />
                </Field>
                <Field label="النتيجة" htmlFor="cyc-outcome">
                  <Select
                    id="cyc-outcome"
                    value={cycleDraft.outcome}
                    onChange={(e) => setCycleDraft({ ...cycleDraft, outcome: e.target.value as ReviewOutcome })}
                  >
                    {(Object.keys(REVIEW_OUTCOME_LABELS) as ReviewOutcome[]).map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {REVIEW_OUTCOME_LABELS[outcome]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="ملاحظات المراجعة" htmlFor="cyc-obs" className="span-2">
                  <Textarea
                    id="cyc-obs"
                    rows={2}
                    value={cycleDraft.observations}
                    onChange={(e) => setCycleDraft({ ...cycleDraft, observations: e.target.value })}
                  />
                </Field>
                <Field label="التصحيحات المطلوبة" htmlFor="cyc-corr" className="span-2">
                  <Textarea
                    id="cyc-corr"
                    rows={2}
                    value={cycleDraft.corrections}
                    onChange={(e) => setCycleDraft({ ...cycleDraft, corrections: e.target.value })}
                  />
                </Field>
              </div>
              {cycleError ? <p className="field__error">{cycleError}</p> : null}
              <Button variant="primary" icon="plus" onClick={submitCycle}>
                إضافة الدورة
              </Button>
            </div>
          </>
        ) : null}
      </Modal>

      {/* ------------------------- ملاحظة مرتبطة بدورة مراجعة ------------------------ */}
      <Modal
        open={Boolean(obsDraft)}
        onClose={() => setObsDraft(null)}
        title="ملاحظة على مراجعة التقرير"
        size="sm"
        footer={
          <>
            <Button onClick={() => setObsDraft(null)}>إلغاء</Button>
            <Button
              variant="primary"
              icon="save"
              onClick={async () => {
                if (!obsDraft || !liveVisit) return;
                try {
                  await runAction(
                    () =>
                      saveObservation({
                        employeeId: liveVisit.employeeId,
                        visitId: obsDraft.visitId,
                        cycleId: obsDraft.cycleId,
                        minuteId: null,
                        date: obsDraft.date,
                        type: obsDraft.type,
                        text: obsDraft.text,
                        status: 'open',
                        resolution: '',
                      }),
                    'تمت إضافة الملاحظة.',
                  );
                  setObsDraft(null);
                } catch {
                  /* تنبيه بالخطأ */
                }
              }}
            >
              حفظ
            </Button>
          </>
        }
      >
        {obsDraft ? (
          <div className="form-grid">
            <Field label="التاريخ" required htmlFor="cyc-obs-date">
              <Input
                id="cyc-obs-date"
                type="date"
                value={obsDraft.date}
                onChange={(e) => setObsDraft({ ...obsDraft, date: e.target.value })}
              />
            </Field>
            <Field label="النوع" htmlFor="cyc-obs-type">
              <Input
                id="cyc-obs-type"
                list="cycle-obs-types"
                value={obsDraft.type}
                onChange={(e) => setObsDraft({ ...obsDraft, type: e.target.value })}
              />
              <datalist id="cycle-obs-types">
                {settings.observationTypes.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
            <Field label="نص الملاحظة" required htmlFor="cyc-obs-text" className="span-2">
              <Textarea
                id="cyc-obs-text"
                rows={3}
                value={obsDraft.text}
                onChange={(e) => setObsDraft({ ...obsDraft, text: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف زيارة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteVisit(confirmDelete.id), 'تم حذف الزيارة.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <Callout tone="warning" title="تأكيد الحذف">
          سيتم حذف الزيارة «{confirmDelete?.refNo}» بتاريخ {confirmDelete ? fmtDate(confirmDelete.departureAt) : ''} مع كل دورات
          مراجعة التقرير الخاصة بها. الملاحظات تبقى محفوظة في سجل الموظف دون ارتباط.
        </Callout>
      </Modal>
    </>
  );
}
