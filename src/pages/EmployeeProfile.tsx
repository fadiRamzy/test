import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { navigate } from '../state/router';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Table, TableWrap } from '../components/ui';
import {
  EMPLOYEE_STATUS_LABELS,
  EVALUATION_CRITERIA,
  MINUTE_RESULT_LABELS,
  MONTHS_AR,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  VISIT_STATUS_LABELS,
} from '../db/schema';
import { annualSummary, leaveTotals, minuteDurations, monthlyTotals, visitsByMonth } from '../lib/calc';
import { fmtDate, fmtNumber } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => current + 1 - index);
})();

export function EmployeeProfilePage({ employeeId }: { employeeId: string }) {
  const { data, settings } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());

  const employee = data.employees.find((row) => row.id === employeeId);

  const evaluations = useMemo(
    () =>
      data.evaluations
        .filter((row) => row.employeeId === employeeId && row.year === year)
        .sort((a, b) => a.month - b.month),
    [data.evaluations, employeeId, year],
  );
  const visits = useMemo(
    () => data.visits.filter((row) => row.employeeId === employeeId && row.visitDate.startsWith(String(year))),
    [data.visits, employeeId, year],
  );
  const minutes = useMemo(
    () => data.minutes.filter((row) => row.employeeId === employeeId && row.date.startsWith(String(year))),
    [data.minutes, employeeId, year],
  );
  const observations = useMemo(
    () => data.observations.filter((row) => row.employeeId === employeeId && row.date.startsWith(String(year))),
    [data.observations, employeeId, year],
  );
  const leaves = useMemo(
    () => data.leaves.filter((row) => row.employeeId === employeeId && row.startDate.startsWith(String(year))),
    [data.leaves, employeeId, year],
  );

  if (!employee) {
    return (
      <Card>
        <EmptyState title="الموظف غير موجود" description="ربما حُذف أو أن الرابط غير صحيح." />
      </Card>
    );
  }

  const summary = annualSummary(data.evaluations, employee, year, settings.ratingThresholds);
  const totals = leaveTotals(leaves);
  const visitSummary = visitsByMonth(data.visits, year, employeeId);

  const exportHistory = () => {
    downloadCsv(
      csvFileName(`history-${employee.code}-${year}`),
      ['القسم', 'التاريخ', 'التفاصيل', 'القيمة'],
      [
        ...evaluations.map((row) => {
          const monthly = monthlyTotals(row.scores, row.visits);
          return ['التقييم الشهري', `${row.month}/${row.year}`, `زيارات: ${monthly.visits} · مجموع الدرجات: ${monthly.scoresSum}`, monthly.total];
        }),
        ...visits.map((row) => ['زيارة ميدانية', row.visitDate, `${row.branch} — ${row.visitType}`, row.finalAssessment]),
        ...minutes.map((row) => ['دقيقة صرف', row.date, `${row.branch} — ${row.clientRef}`, MINUTE_RESULT_LABELS[row.result]]),
        ...observations.map((row) => ['ملاحظة', row.date, row.details, OBSERVATION_STATUS_LABELS[row.status]]),
        ...leaves.map((row) => ['إجازة/إذن', row.startDate, `${row.type} حتى ${row.endDate}`, row.unit === 'days' ? `${row.days} يوم` : `${row.hours} ساعة`]),
      ],
    );
  };

  return (
    <>
      <PageHeader
        title={employee.name}
        description={`${employee.jobTitle} · كود ${employee.code} · ${employee.sector} / ${employee.governorate} · تعيين ${fmtDate(employee.employmentDate)}`}
        actions={
          <>
            <Button icon="arrow-left" onClick={() => navigate('/employees')}>
              رجوع للقائمة
            </Button>
            <Button icon="download" onClick={exportHistory}>
              تصدير السجل CSV
            </Button>
            <Button icon="print" onClick={() => window.print()}>
              طباعة
            </Button>
          </>
        }
      />

      <Card
        title="البيانات الأساسية"
        actions={
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
            {YEARS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        }
      >
        <div className="stats" style={{ marginBottom: 0 }}>
          <div className="stat">
            <span className="stat__label">الرقم</span>
            <strong className="stat__value">{employee.employeeNo}</strong>
          </div>
          <div className="stat">
            <span className="stat__label">الحالة</span>
            <strong className="stat__value" style={{ fontSize: 14 }}>
              <Badge tone={employee.status === 'active' ? 'success' : 'neutral'}>{EMPLOYEE_STATUS_LABELS[employee.status]}</Badge>
              {employee.archived ? <Badge> مؤرشف</Badge> : null}
            </strong>
          </div>
          <div className="stat">
            <span className="stat__label">الزيارات المسجلة {year}</span>
            <strong className="stat__value">{visitSummary.total}</strong>
          </div>
          <div className="stat">
            <span className="stat__label">أشهر مقيَّمة {year}</span>
            <strong className="stat__value">{summary.evaluatedMonths.length}</strong>
          </div>
          <div className="stat">
            <span className="stat__label">مجموع نقاط {year}</span>
            <strong className="stat__value">{summary.points}</strong>
          </div>
          <div className="stat">
            <span className="stat__label">التقدير السنوي {year}</span>
            <strong className="stat__value" style={{ fontSize: 16 }}>
              {summary.rating ?? '—'}
            </strong>
          </div>
          <div className="stat">
            <span className="stat__label">إجازات (أيام)</span>
            <strong className="stat__value">{fmtNumber(totals.days)}</strong>
          </div>
          <div className="stat">
            <span className="stat__label">أذونات (ساعات)</span>
            <strong className="stat__value">{fmtNumber(totals.hours)}</strong>
          </div>
        </div>
        {employee.notes ? <p className="small muted" style={{ marginTop: 8 }}>ملاحظات: {employee.notes}</p> : null}
      </Card>

      <Card title={`التقييمات الشهرية ${year}`} subtitle={`مجموع النقاط السنوي: ${summary.points} · الزيارات: ${summary.visits} · الأشهر الناقصة: ${summary.missingMonths.length}`} padded={false}>
        {evaluations.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th className="num">الزيارات</th>
                  {EVALUATION_CRITERIA.map((criterion, index) => (
                    <th key={criterion.id} className="num" title={criterion.name}>
                      {index + 1}
                    </th>
                  ))}
                  <th className="num">الإجمالي</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((row) => {
                  const monthly = monthlyTotals(row.scores, row.visits);
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{MONTHS_AR[row.month - 1]}</td>
                      <td className="num">{monthly.visits}</td>
                      {EVALUATION_CRITERIA.map((criterion) => (
                        <td key={criterion.id} className="num">
                          {row.scores[criterion.id] ?? '—'}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{monthly.total}</strong>
                      </td>
                      <td className="wrap small">{row.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title={`لا تقييمات في ${year}`} description="سجّلها من صفحة التقييم الشهري." />
        )}
      </Card>

      <Card title={`الزيارات الميدانية ${year}`} subtitle={`الإجمالي ${visitSummary.total} زيارة`} padded={false}>
        {visits.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المنطقة</th>
                  <th>الفرع</th>
                  <th>النوع</th>
                  <th>المرجع</th>
                  <th>الحالة</th>
                  <th>التقدير</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.visitDate)}</td>
                    <td>{row.region || '—'}</td>
                    <td>{row.branch}</td>
                    <td>{row.visitType}</td>
                    <td>{row.reference || '—'}</td>
                    <td>
                      <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'warning'}>
                        {VISIT_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td>{row.finalAssessment || '—'}</td>
                    <td className="wrap small">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title={`لا زيارات في ${year}`} description="سجّلها من صفحة الزيارات الميدانية." />
        )}
      </Card>

      <Card title={`دقائق الصرف ${year}`} subtitle={`${minutes.length} دقيقة`} padded={false}>
        {minutes.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>العميل</th>
                  <th>نوع التمويل</th>
                  <th className="num">المبلغ</th>
                  <th>الاستلام</th>
                  <th>الرد النهائي</th>
                  <th className="num">المدة</th>
                  <th>النتيجة</th>
                </tr>
              </thead>
              <tbody>
                {minutes.map((row) => {
                  const durations = minuteDurations(row);
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{fmtDate(row.date)}</td>
                      <td>{row.branch}</td>
                      <td>{row.clientRef || '—'}</td>
                      <td>{row.financingType || '—'}</td>
                      <td className="num">{row.amount === null ? '—' : fmtNumber(row.amount)}</td>
                      <td>{row.minuteReceivedTime || '—'}</td>
                      <td>{row.finalResponseTime || '—'}</td>
                      <td className="num">{durations.totalMinutes === null ? '—' : `${durations.totalMinutes} د`}</td>
                      <td>{MINUTE_RESULT_LABELS[row.result]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title={`لا دقائق في ${year}`} description="سجّلها من صفحة دقائق الصرف." />
        )}
      </Card>

      <Card title={`الملاحظات ${year}`} subtitle={`${observations.length} ملاحظة`} padded={false}>
        {observations.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المصدر</th>
                  <th>التصنيف</th>
                  <th>الخطورة</th>
                  <th>التفاصيل</th>
                  <th>الإجراء التصحيحي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.date)}</td>
                    <td>{row.source}</td>
                    <td>{row.category || '—'}</td>
                    <td>
                      <Badge tone={row.severity === 'high' ? 'danger' : row.severity === 'medium' ? 'warning' : 'neutral'}>
                        {SEVERITY_LABELS[row.severity]}
                      </Badge>
                    </td>
                    <td className="wrap small">{row.details}</td>
                    <td className="wrap small">{row.correctiveAction || '—'}</td>
                    <td>
                      <Badge tone={row.status === 'open' ? 'warning' : 'success'}>{OBSERVATION_STATUS_LABELS[row.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title={`لا ملاحظات في ${year}`} />
        )}
      </Card>

      <Card title={`الإجازات والأذونات ${year}`} subtitle={`${totals.records} سجل · ${fmtNumber(totals.days)} يوم · ${fmtNumber(totals.hours)} ساعة`} padded={false}>
        {leaves.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th className="num">المدة</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((row) => (
                  <tr key={row.id}>
                    <td>{row.type}</td>
                    <td className="nowrap">{fmtDate(row.startDate)}</td>
                    <td className="nowrap">{fmtDate(row.endDate)}</td>
                    <td className="num">{row.unit === 'days' ? `${fmtNumber(row.days)} يوم` : `${fmtNumber(row.hours)} ساعة`}</td>
                    <td className="wrap small">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title={`لا إجازات في ${year}`} />
        )}
      </Card>
    </>
  );
}
