import { useMemo } from 'react';
import { useApp } from '../state/store';
import { navigate } from '../state/router';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, StatCard, Table, TableWrap } from '../components/ui';
import { countNoun, fmtDate, fmtDateTime, NOUNS } from '../lib/format';
import { buildDashboard, visitState } from '../lib/tracking';
import { REVIEW_OUTCOME_LABELS } from '../db/schema';

export function DashboardPage() {
  const { data, settings, ready } = useApp();

  const counters = useMemo(
    () => buildDashboard(data, settings.deadlineMinutes),
    [data, settings.deadlineMinutes],
  );

  const nameOf = (id: string | null) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const openObservations = useMemo(
    () => data.observations.filter((row) => row.status === 'open').slice(0, 6),
    [data.observations],
  );

  const upcoming = useMemo(
    () =>
      data.visits.filter((visit) => visit.status !== 'completed' && visit.status !== 'cancelled').slice(0, 5),
    [data.visits],
  );

  if (!ready) return null;

  if (!data.employees.length) {
    return (
      <>
        <PageHeader title="لوحة المعلومات اليومية" description="نظرة سريعة على أحمال العمل والمهام المتأخرة." />
        <Card>
          <EmptyState
            icon="employees"
            title="ابدأ بإضافة الموظفين"
            description="أضف ضباط المخاطر (الاسم، الكود، القطاع، المحافظة، تاريخ الالتحاق) ثم سجّل دقائق الصرف والزيارات والتقييمات."
            action={
              <Button variant="primary" icon="plus" onClick={() => navigate('/employees')}>
                إضافة الموظفين
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="لوحة المعلومات اليومية"
        description={`${fmtDate(new Date())} — مهلة المراجعة المعتمدة ${settings.deadlineMinutes} دقيقة.`}
        actions={
          <>
            <Button icon="minutes" onClick={() => navigate('/minutes')}>
              دقائق الصرف
            </Button>
            <Button icon="visits" onClick={() => navigate('/visits')}>
              الزيارات
            </Button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard
          label="دقائق واردة اليوم"
          value={counters.incomingToday}
          hint={`إجمالي المسجل ${counters.incomingTotal}`}
          icon="minutes"
          tone="primary"
          onClick={() => navigate('/minutes?flag=all')}
        />
        <StatCard
          label="بانتظار طلب الملف"
          value={counters.fileNotRequested}
          hint="لم يُسجَّل وقت طلب الملف"
          icon="clock"
          tone="info"
          onClick={() => navigate('/minutes?flag=file_not_requested')}
        />
        <StatCard
          label="بانتظار استلام الملف"
          value={counters.waitingForFile}
          icon="upload"
          tone="info"
          onClick={() => navigate('/minutes?flag=waiting_file')}
        />
        <StatCard
          label="لم تبدأ المراجعة"
          value={counters.reviewNotStarted}
          icon="flag"
          tone="warning"
          onClick={() => navigate('/minutes?flag=review_not_started')}
        />
        <StatCard
          label="بانتظار الرد النهائي"
          value={counters.pendingFinalResponse}
          icon="reports"
          tone="warning"
          onClick={() => navigate('/minutes?flag=pending_response')}
        />
        <StatCard
          label="دقائق متأخرة عن المهلة"
          value={counters.overdueMinutes}
          icon="alert"
          tone="danger"
          onClick={() => navigate('/minutes?flag=overdue')}
        />
        <StatCard
          label="زيارات جارية"
          value={counters.visitsInProgress}
          icon="visits"
          tone="primary"
          onClick={() => navigate('/visits?flag=in_progress')}
        />
        <StatCard
          label="تقارير بانتظار التسليم"
          value={counters.reportsPendingSubmission}
          icon="upload"
          tone="neutral"
          onClick={() => navigate('/visits?flag=report_pending')}
        />
        <StatCard
          label="تقارير بانتظار المراجعة"
          value={counters.reportsPendingReview}
          icon="search"
          tone="info"
          onClick={() => navigate('/visits?flag=awaiting_review')}
        />
        <StatCard
          label="مهام متأخرة (دقائق + تقارير)"
          value={counters.overdueTasks}
          hint={`تقارير متأخرة: ${counters.overdueReports}`}
          icon="alert"
          tone="danger"
          onClick={() => navigate('/reports')}
        />
      </div>

      <Card title="حِمل العمل حسب الموظف" subtitle="مرتب تنازليًا بحسب المتأخرات ثم التقارير المعلّقة." padded={false}>
        {counters.workload.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>م</th>
                  <th>الموظف</th>
                  <th>دقائق مفتوحة</th>
                  <th>دقائق متأخرة</th>
                  <th>زيارات مفتوحة</th>
                  <th>تقارير معلّقة</th>
                  <th>ملاحظات مفتوحة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {counters.workload.map((row) => (
                  <tr key={row.employee.id}>
                    <td className="num">{row.employee.serial}</td>
                    <td>
                      <strong>{row.employee.name}</strong>
                      <div className="small muted">{row.employee.jobTitle}</div>
                    </td>
                    <td className="num">{row.openMinutes}</td>
                    <td className="num">{row.overdueMinutes ? <Badge tone="danger">{row.overdueMinutes}</Badge> : '0'}</td>
                    <td className="num">{row.openVisits}</td>
                    <td className="num">{row.pendingReports}</td>
                    <td className="num">{row.openObservations}</td>
                    <td>
                      <Button size="sm" onClick={() => navigate(`/employees/${row.employee.id}`)}>
                        الملف
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState icon="employees" title="لا يوجد موظفون نشطون" description="أضف موظفًا أو أعد تفعيل موظف مؤرشف." />
        )}
      </Card>

      <div className="grid-2">
        <Card title="أحدث الملاحظات المفتوحة" subtitle={countNoun(openObservations.length, NOUNS.observation)}>
          {openObservations.length ? (
            <ul className="timeline">
              {openObservations.map((row) => (
                <li key={row.id}>
                  <div className="timeline__head">
                    <Badge tone="warning">{row.type}</Badge>
                    <span className="small muted">{fmtDate(row.date)}</span>
                  </div>
                  <p className="small">{row.text}</p>
                  <span className="small muted">الموظف: {nameOf(row.employeeId)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="observations" title="لا ملاحظات مفتوحة" description="أي ملاحظة تُسجَّل تظهر هنا حتى تُغلق." />
          )}
        </Card>

        <Card title="تقارير وزيارات تحتاج متابعة">
          {upcoming.length ? (
            <ul className="timeline">
              {upcoming.map((visit) => {
                const state = visitState(visit, settings.deadlineMinutes);
                const label = state.reportPending
                  ? 'بانتظار التقرير'
                  : state.reportAwaitingReview
                    ? 'بانتظار المراجعة'
                    : state.needsCorrections
                      ? 'تحتاج تصحيحًا'
                      : 'جارية';
                return (
                <li key={visit.id}>
                  <div className="timeline__head">
                    <strong>{visit.refNo}</strong>
                    <Badge tone={state.overdue ? 'danger' : state.reportAwaitingReview ? 'info' : 'neutral'}>{label}</Badge>
                  </div>
                  <p className="small">
                    {visit.branchRef} — {nameOf(visit.employeeId)}
                  </p>
                  <span className="small muted">
                    عودة: {fmtDateTime(visit.returnAt)} · تسليم التقرير: {fmtDateTime(visit.reportSubmittedAt)}
                    {visit.reviewCycles?.length
                      ? ` · آخر نتيجة: ${REVIEW_OUTCOME_LABELS[visit.reviewCycles[visit.reviewCycles.length - 1].outcome]}`
                      : ''}
                  </span>
                </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="visits" title="لا تقارير معلّقة" description="كل الزيارات المسجلة مكتملة." />
          )}
        </Card>
      </div>

      <Callout tone="info" title="البيانات محلية على هذا المتصفح">
        كل ما تدخله يُحفظ في IndexedDB داخل هذا المتصفح فقط. لا تتم مزامنة البيانات بين الأجهزة، وقد تُفقد إذا حذفت
        بيانات المتصفح. صدّر نسخة JSON من صفحة الإعدادات بشكل دوري.
      </Callout>
    </>
  );
}
