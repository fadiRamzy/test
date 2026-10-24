import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { readAudit } from '../db/database';
import { restoreEmployee, softDeleteEmployee } from '../db/repo';
import type { AuditEntry, Employee, Evaluation } from '../db/schema';
import { computeEmployeeStats } from '../lib/analytics';
import { fmtDate, fmtDateTime, fmtDecimal, fmtMinutes, fmtNumber, fmtPercent, monthLabel } from '../lib/format';
import { summarizeScores } from '../lib/evaluation';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  DefinitionList,
  EmptyState,
  PageHeader,
  ProgressBar,
  Table,
  TableWrap,
  Tabs,
} from '../components/ui';
import { EmployeeStatusBadge, MetricRow, useLookups } from '../components/domain';
import { EvaluationsTable, MinutesTable, ObservationDetails, ObservationsTable, VisitsTable } from '../components/RecordTables';
import { EmployeeForm } from '../components/forms/EmployeeForm';

type TabId = 'overview' | 'minutes' | 'visits' | 'observations' | 'evaluations' | 'history';

export function EmployeeDetailPage() {
  const route = useRoute();
  const id = route.segments[1];
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const [tab, setTab] = useState<TabId>((route.query.get('tab') as TabId) ?? 'overview');
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [selectedObservation, setSelectedObservation] = useState<string | null>(null);

  const employee = data.employees.find((e) => e.id === id) ?? data.archivedEmployees.find((e) => e.id === id);

  useEffect(() => {
    if (!employee) return;
    void readAudit(400).then((entries) =>
      setHistory(entries.filter((entry) => entry.entityId === employee.id || entry.summary.includes(employee.fullName))),
    );
  }, [employee, data]);

  const stats = useMemo(
    () => (employee ? computeEmployeeStats(employee, data, settings) : null),
    [employee, data, settings],
  );

  if (!employee || !stats) {
    return (
      <Card>
        <EmptyState
          icon="user"
          title="الموظف غير موجود"
          description="ربما تم أرشفته أو حُذف. تحقق من قائمة الموظفين أو المؤرشفين."
          action={<Button onClick={() => navigate('/employees')}>العودة للموظفين</Button>}
        />
      </Card>
    );
  }

  const observation = data.observations.find((o) => o.id === selectedObservation) ?? null;
  const latestMonthly = stats.latestMonthly;
  const monthlySummary = stats.latestMonthlySummary;

  return (
    <>
      <div className="breadcrumb">
        <a href="#/employees">الموظفون</a>
        <span>/</span>
        <span>{employee.fullName}</span>
      </div>

      <PageHeader
        title={
          <span className="row" style={{ gap: 10 }}>
            {employee.fullName}
            <EmployeeStatusBadge status={employee.status} />
            {employee.deletedAt ? <Badge tone="danger">مؤرشف</Badge> : null}
          </span>
        }
        description={`${employee.employeeCode} — ${employee.jobTitle || 'بدون مسمى'} — ${lookups.branchName(employee.branchId)}`}
        actions={
          <>
            <Button icon="reports" onClick={() => navigate(`/reports?employee=${employee.id}`)}>
              تقرير الموظف
            </Button>
            <Button icon="edit" onClick={() => setEditOpen(true)}>
              تعديل
            </Button>
            {employee.deletedAt ? (
              <Button
                variant="success"
                icon="restore"
                onClick={() => void runAction(() => restoreEmployee(employee.id), 'تمت استعادة الموظف.')}
              >
                استعادة
              </Button>
            ) : (
              <Button variant="danger" icon="archive" onClick={() => setArchiveOpen(true)}>
                أرشفة
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid--stats">
        <MetricCard label="نسبة الالتزام بالمهلة" value={stats.compliancePercent === null ? '—' : fmtPercent(stats.compliancePercent)} hint={`${stats.minutesMet} من ${stats.minutesClosed} دقيقة مغلقة`} />
        <MetricCard label="دقائق قيد التنفيذ" value={fmtNumber(stats.minutesPending)} hint={`${stats.minutesOverdue} متأخرة`} tone={stats.minutesOverdue > 0 ? 'danger' : undefined} />
        <MetricCard label="متوسط زمن معالجة الضابط" value={fmtMinutes(stats.avgOfficerMinutes)} hint="وقت العمل الفعلي" />
        <MetricCard label="متوسط زمن انتظار الفرع" value={fmtMinutes(stats.avgWaitingMinutes)} hint="من طلب الملف/الاستيضاح حتى الرد" />
        <MetricCard label="زيارات ميدانية" value={fmtNumber(stats.visitsTotal)} hint={`${stats.visitsThisMonth} هذا الشهر`} />
        <MetricCard label="جودة التقارير" value={stats.avgQuality === null ? '—' : `${fmtDecimal(stats.avgQuality)} / 5`} hint={`${stats.delayedReports} تقرير متأخر — ${stats.returnedReports} أعيد للتصحيح`} />
        <MetricCard label="ملاحظات مفتوحة" value={fmtNumber(stats.observationsOpen)} hint={`${stats.observationsRecurring} متكررة من ${stats.observationsTotal}`} tone={stats.observationsOpen > 0 ? 'warning' : undefined} />
        <MetricCard
          label="آخر تقييم شهري"
          value={monthlySummary?.average == null ? '—' : `${fmtDecimal(monthlySummary.average)} / ${settings.ratingScale.max}`}
          hint={latestMonthly ? monthLabel(latestMonthly.year, latestMonthly.month) : 'لا يوجد تقييم'}
        />
      </div>

      <Card className="mt-16" padded={false}>
        <Tabs
          tabs={[
            { id: 'overview', label: 'نظرة عامة' },
            { id: 'minutes', label: 'دقائق الصرف', count: stats.minutes.length },
            { id: 'visits', label: 'الزيارات', count: stats.visits.length },
            { id: 'observations', label: 'الملاحظات', count: stats.observations.length },
            { id: 'evaluations', label: 'التقييمات', count: stats.evaluations.length },
            { id: 'history', label: 'السجل الزمني' },
          ]}
          value={tab}
          onChange={(next) => setTab(next as TabId)}
        />

        <div style={{ padding: 16 }}>
          {tab === 'overview' ? (
            <div className="grid grid--2">
              <div>
                <h3 className="section-title">البيانات الوظيفية</h3>
                <DefinitionList
                  items={[
                    { label: 'الرقم الوظيفي', value: employee.employeeCode },
                    { label: 'الاسم', value: employee.fullName },
                    { label: 'المسمى الوظيفي', value: employee.jobTitle || '—' },
                    { label: 'الفرع', value: lookups.branchName(employee.branchId) },
                    { label: 'المحافظة', value: employee.governorate || '—' },
                    { label: 'تاريخ التعيين', value: fmtDate(employee.hireDate) },
                    { label: 'تاريخ الانتهاء', value: employee.endDate ? fmtDate(employee.endDate) : '—' },
                    { label: 'الهاتف', value: employee.phone || '—' },
                    { label: 'البريد الإلكتروني', value: employee.email || '—' },
                    { label: 'ملاحظات', value: employee.notes || '—' },
                  ]}
                />
              </div>
              <div>
                <h3 className="section-title">ملخص التقييم</h3>
                {monthlySummary ? (
                  <div className="card" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 13 }}>
                        {latestMonthly ? monthLabel(latestMonthly.year, latestMonthly.month) : ''}
                      </strong>
                      <Badge tone={latestMonthly?.status === 'approved' ? 'success' : 'neutral'}>
                        {latestMonthly?.status === 'approved' ? 'معتمد' : 'مسودة'}
                      </Badge>
                    </div>
                    <div className="row mt-8" style={{ gap: 14 }}>
                      <div>
                        <div className="stat__value" style={{ fontSize: 22 }}>
                          {monthlySummary.average === null ? '—' : monthlySummary.average.toFixed(2)}
                        </div>
                        <span className="small muted">المتوسط من {settings.ratingScale.max}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <ProgressBar
                          value={((monthlySummary.average ?? 0) / settings.ratingScale.max) * 100}
                          tone={monthlySummary.average === null ? 'neutral' : 'primary'}
                        />
                        <p className="small muted mt-8">
                          مجموع الدرجات {fmtNumber(monthlySummary.sum)} ÷ {monthlySummary.count} معيار مسجل
                        </p>
                      </div>
                    </div>
                    {monthlySummary.missingCriteria.length ? (
                      <Callout tone="warning" title="معايير غير مسجلة" icon="alert">
                        {monthlySummary.missingCriteria
                          .map((cid) => settings.evaluationCriteria.find((c) => c.id === cid)?.name ?? cid)
                          .join('، ')}
                      </Callout>
                    ) : null}
                    <div className="mt-12">
                      <Button size="sm" icon="evaluations" onClick={() => navigate(`/evaluations?employee=${employee.id}`)}>
                        إدارة التقييمات
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="small muted">لا يوجد تقييم شهري مسجل بعد.</p>
                )}

                <h3 className="section-title">مؤشرات تشغيلية</h3>
                <MetricRow label="دقائق مسجلة" value={fmtNumber(stats.minutesTotal)} />
                <MetricRow label="دقائق تجاوزت المهلة" value={fmtNumber(stats.minutesBreached)} tone={stats.minutesBreached ? 'danger' : undefined} />
                <MetricRow label="تقارير أعيدت للتصحيح" value={fmtNumber(stats.returnedReports)} tone={stats.returnedReports ? 'warning' : undefined} />
                <MetricRow label="مهام معلقة في الزيارات" value={fmtNumber(stats.pendingActions)} />
                <MetricRow label="ملاحظات تمت معالجتها" value={fmtNumber(stats.observationsResolved)} tone="success" />
                <MetricRow
                  label="التقييم السنوي"
                  value={
                    stats.annualSummary?.average != null
                      ? `${fmtDecimal(stats.annualSummary.average)} / ${settings.ratingScale.max} (${stats.annual?.year})`
                      : 'لا يوجد'
                  }
                />
              </div>
            </div>
          ) : null}

          {tab === 'minutes' ? (
            stats.minutes.length ? (
              <MinutesTable minutes={stats.minutes} showEmployee={false} />
            ) : (
              <EmptyState icon="minutes" title="لا توجد دقائق صرف" description="أضف دقيقة صرف جديدة من شاشة دقائق الصرف." />
            )
          ) : null}

          {tab === 'visits' ? (
            stats.visits.length ? (
              <div className="stack">
                <VisitsTable visits={stats.visits} showEmployee={false} />
                <div>
                  <h3 className="section-title">دورات المراجعة لكل زيارة</h3>
                  {stats.visits.map((visit) => (
                    <div className="cycle-card" key={visit.id}>
                      <div className="cycle-card__head">
                        <span className="cycle-card__title">
                          {visit.refNo} — {visit.clientRef}
                        </span>
                        <span className="small muted">{fmtDate(visit.visitDate)}</span>
                      </div>
                      {visit.reviewCycles?.length ? (
                        <ul className="timeline">
                          {visit.reviewCycles.map((cycle) => (
                            <li className="timeline__item" key={cycle.id}>
                              <span className={`timeline__marker ${cycle.reviewedAt ? 'timeline__marker--done' : 'timeline__marker--muted'}`} />
                              <div>
                                <div className="timeline__title">دورة #{cycle.cycleNo}</div>
                                <div className="timeline__meta">
                                  تسليم: {cycle.submittedAt ? fmtDate(cycle.submittedAt) : '—'} · مراجعة:{' '}
                                  {cycle.reviewedAt ? fmtDate(cycle.reviewedAt) : '—'} · تصحيحات:{' '}
                                  {cycle.correctionsRequestedAt ? fmtDate(cycle.correctionsRequestedAt) : '—'} · الجودة:{' '}
                                  {cycle.qualityScore ?? '—'}
                                </div>
                                {cycle.feedback ? <div className="small mt-8">{cycle.feedback}</div> : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="small muted">لا توجد دورات مسجلة.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState icon="visits" title="لا توجد زيارات ميدانية" description="سجّل زيارة من شاشة الزيارات والتقارير." />
            )
          ) : null}

          {tab === 'observations' ? (
            stats.observations.length ? (
              <div className="stack">
                <ObservationsTable observations={stats.observations} showEmployee={false} onOpen={(o) => setSelectedObservation(o.id)} />
                {observation ? (
                  <Card title="تفاصيل الملاحظة" subtitle={observation.refNo}>
                    <ObservationDetails observation={observation} />
                  </Card>
                ) : null}
              </div>
            ) : (
              <EmptyState icon="observations" title="لا توجد ملاحظات" description="سجّل ملاحظة من سجل الملاحظات لربطها بهذا الموظف." />
            )
          ) : null}

          {tab === 'evaluations' ? (
            stats.evaluations.length ? (
              <div className="stack">
                <EvaluationsTable evaluations={stats.evaluations} />
                <Card title="سجل التقييمات الشهرية" subtitle="المتوسط لكل شهر — بلا أوزان أو معادلات رسمية">
                  <TableWrap>
                    <Table className="table--compact">
                      <thead>
                        <tr>
                          <th>الشهر</th>
                          <th>مجموع الدرجات</th>
                          <th>المعايير المسجلة</th>
                          <th>المتوسط</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.monthlyAverages.map((row) => {
                          const evaluation = stats.evaluations.find(
                            (e: Evaluation) => e.periodType === 'monthly' && e.year === row.year && e.month === row.month,
                          );
                          const summary = evaluation
                            ? summarizeScores(evaluation.scores, settings.evaluationCriteria, settings.ratingScale.max)
                            : null;
                          return (
                            <tr key={`${row.year}-${row.month}`}>
                              <td>{monthLabel(row.year, row.month)}</td>
                              <td className="num">{summary ? fmtNumber(summary.sum) : '—'}</td>
                              <td className="num">
                                {summary ? `${summary.count} / ${settings.evaluationCriteria.filter((c) => c.active).length}` : '—'}
                              </td>
                              <td className="num">{row.average === null ? '—' : row.average.toFixed(2)}</td>
                              <td>{evaluation?.status === 'approved' ? <Badge tone="success">معتمد</Badge> : <Badge tone="neutral">مسودة</Badge>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </TableWrap>
                </Card>
              </div>
            ) : (
              <EmptyState icon="evaluations" title="لا توجد تقييمات" description="أنشئ تقييمًا شهريًا من شاشة التقييمات." />
            )
          ) : null}

          {tab === 'history' ? (
            history.length ? (
              <ul className="timeline">
                {history.map((entry, index) => (
                  <li className="timeline__item" key={`${entry.at}-${index}`}>
                    <span className="timeline__marker timeline__marker--done" />
                    <div>
                      <div className="timeline__title">{entry.summary}</div>
                      <div className="timeline__meta">{fmtDateTime(entry.at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="history" title="لا توجد تغييرات مسجلة" description="يُسجّل النظام كل إضافة أو تعديل أو أرشفة في سجل التغييرات." />
            )
          ) : null}
        </div>
      </Card>

      <EmployeeForm open={editOpen} employee={employee as Employee} onClose={() => setEditOpen(false)} />

      <ConfirmDialog
        open={archiveOpen}
        title="أرشفة الموظف"
        message="سيتم أرشفة الموظف مع الاحتفاظ بكل سجلاته. يمكن استعادته من فلتر «المؤرشفون»."
        confirmLabel="أرشفة"
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => {
          setArchiveOpen(false);
          void runAction(() => softDeleteEmployee(employee.id), 'تمت أرشفة الموظف.').then(() => navigate('/employees'));
        }}
      />
    </>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'danger' | 'warning';
}) {
  return (
    <div className={`stat stat--${tone ?? 'primary'}`}>
      <span className="stat__label">{label}</span>
      <div className="stat__value" style={{ fontSize: 20 }}>
        {value}
      </div>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}
