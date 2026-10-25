import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, SearchInput, Select, TableWrap, Toolbar } from '../components/ui';
import { saveMonthlyBatch } from '../db/repo';
import { EVALUATION_CRITERIA, MONTHS_AR, SCORE_MAX, SCORE_MIN, type CriterionScores } from '../db/schema';
import { monthlyTotals } from '../lib/calc';
import { downloadCsv, csvFileName } from '../lib/csv';

interface RowState {
  visits: string;
  scores: Record<string, number | null>;
  notes: string;
  dirty: boolean;
}

const blankRow = (): RowState => ({
  visits: '',
  scores: Object.fromEntries(EVALUATION_CRITERIA.map((criterion) => [criterion.id, null])),
  notes: '',
  dirty: false,
});

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => current + 1 - index);
})();

export function MonthlyEvaluationsPage() {
  const { data, settings, runAction, notify } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [governorate, setGovernorate] = useState('all');
  const [branch, setBranch] = useState('all');
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [saving, setSaving] = useState(false);

  const employees = useMemo(() => data.employees.filter((row) => !row.archived), [data.employees]);

  // تحميل قيم الشهر المختار من البيانات المحفوظة
  useEffect(() => {
    const next: Record<string, RowState> = {};
    for (const employee of employees) {
      const existing = data.evaluations.find(
        (row) => row.employeeId === employee.id && row.year === year && row.month === month,
      );
      next[employee.id] = existing
        ? {
            visits: existing.visits === null ? '' : String(existing.visits),
            scores: { ...blankRow().scores, ...existing.scores },
            notes: existing.notes,
            dirty: false,
          }
        : blankRow();
    }
    setRows(next);
  }, [employees, data.evaluations, year, month]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return employees
      .filter((row) => (sector === 'all' ? true : row.sector === sector))
      .filter((row) => (governorate === 'all' ? true : row.governorate === governorate))
      .filter((row) => (status === 'all' ? true : row.status === status))
      .filter((row) => (branch === 'all' ? true : row.branches.includes(branch)))
      .filter((row) => (!text ? true : `${row.name} ${row.code} ${row.employeeNo}`.toLowerCase().includes(text)))
      .sort((a, b) => a.employeeNo - b.employeeNo);
  }, [employees, query, sector, governorate, branch, status]);

  const branchOptions = Array.from(
    new Set(
      [...settings.branches, ...employees.flatMap((row) => row.branches.split(/[,،]/).map((item) => item.trim()))].filter(Boolean),
    ),
  ).sort();

  const update = (employeeId: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [employeeId]: { ...(prev[employeeId] ?? blankRow()), ...patch, dirty: true } }));

  const dirtyCount = Object.values(rows).filter((row) => row.dirty).length;

  const save = async () => {
    if (!visible.length) return;
    setSaving(true);
    try {
      const payload = visible
        .map((employee) => ({ employee, state: rows[employee.id] ?? blankRow() }))
        .filter(({ employee, state }) => {
          const hasData =
            state.visits !== '' || state.notes.trim() !== '' || Object.values(state.scores).some((value) => value !== null);
          const exists = data.evaluations.some(
            (row) => row.employeeId === employee.id && row.year === year && row.month === month,
          );
          return state.dirty || hasData || exists;
        })
        .map(({ employee, state }) => ({
          employeeId: employee.id,
          visits: state.visits === '' ? null : Number(state.visits),
          scores: state.scores as CriterionScores,
          notes: state.notes,
        }));

      if (!payload.length) {
        notify('لا توجد تغييرات لحفظها.', 'info');
        return;
      }

      await runAction(
        () => saveMonthlyBatch(year, month, payload),
        `تم حفظ تقييم ${MONTHS_AR[month - 1]} ${year} (${payload.length} موظف).`,
      );
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      csvFileName(`monthly-${year}-${String(month).padStart(2, '0')}`),
      [
        'الرقم',
        'القطاع',
        'المحافظة',
        'الاسم',
        'الكود',
        'تاريخ التعيين',
        'المسمى الوظيفي',
        'عدد الزيارات',
        ...EVALUATION_CRITERIA.map((criterion) => criterion.name),
        'إجمالي النقاط',
        'ملاحظات',
      ],
      visible.map((employee) => {
        const state = rows[employee.id] ?? blankRow();
        const totals = monthlyTotals(state.scores as CriterionScores, state.visits === '' ? null : Number(state.visits));
        return [
          employee.employeeNo,
          employee.sector,
          employee.governorate,
          employee.name,
          employee.code,
          employee.employmentDate,
          employee.jobTitle,
          state.visits === '' ? '' : state.visits,
          ...EVALUATION_CRITERIA.map((criterion) => state.scores[criterion.id] ?? ''),
          totals.total,
          state.notes,
        ];
      }),
    );
  };

  const completedCount = visible.filter((employee) => {
    const state = rows[employee.id];
    return state && monthlyTotals(state.scores as CriterionScores, state.visits === '' ? null : Number(state.visits)).complete;
  }).length;

  if (!employees.length) {
    return (
      <>
        <PageHeader title="التقييم الشهري" />
        <Card>
          <EmptyState title="أضف الموظفين أولًا" description="بعد إضافة الموظفين سيظهرون تلقائيًا في جدول التقييم الشهري." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="التقييم الشهري"
        description={`إجمالي الشهر = عدد الزيارات + مجموع الدرجات الثمانية (نفس معادلة الملف). درجات من ${SCORE_MIN} إلى ${SCORE_MAX}.`}
        actions={
          <>
            <Button icon="download" onClick={exportCsv}>
              تصدير CSV
            </Button>
            <Button icon="print" onClick={() => window.print()}>
              طباعة
            </Button>
            <Button variant="primary" icon="save" onClick={save} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : `حفظ الشهر${dirtyCount ? ` (${dirtyCount})` : ''}`}
            </Button>
          </>
        }
      />

      <div className="print-only print-head">
        <h1>{settings.organizationName} — التقييم الشهري {MONTHS_AR[month - 1]} {year}</h1>
        <p className="small">
          المعايير: {EVALUATION_CRITERIA.map((criterion, index) => `${index + 1}) ${criterion.name}`).join(' — ')}
        </p>
      </div>

      <Card padded={false}>
        <Toolbar>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
            {YEARS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="الشهر">
            {MONTHS_AR.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </Select>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث عن موظف…" />
          <Select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="القطاع">
            <option value="all">كل القطاعات</option>
            {settings.sectors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={governorate} onChange={(e) => setGovernorate(e.target.value)} aria-label="المحافظة">
            <option value="all">كل المحافظات</option>
            {settings.governorates.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
            <option value="all">كل الفروع</option>
            {branchOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة الوظيفية">
            <option value="active">تعيين</option>
            <option value="inactive">مستقيل</option>
            <option value="all">الكل</option>
          </Select>
          <span className="toolbar__spacer">
            {visible.length} موظف · مكتمل {completedCount}
          </span>
        </Toolbar>

        <TableWrap>
          <table className="table sheet">
            <thead>
              <tr>
                <th rowSpan={2} className="num">م</th>
                <th rowSpan={2}>القطاع</th>
                <th rowSpan={2}>المحافظة</th>
                <th rowSpan={2}>الاسم</th>
                <th rowSpan={2}>الكود</th>
                <th rowSpan={2}>تاريخ التعيين</th>
                <th rowSpan={2}>المسمى</th>
                <th rowSpan={2} className="num">الزيارات</th>
                <th colSpan={EVALUATION_CRITERIA.length} className="group">
                  درجات المعايير (1 – 5)
                </th>
                <th rowSpan={2} className="num">الإجمالي</th>
                <th rowSpan={2}>ملاحظات</th>
                <th rowSpan={2}>الحالة</th>
              </tr>
              <tr>
                {EVALUATION_CRITERIA.map((criterion, index) => (
                  <th key={criterion.id} title={criterion.name} className="num">
                    {index + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((employee) => {
                const state = rows[employee.id] ?? blankRow();
                const totals = monthlyTotals(state.scores as CriterionScores, state.visits === '' ? null : Number(state.visits));
                return (
                  <tr key={employee.id} className={totals.complete ? undefined : 'row--missing'}>
                    <td className="num info">{employee.employeeNo}</td>
                    <td className="info">{employee.sector}</td>
                    <td className="info">{employee.governorate}</td>
                    <td className="info">
                      <a href={`#/employees/${employee.id}`}>{employee.name}</a>
                    </td>
                    <td className="info mono">{employee.code}</td>
                    <td className="info nowrap">{employee.employmentDate}</td>
                    <td className="info">{employee.jobTitle}</td>
                    <td>
                      <input
                        className="input cell cell--visits"
                        type="number"
                        min={0}
                        value={state.visits}
                        aria-label={`عدد الزيارات — ${employee.name}`}
                        onChange={(e) => update(employee.id, { visits: e.target.value })}
                      />
                    </td>
                    {EVALUATION_CRITERIA.map((criterion) => (
                      <td key={criterion.id}>
                        <select
                          className="select cell cell--score"
                          aria-label={`${criterion.name} — ${employee.name}`}
                          value={state.scores[criterion.id] ?? ''}
                          onChange={(e) =>
                            update(employee.id, {
                              scores: { ...state.scores, [criterion.id]: e.target.value === '' ? null : Number(e.target.value) },
                            })
                          }
                        >
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5].map((score) => (
                            <option key={score} value={score}>
                              {score}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td className="num info">
                      <strong>{totals.total}</strong>
                    </td>
                    <td>
                      <textarea
                        className="textarea cell cell--notes"
                        rows={1}
                        aria-label={`ملاحظات — ${employee.name}`}
                        value={state.notes}
                        onChange={(e) => update(employee.id, { notes: e.target.value })}
                      />
                    </td>
                    <td className="nowrap">
                      {totals.complete ? <span className="pill pill--ok">مكتمل</span> : <span className="pill pill--pending">ناقص</span>}
                      {state.dirty ? <Badge tone="info">غير محفوظ</Badge> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Callout tone="info">
        إجمالي الشهر يُحسب تلقائيًا = عدد الزيارات + مجموع الدرجات المسجلة. الخلايا الفارغة تعني «لم يُقيَّم بعد» ولا تُحسب
        صفرًا. اضغط «حفظ الشهر» لتثبيت القيم.
      </Callout>
      <p className="print-only small">
        توقيع قائد الفريق: .............................. — التاريخ: ..............................
      </p>
    </>
  );
}
