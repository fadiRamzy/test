import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { useRoute } from '../state/router';
import { buildEmployeeReport, type ReportPeriod, type ReportPeriodType } from '../lib/reportModel';
import { monthName } from '../lib/format';
import { Button, Callout, Card, EmptyState, Field, PageHeader, Select } from '../components/ui';
import { ReportDocument } from '../components/report/ReportDocument';
import { useLookups } from '../components/domain';
import { navigate } from '../state/router';

export function ReportsPage() {
  const { settings } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const route = useRoute();
  const now = new Date();

  const employeeFromQuery = route.query.get('employee');
  const [employeeId, setEmployeeId] = useState(employeeFromQuery ?? data.employees[0]?.id ?? '');
  const [periodType, setPeriodType] = useState<ReportPeriodType>((route.query.get('type') as ReportPeriodType) ?? 'all');
  const [year, setYear] = useState(Number(route.query.get('year') ?? now.getFullYear()));
  const [month, setMonth] = useState(Number(route.query.get('month') ?? now.getMonth() + 1));
  const [from, setFrom] = useState(route.query.get('from') ?? '');
  const [to, setTo] = useState(route.query.get('to') ?? '');
  const [generated, setGenerated] = useState(true);

  useEffect(() => {
    if (employeeFromQuery) setEmployeeId(employeeFromQuery);
  }, [employeeFromQuery]);

  useEffect(() => {
    if (!employeeId && data.employees.length) setEmployeeId(data.employees[0].id);
  }, [employeeId, data.employees]);

  useEffect(() => {
    const beforePrint = () => document.body.classList.add('print-mode');
    const afterPrint = () => document.body.classList.remove('print-mode');
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      document.body.classList.remove('print-mode');
    };
  }, []);

  const employee = data.employees.find((e) => e.id === employeeId) ?? data.archivedEmployees.find((e) => e.id === employeeId);

  const period = useMemo<ReportPeriod>(() => {
    if (periodType === 'monthly') return { type: 'monthly', year, month };
    if (periodType === 'annual') return { type: 'annual', year };
    if (periodType === 'custom') return { type: 'custom', from, to };
    return { type: 'all' };
  }, [periodType, year, month, from, to]);

  const report = useMemo(() => {
    if (!employee || !generated) return null;
    return buildEmployeeReport({
      settings,
      employee,
      branches: data.branches,
      minutes: data.minutes,
      visits: data.visits,
      observations: data.observations,
      evaluations: data.evaluations,
      period,
    });
  }, [employee, generated, settings, data, period]);

  const years = useMemo(() => {
    const set = new Set<number>(data.evaluations.map((e) => e.year));
    data.minutes.forEach((m) => set.add(Number(m.receivedAt.slice(0, 4))));
    set.add(now.getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [data.evaluations, data.minutes, now]);

  const print = () => {
    document.body.classList.add('print-mode');
    // مهلة قصيرة لضمان تطبيق أنماط الطباعة قبل فتح نافذة الطباعة
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => document.body.classList.remove('print-mode'), 500);
    }, 120);
  };

  return (
    <>
      <div className="report-help">
        <PageHeader
          title="تقارير الموظفين"
          description="تقرير عربي احترافي متعدد الصفحات بقياس A4، يشمل البيانات الوظيفية، التقييمات، الإحصاءات التشغيلية، دقائق الصرف، الزيارات ودورات المراجعة، وكل الملاحظات وسجل معالجتها."
          actions={
            <>
              <Button icon="download" onClick={print} variant="primary">
                طباعة / حفظ PDF
              </Button>
              <Button icon="reports" onClick={() => setGenerated(true)}>
                تحديث المعاينة
              </Button>
            </>
          }
        />

        <div className="report-toolbar">
          <Field label="الموظف">
            <Select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setGenerated(true); }}>
              <option value="">— اختر موظفًا —</option>
              {data.employees.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName} ({item.employeeCode})
                </option>
              ))}
              {data.archivedEmployees.length ? (
                <optgroup label="المؤرشفون">
                  {data.archivedEmployees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName} ({item.employeeCode})
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          <Field label="الفترة">
            <Select value={periodType} onChange={(e) => { setPeriodType(e.target.value as ReportPeriodType); setGenerated(true); }}>
              <option value="all">كل الفترات</option>
              <option value="monthly">شهر محدد</option>
              <option value="annual">سنة كاملة</option>
              <option value="custom">فترة مخصصة</option>
            </Select>
          </Field>
          {periodType === 'monthly' || periodType === 'annual' ? (
            <Field label="السنة">
              <Select value={year} onChange={(e) => { setYear(Number(e.target.value)); setGenerated(true); }}>
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {periodType === 'monthly' ? (
            <Field label="الشهر">
              <Select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setGenerated(true); }}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {monthName(value)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {periodType === 'custom' ? (
            <>
              <Field label="من تاريخ">
                <input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setGenerated(true); }} />
              </Field>
              <Field label="إلى تاريخ">
                <input type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); setGenerated(true); }} />
              </Field>
            </>
          ) : null}
          <div className="spacer" />
          <Button icon="print" onClick={print} disabled={!report}>
            طباعة
          </Button>
        </div>

        <Callout tone="info" title="حول الطباعة والتصدير" icon="print">
          تُنشأ الصفحات محليًا بقياس A4 مع ترقيم صفحات وتكرار رؤوس الجداول. استخدم «طباعة / حفظ PDF» واختر «حفظ كـ PDF»
          في نافذة الطباعة. هذا الأسلوب هو المسار البديل الموثوق للتصدير ولا يحتاج أي مكتبة خارجية.
          {report ? ` عدد الصفحات المتوقع يتحدد تلقائيًا حسب حجم البيانات.` : ''}
        </Callout>
      </div>

      {!employee ? (
        <Card>
          <EmptyState
            icon="reports"
            title="لا يوجد موظف لعرض تقريره"
            description="أضف موظفًا أولًا ثم عد إلى هذه الصفحة."
            action={<Button variant="primary" onClick={() => navigate('/employees?new=1')}>إضافة موظف</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="row mb-12" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">
              معاينة التقرير — {employee.fullName} · {lookups.branchName(employee.branchId)}
            </span>
            <span className="small muted">الصفحات تُحسب تلقائيًا بنمط A4 · 794×1123 بكسل</span>
          </div>
          <div className="report-stage">
            {report ? <ReportDocument model={report} /> : <p className="small muted">اختر الموظف ثم اضغط «تحديث المعاينة».</p>}
          </div>
        </>
      )}
    </>
  );
}
