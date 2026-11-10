/**
 * تبويب «النسخ الاحتياطي»: ثلاثة أزرار فقط —
 * تصدير Excel، تنزيل نسخة احتياطية JSON، ورفع نسخة احتياطية JSON (استعادة).
 */
import { useRef, useState } from 'react';
import { Button, Modal } from '../ui/kit';
import type { Notify } from '../ui/toast';
import { restoreDelinquencyData } from '../db/delinquencyDb';
import { backupFileName, createBackupFile, parseBackupFile, type ParsedBackup } from '../lib/backupFile';
import { errorMessage } from '../lib/errors';
import { comparisonsNoun, downloadBlob, monthsNoun, readTextFile } from '../lib/utils';
import { exportReport, reportPeriods, type Selection } from '../lib/selection';
import type { DelinquencyData } from './Delinquency';

type Pending = Extract<ParsedBackup, { ok: true }>;

export function DataTab({
  data,
  selection,
  reload,
  notify,
  organization,
  onOrganizationChange,
}: {
  data: DelinquencyData;
  selection: Selection;
  reload: () => Promise<void>;
  notify: Notify;
  organization: string;
  onOrganizationChange: (name: string) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasMonths = data.snapshots.length > 0;
  const isEmpty = !hasMonths && !data.saved.length && !data.lists.size;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = () => {
    const periods = reportPeriods(data.snapshots, selection);
    if (periods) exportReport(data.snapshots, periods.current, periods.previous, organization, notify);
  };

  const downloadBackup = () =>
    run(async () => {
      const file = await createBackupFile(organization);
      downloadBlob(backupFileName(), JSON.stringify(file, null, 2), 'application/json');
      notify('تم تنزيل النسخة الاحتياطية.', 'success');
    });

  const restore = (backup: Pending) =>
    run(async () => {
      const counts = await restoreDelinquencyData(backup.data, 'restore');
      if (backup.organization) onOrganizationChange(backup.organization);
      setPending(null);
      await reload();
      notify(`تمت الاستعادة: ${monthsNoun(counts.months)}، ${comparisonsNoun(counts.comparisons)}.`, 'success');
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseBackupFile(await readTextFile(file));
      if (!parsed.ok) {
        notify(parsed.errors[0] ?? 'تعذّر استخدام الملف.', 'error');
        return;
      }
      // لا شيء يُستبدل إذا كان النظام فارغًا — تُستعاد النسخة مباشرة
      if (isEmpty) await restore(parsed);
      else setPending(parsed);
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="dq-backup" aria-label="النسخ الاحتياطي">
      <Button variant="primary" icon="download" onClick={exportExcel} disabled={busy || !hasMonths}>
        تصدير Excel
      </Button>
      <Button icon="download" onClick={downloadBackup} disabled={busy || isEmpty}>
        تنزيل نسخة احتياطية (JSON)
      </Button>
      <Button icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
        رفع نسخة احتياطية (JSON)
      </Button>
      <input
        ref={fileRef}
        id="dq-restore-file"
        type="file"
        accept="application/json,.json"
        className="dq-visually-hidden"
        aria-label="ملف النسخة الاحتياطية"
        tabIndex={-1}
        onChange={(event) => void onFile(event.target.files?.[0])}
      />

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        size="sm"
        title="استعادة النسخة الاحتياطية"
        footer={
          <>
            <Button onClick={() => setPending(null)}>إلغاء</Button>
            <Button variant="primary" icon="restore" disabled={busy} onClick={() => pending && void restore(pending)}>
              استعادة
            </Button>
          </>
        }
      >
        {pending ? (
          <p className="dq-data__text">
            الملف يحتوي {monthsNoun(pending.data.months.length)}. الأشهر الموجودة بنفس الشهر والفرع ستُستبدل ببيانات الملف، وباقي بياناتك تبقى كما هي.
          </p>
        ) : null}
      </Modal>
    </section>
  );
}
