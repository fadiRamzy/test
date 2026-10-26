import { useRef, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, Callout, Card, Field, Input, Modal, PageHeader, Select, Table, TableWrap, Textarea } from '../components/ui';
import {
  backupFileName,
  createBackup,
  restoreBackup,
  validateBackup,
  type BackupPayload,
  type ValidationResult,
} from '../db/backup';
import { ENTITY_LABELS, INSPECTION_RESULT_LABELS, MONTHS_AR, type EntityName } from '../db/schema';
import { annualSummary, leaveTotals, minuteTiming, monthlyTotals, visitTiming } from '../lib/calc';
import { fmtDate, fmtDateTime, fmtDurationWords, fmtNumber } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';
import { downloadFile, readTextFile, safeJsonParse } from '../lib/utils';

const ENTITIES: EntityName[] = [
  'employees',
  'monthlyEvaluations',
  'fieldVisits',
  'minutes',
  'visitTimings',
  'observations',
  'leaves',
  'annualNotes',
];

export function ReportsPage() {
  const { data, settings, saveSettings, refresh, notify } = useApp();
  const [pending, setPending] = useState<{ payload: BackupPayload; validation: ValidationResult; name: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());

  const [org, setOrg] = useState(settings.organizationName);
  const [sectors, setSectors] = useState(settings.sectors.join('\n'));
  const [governorates, setGovernorates] = useState(settings.governorates.join('\n'));
  const [branches, setBranches] = useState(settings.branches.join('\n'));
  const [leaveTypes, setLeaveTypes] = useState(settings.leaveTypes.join('\n'));
  const [categories, setCategories] = useState(settings.observationCategories.join('\n'));

  const nameOf = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';
  const rowsFor = (text: string) => Math.min(14, Math.max(3, text.split('\n').length + 1));
  const lines = (text: string) => Array.from(new Set(text.split('\n').map((line) => line.trim()).filter(Boolean)));

  /* ------------------------------ تصدير CSV ------------------------------ */

  const exportMonthly = () =>
    downloadCsv(
      csvFileName(`monthly-${year}`),
      ['الموظف', 'الكود', 'الشهر', 'الزيارات', 'مجموع الدرجات', 'إجمالي النقاط', 'ملاحظات'],
      data.evaluations
        .filter((row) => row.year === year)
        .sort((a, b) => a.month - b.month)
        .map((row) => {
          const totals = monthlyTotals(row.scores, row.visits);
          return [nameOf(row.employeeId), data.employees.find((e) => e.id === row.employeeId)?.code ?? '', MONTHS_AR[row.month - 1], totals.visits, totals.scoresSum, totals.total, row.notes];
        }),
    );

  const exportAnnual = () =>
    downloadCsv(
      csvFileName(`annual-${year}`),
      ['الرقم', 'الموظف', 'الكود', 'الزيارات السنوية', 'مجموع النقاط', 'التقدير', 'أشهر مقيَّمة', 'مدة الخدمة (شهر)'],
      data.employees
        .filter((row) => !row.archived)
        .map((employee) => {
          const summary = annualSummary(data.evaluations, employee, year, settings.ratingThresholds);
          return [
            employee.employeeNo,
            employee.name,
            employee.code,
            summary.visits,
            summary.points,
            summary.rating ?? 'لم يُقيَّم',
            summary.evaluatedMonths.length,
            summary.employmentMonths ?? '',
          ];
        }),
    );

  const exportHistory = () =>
    downloadCsv(
      csvFileName(`employee-history-${year}`),
      ['الموظف', 'القسم', 'التاريخ', 'التفاصيل'],
      data.employees.flatMap((employee) => {
        const monthly = data.evaluations.filter((row) => row.employeeId === employee.id && row.year === year);
        const visits = data.visits.filter((row) => row.employeeId === employee.id && row.visitDate.startsWith(String(year)));
        const minutes = data.minutes.filter(
          (row) => row.employeeId === employee.id && (row.date ?? row.createdAt.slice(0, 10)).startsWith(String(year)),
        );
        const observations = data.observations.filter((row) => row.employeeId === employee.id && row.date.startsWith(String(year)));
        const leaves = data.leaves.filter((row) => row.employeeId === employee.id && row.startDate.startsWith(String(year)));
        return [
          ...monthly.map((row) => [employee.name, 'تقييم شهري', `${row.month}/${row.year}`, `النقاط: ${monthlyTotals(row.scores, row.visits).total}`]),
          ...visits.map((row) => [employee.name, 'زيارة', row.visitDate, `${row.branch} — ${row.visitType}`]),
          ...minutes.map((row) => [
            employee.name,
            'محضر يومي',
            row.date ?? row.createdAt.slice(0, 10),
            `${row.fileReceivedTime || '—'} → ${row.responseTime || '—'}`,
          ]),
          ...observations.map((row) => [employee.name, 'ملاحظة', row.date, row.details]),
          ...leaves.map((row) => [employee.name, 'إجازة/إذن', row.startDate, `${row.type} (${row.unit === 'days' ? `${row.days} يوم` : `${row.hours} ساعة`})`]),
        ];
      }),
    );

  const exportVisits = () =>
    downloadCsv(
      csvFileName(`visits-${year}`),
      ['التاريخ', 'الموظف', 'المنطقة', 'الفرع', 'النوع', 'المرجع', 'التقدير'],
      data.visits.filter((row) => row.visitDate.startsWith(String(year))).map((row) => [row.visitDate, nameOf(row.employeeId), row.region, row.branch, row.visitType, row.reference, row.finalAssessment]),
    );

  const exportMinutes = () =>
    downloadCsv(
      csvFileName('minutes'),
      ['الموظف', 'توقيت طلب الملف', 'توقيت استلام الملف', 'توقيت الرد على الملف', 'نتيجة الفحص', 'المدة', 'حالة التأخير'],
      data.minutes.map((row) => {
        const timing = minuteTiming(row);
        return [
          nameOf(row.employeeId),
          row.fileRequestTime || '',
          row.fileReceivedTime || '',
          row.responseTime || '',
          row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : '',
          timing.minutes === null ? '' : fmtDurationWords(timing.minutes),
          timing.invalid ? (timing.reason ?? '') : timing.delayed ? 'متأخر' : 'في الوقت',
        ];
      }),
    );

  const exportVisitTimings = () =>
    downloadCsv(
      csvFileName(`visit-timings-${year}`),
      ['الموظف', 'التاريخ', 'الفرع', 'اسم العميل', 'مكان الزيارة', 'توقيت التحرك', 'توقيت الرجوع', 'مدة الزيارة', 'ملاحظات'],
      data.visitTimings
        .filter((row) => (row.visitDate ?? '').startsWith(String(year)))
        .map((row) => {
          const timing = visitTiming(row);
          return [
            nameOf(row.employeeId),
            row.visitDate,
            row.branch,
            row.clientName,
            row.location,
            row.departureTime,
            row.returnTime,
            timing.minutes === null ? (timing.reason ?? '') : fmtDurationWords(timing.minutes),
            row.notes ?? '',
          ];
        }),
    );

  const exportObservations = () =>
    downloadCsv(
      csvFileName('observations'),
      ['التاريخ', 'الموظف', 'المصدر', 'التصنيف', 'الخطورة', 'التفاصيل', 'الإجراء التصحيحي', 'الحالة'],
      data.observations.map((row) => [row.date, nameOf(row.employeeId), row.source, row.category, row.severity, row.details, row.correctiveAction, row.status === 'open' ? 'مفتوحة' : 'مغلقة']),
    );

  const exportLeaves = () => {
    downloadCsv(
      csvFileName('leaves'),
      ['الموظف', 'النوع', 'من', 'إلى', 'الوحدة', 'القيمة', 'ملاحظات'],
      data.leaves.map((row) => [nameOf(row.employeeId), row.type, row.startDate, row.endDate, row.unit === 'days' ? 'أيام' : 'ساعات', row.unit === 'days' ? row.days : row.hours, row.notes]),
    );
    const totals = leaveTotals(data.leaves);
    notify(`إجمالي الإجازات: ${fmtNumber(totals.days)} يوم · الأذونات: ${fmtNumber(totals.hours)} ساعة.`, 'info');
  };

  /* --------------------------- النسخ الاحتياطي --------------------------- */

  const exportBackup = async () => {
    const payload = await createBackup();
    downloadFile(backupFileName(), JSON.stringify(payload, null, 2));
    notify('تم تصدير النسخة الاحتياطية (JSON).', 'success');
  };

  const pickFile = async (file: File) => {
    const text = await readTextFile(file);
    const parsed = safeJsonParse<unknown>(text);
    if (!parsed.ok) {
      notify(parsed.error, 'error');
      return;
    }
    setPending({ payload: parsed.value as BackupPayload, validation: validateBackup(parsed.value), name: file.name });
  };

  const doRestore = async (mode: 'replace' | 'merge') => {
    if (!pending) return;
    setRestoring(true);
    try {
      await restoreBackup(pending.payload, mode);
      await refresh();
      downloadFile(`safety-${backupFileName()}`, JSON.stringify(await createBackup(), null, 2));
      notify(mode === 'replace' ? 'تم استبدال البيانات، ونُزّلت نسخة أمان.' : 'تم دمج البيانات، ونُزّلت نسخة أمان.', 'success');
      setPending(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذّرت الاستعادة.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <PageHeader
        title="التقارير والنسخ"
        description="نسخة احتياطية كاملة بصيغة JSON واستعادتها، مع تصدير CSV والقوائم المرجعية."
      />

      <Card title="تصدير CSV" subtitle={`السنة: ${year} حيث ينطبق`} actions={<Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">{Array.from({ length: 6 }, (_, index) => now.getFullYear() + 1 - index).map((item) => <option key={item} value={item}>{item}</option>)}</Select>}>
        <div className="rowactions">
          <Button icon="download" onClick={exportMonthly}>التقييم الشهري</Button>
          <Button icon="download" onClick={exportAnnual}>التقييم السنوي</Button>
          <Button icon="download" onClick={exportHistory}>سجل الموظفين</Button>
          <Button icon="download" onClick={exportVisits}>الزيارات الميدانية</Button>
          <Button icon="download" onClick={exportMinutes}>محاضر يومية</Button>
          <Button icon="download" onClick={exportVisitTimings}>توقيت الزيارات</Button>
          <Button icon="download" onClick={exportObservations}>الملاحظات</Button>
          <Button icon="download" onClick={exportLeaves}>الإجازات والأذونات</Button>
        </div>
      </Card>

      <Card title="النسخ الاحتياطي والاستعادة" subtitle="ملف JSON واحد يحتوي كل السجلات والإعدادات — تصدير للنسخ، واستيراد للاستعادة.">
        <div className="rowactions">
          <Button variant="primary" icon="download" onClick={exportBackup}>
            تصدير نسخة كاملة
          </Button>
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            استيراد نسخة
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pickFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </Card>

      <Card title="القوائم المرجعية" subtitle="سطر واحد لكل قيمة — تُستخدم في القوائم المنسدلة داخل النماذج.">
        <div className="formgrid">
          <Field label="اسم الإدارة / الجهة" htmlFor="set-org" className="span2">
            <Input id="set-org" value={org} onChange={(e) => setOrg(e.target.value)} />
          </Field>
          <Field label="القطاعات" htmlFor="set-sectors">
            <Textarea id="set-sectors" rows={rowsFor(sectors)} value={sectors} onChange={(e) => setSectors(e.target.value)} />
          </Field>
          <Field label="المحافظات" htmlFor="set-govs">
            <Textarea id="set-govs" rows={rowsFor(governorates)} value={governorates} onChange={(e) => setGovernorates(e.target.value)} />
          </Field>
          <Field label="الفروع" htmlFor="set-branches">
            <Textarea id="set-branches" rows={rowsFor(branches)} value={branches} onChange={(e) => setBranches(e.target.value)} />
          </Field>
          <Field label="أنواع الإجازات والأذونات" htmlFor="set-leaves">
            <Textarea id="set-leaves" rows={rowsFor(leaveTypes)} value={leaveTypes} onChange={(e) => setLeaveTypes(e.target.value)} />
          </Field>
          <Field label="تصنيفات الملاحظات" htmlFor="set-categories" className="span2">
            <Textarea id="set-categories" rows={rowsFor(categories)} value={categories} onChange={(e) => setCategories(e.target.value)} />
          </Field>
        </div>
        <div className="rowactions" style={{ marginTop: 10 }}>
          <Button
            variant="primary"
            icon="save"
            onClick={() =>
              saveSettings({
                organizationName: org.trim(),
                sectors: lines(sectors),
                governorates: lines(governorates),
                branches: lines(branches),
                leaveTypes: lines(leaveTypes),
                observationCategories: lines(categories),
              })
            }
          >
            حفظ القوائم
          </Button>
        </div>
      </Card>

      <Card title="عتبات التقدير السنوي" subtitle="كما هي في ملف الإكسل — تُطبَّق على مجموع نقاط الشهور المسجلة.">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th>من (نقطة)</th>
                <th>التقدير</th>
              </tr>
            </thead>
            <tbody>
              {[...settings.ratingThresholds]
                .sort((a, b) => b.min - a.min)
                .map((threshold) => (
                  <tr key={threshold.label}>
                    <td className="num">{threshold.min}</td>
                    <td>
                      <Badge tone={threshold.label === 'ممتاز' ? 'success' : threshold.label === 'ضعيف' ? 'danger' : 'info'}>{threshold.label}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Callout tone="warning">
        البيانات محلية في هذا المتصفح فقط: لا مزامنة بين الأجهزة، وتُفقد عند حذف بيانات المتصفح. صدّر نسخة كاملة دوريًا
        واحفظها خارج المتصفح. آخر تحديث للإعدادات: {fmtDateTime(settings.updatedAt)} — تاريخ اليوم: {fmtDate(new Date())}.
      </Callout>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="استيراد نسخة احتياطية"
        subtitle={pending?.name}
        footer={
          <>
            <Button onClick={() => setPending(null)}>إلغاء</Button>
            <Button variant="danger" disabled={!pending?.validation.ok || restoring} onClick={() => doRestore('replace')}>
              استبدال البيانات
            </Button>
            <Button variant="primary" disabled={!pending?.validation.ok || restoring} onClick={() => doRestore('merge')}>
              دمج
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p className="small muted">تاريخ التصدير: {fmtDateTime(pending.validation.exportedAt)}</p>
            {pending.validation.counts ? (
              <Table>
                <tbody>
                  {ENTITIES.map((entity) => (
                    <tr key={entity}>
                      <td>{ENTITY_LABELS[entity]}</td>
                      <td className="num">{pending.validation.counts?.[entity] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            {pending.validation.errors.length ? (
              <Callout tone="danger">
                <ul>
                  {pending.validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </Callout>
            ) : (
              <Callout tone="success">الملف صالح. سيتم تنزيل نسخة أمان من بياناتك الحالية قبل التنفيذ.</Callout>
            )}
            {pending.validation.warnings.length ? (
              <Callout tone="warning">
                <ul>
                  {pending.validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </>
        ) : null}
      </Modal>
    </>
  );
}
