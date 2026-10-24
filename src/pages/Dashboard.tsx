import { useMemo } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate } from '../state/router';
import { computeDashboard, computeEmployeeStats } from '../lib/analytics';
import { countNoun, fmtDecimal, fmtNumber, fmtPercent, monthLabel } from '../lib/format';
import { SEVERITY_LABELS, type ObservationSeverity } from '../db/schema';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, StatCard, Table, TableWrap } from '../components/ui';
import { BarChart, DonutChart, LineChart } from '../components/Charts';
import { useLookups } from '../components/domain';
import { Icon } from '../components/Icon';

export function DashboardPage() {
  const { settings, demoMode } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();

  const metrics = useMemo(() => computeDashboard(data, settings), [data, settings]);

  const stats = useMemo(
    () => data.employees.map((employee) => computeEmployeeStats(employee, data, settings)),
    [data, settings],
  );

  const hasData = data.employees.length + data.minutes.length + data.visits.length + data.observations.length > 0;

  if (!hasData) {
    return (
      <>
        <PageHeader
          title="لوحة المعلومات"
          description="نظرة شاملة على أداء ضباط المخاطر بناءً على السجلات المحفوظة محليًا في هذا المتصفح."
        />
        <Card>
          <EmptyState
            icon="dashboard"
            title="لا توجد سجلات بعد"
            description="ابدأ بإضافة الفروع ثم الموظفين، أو استعد نسخة احتياطية سابقة. يمكنك أيضًا تفعيل البيانات التجريبية لاستكشاف النظام بمثال معزول تمامًا."
            action={
              <div className="row" style={{ justifyContent: 'center' }}>
                <Button variant="primary" icon="employees" onClick={() => navigate('/employees?new=1')}>
                  إضافة موظف
                </Button>
                <Button icon="settings" onClick={() => navigate('/settings?tab=backup')}>
                  استعادة نسخة احتياطية
                </Button>
                <Button icon="database" onClick={() => navigate('/settings?tab=demo')}>
                  البيانات التجريبية
                </Button>
              </div>
            }
          />
        </Card>
        <Callout tone="info" title="الخصوصية أولًا" icon="shield">
          كل البيانات تُخزَّن في IndexedDB داخل متصفحك فقط. لا يوجد خادم أو مزامنة أو إرسال بيانات. تذكّر أن مساحة
          المتصفح ليست نسخة احتياطية دائمة — صدّر نسخة JSON بانتظام.
        </Callout>
      </>
    );
  }

  const slaData = [
    { label: 'داخل المهلة', value: metrics.minutesMet, tone: '#15803d' },
    { label: 'تجاوز المهلة', value: metrics.minutesBreached, tone: '#b91c1c' },
    { label: 'قارب المهلة', value: metrics.minutesWarning, tone: '#b45309' },
    { label: 'متأخر (مفتوح)', value: metrics.minutesOverdue, tone: '#dc2626' },
    { label: 'قيد المراجعة', value: Math.max(0, metrics.minutesPending - metrics.minutesOverdue - metrics.minutesWarning), tone: '#2563eb' },
  ];

  const severityData = metrics.severityBreakdown.map((item) => ({
    label: SEVERITY_LABELS[item.severity as ObservationSeverity],
    value: item.count,
  }));

  const trendPoints = metrics.evaluationTrend.slice(-12).map((point) => ({
    label: `${point.month}/${String(point.year).slice(2)}`,
    value: point.average,
  }));

  return (
    <>
      <PageHeader
        title="لوحة المعلومات"
        description={`مؤشرات محسوبة من السجلات المحلية — ${settings.departmentName}${demoMode ? ' (بيانات تجريبية معزولة)' : ''}`}
        actions={
          <>
            <Button icon="reports" onClick={() => navigate('/reports')}>
              تقرير موظف
            </Button>
            <Button icon="minutes" onClick={() => navigate('/minutes?new=1')} variant="primary">
              دقيقة صرف جديدة
            </Button>
          </>
        }
      />

      {demoMode ? (
        <Callout tone="warning" title="وضع البيانات التجريبية مفعّل" icon="info">
          كل ما يظهر الآن سجلات تجريبية (isDemo) ولا يختلط مطلقًا بالسجلات الفعلية. أوقف الوضع من الإعدادات لعرض
          بياناتك الحقيقية.
        </Callout>
      ) : null}

      <div className="grid grid--stats" style={{ marginTop: 12 }}>
        <StatCard
          label="دقائق بانتظار المراجعة"
          value={fmtNumber(metrics.minutesPending)}
          hint={`${countNoun(metrics.minutesTotal, 'minute')} مسجلة`}
          tone="primary"
          icon="minutes"
          onClick={() => navigate('/minutes?status=pending')}
        />
        <StatCard
          label="دقائق متأخرة"
          value={fmtNumber(metrics.minutesOverdue)}
          hint="تجاوزت المهلة ولم تُغلق"
          tone="danger"
          icon="clock"
          onClick={() => navigate('/minutes?status=overdue')}
        />
        <StatCard
          label="نسبة الالتزام بالمهلة"
          value={metrics.compliancePercent === null ? '—' : fmtPercent(metrics.compliancePercent)}
          hint={`من ${fmtNumber(metrics.minutesMet + metrics.minutesBreached)} دقيقة مغلقة`}
          tone={
            metrics.compliancePercent === null
              ? 'neutral'
              : settings.thresholds.complianceTargetPercent > 0 &&
                  metrics.compliancePercent < settings.thresholds.complianceTargetPercent
                ? 'warning'
                : 'success'
          }
          icon="shield"
          onClick={() => navigate('/minutes?status=closed')}
        />
        <StatCard
          label="زيارات هذا الشهر"
          value={fmtNumber(metrics.visitsThisMonth)}
          hint={`${countNoun(metrics.visitsTotal, 'visit')} إجمالًا`}
          tone="info"
          icon="visits"
          onClick={() => navigate('/visits')}
        />
        <StatCard
          label="تقارير متأخرة"
          value={fmtNumber(metrics.delayedReports)}
          hint="تجاوزت حد التأخير المُعرَّف"
          tone="warning"
          icon="reports"
          onClick={() => navigate('/visits?filter=delayed')}
        />
        <StatCard
          label="تقارير مُعادة للتصحيح"
          value={fmtNumber(metrics.returnedReports)}
          hint="دورات مراجعة بها تصحيحات"
          tone="warning"
          icon="history"
          onClick={() => navigate('/visits?filter=returned')}
        />
        <StatCard
          label="ملاحظات مفتوحة"
          value={fmtNumber(metrics.observationsOpen)}
          hint={`${countNoun(metrics.observationsRepeated, 'observation')} متكررة`}
          tone="danger"
          icon="observations"
          onClick={() => navigate('/observations?status=open')}
        />
        <StatCard
          label="موظفون على رأس العمل"
          value={fmtNumber(metrics.employeesActive)}
          hint={`${countNoun(metrics.employeesInactive, 'employee')} غير نشط`}
          tone="primary"
          icon="employees"
          onClick={() => navigate('/employees')}
        />
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card title="توزيع حالة دقائق الصرف" subtitle="محسوبة من الطوابع الزمنية المسجلة وأوقات العمل الفعلية">
          <div className="row" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
            <DonutChart
              value={metrics.minutesMet}
              total={metrics.minutesMet + metrics.minutesBreached}
              label="التزام"
              tone={metrics.compliancePercent !== null && metrics.compliancePercent >= 90 ? '#15803d' : '#1d4ed8'}
            />
            <div style={{ flex: 1, minWidth: 190 }}>
              <BarChart data={slaData} height={150} />
            </div>
          </div>
        </Card>

        <Card title="اتجاه التقييمات الشهرية" subtitle="متوسط درجات المعايير المسجلة لكل شهر">
          <LineChart points={trendPoints} min={settings.ratingScale.min} max={settings.ratingScale.max} height={190} />
          {trendPoints.length > 0 ? (
            <p className="small muted mt-8">
              آخر فترة: {monthLabel(metrics.evaluationTrend[metrics.evaluationTrend.length - 1]?.year ?? 0, metrics.evaluationTrend[metrics.evaluationTrend.length - 1]?.month ?? null)} —
              المتوسط {fmtDecimal(metrics.evaluationTrend[metrics.evaluationTrend.length - 1]?.average ?? null)} من{' '}
              {settings.ratingScale.max}
            </p>
          ) : null}
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card
          title="أداء الفروع"
          subtitle="اضغط على أي فرع لعرض دقائقه"
          actions={
            <Button size="sm" icon="list" onClick={() => navigate('/minutes')}>
              كل الدقائق
            </Button>
          }
          padded={false}
        >
          {metrics.branchPerformance.length ? (
            <TableWrap>
              <Table className="table--compact">
                <thead>
                  <tr>
                    <th>الفرع</th>
                    <th>الدقائق</th>
                    <th>المغلقة</th>
                    <th>الالتزام</th>
                    <th>زيارات</th>
                    <th>ملاحظات مفتوحة</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.branchPerformance.map((row) => (
                    <tr key={row.branch.id}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => navigate(`/minutes?branch=${row.branch.id}`)}>
                          {row.branch.name}
                        </button>
                        <span className="table__sub">{row.branch.governorate}</span>
                      </td>
                      <td className="num">{fmtNumber(row.minutes)}</td>
                      <td className="num">{fmtNumber(row.closed)}</td>
                      <td className="num">
                        {row.compliancePercent === null ? (
                          '—'
                        ) : (
                          <Badge tone={row.compliancePercent >= 90 ? 'success' : row.compliancePercent >= 70 ? 'warning' : 'danger'}>
                            {fmtPercent(row.compliancePercent)}
                          </Badge>
                        )}
                      </td>
                      <td className="num">{fmtNumber(row.visits)}</td>
                      <td className="num">{fmtNumber(row.openObservations)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState icon="building" title="لا توجد فروع" description="أضف الفروع من الإعدادات لتظهر هنا." />
          )}
        </Card>

        <Card title="توزيع الملاحظات المفتوحة" subtitle="حسب درجة الخطورة" padded={false}>
          <div style={{ padding: 16 }}>
            <BarChart data={severityData} height={150} emptyMessage="لا توجد ملاحظات مفتوحة" />
            <Button size="sm" icon="observations" className="mt-12" onClick={() => navigate('/observations?status=open')}>
              عرض الملاحظات المفتوحة
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title="أحمال العمل الحالية"
        subtitle="الموظفون على رأس العمل — مرتبون حسب المتأخرات والملاحظات المفتوحة"
        className="mt-16"
        padded={false}
        actions={
          <Button size="sm" icon="evaluations" onClick={() => navigate('/evaluations')}>
            التقييمات
          </Button>
        }
      >
        {metrics.workloads.length ? (
          <TableWrap>
            <Table className="table--compact">
              <thead>
                <tr>
                  <th>ضابط المخاطر</th>
                  <th>الفرع</th>
                  <th>دقائق قيد التنفيذ</th>
                  <th>متأخرة</th>
                  <th>زيارات الشهر</th>
                  <th>ملاحظات مفتوحة</th>
                  <th>آخر تقييم</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {metrics.workloads.map((row) => {
                  const employeeStats = stats.find((s) => s.employee.id === row.employee.id);
                  const average = employeeStats?.latestMonthlySummary?.average ?? null;
                  return (
                    <tr key={row.employee.id}>
                      <td>
                        <span className="table__primary">{row.employee.fullName}</span>
                        <span className="table__sub">{row.employee.employeeCode}</span>
                      </td>
                      <td>{lookups.branchName(row.employee.branchId)}</td>
                      <td className="num">{fmtNumber(row.pendingMinutes)}</td>
                      <td className="num">
                        {row.overdueMinutes > 0 ? (
                          <Badge tone="danger">{fmtNumber(row.overdueMinutes)}</Badge>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="num">{fmtNumber(row.visits)}</td>
                      <td className="num">
                        {row.openObservations > 0 ? (
                          <Badge tone="warning">{fmtNumber(row.openObservations)}</Badge>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="num">
                        {average === null ? <span className="muted">—</span> : <strong>{fmtDecimal(average)}</strong>}
                        <span className="table__sub">من {settings.ratingScale.max}</span>
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="icon-btn icon-btn--primary"
                          aria-label={`ملف ${row.employee.fullName}`}
                          title="ملف الموظف"
                          onClick={() => navigate(`/employees/${row.employee.id}`)}
                        >
                          <Icon name="user" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState icon="employees" title="لا يوجد موظفون نشطون" description="أضف موظفًا أو فعّل حالته لعرض أحمال العمل." />
        )}
      </Card>
    </>
  );
}
