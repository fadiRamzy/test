import { useRef, useState } from 'react';
import { useApp } from '../state/store';
import {
  Badge,
  Button,
  Callout,
  Card,
  DefinitionList,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Table,
  TableWrap,
  Textarea,
} from '../components/ui';
import { backupFileName, createBackup, dataCounts, restoreBackup, validateBackup, type BackupPayload, type ValidationResult } from '../db/backup';
import { ENTITY_LABELS, type EntityName } from '../db/schema';
import { fmtDateTime } from '../lib/format';
import { downloadFile, readTextFile, safeJsonParse } from '../lib/utils';
import { DB_NAME, DB_VERSION } from '../db/schema';

const ENTITIES: EntityName[] = ['employees', 'minutes', 'visits', 'observations', 'evaluations'];

export function SettingsPage() {
  const { settings, saveSettings, refresh, notify, data } = useApp();
  const [org, setOrg] = useState(settings.organizationName);
  const [leader, setLeader] = useState(settings.teamLeaderName);
  const [deadline, setDeadline] = useState(String(settings.deadlineMinutes));
  const [sectors, setSectors] = useState(settings.sectors.join('\n'));
  const [governorates, setGovernorates] = useState(settings.governorates.join('\n'));
  const [obsTypes, setObsTypes] = useState(settings.observationTypes.join('\n'));
  const [deadlineError, setDeadlineError] = useState('');

  const [counts, setCounts] = useState<Record<EntityName, number> | null>(null);
  const [pending, setPending] = useState<{ payload: BackupPayload; validation: ValidationResult; name: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rowsFor = (text: string, min = 3) => Math.min(12, Math.max(min, text.split('\n').length + 1));

  const parseLines = (text: string) =>
    Array.from(new Set(text.split('\n').map((line) => line.trim()).filter(Boolean)));

  const saveGeneral = async () => {
    const value = Number(deadline);
    if (!Number.isFinite(value) || value < 1 || value > 10080) {
      setDeadlineError('أدخل مهلة بالدقائق بين 1 و10080.');
      return;
    }
    setDeadlineError('');
    await saveSettings({
      organizationName: org.trim(),
      teamLeaderName: leader.trim(),
      deadlineMinutes: Math.round(value),
      sectors: parseLines(sectors),
      governorates: parseLines(governorates),
      observationTypes: parseLines(obsTypes),
    });
  };

  const exportBackup = async () => {
    const payload = await createBackup();
    downloadFile(backupFileName(), JSON.stringify(payload, null, 2));
    setCounts(payload.counts);
    notify('تم تصدير النسخة الاحتياطية بصيغة JSON.', 'success');
  };

  const showCounts = async () => setCounts(await dataCounts());

  const pickFile = async (file: File) => {
    const text = await readTextFile(file);
    const parsed = safeJsonParse<unknown>(text);
    if (!parsed.ok) {
      notify(parsed.error, 'error');
      return;
    }
    const validation = await validateBackup(parsed.value);
    setPending({ payload: parsed.value as BackupPayload, validation, name: file.name });
  };

  const doRestore = async (mode: 'replace' | 'merge') => {
    if (!pending) return;
    setRestoring(true);
    try {
      await restoreBackup(pending.payload, mode);
      await refresh();
      const safetyName = `risk-tracker-safety-${backupFileName().replace('risk-tracker-backup-', '')}`;
      downloadFile(safetyName, JSON.stringify(await createBackup(), null, 2));
      notify(
        mode === 'replace' ? 'تم استبدال البيانات بالنسخة المستوردة. نُزّلت نسخة أمان من بياناتك السابقة.' : 'تم دمج النسخة المستوردة. نُزّلت نسخة أمان من بياناتك السابقة.',
        'success',
      );
      setPending(null);
      await showCounts();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذّرت الاستعادة.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <PageHeader title="الإعدادات" description="بيانات الفريق، المهل الزمنية، القوائم المرجعية، والنسخ الاحتياطي." />

      <Callout tone="warning" title="تنبيه مهم عن تخزين البيانات">
        كل البيانات تُخزَّن في IndexedDB داخل هذا المتصفح على هذا الجهاز فقط. لا توجد مزامنة بين الأجهزة أو المتصفحات، ولا
        نسخ على أي خادم. إذا حذفت بيانات المتصفح (Clear browsing data / Site data) أو استخدمت وضع التصفح الخاص أو غيّرت
        المتصفح أو الجهاز، فلن تجد بياناتك. صدّر نسخة JSON دوريًا واحفظها خارج المتصفح (قرص/بريد مؤسسي).
      </Callout>

      <div className="grid-2">
        <Card title="بيانات الفريق والإعدادات العامة">
          <div className="form-grid">
            <Field label="اسم المؤسسة" htmlFor="set-org" className="span-2">
              <Input id="set-org" value={org} onChange={(e) => setOrg(e.target.value)} />
            </Field>
            <Field label="اسم قائد الفريق" htmlFor="set-leader" className="span-2">
              <Input id="set-leader" value={leader} onChange={(e) => setLeader(e.target.value)} />
            </Field>
            <Field
              label="مهلة المراجعة (بالدقائق)"
              error={deadlineError}
              hint="تُستخدم لحساب تجاوز المهلة في دقائق الصرف ومراجعة التقارير."
              htmlFor="set-deadline"
            >
              <Input id="set-deadline" type="number" min={1} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <Field label="قطاعات (سطر لكل قطاع)" htmlFor="set-sectors" className="span-2">
              <Textarea id="set-sectors" rows={rowsFor(sectors)} value={sectors} onChange={(e) => setSectors(e.target.value)} />
            </Field>
            <Field label="محافظات (سطر لكل محافظة)" htmlFor="set-govs" className="span-2">
              <Textarea id="set-govs" rows={rowsFor(governorates)} value={governorates} onChange={(e) => setGovernorates(e.target.value)} />
            </Field>
            <Field label="أنواع الملاحظات (سطر لكل نوع)" htmlFor="set-obs" className="span-2">
              <Textarea id="set-obs" rows={rowsFor(obsTypes)} value={obsTypes} onChange={(e) => setObsTypes(e.target.value)} />
            </Field>
          </div>
          <div className="form-actions">
            <Button variant="primary" icon="save" onClick={saveGeneral}>
              حفظ الإعدادات
            </Button>
          </div>
        </Card>

        <Card title="النسخ الاحتياطي والاستعادة" subtitle="ملف JSON واحد يحتوي كل السجلات والإعدادات.">
          <div className="form-actions">
            <Button variant="primary" icon="download" onClick={exportBackup}>
              تصدير نسخة JSON
            </Button>
            <Button icon="upload" onClick={() => fileRef.current?.click()}>
              استيراد نسخة
            </Button>
            <Button icon="database" onClick={showCounts}>
              عرض عدد السجلات
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {counts ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>الجدول</th>
                    <th>عدد السجلات</th>
                  </tr>
                </thead>
                <tbody>
                  {ENTITIES.map((entity) => (
                    <tr key={entity}>
                      <td>{ENTITY_LABELS[entity]}</td>
                      <td className="num">{counts[entity]}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState icon="database" title="لم يتم عرض الأعداد بعد" description="اضغط «عرض عدد السجلات»." />
          )}

          <Callout tone="danger" title="منطقة خطر">
            حذف كل البيانات نهائيًا من هذا المتصفح — نزّل نسخة أمان أولًا. عدد السجلات الحالي:{' '}
            {data.employees.length + data.minutes.length + data.visits.length + data.observations.length + data.evaluations.length}
            .
            <div className="form-actions">
              <Button variant="danger" icon="trash" onClick={() => setResetOpen(true)}>
                حذف كل البيانات
              </Button>
            </div>
          </Callout>
        </Card>
      </div>

      <Card title="معلومات التخزين">
        <DefinitionList
          items={[
            { label: 'قاعدة البيانات المحلية', value: <span className="mono">{DB_NAME}</span> },
            { label: 'إصدار المخطط', value: String(DB_VERSION) },
            { label: 'آخر تحديث للإعدادات', value: fmtDateTime(settings.updatedAt) },
            { label: 'مزامنة بين الأجهزة', value: <Badge tone="danger">غير مدعومة — بيانات محلية فقط</Badge> },
            { label: 'خادم أو سحابة', value: <Badge tone="success">لا يوجد — لا تُرسَل أي بيانات</Badge> },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="استيراد نسخة احتياطية"
        subtitle={pending?.name}
        size="md"
        footer={
          <>
            <Button onClick={() => setPending(null)}>إلغاء</Button>
            <Button variant="danger" loading={restoring} disabled={!pending?.validation.ok} onClick={() => doRestore('replace')}>
              استبدال كل البيانات
            </Button>
            <Button variant="primary" loading={restoring} disabled={!pending?.validation.ok} onClick={() => doRestore('merge')}>
              دمج مع الحالي
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p className="small muted">تاريخ التصدير: {fmtDateTime(pending.validation.exportedAt)}</p>
            {pending.validation.counts ? (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <th>الجدول</th>
                      <th>عدد السجلات في الملف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ENTITIES.map((entity) => (
                      <tr key={entity}>
                        <td>{ENTITY_LABELS[entity]}</td>
                        <td className="num">{pending.validation.counts?.[entity] ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            ) : null}
            {pending.validation.errors.length ? (
              <Callout tone="danger" title="الملف غير صالح">
                <ul>
                  {pending.validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </Callout>
            ) : (
              <Callout tone="success" title="الملف صالح">
                يمكنك الدمج (الأحدث يفوز حسب تاريخ التعديل) أو الاستبدال الكامل. في الحالتين تُنزَّل نسخة أمان من بياناتك
                الحالية أولًا.
              </Callout>
            )}
            {pending.validation.warnings.length ? (
              <Callout tone="warning" title="ملاحظات">
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

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="حذف كل البيانات"
        size="sm"
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                const { resetAllData } = await import('../db/backup');
                const safety = await resetAllData();
                downloadFile(
                  `risk-tracker-safety-before-reset-${backupFileName().replace('risk-tracker-backup-', '')}`,
                  JSON.stringify(safety, null, 2),
                );
                await refresh();
                setResetOpen(false);
                notify('تم حذف كل البيانات، ونُزّلت نسخة أمان قبل الحذف.', 'success');
              }}
            >
              تأكيد الحذف
            </Button>
          </>
        }
      >
        <p className="confirm-text">
          سيتم حذف كل الموظفين والدقائق والزيارات والملاحظات والتقييمات من هذا المتصفح. تُنزَّل نسخة أمان تلقائيًا قبل
          الحذف — احتفظ بها.
        </p>
      </Modal>
    </>
  );
}
