import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { navigate } from '../state/router';
import { Button, Card, EmptyState, PageHeader, Select, Stat, Table, TableWrap } from '../components/ui';
import { MONTHS_AR } from '../db/schema';
import { dashboardCounts } from '../lib/calc';
import { fmtDate } from '../lib/format';

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, index) => current + 1 - index);
})();

export function DashboardPage() {
  const { data, settings } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const counts = useMemo(
    () =>
      dashboardCounts(
        { employees: data.employees, evaluations: data.evaluations, visits: data.visits, minutes: data.minutes, observations: data.observations },
        year,
        month,
      ),
    [data, year, month],
  );

  const recentObservations = useMemo(
    () => data.observations.filter((row) => row.status === 'open').slice(0, 5),
    [data.observations],
  );

  if (!data.employees.length) {
    return (
      <>
        <PageHeader title="لوحة المتابعة" description="ابدأ بإضافة الموظفين ثم سجّل التقييمات والزيارات." />
        <Card>
          <EmptyState
            title="لا يوجد موظفون بعد"
            description="أضف ضباط المخاطر مرة واحدة، ثم ستظهر أسماؤهم في كل الجداول تلقائيًا."
            action={
              <Button variant="primary" icon="plus" onClick={() => navigate('/employees')}>
                إضافة موظف
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
        title="لوحة المتابعة"
        description={`${settings.organizationName} — نظرة سريعة على ${MONTHS_AR[month - 1]} ${year}.`}
        actions={
          <>
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="الشهر">
              {MONTHS_AR.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </Select>
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
              {YEARS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </>
        }
      />

      <div className="stats">
        <Stat label="موظفون على رأس العمل" value={counts.activeEmployees} onClick={() => navigate('/employees')} />
        <Stat
          label={`زيارات ${MONTHS_AR[month - 1]}`}
          value={counts.visitsInPeriod}
          onClick={() => navigate('/visits')}
        />
        <Stat
          label="تقييمات شهرية مكتملة"
          value={counts.evaluationsCompleted}
          hint={`من ${counts.activeEmployees} موظفًا`}
          onClick={() => navigate('/monthly')}
        />
        <Stat
          label="موظفون بدون تقييم هذا الشهر"
          value={counts.evaluationsMissing}
          onClick={() => navigate('/monthly')}
        />
        <Stat label="ملاحظات مفتوحة" value={counts.openObservations} onClick={() => navigate('/observations')} />
        <Stat label="دقائق صرف بدون رد نهائي" value={counts.outstandingMinutes} onClick={() => navigate('/minutes')} />
      </div>

      <Card title="موظفون بدون تقييم شهري" subtitle={`${MONTHS_AR[month - 1]} ${year}`} padded={false}>
        {counts.employeesWithoutEvaluation.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th className="num">الرقم</th>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>القطاع</th>
                  <th>المحافظة</th>
                  <th>الفروع</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {counts.employeesWithoutEvaluation.map((employee) => (
                  <tr key={employee.id}>
                    <td className="num">{employee.employeeNo}</td>
                    <td>{employee.name}</td>
                    <td className="mono">{employee.code}</td>
                    <td>{employee.sector}</td>
                    <td>{employee.governorate}</td>
                    <td>{employee.branches || '—'}</td>
                    <td>
                      <Button size="sm" onClick={() => navigate('/monthly')}>
                        تسجيل التقييم
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="كل الموظفين تم تقييمهم هذا الشهر" />
        )}
      </Card>

      <Card title="أحدث الملاحظات المفتوحة" padded={false}>
        {recentObservations.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الموظف</th>
                  <th>التصنيف</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {recentObservations.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.date)}</td>
                    <td>{data.employees.find((employee) => employee.id === row.employeeId)?.name ?? '—'}</td>
                    <td>{row.category || '—'}</td>
                    <td className="wrap small">{row.details}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="لا ملاحظات مفتوحة" />
        )}
      </Card>
    </>
  );
}
