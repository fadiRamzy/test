import { useRef, useState } from 'react';
import { useApp } from '../state/store';
import { Button, Callout, Modal, PageHeader } from '../components/ui';
import {
  backupFileName,
  createBackup,
  restoreBackup,
  validateBackup,
  type BackupPayload,
  type ValidationResult,
} from '../db/backup';
import { downloadFile, readTextFile, safeJsonParse } from '../lib/utils';
import { fmtDateTime } from '../lib/format';

export function ReportsPage() {
  const { refresh, notify } = useApp();
  const [pending, setPending] = useState<{ payload: BackupPayload; validation: ValidationResult; name: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    try {
      const payload = await createBackup();
      downloadFile(backupFileName(), JSON.stringify(payload, null, 2));
      notify('تم تنزيل النسخة الاحتياطية.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذّر تنزيل النسخة الاحتياطية.', 'error');
    }
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
        eyebrow="إدارة البيانات المحلية"
        title="التقارير والنسخ الاحتياطي"
        description="نزّل نسخة كاملة من سجلاتك أو ارفع نسخة محفوظة لاستعادتها."
      />
      <section className="backup-actions" aria-label="إجراءات النسخ الاحتياطي">
        <article className="backup-action-card">
          <span className="backup-action-card__icon" aria-hidden="true">↓</span>
          <div>
            <h2>تنزيل آخر نسخة</h2>
            <p>تنزيل نسخة JSON كاملة تشمل السجلات والإعدادات المحفوظة.</p>
          </div>
          <Button variant="primary" icon="download" onClick={exportBackup}>تنزيل آخر نسخة</Button>
        </article>
        <article className="backup-action-card">
          <span className="backup-action-card__icon backup-action-card__icon--upload" aria-hidden="true">↑</span>
          <div>
            <h2>رفع نسخة بيانات</h2>
            <p>استعادة نسخة موجودة بعد التحقق منها، مع تنزيل نسخة أمان قبل التنفيذ.</p>
          </div>
          <Button icon="upload" onClick={() => fileRef.current?.click()}>رفع نسخة بيانات</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="اختيار ملف نسخة بيانات"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickFile(file);
              event.target.value = '';
            }}
          />
        </article>
      </section>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="تأكيد رفع نسخة بيانات"
        subtitle={pending?.name}
        footer={
          <>
            <Button onClick={() => setPending(null)}>إلغاء</Button>
            <Button variant="danger" disabled={!pending?.validation.ok || restoring} onClick={() => doRestore('replace')}>
              استبدال البيانات
            </Button>
            <Button variant="primary" disabled={!pending?.validation.ok || restoring} onClick={() => doRestore('merge')}>
              دمج مع البيانات الحالية
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p className="small muted">تاريخ إنشاء النسخة: {fmtDateTime(pending.validation.exportedAt)}</p>
            {pending.validation.errors.length ? (
              <Callout tone="danger">
                <ul>{pending.validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>
              </Callout>
            ) : (
              <Callout tone="success">الملف صالح. ستُنزّل نسخة أمان من البيانات الحالية قبل التنفيذ.</Callout>
            )}
            {pending.validation.warnings.length ? (
              <Callout tone="warning">
                <ul>{pending.validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </Callout>
            ) : null}
          </>
        ) : null}
      </Modal>
    </>
  );
}
