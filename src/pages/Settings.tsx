import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate, useRoute } from '../state/router';
import {
  createBackup,
  resetAllWithSafetyBackup,
  restoreBackup,
  validateBackup,
  backupFileName,
  type BackupPayload,
} from '../db/backup';
import { readAudit, storageEstimate, wipeAllData } from '../db/database';
import {
  restoreBranch,
  saveBranch,
  saveEmployee,
  saveEvaluation,
  saveMinute,
  saveObservation,
  saveVisit,
  softDeleteBranch,
} from '../db/repo';
import { clearDemoData, demoStatus, seedDemoData } from '../db/demo';
import { exportEntityCsv, parseEntityCsv, SCHEMAS, type CsvEntity } from '../db/csv';
import type { AuditEntry, Branch } from '../db/schema';
import { EMPLOYEE_STATUS_LABELS } from '../db/schema';
import { downloadFile, readTextFile, safeJsonParse, uid } from '../lib/utils';
import { fmtDate, fmtDateTime, fmtNumber, toDateInputValue } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Tabs,
} from '../components/ui';
import { useLookups } from '../components/domain';

type TabId = 'general' | 'time' | 'branches' | 'criteria' | 'backup' | 'data' | 'demo' | 'audit';

const TAB_ITEMS: Array<{ id: TabId; label: string }> = [
  { id: 'general', label: 'عام' },
  { id: 'time', label: 'المواعيد وأيام العمل' },
  { id: 'branches', label: 'الفروع' },
  { id: 'criteria', label: 'التصنيفات والمعايير' },
  { id: 'backup', label: 'النسخ الاحتياطي' },
  { id: 'data', label: 'الاستيراد والتصدير' },
  { id: 'demo', label: 'البيانات التجريبية' },
  { id: 'audit', label: 'سجل التغييرات' },
];

const WEEK_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function SettingsPage() {
  const { settings, notify, runAction, demoMode, setDemoMode } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const route = useRoute();
  const [tab, setTab] = useState<TabId>((route.query.get('tab') as TabId) ?? 'general');

  useEffect(() => {
    const requested = route.query.get('tab') as TabId | null;
    if (requested) setTab(requested);
  }, [route.query]);

  return (
    <>
      <PageHeader
        title="الإعدادات"
        description="إعدادات المؤسسة، المواعيد وأوقات العمل، الفروع، التصنيفات، معايير التقييم، النسخ الاحتياطي، والاستيراد/التصدير."
      />

      <Card padded={false}>
        <Tabs tabs={TAB_ITEMS.map((item) => ({ id: item.id, label: item.label }))} value={tab} onChange={(id) => setTab(id as TabId)} />
        <div style={{ padding: 16 }}>
          {tab === 'general' ? <GeneralTab /> : null}
          {tab === 'time' ? <TimeTab /> : null}
          {tab === 'branches' ? <BranchesTab /> : null}
          {tab === 'criteria' ? <CriteriaTab /> : null}
          {tab === 'backup' ? <BackupTab /> : null}
          {tab === 'data' ? <DataTab /> : null}
          {tab === 'demo' ? (
            <DemoTab demoMode={demoMode} setDemoMode={setDemoMode} notify={notify} runAction={runAction} />
          ) : null}
          {tab === 'audit' ? <AuditTab /> : null}
        </div>
      </Card>

      <Callout tone="warning" title="تنبيه مهم عن التخزين" icon="alert">
        بياناتك محفوظة في IndexedDB داخل هذا المتصفح على هذا الجهاز فقط. مساحة المتصفح ليست نسخة احتياطية دائمة: قد تُفقد
        عند حذف بيانات التصفح، أو تغيير الجهاز، أو تغيير إعدادات المتصفح. البيانات غير مشفّرة افتراضيًا. صدّر نسخة JSON
        دوريًا واحفظها في مكان آمن. لا يتم إرسال أي بيانات إلى أي خادم.
        {data.employees.length ? '' : ''}
        <span className="small">
          {' '}
          — الإعدادات الحالية: مهلة {settings.minutesDeadlineMinutes} دقيقة · {settings.workingDays.length} أيام عمل ·
          فروع {lookups.branches.length}
        </span>
      </Callout>
    </>
  );
}

/* ---------------------------------- عام ---------------------------------- */

function GeneralTab() {
  const { settings, saveSettings } = useApp();
  const [form, setForm] = useState({
    organizationName: settings.organizationName,
    departmentName: settings.departmentName,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ organizationName: settings.organizationName, departmentName: settings.departmentName });
  }, [settings]);

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="اسم المؤسسة">
          <Input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />
        </Field>
        <Field label="اسم الإدارة">
          <Input value={form.departmentName} onChange={(e) => setForm({ ...form, departmentName: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <Button
          variant="primary"
          icon="save"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await saveSettings(form);
            } finally {
              setSaving(false);
            }
          }}
        >
          حفظ
        </Button>
      </div>
      <Callout tone="info" title="خصوصية البيانات" icon="shield">
        هذا التطبيق يعمل بالكامل داخل المتصفح. لا يوجد خادم أو مزامنة أو تحليلات. مشاركة الملفات مع الآخرين تعني مشاركة
        الكود فقط، بينما تبقى السجلات على جهاز كل مستخدم.
      </Callout>
    </div>
  );
}

/* ------------------------------ المواعيد -------------------------------- */

function TimeTab() {
  const { settings, saveSettings } = useApp();
  const [deadline, setDeadline] = useState(settings.minutesDeadlineMinutes);
  const [warn, setWarn] = useState(settings.deadlineWarnPercent);
  const [start, setStart] = useState(settings.workingHours.start);
  const [end, setEnd] = useState(settings.workingHours.end);
  const [days, setDays] = useState<number[]>(settings.workingDays);
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [thresholds, setThresholds] = useState(settings.thresholds);

  useEffect(() => {
    setDeadline(settings.minutesDeadlineMinutes);
    setWarn(settings.deadlineWarnPercent);
    setStart(settings.workingHours.start);
    setEnd(settings.workingHours.end);
    setDays(settings.workingDays);
    setThresholds(settings.thresholds);
  }, [settings]);

  const save = async () => {
    if (start >= end) {
      await saveSettings({ workingHours: settings.workingHours });
      return;
    }
    await saveSettings({
      minutesDeadlineMinutes: Math.max(1, Number(deadline) || 60),
      deadlineWarnPercent: Math.min(100, Math.max(1, Number(warn) || 80)),
      workingHours: { start, end },
      workingDays: days.length ? days : settings.workingDays,
      thresholds,
    });
  };

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="مهلة مراجعة الدقيقة (دقيقة عمل)" hint="افتراضي 60 دقيقة">
          <Input type="number" min={1} value={deadline} onChange={(e) => setDeadline(Number(e.target.value))} />
        </Field>
        <Field label="نسبة التنبيه قبل انتهاء المهلة %" hint="تظهر الدقيقة كـ«قاربت المهلة»">
          <Input type="number" min={1} max={100} value={warn} onChange={(e) => setWarn(Number(e.target.value))} />
        </Field>
        <Field label="بداية وقت العمل">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="نهاية وقت العمل">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      {start >= end ? <p className="field__error">نهاية وقت العمل يجب أن تكون بعد بدايته.</p> : null}

      <div>
        <strong className="small">أيام العمل</strong>
        <div className="row mt-8">
          {WEEK_DAYS.map((label, index) => (
            <Checkbox
              key={label}
              label={label}
              checked={days.includes(index)}
              onChange={(e) =>
                setDays((prev) => (e.target.checked ? [...prev, index].sort() : prev.filter((day) => day !== index)))
              }
            />
          ))}
        </div>
      </div>

      <div>
        <strong className="small">العطلات الرسمية</strong>
        <div className="row mt-8">
          <Input type="date" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} style={{ maxWidth: 170 }} />
          <Input placeholder="اسم العطلة" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} style={{ maxWidth: 240 }} />
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              if (!holiday.date) return;
              const exists = settings.holidays.some((h) => h.date === holiday.date);
              if (exists) return;
              void saveSettings({
                holidays: [...settings.holidays, { date: holiday.date, name: holiday.name.trim() || 'عطلة رسمية' }].sort((a, b) =>
                  a.date.localeCompare(b.date),
                ),
              });
              setHoliday({ date: '', name: '' });
            }}
          >
            إضافة عطلة
          </Button>
        </div>
        {settings.holidays.length ? (
          <TableWrap className="mt-12">
            <Table className="table--compact">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الاسم</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settings.holidays.map((item) => (
                  <tr key={item.date}>
                    <td>{fmtDate(item.date)}</td>
                    <td>{item.name}</td>
                    <td className="actions">
                      <IconButton
                        icon="trash"
                        label="حذف"
                        variant="danger"
                        onClick={() => void saveSettings({ holidays: settings.holidays.filter((h) => h.date !== item.date) })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <p className="small muted mt-8">لا توجد عطلات مسجلة.</p>
        )}
      </div>

      <div>
        <strong className="small">حدود التنبيه</strong>
        <div className="form-grid mt-8">
          <Field label="نسبة الالتزام المستهدفة %" hint="تظهر كمقارنة فقط — لا تُستخدم كمعادلة رسمية">
            <Input
              type="number"
              min={0}
              max={100}
              value={thresholds.complianceTargetPercent}
              onChange={(e) => setThresholds({ ...thresholds, complianceTargetPercent: Number(e.target.value) })}
            />
          </Field>
          <Field label="الزيارات المستهدفة شهريًا" hint="0 = بدون هدف">
            <Input
              type="number"
              min={0}
              value={thresholds.visitTargetPerMonth}
              onChange={(e) => setThresholds({ ...thresholds, visitTargetPerMonth: Number(e.target.value) })}
            />
          </Field>
          <Field label="حد تأخر التقرير (ساعة عمل)">
            <Input
              type="number"
              min={1}
              value={thresholds.reportDelayWarnHours}
              onChange={(e) => setThresholds({ ...thresholds, reportDelayWarnHours: Number(e.target.value) })}
            />
          </Field>
          <Field label="نافذة الملاحظات المتكررة (يوم)">
            <Input
              type="number"
              min={1}
              value={thresholds.repeatedObservationWindowDays}
              onChange={(e) => setThresholds({ ...thresholds, repeatedObservationWindowDays: Number(e.target.value) })}
            />
          </Field>
          <Field label="حد تحذير جودة التقرير (أقل من)">
            <Input
              type="number"
              min={0}
              max={5}
              value={thresholds.lowQualityWarnBelow}
              onChange={(e) => setThresholds({ ...thresholds, lowQualityWarnBelow: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>

      <div className="row">
        <Button variant="primary" icon="save" onClick={save}>
          حفظ إعدادات الوقت
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------- الفروع --------------------------------- */

function BranchesTab() {
  const { runAction } = useApp();
  const data = useVisibleData();
  const [form, setForm] = useState<Partial<Branch>>({ code: '', name: '', governorate: '' });
  const [editing, setEditing] = useState<Branch | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Branch | null>(null);

  const reset = () => {
    setForm({ code: '', name: '', governorate: '' });
    setEditing(null);
  };

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="كود الفرع" required>
          <Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BR-001" />
        </Field>
        <Field label="اسم الفرع" required>
          <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="المحافظة">
          <Input value={form.governorate ?? ''} onChange={(e) => setForm({ ...form, governorate: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <Button
          variant="primary"
          icon={editing ? 'save' : 'plus'}
          onClick={async () => {
            const saved = await runAction(() => saveBranch({ ...form, id: editing?.id }), editing ? 'تم تحديث الفرع.' : 'تمت إضافة الفرع.');
            if (saved) reset();
          }}
        >
          {editing ? 'حفظ التعديل' : 'إضافة فرع'}
        </Button>
        {editing ? <Button onClick={reset}>إلغاء</Button> : null}
      </div>

      <TableWrap>
        <Table className="table--compact">
          <thead>
            <tr>
              <th>الكود</th>
              <th>الاسم</th>
              <th>المحافظة</th>
              <th>الموظفون</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.branches.map((branch) => (
              <tr key={branch.id}>
                <td>{branch.code}</td>
                <td>{branch.name}</td>
                <td>{branch.governorate || '—'}</td>
                <td className="num">{fmtNumber(data.employees.filter((e) => e.branchId === branch.id).length)}</td>
                <td className="actions">
                  <IconButton
                    icon="edit"
                    label="تعديل"
                    onClick={() => {
                      setEditing(branch);
                      setForm({ code: branch.code, name: branch.name, governorate: branch.governorate });
                    }}
                  />
                  <IconButton icon="archive" label="أرشفة" variant="danger" onClick={() => setArchiveTarget(branch)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {data.archivedBranches.length ? (
        <div>
          <strong className="small">الفروع المؤرشفة</strong>
          <TableWrap className="mt-8">
            <Table className="table--compact">
              <thead>
                <tr>
                  <th>الكود</th>
                  <th>الاسم</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.archivedBranches.map((branch) => (
                  <tr key={branch.id}>
                    <td>{branch.code}</td>
                    <td>{branch.name}</td>
                    <td className="actions">
                      <IconButton icon="restore" label="استعادة" onClick={() => void runAction(() => restoreBranch(branch.id), 'تمت استعادة الفرع.')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة الفرع"
        message={`سيتم أرشفة «${archiveTarget?.name ?? ''}». لا يمكن الأرشفة إذا كان هناك موظفون مرتبطون.`}
        confirmLabel="أرشفة"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void runAction(() => softDeleteBranch(target.id), 'تمت أرشفة الفرع.');
        }}
      />
    </div>
  );
}

/* -------------------------- التصنيفات والمعايير --------------------------- */

function CriteriaTab() {
  const { settings, saveSettings } = useApp();
  const [newCategory, setNewCategory] = useState('');
  const [newCriterion, setNewCriterion] = useState('');
  const [scale, setScale] = useState(settings.ratingScale);

  useEffect(() => setScale(settings.ratingScale), [settings.ratingScale]);

  return (
    <div className="stack">
      <div>
        <strong className="small">تصنيفات الملاحظات</strong>
        <div className="row mt-8">
          <Input placeholder="اسم التصنيف الجديد" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} style={{ maxWidth: 260 }} />
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              if (!newCategory.trim()) return;
              void saveSettings({
                observationCategories: [
                  ...settings.observationCategories,
                  { id: uid('cat'), name: newCategory.trim(), active: true },
                ],
              });
              setNewCategory('');
            }}
          >
            إضافة تصنيف
          </Button>
        </div>
        <TableWrap className="mt-8">
          <Table className="table--compact">
            <thead>
              <tr>
                <th>التصنيف</th>
                <th>مفعّل</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.observationCategories.map((category) => (
                <tr key={category.id}>
                  <td>
                    <Input
                      value={category.name}
                      onChange={(e) =>
                        void saveSettings({
                          observationCategories: settings.observationCategories.map((c) =>
                            c.id === category.id ? { ...c, name: e.target.value } : c,
                          ),
                        })
                      }
                      style={{ minHeight: 30, fontSize: 12 }}
                    />
                  </td>
                  <td>
                    <Checkbox
                      label=""
                      checked={category.active}
                      onChange={(e) =>
                        void saveSettings({
                          observationCategories: settings.observationCategories.map((c) =>
                            c.id === category.id ? { ...c, active: e.target.checked } : c,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="actions">
                    <IconButton
                      icon="trash"
                      label="حذف"
                      variant="danger"
                      onClick={() =>
                        void saveSettings({
                          observationCategories: settings.observationCategories.filter((c) => c.id !== category.id),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      <div>
        <strong className="small">معايير التقييم</strong>
        <div className="row mt-8">
          <Input placeholder="اسم المعيار الجديد" value={newCriterion} onChange={(e) => setNewCriterion(e.target.value)} style={{ maxWidth: 320 }} />
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              if (!newCriterion.trim()) return;
              void saveSettings({
                evaluationCriteria: [
                  ...settings.evaluationCriteria,
                  { id: uid('cr'), name: newCriterion.trim(), active: true },
                ],
              });
              setNewCriterion('');
            }}
          >
            إضافة معيار
          </Button>
        </div>
        <TableWrap className="mt-8">
          <Table className="table--compact">
            <thead>
              <tr>
                <th>المعيار</th>
                <th>مفعّل</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.evaluationCriteria.map((criterion) => (
                <tr key={criterion.id}>
                  <td>
                    <Input
                      value={criterion.name}
                      onChange={(e) =>
                        void saveSettings({
                          evaluationCriteria: settings.evaluationCriteria.map((c) =>
                            c.id === criterion.id ? { ...c, name: e.target.value } : c,
                          ),
                        })
                      }
                      style={{ minHeight: 30, fontSize: 12 }}
                    />
                  </td>
                  <td>
                    <Checkbox
                      label=""
                      checked={criterion.active}
                      onChange={(e) =>
                        void saveSettings({
                          evaluationCriteria: settings.evaluationCriteria.map((c) =>
                            c.id === criterion.id ? { ...c, active: e.target.checked } : c,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="actions">
                    <IconButton
                      icon="trash"
                      label="حذف"
                      variant="danger"
                      onClick={() =>
                        void saveSettings({
                          evaluationCriteria: settings.evaluationCriteria.filter((c) => c.id !== criterion.id),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      <div>
        <strong className="small">مقياس التقييم</strong>
        <div className="form-grid mt-8">
          <Field label="أدنى درجة">
            <Input type="number" min={0} value={scale.min} onChange={(e) => setScale({ ...scale, min: Number(e.target.value) })} />
          </Field>
          <Field label="أعلى درجة">
            <Input type="number" min={1} value={scale.max} onChange={(e) => setScale({ ...scale, max: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="row mt-8">
          <Button size="sm" variant="primary" icon="save" onClick={() => void saveSettings({ ratingScale: scale })}>
            حفظ المقياس
          </Button>
          <span className="small muted">لا تُستخدم أوزان أو عتبات تصنيف رسمية؛ المتوسط = المجموع ÷ عدد المعايير المسجلة.</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- النسخ الاحتياطي ---------------------------- */

function BackupTab() {
  const { notify, runAction } = useApp();
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof validateBackup>> | null>(null);
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [safety, setSafety] = useState<BackupPayload | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportNow = async () => {
    setBusy(true);
    try {
      const backup = await createBackup();
      downloadFile(backupFileName(), JSON.stringify(backup, null, 2));
      notify('تم تصدير نسخة احتياطية كاملة.', 'success');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    setSafety(null);
    const text = await readTextFile(file);
    const parsed = safeJsonParse<unknown>(text);
    if (!parsed.ok) {
      setValidation({ ok: false, errors: [parsed.error], warnings: [] });
      setPayload(null);
      return;
    }
    const result = await validateBackup(parsed.value);
    setValidation(result);
    setPayload(result.ok ? (result.payload ?? null) : null);
  };

  return (
    <div className="stack">
      <Callout tone="danger" title="قبل أي استعادة أو حذف" icon="alert">
        أنشئ نسخة احتياطية الآن واحفظها في مكان آمن خارج المتصفح. الاستعادة بالوضع «استبدال» تحذف كل السجلات الحالية بعد
        إنشاء نسخة أمان مؤقتة، ويمكن تنزيل نسخة الأمان بعد العملية.
      </Callout>

      <div className="row">
        <Button variant="primary" icon="download" onClick={exportNow} loading={busy}>
          تصدير نسخة احتياطية JSON
        </Button>
        <Button icon="upload" onClick={() => fileRef.current?.click()}>
          اختيار ملف للاستعادة
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button
          variant="danger"
          icon="trash"
          onClick={() => setConfirmReset(true)}
        >
          حذف كل البيانات المحلية
        </Button>
      </div>

      {validation ? (
        <Card title="نتيجة التحقق من الملف" subtitle="يتم التحقق من البنية والبصمة والعلاقات قبل الاستعادة">
          <div className="stack" style={{ gap: 8 }}>
            {validation.ok ? (
              <Callout tone="success" title="الملف صالح للاستعادة" icon="check">
                {validation.summary ? (
                  <span>
                    تاريخ التصدير: {fmtDateTime(validation.summary.exportedAt)} —{' '}
                    {Object.entries(validation.summary.counts)
                      .map(([key, value]) => `${SCHEMAS[key as CsvEntity]?.label ?? key}: ${value}`)
                      .join(' · ')}
                  </span>
                ) : null}
              </Callout>
            ) : (
              <Callout tone="danger" title="الملف غير صالح" icon="alert">
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </Callout>
            )}
            {validation.warnings.length ? (
              <Callout tone="warning" title="تحذيرات" icon="info">
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}

            {validation.ok ? (
              <div className="row">
                <Field label="طريقة الاستعادة">
                  <Select value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'merge')}>
                    <option value="replace">استبدال كل البيانات الحالية</option>
                    <option value="merge">دمج مع البيانات الحالية (الأحدث يفوز)</option>
                  </Select>
                </Field>
                <Button variant="primary" icon="restore" onClick={() => setConfirmRestore(true)}>
                  تنفيذ الاستعادة
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {safety ? (
        <Callout tone="success" title="نسخة الأمان من بياناتك السابقة" icon="shield">
          أُنشئت نسخة أمان قبل الاستبدال. نزّلها الآن إن كنت تريد الاحتفاظ بها.
          <div className="row mt-8">
            <Button size="sm" icon="download" onClick={() => downloadFile(backupFileName(), JSON.stringify(safety, null, 2))}>
              تنزيل نسخة الأمان
            </Button>
          </div>
        </Callout>
      ) : null}

      <ConfirmDialog
        open={confirmRestore}
        title={mode === 'replace' ? 'استبدال كل البيانات' : 'دمج البيانات'}
        message={
          mode === 'replace'
            ? 'سيتم حذف كل السجلات الحالية واستبدالها بمحتوى الملف. ستُنشأ نسخة أمان من البيانات الحالية أولًا.'
            : 'سيتم دمج سجلات الملف مع السجلات الحالية. عند تعارض المعرّف يُعتمد الأحدث تحديثًا.'
        }
        confirmLabel="تنفيذ"
        onCancel={() => setConfirmRestore(false)}
        onConfirm={async () => {
          setConfirmRestore(false);
          if (!payload) return;
          try {
            const result = await runAction(() => restoreBackup(payload, mode), 'تمت الاستعادة بنجاح.');
            if (result) {
              setSafety(result.safetyBackup);
              setValidation(null);
              setPayload(null);
            }
          } catch {
            /* الرسالة تعرض عبر التنبيهات */
          }
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        title="حذف كل البيانات"
        message="سيتم حذف كل السجلات المحلية (موظفون، دقائق، زيارات، ملاحظات، تقييمات) بعد إنشاء نسخة أمان قابلة للتنزيل."
        confirmLabel="حذف الكل"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          try {
            const backup = await runAction(() => resetAllWithSafetyBackup(), 'تم حذف كل البيانات.');
            if (backup) setSafety(backup);
            await wipeAllData();
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}

/* ------------------------- الاستيراد والتصدير CSV ------------------------ */

function DataTab() {
  const { settings, notify, refresh } = useApp();
  const data = useVisibleData();
  const [entity, setEntity] = useState<CsvEntity>('employees');
  const [preview, setPreview] = useState<ReturnType<typeof parseEntityCsv> | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    void storageEstimate().then(setEstimate);
  }, [data]);

  const countFor = (target: CsvEntity) =>
    target === 'employees'
      ? data.employees.length
      : target === 'minutes'
        ? data.minutes.length
        : target === 'visits'
          ? data.visits.length
          : target === 'observations'
            ? data.observations.length
            : data.evaluations.length;

  const exportCsv = () => {
    const ctx = {
      employees: data.employees,
      branches: data.branches,
      categories: settings.observationCategories,
    };
    const csv =
      entity === 'employees'
        ? exportEntityCsv('employees', data.employees, ctx)
        : entity === 'minutes'
          ? exportEntityCsv('minutes', data.minutes, ctx)
          : entity === 'visits'
            ? exportEntityCsv('visits', data.visits, ctx)
            : entity === 'observations'
              ? exportEntityCsv('observations', data.observations, ctx)
              : exportEntityCsv('evaluations', data.evaluations, ctx);
    downloadFile(`${entity}-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const importCsv = async (file: File) => {
    const text = await readTextFile(file);
    const result = parseEntityCsv(entity, text, {
      employees: data.employees,
      branches: data.branches,
      categories: settings.observationCategories,
    });
    setPreview(result);
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    let success = 0;
    let failed = 0;
    for (const row of preview.accepted) {
      try {
        if (entity === 'employees') await saveEmployee(row as never);
        else if (entity === 'minutes') await saveMinute(row as never);
        else if (entity === 'visits') await saveVisit(row as never);
        else if (entity === 'observations') await saveObservation(row as never);
        else await saveEvaluation(row as never);
        success += 1;
      } catch {
        failed += 1;
      }
    }
    await refresh();
    setImporting(false);
    setPreview(null);
    notify(`تم استيراد ${success} سجلًا${failed ? ` وفشل ${failed}` : ''}.`, failed ? 'warning' : 'success');
  };

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="نوع البيانات">
          <Select value={entity} onChange={(e) => setEntity(e.target.value as CsvEntity)}>
            {Object.entries(SCHEMAS).map(([key, schema]) => (
              <option key={key} value={key}>
                {schema.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="عدد السجلات الحالية">
          <Input value={fmtNumber(countFor(entity))} readOnly />
        </Field>
      </div>

      <div className="row">
        <Button icon="download" onClick={exportCsv}>
          تصدير CSV
        </Button>
        <Button icon="upload" onClick={() => fileRef.current?.click()}>
          استيراد CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importCsv(file);
            e.currentTarget.value = '';
          }}
        />
      </div>

      <Callout tone="info" title="ملاحظات الاستيراد" icon="info">
        التصدير يشمل الأعمدة العربية القابلة للقراءة والتعديل. الاستيراد يتحقق من الأعمدة المطلوبة ووجود الموظفين
        المرتبطين قبل الحفظ، ويستبعد الصفوف غير الصالحة مع بيان السبب. لا يتم استيراد المعرّفات الداخلية.
      </Callout>

      {preview ? (
        <Card title={`معاينة الاستيراد — ${SCHEMAS[preview.entity].label}`} subtitle={`${preview.total} صفًا في الملف`}>
          <div className="summary-strip">
            <div className="summary-strip__item">
              <span>صفوف صالحة</span>
              <strong>{fmtNumber(preview.accepted.length)}</strong>
            </div>
            <div className="summary-strip__item">
              <span>أخطاء</span>
              <strong className="text-danger">{fmtNumber(preview.errors.length)}</strong>
            </div>
            <div className="summary-strip__item">
              <span>تحذيرات</span>
              <strong className="text-warning">{fmtNumber(preview.warnings.length)}</strong>
            </div>
          </div>

          {preview.errors.length ? (
            <div className="mt-12">
              <Callout tone="danger" title="أخطاء تمنع الاستيراد" icon="alert">
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {preview.errors.slice(0, 12).map((error, index) => (
                    <li key={index}>
                      {error.row ? `صف ${error.row}: ` : ''}
                      {error.message}
                    </li>
                  ))}
                </ul>
              </Callout>
            </div>
          ) : null}

          {preview.warnings.length ? (
            <div className="mt-12">
              <Callout tone="warning" title="تحذيرات" icon="info">
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {preview.warnings.slice(0, 8).map((warning, index) => (
                    <li key={index}>
                      {warning.row ? `صف ${warning.row}: ` : ''}
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </Callout>
            </div>
          ) : null}

          <div className="row mt-12">
            <Button variant="primary" icon="save" onClick={confirmImport} loading={importing} disabled={!preview.accepted.length}>
              استيراد {preview.accepted.length} سجلًا
            </Button>
            <Button onClick={() => setPreview(null)}>إلغاء</Button>
          </div>
        </Card>
      ) : null}

      <Card title="معلومات التخزين" subtitle="تقدير المساحة المستخدمة في المتصفح">
        {estimate ? (
          <div className="summary-strip">
            <div className="summary-strip__item">
              <span>المستخدم</span>
              <strong>{Math.round(estimate.usage / 1024)} ك.ب</strong>
            </div>
            <div className="summary-strip__item">
              <span>المتاح</span>
              <strong>{Math.round(estimate.quota / 1024 / 1024)} م.ب</strong>
            </div>
          </div>
        ) : (
          <p className="small muted">لا يوفر هذا المتصفح معلومات عن المساحة المستخدمة.</p>
        )}
        <p className="small muted mt-8">
          الموظفون: {fmtNumber(data.employees.length)} · دقائق: {fmtNumber(data.minutes.length)} · زيارات:{' '}
          {fmtNumber(data.visits.length)} · ملاحظات: {fmtNumber(data.observations.length)} · تقييمات:{' '}
          {fmtNumber(data.evaluations.length)} · حالة الموظفين المتاحة: {Object.values(EMPLOYEE_STATUS_LABELS).join(' / ')}
        </p>
        <div className="row mt-8">
          <Button size="sm" icon="settings" onClick={() => navigate('/settings?tab=backup')}>
            الانتقال إلى النسخ الاحتياطي
          </Button>
          <Button size="sm" variant="ghost" icon="employees" onClick={() => navigate('/employees')}>
            إدارة الموظفين
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------- البيانات التجريبية -------------------------- */

function DemoTab({
  demoMode,
  setDemoMode,
  notify,
  runAction,
}: {
  demoMode: boolean;
  setDemoMode: (value: boolean) => void;
  notify: (message: string, kind?: 'success' | 'error' | 'info' | 'warning') => void;
  runAction: ReturnType<typeof useApp>['runAction'];
}) {
  const [status, setStatus] = useState<{ seeded: boolean; seededAt: string | null }>({ seeded: false, seededAt: null });
  const [busy, setBusy] = useState(false);

  const load = async () => setStatus(await demoStatus());

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="stack">
      <Callout tone="info" title="بيانات تجريبية معزولة" icon="database">
        السجلات التجريبية تُوسم داخليًا (isDemo) ولا تظهر أبدًا مع السجلات الفعلية، ولا تُصدَّر في CSV، ولا تُحسب في لوحة
        المعلومات إلا في وضع البيانات التجريبية. يمكن حذفها بالكامل في أي وقت.
      </Callout>

      <div className="row">
        <Badge tone={status.seeded ? 'success' : 'neutral'}>{status.seeded ? 'بيانات تجريبية محمّلة' : 'لا توجد بيانات تجريبية'}</Badge>
        {status.seededAt ? <span className="small muted">أُضيفت في {fmtDateTime(status.seededAt)}</span> : null}
        <Badge tone={demoMode ? 'warning' : 'neutral'}>{demoMode ? 'وضع العرض التجريبي مفعّل' : 'وضع العرض الفعلي'}</Badge>
      </div>

      <div className="row">
        <Button
          variant="primary"
          icon="database"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await runAction(async () => {
                await seedDemoData();
                await load();
              }, 'تمت إضافة البيانات التجريبية المعزولة.');
              notify('فعّل «وضع البيانات التجريبية» لعرضها.', 'info');
            } finally {
              setBusy(false);
            }
          }}
        >
          إضافة البيانات التجريبية
        </Button>
        <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            const removed = await runAction(async () => clearDemoData(), 'تم حذف كل البيانات التجريبية.');
            await load();
            if (removed) notify(`تم حذف ${removed} سجلًا تجريبيًا. السجلات الفعلية لم تتأثر.`, 'success');
          }}
        >
          حذف البيانات التجريبية
        </Button>
        <Button icon={demoMode ? 'lock' : 'unlock'} onClick={() => setDemoMode(!demoMode)}>
          {demoMode ? 'إيقاف وضع العرض التجريبي' : 'تفعيل وضع العرض التجريبي'}
        </Button>
      </div>

      <p className="small muted">
        ملاحظة: تفعيل الوضع التجريبي يخفي السجلات الفعلية مؤقتًا من الشاشات والتقارير فقط، ولا يحذفها أو يغيّرها.
      </p>
    </div>
  );
}

/* ----------------------------- سجل التغييرات ----------------------------- */

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState('');
  const data = useVisibleData();

  useEffect(() => {
    void readAudit(500).then(setEntries);
  }, [data]);

  const filtered = useMemo(
    () => entries.filter((entry) => (filter ? `${entry.summary} ${entry.entityLabel ?? ''}`.toLowerCase().includes(filter.toLowerCase()) : true)),
    [entries, filter],
  );

  return (
    <div className="stack">
      <div className="row">
        <Input placeholder="بحث في السجل…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="small muted">{fmtNumber(filtered.length)} إدخالًا — أحدث 500 تغيير</span>
      </div>
      {filtered.length ? (
        <TableWrap>
          <Table className="table--compact">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>الإجراء</th>
                <th>الكيان</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, index) => (
                <tr key={`${entry.at}-${index}`}>
                  <td className="nowrap">{fmtDateTime(entry.at)}</td>
                  <td>{entry.action}</td>
                  <td>{entry.entityLabel || entry.entity}</td>
                  <td>{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <p className="small muted">لا توجد تغييرات مسجلة بعد.</p>
      )}
      <p className="small muted">
        يُحفظ السجل محليًا فقط. أرشيف السجلات المحذوفة (حذفًا ناعمًا) متاح من شاشة كل وحدة عبر فلتر «المؤرشفة».
        {' '}تاريخ اليوم: {fmtDate(new Date())} — {toDateInputValue(new Date())}
      </p>
    </div>
  );
}
