import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { navigate } from '../state/router';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  ListCard,
  PageHeader,
  SearchInput,
  Select,
  Stat,
  Table,
  TableWrap,
  Toolbar,
} from '../components/ui';
import {
  EMPLOYEE_STATUS_LABELS,
  EVALUATION_CRITERIA,
  INSPECTION_RESULT_LABELS,
  MONTHS_AR,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  VISIT_STATUS_LABELS,
} from '../db/schema';
import { leaveTotals, minuteTiming, monthlyTotals, visitTiming } from '../lib/calc';
import { fmtDate, fmtDurationWords, fmtNumber, fmtTime, monthName } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

/**
 * ملف الموظف: كل ما يخص هذا الموظف فقط.
 * - بياناته وحالته
 * - محاضر يومية (كل التوقيتات + النتيجة + المدة + التأخير)
 * - توقيت الزيارات (كل الحقول + المدة)
 * - إجماليات: عدد المحاضر، عدد الزيارات، إجمالي مدة الزيارات
 * - سجلات أخرى مرتبطة به (تقييمات/ملاحظات/إجازات/زيارات ميدانية) عند وجودها فقط
 * لا تظهر أي سجلات أو مؤشرات تخص موظفين آخرين أو لوحة متابعة عامة.
 */
export function EmployeeProfilePage({ employeeId }: { employeeId: string }) {
  const { data } = useApp();

  // فلاتر سجلات هذا الموظف (الشهر / السنة / الفرع / بحث نصي) — لا تغيّر أي سجل محفوظ
  const [query, setQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');

  const employee = data.employees.find((row) => row.id === employeeId);

  const allMinutes = useMemo(
    () => data.minutes.filter((row) => row.employeeId === employeeId),
    [data.minutes, employeeId],
  );

  const allVisitTimings = useMemo(
    () =>
      data.visitTimings
        .filter((row) => row.employeeId === employeeId)
        .sort((a, b) => {
          const dateA = a.visitDate ?? '';
          const dateB = b.visitDate ?? '';
          if (dateA !== dateB) return dateA < dateB ? 1 : -1;
          return (a.departureTime ?? '') < (b.departureTime ?? '') ? 1 : -1;
        }),
    [data.visitTimings, employeeId],
  );

  const branches = useMemo(
    () => Array.from(new Set(allVisitTimings.map((row) => row.branch).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar')),
    [allVisitTimings],
  );

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const row of allMinutes) set.add((row.date ?? row.createdAt.slice(0, 10)).slice(0, 4));
    for (const row of allVisitTimings) if (row.visitDate) set.add(row.visitDate.slice(0, 4));
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => (a < b ? 1 : -1));
  }, [allMinutes, allVisitTimings]);

  const matchesPeriod = (isoDate: string) =>
    (yearFilter === 'all' || isoDate.startsWith(yearFilter)) &&
    (monthFilter === 'all' || Number(isoDate.slice(5, 7)) === Number(monthFilter));

  const minutes = useMemo(() => {
    const text = query.trim().toLowerCase();
    return allMinutes
      .filter((row) => matchesPeriod(row.date ?? row.createdAt.slice(0, 10)))
      .filter((row) =>
        !text
          ? true
          : `${row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : ''} ${row.responseTime ?? ''} ${row.fileReceivedTime ?? ''}`
              .toLowerCase()
              .includes(text),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMinutes, query, monthFilter, yearFilter]);

  const visitTimings = useMemo(() => {
    const text = query.trim().toLowerCase();
    return allVisitTimings
      .filter((row) => matchesPeriod(row.visitDate ?? ''))
      .filter((row) => (branchFilter === 'all' ? true : row.branch === branchFilter))
      .filter((row) =>
        !text ? true : `${row.clientName} ${row.branch} ${row.location}`.toLowerCase().includes(text),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVisitTimings, query, monthFilter, yearFilter, branchFilter]);

  const filtersActive = query !== '' || monthFilter !== 'all' || yearFilter !== 'all' || branchFilter !== 'all';
  const resetFilters = () => {
    setQuery('');
    setMonthFilter('all');
    setYearFilter('all');
    setBranchFilter('all');
  };

  const evaluations = useMemo(
    () =>
      data.evaluations
        .filter((row) => row.employeeId === employeeId)
        .sort((a, b) => b.year - a.year || b.month - a.month),
    [data.evaluations, employeeId],
  );

  const observations = useMemo(
    () => data.observations.filter((row) => row.employeeId === employeeId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [data.observations, employeeId],
  );

  const leaves = useMemo(
    () => data.leaves.filter((row) => row.employeeId === employeeId).sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [data.leaves, employeeId],
  );

  const leavePermissionRecords = useMemo(
    () => data.leavePermissions
      .filter((row) => row.employeeId === employeeId)
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [data.leavePermissions, employeeId],
  );
  const leavePermissionCounts = useMemo(() => ({
    leaves: leavePermissionRecords.filter((row) => row.requestType === 'leave').length,
    permissions: leavePermissionRecords.filter((row) => row.requestType === 'permission').length,
  }), [leavePermissionRecords]);

  const legacyVisits = useMemo(
    () => data.visits.filter((row) => row.employeeId === employeeId).sort((a, b) => (a.visitDate < b.visitDate ? 1 : -1)),
    [data.visits, employeeId],
  );

  const totals = useMemo(() => {
    const validTimings = visitTimings.map((row) => visitTiming(row));
    const visitMinutes = validTimings.reduce((sum, row) => sum + (row.valid ? (row.minutes ?? 0) : 0), 0);
    const minuteRows = minutes.map((row) => minuteTiming(row));
    const minuteMinutes = minuteRows.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
    return {
      minutesCount: minutes.length,
      visitsCount: visitTimings.length,
      validVisits: validTimings.filter((row) => row.valid).length,
      invalidVisits: validTimings.filter((row) => !row.valid).length,
      visitMinutes,
      minuteMinutes,
      lateMinutes: minuteRows.filter((row) => row.delayed).length,
      incompleteMinutes: minuteRows.filter((row) => row.invalid).length,
    };
  }, [minutes, visitTimings]);

  const leaveSum = leaveTotals(leaves);

  if (!employee) {
    return (
      <>
        <PageHeader title="ملف الموظف" eyebrow="الموظفون" />
        <Card>
          <EmptyState
            icon="user"
            title="الموظف غير موجود"
            description="ربما حُذف الموظف أو أن الرابط غير صحيح."
            action={
              <Button icon="arrow-left" onClick={() => navigate('/employees')}>
                رجوع لقائمة الموظفين
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const exportProfile = () => {
    downloadCsv(
      csvFileName(`employee-${employee.code}`),
      ['القسم', 'التاريخ', 'التفاصيل', 'القيمة'],
      [
        ...minutes.map((row) => {
          const timing = minuteTiming(row);
          return [
            'محضر يومي',
            row.date ?? row.createdAt.slice(0, 10),
            `طلب ${fmtTime(row.fileRequestTime)} · استلام ${fmtTime(row.fileReceivedTime)} · رد ${fmtTime(row.responseTime)}`,
            `${row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : '—'} · ${
              timing.minutes === null ? '—' : fmtDurationWords(timing.minutes)
            } · ${timing.invalid ? 'بيانات غير مكتملة' : timing.delayed ? 'متأخر' : 'في الوقت'}`,
          ];
        }),
        ...visitTimings.map((row) => {
          const timing = visitTiming(row);
          return [
            'زيارة موقوتة',
            row.visitDate,
            `${row.branch} — ${row.clientName}${row.location ? ` — ${row.location}` : ''}${row.notes ? ` — ${row.notes}` : ''}`,
            `تحرك ${fmtTime(row.departureTime)} · رجوع ${fmtTime(row.returnTime)} · ${
              timing.minutes === null ? 'مدة غير صالحة' : fmtDurationWords(timing.minutes)
            }`,
          ];
        }),
        ...evaluations.map((row) => {
          const monthly = monthlyTotals(row.scores, row.visits);
          return ['تقييم شهري', `${MONTHS_AR[row.month - 1]} ${row.year}`, `زيارات: ${monthly.visits} · درجات: ${monthly.scoresSum}`, monthly.total];
        }),
        ...observations.map((row) => ['ملاحظة', row.date, row.details, OBSERVATION_STATUS_LABELS[row.status]]),
        ...leaves.map((row) => [
          'إجازة/إذن',
          row.startDate,
          `${row.type} حتى ${row.endDate}`,
          row.unit === 'days' ? `${fmtNumber(row.days)} يوم` : `${fmtNumber(row.hours)} ساعة`,
        ]),
      ],
    );
  };

  const initials = employee.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return (
    <>
      <header className="profile-hero">
        <div className="profile-hero__top">
          <div className="profile-hero__avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="profile-hero__identity">
            <span className="profile-hero__eyebrow">ملف الموظف</span>
            <h1 className="profile-hero__name">{employee.name}</h1>
            <p className="profile-hero__role">
              {employee.jobTitle}
              <span className="profile-hero__dot" aria-hidden="true" />
              {employee.sector}
              <span className="profile-hero__dot" aria-hidden="true" />
              {employee.governorate}
            </p>
            <div className="profile-hero__badges">
              <Badge tone={employee.status === 'active' ? 'success' : 'neutral'}>
                {EMPLOYEE_STATUS_LABELS[employee.status]}
              </Badge>
              {employee.archived ? <Badge>مؤرشف</Badge> : null}
              <Badge tone="info">{employee.code}</Badge>
            </div>
          </div>
          <div className="profile-hero__actions">
            <Button icon="arrow-left" onClick={() => navigate('/employees')}>
              قائمة الموظفين
            </Button>
            <Button icon="download" onClick={exportProfile}>
              تصدير CSV
            </Button>
            <Button icon="print" onClick={() => window.print()}>
              طباعة
            </Button>
          </div>
        </div>
        <div className="profile-facts">
          <span className="profile-chip">
            <em>الكود</em>
            <strong className="mono">{employee.code}</strong>
          </span>
          <span className="profile-chip">
            <em>الرقم</em>
            <strong>{employee.employeeNo}</strong>
          </span>
          <span className="profile-chip">
            <em>التعيين</em>
            <strong>{fmtDate(employee.employmentDate)}</strong>
          </span>
          <span className="profile-chip profile-chip--wide">
            <em>الفروع</em>
            <strong>{employee.branches || '—'}</strong>
          </span>
        </div>
      </header>

      <section aria-labelledby="profile-summary">
        <h2 className="profile-section" id="profile-summary">
          ملخص النشاط
        </h2>
        <div className="stats profile-stats">
          <Stat
            icon="minutes"
            label="عدد المحاضر اليومية"
            value={totals.minutesCount}
            hint={`إجمالي مدد المحاضر: ${totals.minutesCount ? fmtDurationWords(totals.minuteMinutes) : '—'}`}
          />
          <Stat
            icon="visits"
            label="عدد الزيارات"
            value={totals.visitsCount}
            hint={totals.invalidVisits ? `${totals.invalidVisits} زيارة بمدة غير صالحة` : 'كل الزيارات بمدة صالحة'}
          />
          <Stat
            icon="clock"
            label="إجمالي مدة الزيارات"
            value={totals.validVisits ? fmtDurationWords(totals.visitMinutes) : '—'}
            hint={`محسوبة من ${totals.validVisits} زيارة`}
          />
          <Stat
            icon="alert"
            tone={totals.lateMinutes ? 'warning' : 'neutral'}
            label="محاضر متأخرة"
            value={totals.lateMinutes}
            hint={totals.incompleteMinutes ? `${totals.incompleteMinutes} محضر ناقص التوقيتات` : 'تجاوزت 60 دقيقة'}
          />
        </div>
      </section>

      <h2 className="profile-section">البيانات الأساسية</h2>
      <ListCard
        id="profile-details"
        title="بيانات الموظف"
        subtitle="البيانات المسجلة في قسم الموظفين — لا تُعدَّل من هنا"
        padded
        hideLabel="إخفاء البيانات"
        showLabel="إظهار البيانات"
        note="بيانات الموظف مخفية — اضغط «إظهار البيانات» لعرضها."
        actions={
          <>
            <Badge tone={employee.status === 'active' ? 'success' : 'neutral'}>{EMPLOYEE_STATUS_LABELS[employee.status]}</Badge>
            {employee.archived ? <Badge>مؤرشف</Badge> : null}
            <IconButton icon="edit" label="تعديل البيانات" onClick={() => navigate('/employees')} />
          </>
        }
      >
        <dl className="deflist">
          <div>
            <dt>رقم الموظف</dt>
            <dd>{employee.employeeNo}</dd>
          </div>
          <div>
            <dt>كود الموظف</dt>
            <dd className="mono">{employee.code}</dd>
          </div>
          <div>
            <dt>المسمى الوظيفي</dt>
            <dd>{employee.jobTitle}</dd>
          </div>
          <div>
            <dt>القطاع</dt>
            <dd>{employee.sector}</dd>
          </div>
          <div>
            <dt>المحافظة</dt>
            <dd>{employee.governorate}</dd>
          </div>
          <div>
            <dt>تاريخ التعيين</dt>
            <dd>{fmtDate(employee.employmentDate)}</dd>
          </div>
          <div>
            <dt>الفرع / الفروع</dt>
            <dd>{employee.branches || '—'}</dd>
          </div>
          <div>
            <dt>حالة الموظف</dt>
            <dd>{EMPLOYEE_STATUS_LABELS[employee.status]}</dd>
          </div>
        </dl>
        {employee.notes ? <p className="small muted note-block">ملاحظات: {employee.notes}</p> : null}
      </ListCard>

      <h2 className="profile-section">محاضر يومية</h2>
      <Card title="تصفية السجلات" subtitle="تُطبَّق على المحاضر والزيارات — لا تحذف أي سجل">
        <Toolbar>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالعميل أو الفرع أو المكان…" />
          <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} aria-label="الشهر">
            <option value="all">كل الشهور</option>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {monthName(value)}
              </option>
            ))}
          </Select>
          <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="السنة">
            <option value="all">كل السنوات</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="الفرع">
            <option value="all">كل الفروع</option>
            {branches.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Button size="sm" icon="restore" onClick={resetFilters} disabled={!filtersActive}>
            إعادة تعيين
          </Button>
        </Toolbar>
      </Card>

      <ListCard
        id="profile-minutes"
        title="محاضر يومية"
        subtitle={`محاضر ${employee.name} — ${totals.minutesCount} من ${allMinutes.length}`}
        hideLabel="إخفاء البيانات"
        showLabel="إظهار البيانات"
        note={`قائمة محاضر ${employee.name} مخفية — اضغط «إظهار البيانات» لعرضها.`}
      >
        {minutes.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>توقيت طلب الملف</th>
                  <th>توقيت استلام الملف</th>
                  <th>توقيت الرد على الملف</th>
                  <th>نتيجة الفحص</th>
                  <th>المدة</th>
                  <th>حالة التأخير</th>
                </tr>
              </thead>
              <tbody>
                {minutes.map((row) => {
                  const timing = minuteTiming(row);
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{fmtTime(row.fileRequestTime)}</td>
                      <td className="nowrap">{fmtTime(row.fileReceivedTime)}</td>
                      <td className="nowrap">{fmtTime(row.responseTime)}</td>
                      <td>
                        {row.inspectionResult ? (
                          <Badge tone={row.inspectionResult === 'has_notes' ? 'warning' : 'success'}>
                            {INSPECTION_RESULT_LABELS[row.inspectionResult]}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="nowrap" title={timing.reason ?? undefined}>
                        {timing.minutes === null ? '—' : fmtDurationWords(timing.minutes)}
                      </td>
                      <td>
                        {timing.invalid ? (
                          <Badge tone="neutral">بيانات غير مكتملة</Badge>
                        ) : timing.delayed ? (
                          <Badge tone="danger">متأخر</Badge>
                        ) : (
                          <Badge tone="success">في الوقت</Badge>
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
            icon="minutes"
            title={filtersActive ? 'لا محاضر مطابقة للفلاتر' : 'لا محاضر لهذا الموظف'}
            description={filtersActive ? 'جرّب تعديل الفلاتر أو إعادة تعيينها.' : 'سجّل المحاضر من قسم «محاضر يومية».'}
          />
        )}
      </ListCard>

      <h2 className="profile-section">الزيارات</h2>
      <ListCard
        id="profile-visits"
        title="توقيت الزيارات"
        subtitle={`زيارات ${employee.name} — ${totals.visitsCount} من ${allVisitTimings.length}`}
        hideLabel="إخفاء البيانات"
        showLabel="إظهار البيانات"
        note={`قائمة زيارات ${employee.name} مخفية — اضغط «إظهار البيانات» لعرضها.`}
        actions={
          <span className="small muted">
            إجمالي المدة: <strong>{totals.validVisits ? fmtDurationWords(totals.visitMinutes) : '—'}</strong>
          </span>
        }
      >
        {visitTimings.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>اسم العميل</th>
                  <th>مكان الزيارة</th>
                  <th>توقيت التحرك</th>
                  <th>توقيت الرجوع</th>
                  <th>مدة الزيارة</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {visitTimings.map((row) => {
                  const timing = visitTiming(row);
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{fmtDate(row.visitDate)}</td>
                      <td>{row.branch || '—'}</td>
                      <td>{row.clientName || '—'}</td>
                      <td>{row.location || '—'}</td>
                      <td className="nowrap">{fmtTime(row.departureTime)}</td>
                      <td className="nowrap">{fmtTime(row.returnTime)}</td>
                      <td className="nowrap" title={timing.reason ?? undefined}>
                        {timing.minutes === null ? (
                          <Badge tone="neutral">{timing.reason ?? 'مدة غير صالحة'}</Badge>
                        ) : (
                          fmtDurationWords(timing.minutes)
                        )}
                      </td>
                      <td className="wrap small">{row.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="visits"
            title={filtersActive ? 'لا زيارات مطابقة للفلاتر' : 'لا زيارات لهذا الموظف'}
            description={filtersActive ? 'جرّب تعديل الفلاتر أو إعادة تعيينها.' : 'سجّل الزيارات من قسم «توقيت الزيارات».'}
          />
        )}
      </ListCard>

      {evaluations.length ? (
        <ListCard id="profile-evaluations" title="التقييمات الشهرية" subtitle={`${evaluations.length} تقييم مسجل`} note="قائمة التقييمات مخفية — اضغط «إظهار البيانات» لعرضها.">
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
                      <td className="nowrap">
                        {MONTHS_AR[row.month - 1]} {row.year}
                      </td>
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
        </ListCard>
      ) : null}

      {observations.length ? (
        <ListCard id="profile-observations" title="الملاحظات" subtitle={`${observations.length} ملاحظة`} note="قائمة الملاحظات مخفية — اضغط «إظهار البيانات» لعرضها.">
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
        </ListCard>
      ) : null}

      {leaves.length ? (
        <ListCard
          id="profile-leaves"
          title="الإجازات والأذونات"
          subtitle={`${leaveSum.records} سجل · ${fmtNumber(leaveSum.days)} يوم · ${fmtNumber(leaveSum.hours)} ساعة`}
          note="قائمة الإجازات مخفية — اضغط «إظهار البيانات» لعرضها."
        >
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
        </ListCard>
      ) : null}

      <ListCard
        id="profile-leave-permission-records"
        title="طلبات الإجازات والأذونات"
        subtitle={`${leavePermissionCounts.leaves} إجازة · ${leavePermissionCounts.permissions} إذن · ${leavePermissionRecords.length} سجل`}
        note="قائمة الطلبات مخفية — اضغط «إظهار البيانات» لعرضها."
      >
        {leavePermissionRecords.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>نوع الطلب</th>
                  <th>نوع الإجازة أو الإذن</th>
                  <th className="num">مدة الإذن</th>
                  <th>السبب / الملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {leavePermissionRecords.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.date)}</td>
                    <td><Badge tone={row.requestType === 'leave' ? 'info' : 'warning'}>{row.requestType === 'leave' ? 'إجازة' : 'إذن'}</Badge></td>
                    <td>{row.category}</td>
                    <td className="num">{row.durationHours ? (row.durationHours === 1 ? 'ساعة واحدة' : 'ساعتان') : '—'}</td>
                    <td className="wrap small">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : <EmptyState title="لا توجد إجازات أو أذونات مسجلة لهذا الموظف" />}
      </ListCard>

      {legacyVisits.length ? (
        <ListCard id="profile-legacy-visits" title="زيارات ميدانية (سجلات سابقة)" subtitle={`${legacyVisits.length} سجل`} note="القائمة مخفية — اضغط «إظهار البيانات» لعرضها.">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>النوع</th>
                  <th>المرجع</th>
                  <th>الحالة</th>
                  <th>التقدير</th>
                </tr>
              </thead>
              <tbody>
                {legacyVisits.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.visitDate)}</td>
                    <td>{row.branch}</td>
                    <td>{row.visitType}</td>
                    <td>{row.reference || '—'}</td>
                    <td>
                      <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'warning'}>
                        {VISIT_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td>{row.finalAssessment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </ListCard>
      ) : null}
    </>
  );
}
