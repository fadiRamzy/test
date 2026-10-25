import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, Callout, Card, EmptyState, ListCard, Input, PageHeader, SearchInput, Select, Table, TableWrap, Toolbar } from '../components/ui';
import { saveAnnualNote } from '../db/repo';
import { MONTHS_AR } from '../db/schema';
import { annualSummary, monthsLabel } from '../lib/calc';
import { downloadCsv, csvFileName } from '../lib/csv';

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => current + 1 - index);
})();

export function AnnualEvaluationsPage() {
  const { data, settings, runAction } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const employees = useMemo(
    () =>
      data.employees
        .filter((row) => !row.archived)
        .filter((row) => (sector === 'all' ? true : row.sector === sector))
        .filter((row) => (!query.trim() ? true : `${row.name} ${row.code} ${row.employeeNo}`.toLowerCase().includes(query.trim().toLowerCase())))
        .sort((a, b) => a.employeeNo - b.employeeNo),
    [data.employees, query, sector],
  );

  const rows = useMemo(
    () =>
      employees.map((employee) => ({
        employee,
        summary: annualSummary(data.evaluations, employee, year, settings.ratingThresholds),
        notes: data.annualNotes.find((row) => row.employeeId === employee.id && row.year === year)?.notes ?? '',
      })),
    [employees, data.evaluations, data.annualNotes, year, settings.ratingThresholds],
  );

  const exportCsv = () => {
    downloadCsv(
      csvFileName(`annual-${year}`),
      [
        'الرقم',
        'الاسم',
        'الكود',
        'القطاع',
        'المحافظة',
        'المسمى الوظيفي',
        'تاريخ التعيين',
        'إجمالي الزيارات السنوية',
        'إجمالي نقاط التقييمات الشهرية',
        'التقدير السنوي',
        'عدد الأشهر المقيَّمة',
        'الأشهر المقيَّمة',
        'الأشهر غير المقيَّمة',
        'مدة الخدمة بالأشهر',
        'ملاحظات',
      ],
      rows.map(({ employee, summary, notes }) => [
        employee.employeeNo,
        employee.name,
        employee.code,
        employee.sector,
        employee.governorate,
        employee.jobTitle,
        employee.employmentDate,
        summary.visits,
        summary.points,
        summary.rating ?? 'لم يُقيَّم',
        summary.evaluatedMonths.length,
        monthsLabel(summary.evaluatedMonths),
        monthsLabel(summary.missingMonths),
        summary.employmentMonths ?? '',
        notes,
      ]),
    );
  };

  if (!data.employees.length) {
    return (
      <>
        <PageHeader title="التقييم السنوي" />
        <Card>
          <EmptyState title="أضف الموظفين أولًا" description="ثم سجّل التقييمات الشهرية ليُحسب الملخص السنوي تلقائيًا." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="التقييم السنوي"
        description="يُجمع من التقييمات الشهرية المسجلة فعليًا: الزيارات + النقاط، ثم يُطبّق تقدير الملف على مجموع النقاط."
        actions={
          <>
            <Button icon="download" onClick={exportCsv}>
              تصدير CSV
            </Button>
            <Button icon="print" onClick={() => window.print()}>
              طباعة
            </Button>
          </>
        }
      />

      <div className="print-only print-head">
        <h1>{settings.organizationName} — التقييم السنوي {year}</h1>
      </div>

      <ListCard id="annual-records" title="الملخص السنوي — جدول الإدخال" note="الجدول مخفي — اضغط «إظهار البيانات» لعرضه.">
        <Toolbar>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
            {YEARS.map((item) => (
              <option key={item} value={item}>
                {item}
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
          <span className="toolbar__spacer">{rows.length} موظف</span>
        </Toolbar>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th className="num">الرقم</th>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>القطاع</th>
                  <th>المحافظة</th>
                  <th>المسمى</th>
                  <th className="num">الزيارات السنوية</th>
                  <th className="num">مجموع النقاط</th>
                  <th>التقدير السنوي</th>
                  <th className="num">أشهر مقيَّمة</th>
                  <th>الأشهر المقيَّمة</th>
                  <th>الأشهر الناقصة</th>
                  <th className="num">مدة الخدمة (شهر)</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee, summary, notes }) => (
                  <tr key={employee.id}>
                    <td className="num">{employee.employeeNo}</td>
                    <td>
                      <a href={`#/employees/${employee.id}`}>{employee.name}</a>
                    </td>
                    <td className="mono">{employee.code}</td>
                    <td>{employee.sector}</td>
                    <td>{employee.governorate}</td>
                    <td>{employee.jobTitle}</td>
                    <td className="num">{summary.visits}</td>
                    <td className="num">
                      <strong>{summary.points}</strong>
                    </td>
                    <td>
                      {summary.rating ? (
                        <>
                          <Badge tone={summary.rating === 'ممتاز' || summary.rating === 'جيد جدًا' ? 'success' : summary.rating === 'ضعيف' ? 'danger' : 'info'}>
                            {summary.rating}
                          </Badge>
                          {summary.missingMonths.length ? (
                            <div className="small muted">مبدئي — {summary.missingMonths.length} شهرًا بلا تقييم</div>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted small">لا تقييمات مسجلة</span>
                      )}
                    </td>
                    <td className="num">{summary.evaluatedMonths.length}</td>
                    <td className="small">{monthsLabel(summary.evaluatedMonths)}</td>
                    <td className="small">
                      {summary.missingMonths.length ? (
                        <span className="muted">{monthsLabel(summary.missingMonths)}</span>
                      ) : (
                        <span className="pill pill--ok">مكتمل</span>
                      )}
                    </td>
                    <td className="num">{summary.employmentMonths ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => {
                          setNotesFor(employee.id);
                          setNoteDraft(notes);
                        }}
                      >
                        {notes ? 'تعديل الملاحظات' : 'إضافة ملاحظات'}
                      </button>
                      {notes ? <div className="small wrap muted">{notes}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="لا نتائج مطابقة" description="غيّر البحث أو القطاع." />
        )}
      </ListCard>

      {notesFor ? (
        <Card
          title={`ملاحظات التقييم السنوي — ${data.employees.find((row) => row.id === notesFor)?.name ?? ''} (${year})`}
          actions={
            <>
              <Button size="sm" onClick={() => setNotesFor(null)}>
                إغلاق
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="save"
                onClick={async () => {
                  await runAction(() => saveAnnualNote(notesFor, year, noteDraft), 'تم حفظ الملاحظات السنوية.');
                  setNotesFor(null);
                }}
              >
                حفظ
              </Button>
            </>
          }
        >
          <Input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} aria-label="ملاحظات التقييم السنوي" />
        </Card>
      ) : null}

      <Callout tone="info">
        عتبات التقدير (كما في الملف): أقل من 240 ضعيف · 240 إلى أقل من 280 مقبول · 280 إلى أقل من 330 جيد · 330 إلى أقل من 430
        جيد جدًا · 430 أو أكثر ممتاز. الشهور التي لا يوجد لها تقييم لا تُحسب صفرًا؛ تُعرض كأشهر ناقصة.
        {year === new Date().getFullYear() ? ` النطاق الحالي: ${MONTHS_AR[0]} – ${MONTHS_AR[new Date().getMonth()]}.` : ''}
      </Callout>
    </>
  );
}
