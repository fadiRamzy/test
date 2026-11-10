/**
 * تبويب «البيانات والنسخ الاحتياطي»: ملخص ما هو مخزَّن، اسم الجهة،
 * تنزيل/استعادة نسخة احتياطية، البيانات التجريبية، وحذف كل البيانات.
 */
import { useMemo, useRef, useState } from 'react';
import { Button, Callout, Field, Input, Modal, Select } from '../ui/kit';
import type { Notify } from '../ui/toast';
import { Panel } from '../components/Dashboard';
import { clearDelinquencyData, restoreDelinquencyData } from '../db/delinquencyDb';
import { backupFileName, createBackupFile, parseBackupFile, type ParsedBackup } from '../lib/backupFile';
import { errorMessage } from '../lib/errors';
import { isSampleSnapshot, loadSampleData, removeSampleData } from '../lib/sampleData';
import { clientListsNoun, comparisonsNoun, downloadBlob, fmtDateTime, monthsNoun, readTextFile } from '../lib/utils';
import type { DelinquencyData } from './Delinquency';

type RestoreMode = 'merge' | 'replace';

const describe = (counts: { months: number; clientLists: number; comparisons: number }): string =>
  `${monthsNoun(counts.months)}، ${clientListsNoun(counts.clientLists)}، ${comparisonsNoun(counts.comparisons)}`;

type Pending = Extract<ParsedBackup, { ok: true }> & { fileName: string };

export function DataTab({
  data,
  reload,
  notify,
  organization,
  onOrganizationChange,
}: {
  data: DelinquencyData;
  reload: () => Promise<void>;
  notify: Notify;
  organization: string;
  onOrganizationChange: (name: string) => void;
}) {
  const [orgDraft, setOrgDraft] = useState(organization);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const branches = useMemo(() => new Set(data.snapshots.map((snapshot) => snapshot.branch)).size, [data.snapshots]);
  const sampleCount = useMemo(() => data.snapshots.filter(isSampleSnapshot).length, [data.snapshots]);
  const isEmpty = !data.snapshots.length && !data.saved.length;

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

  const downloadBackup = () =>
    run(async () => {
      const file = await createBackupFile(organization);
      downloadBlob(backupFileName(), JSON.stringify(file, null, 2), 'application/json');
      notify('تم تنزيل النسخة الاحتياطية.', 'success');
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileErrors([]);
    try {
      const parsed = parseBackupFile(await readTextFile(file));
      if (!parsed.ok) {
        setFileErrors(parsed.errors.slice(0, 5));
        return;
      }
      setPending({ ...parsed, fileName: file.name });
    } catch (cause) {
      setFileErrors([errorMessage(cause)]);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmRestore = () =>
    run(async () => {
      if (!pending) return;
      const counts = await restoreDelinquencyData(pending.data, mode);
      setPending(null);
      await reload();
      notify(
        mode === 'replace'
          ? `تم استبدال البيانات — المحتوى الآن: ${describe(counts)}.`
          : `تم الدمج — سجلات أُضيفت أو حُدّثت: ${describe(counts)}.`,
        'success',
      );
    });

  const confirmClear = () =>
    run(async () => {
      await clearDelinquencyData();
      setClearing(false);
      await reload();
      notify('تم حذف كل بيانات النظام من هذا المتصفح.', 'success');
    });

  return (
    <div className="dq-data">
      <Panel title="البيانات المخزنة" icon="database" subtitle="كل البيانات محفوظة داخل هذا المتصفح على هذا الجهاز فقط — لا تُرسل إلى أي خادم.">
        <dl className="dq-data__stats" data-testid="dq-data-stats">
          <div>
            <dt>أشهر مُدخلة</dt>
            <dd>{data.snapshots.length}</dd>
          </div>
          <div>
            <dt>فروع</dt>
            <dd>{branches}</dd>
          </div>
          <div>
            <dt>قوائم عملاء</dt>
            <dd>{data.lists.size}</dd>
          </div>
          <div>
            <dt>مقارنات محفوظة</dt>
            <dd>{data.saved.length}</dd>
          </div>
        </dl>
        <Callout tone="warning">
          مسح بيانات المتصفح أو استخدام جهاز آخر يعني فقدان هذه البيانات. نزّل نسخة احتياطية بانتظام واحفظها في مكان آمن.
        </Callout>
      </Panel>

      <div className="dq-grid dq-grid--2">
        <Panel title="نسخة احتياطية" icon="download" subtitle="ملف JSON واحد يحتوي الأشهر وقوائم العملاء والمقارنات المحفوظة.">
          <div className="dq-data__row">
            <Button variant="primary" icon="download" onClick={downloadBackup} disabled={busy || isEmpty}>
              تنزيل نسخة احتياطية
            </Button>
            {isEmpty ? <span className="dq-data__hint">لا توجد بيانات لتنزيلها بعد.</span> : null}
          </div>
        </Panel>

        <Panel title="استعادة من نسخة احتياطية" icon="restore" subtitle="يُفحص الملف أولًا، ولا يتغير شيء قبل تأكيدك.">
          <div className="dq-data__row">
            <Field label="طريقة الاستعادة" htmlFor="dq-restore-mode">
              <Select id="dq-restore-mode" value={mode} onChange={(event) => setMode(event.target.value as RestoreMode)}>
                <option value="merge">دمج — إضافة الجديد وتحديث الأحدث</option>
                <option value="replace">استبدال — حذف الحالي ووضع محتوى الملف</option>
              </Select>
            </Field>
            <input
              ref={fileRef}
              id="dq-restore-file"
              type="file"
              accept="application/json,.json"
              className="dq-visually-hidden"
              aria-label="ملف النسخة الاحتياطية"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            <Button icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
              اختيار ملف النسخة…
            </Button>
          </div>
          {fileErrors.length ? (
            <Callout tone="danger">
              <strong>تعذّر استخدام الملف:</strong>
              <ul>
                {fileErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </Panel>
      </div>

      <div className="dq-grid dq-grid--2">
        <Panel title="اسم الجهة" icon="building" subtitle="يظهر في رأس الصفحة وفي ملفات Excel المُصدَّرة (اختياري).">
          <div className="dq-data__row">
            <Field label="اسم الجهة أو الإدارة" htmlFor="dq-organization">
              <Input
                id="dq-organization"
                value={orgDraft}
                maxLength={80}
                placeholder="مثال: إدارة المخاطر — قطاع الصعيد"
                onChange={(event) => setOrgDraft(event.target.value)}
              />
            </Field>
            <Button
              icon="save"
              disabled={orgDraft.trim() === organization}
              onClick={() => {
                onOrganizationChange(orgDraft.trim());
                notify('تم حفظ اسم الجهة.', 'success');
              }}
            >
              حفظ الاسم
            </Button>
          </div>
        </Panel>

        <Panel title="بيانات تجريبية" icon="sparkles" subtitle="لاستكشاف النظام فقط — ليست بيانات أي فرع حقيقي.">
          <div className="dq-data__row">
            {sampleCount ? (
              <Button
                icon="trash"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const removed = await removeSampleData();
                    await reload();
                    notify(`تم حذف البيانات التجريبية (${monthsNoun(removed)}). بياناتك الأخرى لم تتغير.`, 'success');
                  })
                }
              >
                حذف البيانات التجريبية
              </Button>
            ) : (
              <Button
                icon="sparkles"
                disabled={busy || data.snapshots.length > 0}
                onClick={() =>
                  run(async () => {
                    await loadSampleData();
                    await reload();
                    notify('تم تحميل بيانات تجريبية لفرعين. افتح «لوحة المقارنة» لمشاهدتها.', 'success');
                  })
                }
              >
                تحميل بيانات تجريبية
              </Button>
            )}
            <span className="dq-data__hint">
              {sampleCount
                ? `البيانات التجريبية الحالية: ${monthsNoun(sampleCount)}. احذفها قبل الاعتماد على النتائج.`
                : data.snapshots.length
                  ? 'متاحة فقط عندما لا توجد أي بيانات مُدخلة.'
                  : 'تُضاف ثلاثة أشهر لفرع أول، وشهران مع قوائم عملاء لفرع ثانٍ.'}
            </span>
          </div>
        </Panel>
      </div>

      <Panel title="حذف كل البيانات" icon="trash" subtitle="يحذف كل الأشهر وقوائم العملاء والمقارنات المحفوظة من هذا المتصفح.">
        <div className="dq-data__row">
          <Button variant="danger" icon="trash" disabled={busy || isEmpty} onClick={() => setClearing(true)}>
            حذف كل البيانات…
          </Button>
          <span className="dq-data__hint">لا يمكن التراجع عن الحذف — نزّل نسخة احتياطية أولًا.</span>
        </div>
      </Panel>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        size="sm"
        title={mode === 'replace' ? 'تأكيد استبدال البيانات' : 'تأكيد دمج البيانات'}
        subtitle={pending?.fileName}
        footer={
          <>
            <Button onClick={() => setPending(null)}>إلغاء</Button>
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} icon="restore" disabled={busy} onClick={confirmRestore}>
              {mode === 'replace' ? 'استبدال البيانات الحالية' : 'دمج مع البيانات الحالية'}
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p className="dq-data__text">
              محتوى الملف:{' '}
              <strong>
                {describe({
                  months: pending.data.months.length,
                  clientLists: pending.data.clientLists.length,
                  comparisons: pending.data.comparisons.length,
                })}
              </strong>
              {pending.exportedAt ? ` — أُنشئ في ${fmtDateTime(pending.exportedAt)}` : ''}.
            </p>
            {mode === 'replace' ? (
              <Callout tone="danger">سيُحذف كل ما هو مخزَّن حاليًا ويوضع محتوى الملف مكانه. لا يمكن التراجع.</Callout>
            ) : (
              <Callout tone="info">ستُضاف السجلات الجديدة، ويُحدَّث أي سجل موجود إذا كانت نسخة الملف أحدث. لا يُحذف شيء.</Callout>
            )}
          </>
        ) : null}
      </Modal>

      <Modal
        open={clearing}
        onClose={() => setClearing(false)}
        size="sm"
        title="حذف كل بيانات النظام"
        footer={
          <>
            <Button onClick={() => setClearing(false)}>إلغاء</Button>
            <Button variant="danger" icon="trash" disabled={busy} onClick={confirmClear}>
              نعم، احذف كل البيانات
            </Button>
          </>
        }
      >
        <p className="dq-data__text">
          سيُحذف نهائيًا من هذا المتصفح:{' '}
          <strong>{describe({ months: data.snapshots.length, clientLists: data.lists.size, comparisons: data.saved.length })}</strong>.
        </p>
        <Callout tone="danger">لا يمكن التراجع عن هذا الإجراء.</Callout>
      </Modal>
    </div>
  );
}
