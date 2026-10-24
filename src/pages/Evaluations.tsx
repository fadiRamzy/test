import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate, useRoute } from '../state/router';
import {
  approveEvaluation,
  findEvaluationConflict,
  restoreEvaluation,
  saveEvaluation,
  softDeleteEvaluation,
  unlockEvaluation,
} from '../db/repo';
import { summarizeScores, evaluationTone, deriveAnnualScores } from '../lib/evaluation';
import { computeEmployeeStats } from '../lib/analytics';
import { fmtNumber, monthLabel, monthName } from '../lib/format';
import type { Evaluation, EvaluationScores } from '../db/schema';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  ProgressBar,
  SearchInput,
  Select,
  StatCard,
  Table,
  TableWrap,
  Tabs,
  Textarea,
} from '../components/ui';
import { useLookups } from '../components/domain';

type PeriodFilter = 'all' | 'monthly' | 'annual';

export function EvaluationsPage() {
  const { settings, runAction, notify } = useApp();
  const data = useVisibleData();
  const route = useRoute();
  const lookups = useLookups();

  const now = new Date();
  const [employee, setEmployee] = useState(route.query.get('employee') ?? 'all');
  const [year, setYear] = useState(String(now.getFullYear()));
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Evaluation | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<Evaluation | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<Evaluation | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (route.query.get('new') === '1' || route.query.get('employee')) {
      setEditing(null);
      setModalOpen(route.query.get('new') === '1');
    }
  }, [route.query]);

  const source = showArchived ? data.archivedEvaluations : data.evaluations;

  const years = useMemo(() => {
    const set = new Set<number>(source.map((e) => e.year));
    set.add(now.getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [source, now]);

  const filtered = useMemo(
    () =>
      source
        .filter((evaluation) => (employee === 'all' ? true : evaluation.employeeId === employee))
        .filter((evaluation) => (year === 'all' ? true : evaluation.year === Number(year)))
        .filter((evaluation) => (period === 'all' ? true : evaluation.periodType === period))
        .filter((evaluation) => {
          const needle = search.trim().toLowerCase();
          if (!needle) return true;
          return `${lookups.employeeName(evaluation.employeeId)} ${evaluation.overallComment ?? ''}`.toLowerCase().includes(needle);
        }),
    [source, employee, year, period, search, lookups],
  );

  const summary = useMemo(() => {
    const averages = filtered
      .map((evaluation) => summarizeScores(evaluation.scores, settings.evaluationCriteria, settings.ratingScale.max))
      .filter((s) => s.average !== null) as Array<{ average: number }>;
    return {
      count: filtered.length,
      approved: filtered.filter((e) => e.status === 'approved').length,
      average: averages.length ? averages.reduce((sum, s) => sum + s.average, 0) / averages.length : null,
      incomplete: filtered.filter(
        (e) => summarizeScores(e.scores, settings.evaluationCriteria, settings.ratingScale.max).missingCriteria.length > 0,
      ).length,
    };
  }, [filtered, settings]);

  const startNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  return (
    <>
      <PageHeader
        title="التقييمات الشهرية والسنوية"
        description="ثمانية معايير بمقياس قابل للتخصيص. المتوسط الافتراضي = مجموع الدرجات المسجلة ÷ عدد المعايير المسجلة (بدون أوزان أو صيغ رسمية)."
        actions={
          <>
            <Button icon={showArchived ? 'list' : 'archive'} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'العودة للنشطة' : 'المؤرشفة'}
            </Button>
            <Button variant="primary" icon="plus" onClick={startNew}>
              تقييم جديد
            </Button>
          </>
        }
      />

      <div className="grid grid--stats">
        <StatCard label="تقييمات معروضة" value={fmtNumber(summary.count)} hint={`${summary.approved} معتمد`} icon="evaluations" tone="primary" />
        <StatCard
          label="متوسط الدرجات"
          value={summary.average === null ? '—' : `${summary.average.toFixed(2)} / ${settings.ratingScale.max}`}
          hint="من التقييمات المعروضة"
          icon="chart"
          tone="info"
        />
        <StatCard label="تقييمات ناقصة" value={fmtNumber(summary.incomplete)} hint="بها معايير غير مسجلة" icon="alert" tone="warning" />
        <StatCard label="عدد المعايير النشطة" value={fmtNumber(settings.evaluationCriteria.filter((c) => c.active).length)} hint={`مقياس ${settings.ratingScale.min}–${settings.ratingScale.max}`} icon="list" tone="neutral" />
      </div>

      <div className="filter-bar mt-12">
        <SearchInput value={search} onChange={setSearch} placeholder="بحث باسم الموظف…" />
        <span className="filter-bar__label">الموظف</span>
        <Select value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="all">الكل</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">السنة</span>
        <Select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="all">الكل</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">النوع</span>
        <Select value={period} onChange={(e) => setPeriod(e.target.value as PeriodFilter)}>
          <option value="all">الكل</option>
          <option value="monthly">شهري</option>
          <option value="annual">سنوي</option>
        </Select>
        <span className="filter-count">{fmtNumber(filtered.length)} تقييم</span>
      </div>

      <Card padded={false}>
        {filtered.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الفترة</th>
                  <th>النوع</th>
                  <th>مجموع الدرجات</th>
                  <th>المعايير المسجلة</th>
                  <th>المتوسط</th>
                  <th>المستوى</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((evaluation) => {
                  const s = summarizeScores(evaluation.scores, settings.evaluationCriteria, settings.ratingScale.max);
                  return (
                    <tr key={evaluation.id}>
                      <td>
                        <span className="table__primary">{lookups.employeeName(evaluation.employeeId)}</span>
                        <span className="table__sub">{lookups.employeeCode(evaluation.employeeId)}</span>
                      </td>
                      <td className="nowrap">
                        {evaluation.periodType === 'annual' ? `سنة ${evaluation.year}` : monthLabel(evaluation.year, evaluation.month)}
                      </td>
                      <td>{evaluation.periodType === 'annual' ? 'سنوي' : 'شهري'}</td>
                      <td className="num">{fmtNumber(s.sum)}</td>
                      <td className="num">
                        {s.count} / {settings.evaluationCriteria.filter((c) => c.active).length}
                        {s.missingCriteria.length ? <span className="table__sub text-warning">ناقص {s.missingCriteria.length}</span> : null}
                      </td>
                      <td className="num">
                        <strong>{s.average === null ? '—' : s.average.toFixed(2)}</strong>
                      </td>
                      <td>
                        <div style={{ width: 90 }}>
                          <ProgressBar value={s.percentOfMax ?? 0} tone={evaluationTone(s.average, settings.ratingScale.max)} />
                        </div>
                      </td>
                      <td>
                        {evaluation.status === 'approved' ? <Badge tone="success">معتمد</Badge> : <Badge tone="neutral">مسودة</Badge>}
                        {evaluation.unlockReason ? <span className="table__sub text-warning">فُتح للتعديل</span> : null}
                      </td>
                      <td className="actions">
                        <IconButton
                          icon="edit"
                          label="تعديل"
                          onClick={() => {
                            setEditing(evaluation);
                            setModalOpen(true);
                          }}
                        />
                        {evaluation.status === 'approved' ? (
                          <IconButton
                            icon="unlock"
                            label="فتح للتعديل"
                            onClick={() => {
                              setUnlockTarget(evaluation);
                              setUnlockReason('');
                            }}
                          />
                        ) : (
                          <IconButton
                            icon="check"
                            label="اعتماد"
                            onClick={() => void runAction(() => approveEvaluation(evaluation.id), 'تم اعتماد التقييم.')}
                          />
                        )}
                        {showArchived ? (
                          <IconButton icon="restore" label="استعادة" onClick={() => void runAction(() => restoreEvaluation(evaluation.id), 'تمت الاستعادة.')} />
                        ) : (
                          <IconButton icon="trash" label="أرشفة" variant="danger" onClick={() => setArchiveTarget(evaluation)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="evaluations"
            title="لا توجد تقييمات مطابقة"
            description="أنشئ تقييمًا شهريًا ثم اشتق التقييم السنوي من الشهور المسجلة."
            action={
              <Button variant="primary" icon="plus" onClick={startNew}>
                تقييم جديد
              </Button>
            }
          />
        )}
      </Card>

      <EvaluationEditor
        open={modalOpen}
        evaluation={editing}
        defaultEmployeeId={employee !== 'all' ? employee : undefined}
        onClose={() => setModalOpen(false)}
        onNotify={notify}
        onSave={async (payload, approve) => {
          const saved = await runAction(
            () => saveEvaluation({ ...payload, status: approve ? 'approved' : payload.status }),
            'تم حفظ التقييم.',
          );
          if (saved && approve && saved.status !== 'approved') {
            await runAction(() => approveEvaluation(saved.id), 'تم اعتماد التقييم.');
          }
          setModalOpen(false);
        }}
      />

      <Modal
        open={Boolean(unlockTarget)}
        onClose={() => setUnlockTarget(null)}
        title="فتح تقييم معتمد للتعديل"
        subtitle="يتطلب النظام سببًا موثقًا يُحفظ في سجل التغييرات."
        size="sm"
        footer={
          <>
            <Button
              variant="danger"
              icon="unlock"
              disabled={!unlockReason.trim()}
              onClick={() => {
                const target = unlockTarget;
                setUnlockTarget(null);
                if (target) void runAction(() => unlockEvaluation(target.id, unlockReason), 'تم فتح التقييم للتعديل.');
              }}
            >
              فتح للتعديل
            </Button>
            <Button onClick={() => setUnlockTarget(null)}>إلغاء</Button>
          </>
        }
      >
        <Field label="سبب الفتح" required>
          <Textarea value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} rows={3} placeholder="مثال: تصحيح درجة معيار بعد مراجعة إضافية" />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة التقييم"
        message="سيتم أرشفة التقييم (حذف ناعم) مع إمكانية استعادته من «المؤرشفة»."
        confirmLabel="أرشفة"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void runAction(() => softDeleteEvaluation(target.id), 'تمت أرشفة التقييم.');
        }}
      />

      <EmployeeEvaluationHistory employeeId={employee} year={year} />
    </>
  );
}

function EmployeeEvaluationHistory({ employeeId, year }: { employeeId: string; year: string }) {
  const { settings } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();

  const employees = employeeId === 'all' ? data.employees : data.employees.filter((e) => e.id === employeeId);
  if (!employees.length) return null;

  return (
    <Card className="mt-16" title="سجل الأداء الشهري" subtitle="المتوسط والزيارات لكل شهر — يساعد في إعداد التقييم السنوي">
      <Tabs
        tabs={employees.slice(0, 12).map((employee) => ({ id: employee.id, label: employee.fullName }))}
        value={employees[0].id}
        onChange={() => undefined}
      />
      <div className="mt-12 stack">
        {employees.slice(0, 3).map((employee) => {
          const stats = computeEmployeeStats(employee, data, settings);
          const monthly = stats.evaluations
            .filter((e) => e.periodType === 'monthly' && (year === 'all' || e.year === Number(year)))
            .sort((a, b) => (a.year === b.year ? (a.month ?? 0) - (b.month ?? 0) : a.year - b.year));
          return (
            <div key={employee.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 13 }}>
                  {employee.fullName} <span className="small muted">({lookups.branchName(employee.branchId)})</span>
                </strong>
                <Button size="sm" variant="ghost" icon="reports" onClick={() => navigate(`/reports?employee=${employee.id}`)}>
                  تقرير كامل
                </Button>
              </div>
              {monthly.length ? (
                <TableWrap>
                  <Table className="table--compact">
                    <thead>
                      <tr>
                        <th>الشهر</th>
                        <th>المتوسط</th>
                        <th>المعايير المسجلة</th>
                        <th>الزيارات في الشهر</th>
                        <th>ملاحظات الشهر</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map((evaluation) => {
                        const s = summarizeScores(evaluation.scores, settings.evaluationCriteria, settings.ratingScale.max);
                        const monthKey = `${evaluation.year}-${String(evaluation.month).padStart(2, '0')}`;
                        const visits = data.visits.filter((v) => v.employeeId === employee.id && v.visitDate.startsWith(monthKey));
                        const observations = data.observations.filter(
                          (o) => o.employeeId === employee.id && o.date.startsWith(monthKey),
                        );
                        return (
                          <tr key={evaluation.id}>
                            <td>{monthName(evaluation.month)} {evaluation.year}</td>
                            <td className="num">{s.average === null ? '—' : s.average.toFixed(2)}</td>
                            <td className="num">{s.count} / {settings.evaluationCriteria.filter((c) => c.active).length}</td>
                            <td className="num">{visits.length} ({visits.filter((v) => v.status === 'completed').length} مكتملة)</td>
                            <td className="num">{observations.length}</td>
                            <td>{evaluation.status === 'approved' ? <Badge tone="success">معتمد</Badge> : <Badge tone="neutral">مسودة</Badge>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              ) : (
                <p className="small muted">لا يوجد سجل شهري لهذا العام.</p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function EvaluationEditor({
  open,
  evaluation,
  defaultEmployeeId,
  onClose,
  onSave,
  onNotify,
}: {
  open: boolean;
  evaluation: Evaluation | null;
  defaultEmployeeId?: string;
  onClose: () => void;
  onSave: (payload: Partial<Evaluation>, approve: boolean) => Promise<void>;
  onNotify: (message: string, kind?: 'success' | 'error' | 'info' | 'warning') => void;
}) {
  const { settings } = useApp();
  const data = useVisibleData();
  const now = new Date();
  const [employeeId, setEmployeeId] = useState(evaluation?.employeeId ?? defaultEmployeeId ?? '');
  const [periodType, setPeriodType] = useState<'monthly' | 'annual'>(evaluation?.periodType ?? 'monthly');
  const [year, setYear] = useState(evaluation?.year ?? now.getFullYear());
  const [month, setMonth] = useState(evaluation?.month ?? now.getMonth() + 1);
  const [scores, setScores] = useState<EvaluationScores>(evaluation?.scores ?? {});
  const [comments, setComments] = useState<Record<string, string>>(evaluation?.comments ?? {});
  const [overallComment, setOverallComment] = useState(evaluation?.overallComment ?? '');
  const [derived, setDerived] = useState(evaluation?.derivedFromMonthly ?? false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(evaluation?.employeeId ?? defaultEmployeeId ?? '');
    setPeriodType(evaluation?.periodType ?? 'monthly');
    setYear(evaluation?.year ?? now.getFullYear());
    setMonth(evaluation?.month ?? now.getMonth() + 1);
    setScores(evaluation?.scores ?? {});
    setComments(evaluation?.comments ?? {});
    setOverallComment(evaluation?.overallComment ?? '');
    setDerived(evaluation?.derivedFromMonthly ?? false);
  }, [open, evaluation, defaultEmployeeId, now]);

  const criteria = settings.evaluationCriteria.filter((c) => c.active);
  const summary = summarizeScores(scores, criteria, settings.ratingScale.max);
  const scaleValues = Array.from(
    { length: settings.ratingScale.max - settings.ratingScale.min + 1 },
    (_, index) => settings.ratingScale.min + index,
  );

  const periodVisits = useMemo(() => {
    if (!employeeId) return 0;
    return data.visits.filter((visit) => {
      if (visit.employeeId !== employeeId) return false;
      const date = visit.visitDate.slice(0, 7);
      if (periodType === 'annual') return date.startsWith(String(year));
      return date === `${year}-${String(month).padStart(2, '0')}`;
    }).length;
  }, [data.visits, employeeId, periodType, year, month]);

  const periodMinutes = useMemo(() => {
    if (!employeeId) return 0;
    return data.minutes.filter((minute) => {
      if (minute.employeeId !== employeeId) return false;
      const date = (minute.receivedAt ?? '').slice(0, 7);
      if (periodType === 'annual') return date.startsWith(String(year));
      return date === `${year}-${String(month).padStart(2, '0')}`;
    }).length;
  }, [data.minutes, employeeId, periodType, year, month]);

  const applyDerivation = () => {
    const result = deriveAnnualScores(data.evaluations, year, criteria);
    if (!result.monthsUsed.length) {
      onNotify('لا توجد تقييمات شهرية مسجلة لهذه السنة للاشتقاق.', 'warning');
      return;
    }
    setPeriodType('annual');
    setMonth(1);
    setScores(result.scores);
    setDerived(true);
    onNotify(`تم اشتقاق الدرجات من ${result.monthsUsed.length} شهرًا مسجلًا — راجع القيم قبل الحفظ.`, 'info');
  };

  const handleSave = async (approve: boolean) => {
    if (!employeeId) {
      onNotify('اختر الموظف أولًا.', 'error');
      return;
    }
    setBusy(true);
    try {
      const conflict = await findEvaluationConflict({
        id: evaluation?.id,
        employeeId,
        periodType,
        year,
        month: periodType === 'annual' ? null : month,
      });
      if (conflict) {
        onNotify('يوجد تقييم مسجل لنفس الموظف ونفس الفترة. عدّل التقييم الموجود بدلًا من إنشاء آخر.', 'error');
        return;
      }
      await onSave(
        {
          id: evaluation?.id,
          employeeId,
          periodType,
          year,
          month: periodType === 'annual' ? null : month,
          scores,
          comments,
          overallComment,
          status: evaluation?.status ?? 'draft',
          unlockReason: evaluation?.unlockReason ?? null,
          unlockedAt: evaluation?.unlockedAt ?? null,
          derivedFromMonthly: derived,
          createdAt: evaluation?.createdAt,
          updatedAt: evaluation?.updatedAt,
          isDemo: evaluation?.isDemo ?? false,
        },
        approve,
      );
    } finally {
      setBusy(false);
    }
  };

  const locked = evaluation?.status === 'approved';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={evaluation ? 'تعديل التقييم' : 'تقييم جديد'}
      subtitle={`مقياس ${settings.ratingScale.min}–${settings.ratingScale.max} — المتوسط = المجموع ÷ عدد المعايير المسجلة`}
      size="lg"
      footer={
        <>
          <Button variant="primary" icon="save" onClick={() => handleSave(false)} loading={busy} disabled={locked}>
            حفظ كمسودة
          </Button>
          <Button variant="success" icon="check" onClick={() => handleSave(true)} disabled={busy || locked}>
            حفظ واعتماد
          </Button>
          <Button onClick={onClose}>إغلاق</Button>
        </>
      }
    >
      {locked ? (
        <Callout tone="warning" title="هذا التقييم معتمد" icon="lock">
          التقييمات المعتمدة محفوظة من التعديل. استخدم «فتح للتعديل» مع ذكر السبب من قائمة التقييمات.
        </Callout>
      ) : null}

      <div className="form-grid">
        <Field label="الموظف" required>
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={Boolean(evaluation)}>
            <option value="">— اختر الموظف —</option>
            {data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ({employee.employeeCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="نوع الفترة">
          <Select value={periodType} onChange={(e) => setPeriodType(e.target.value as 'monthly' | 'annual')} disabled={locked}>
            <option value="monthly">شهري</option>
            <option value="annual">سنوي</option>
          </Select>
        </Field>
        <Field label="السنة">
          <Input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={locked}
          />
        </Field>
        {periodType === 'monthly' ? (
          <Field label="الشهر">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={locked}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {monthName(value)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="summary-strip mt-12">
        <div className="summary-strip__item">
          <span>الزيارات في الفترة</span>
          <strong>{fmtNumber(periodVisits)}</strong>
        </div>
        <div className="summary-strip__item">
          <span>دقائق الصرف في الفترة</span>
          <strong>{fmtNumber(periodMinutes)}</strong>
        </div>
        <div className="summary-strip__item">
          <span>المتوسط المحسوب</span>
          <strong>{summary.average === null ? '—' : summary.average.toFixed(2)}</strong>
        </div>
        <div className="summary-strip__item">
          <span>المعايير المسجلة</span>
          <strong>
            {summary.count} / {criteria.length}
          </strong>
        </div>
        <div className="summary-strip__item">
          <span>البسط / المقام</span>
          <strong>
            {fmtNumber(summary.sum)} ÷ {summary.count}
          </strong>
        </div>
      </div>

      <div className="form-section mt-12">
        <div className="form-section__title">درجات المعايير</div>
        <div className="score-inputs">
          {criteria.map((criterion) => (
            <div className="score-row" key={criterion.id}>
              <div>
                <div className="score-row__label">{criterion.name}</div>
                <Input
                  className="mt-8"
                  placeholder="تعليق على المعيار (اختياري)"
                  value={comments[criterion.id] ?? ''}
                  disabled={locked}
                  onChange={(e) => setComments({ ...comments, [criterion.id]: e.target.value })}
                  style={{ fontSize: 12, minHeight: 30 }}
                />
              </div>
              <div className="scale">
                {scaleValues.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={scores[criterion.id] === value ? 'is-on' : ''}
                    disabled={locked}
                    onClick={() =>
                      setScores({ ...scores, [criterion.id]: scores[criterion.id] === value ? null : value })
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {summary.missingCriteria.length ? (
          <p className="small text-warning mt-8">
            معايير غير مسجلة ({summary.missingCriteria.length}):{' '}
            {summary.missingCriteria.map((id) => criteria.find((c) => c.id === id)?.name ?? id).join('، ')} — لا تدخل في المتوسط.
          </p>
        ) : null}
      </div>

      <div className="form-section">
        <Field label="ملاحظة عامة">
          <Textarea value={overallComment} onChange={(e) => setOverallComment(e.target.value)} rows={3} disabled={locked} />
        </Field>
        <div className="row mt-8">
          <Button size="sm" icon="chart" onClick={applyDerivation} disabled={locked}>
            اشتقاق من التقييمات الشهرية
          </Button>
          {derived ? <Badge tone="info">مشتق من الشهري</Badge> : null}
          <Button size="sm" variant="ghost" onClick={() => setScores({})} disabled={locked}>
            تفريغ الدرجات
          </Button>
        </div>
        {evaluation?.unlockReason ? (
          <p className="small text-warning mt-8">سبب الفتح السابق للتعديل: {evaluation.unlockReason}</p>
        ) : null}
      </div>
    </Modal>
  );
}
