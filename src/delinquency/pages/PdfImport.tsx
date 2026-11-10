/**
 * استيراد بيانات الشهر من ملف PDF (تقرير «اعمار الديون»):
 * قراءة قسم «المحفظة في ظل المخاطر» فقط ← جدول مراجعة قابل للتعديل للمكاتب التسعة عشر ← تأكيد ← حفظ.
 * الملف يُقرأ داخل المتصفح ولا يُرسل إلى أي مكان.
 */
import { useMemo, useRef, useState } from 'react';
import { Badge, Button, Callout, Field, Icon, Input, Modal, Select, type Tone } from '../ui/kit';
import type { Notify } from '../ui/toast';
import { Panel } from '../components/Dashboard';
import { ExistingSnapshotsError, saveSnapshotsBatch } from '../db/delinquencyDb';
import {
  BUCKETS,
  BUCKET_IDS,
  MONTH_NAMES_AR,
  fmtInt,
  fmtMoney,
  parseNumberInput,
  periodLabel,
  snapshotId,
  type BucketId,
  type MonthlySnapshot,
} from '../lib/delinquency';
import { errorMessage } from '../lib/errors';
import { OFFICES, type OfficeName } from '../lib/offices';
import { ParReportError, parseParReport, type ParExtraction } from '../lib/parReport';
import { assessReview, reviewTableFrom, reviewToInputs, reviewToSnapshots, type ReviewField, type ReviewTable, type RowAssessment } from '../lib/pdfImport';
import { PdfReadError, readPdfText } from '../lib/pdfText';
import { exportReport } from '../lib/selection';
import { readBinaryFile } from '../lib/utils';

const MAX_FILE_BYTES = 40 * 1024 * 1024;

export interface PdfImportState {
  fileName: string;
  extraction: ParExtraction;
  table: ReviewTable;
  month: string;
  year: string;
  /** صفحات بلا نص في الملف (صور) */
  emptyPages: number[];
}

/** يقرأ ملف PDF ويجهّز حالة المراجعة. يرمي خطأ برسالة عربية واضحة عند الفشل. */
export async function loadPdfImport(file: File): Promise<PdfImportState> {
  if (file.size === 0) throw new Error('الملف فارغ.');
  if (file.size > MAX_FILE_BYTES) throw new Error('حجم الملف أكبر من 40 ميجابايت.');
  const bytes = await readBinaryFile(file);
  const text = await readPdfText(bytes);
  const extraction = parseParReport(text.items);
  return {
    fileName: file.name,
    extraction,
    table: reviewTableFrom(extraction),
    month: extraction.asOf ? String(extraction.asOf.month) : '',
    year: extraction.asOf ? String(extraction.asOf.year) : '',
    emptyPages: text.emptyPages,
  };
}

function importErrorMessage(cause: unknown): string {
  if (cause instanceof PdfReadError || cause instanceof ParReportError) return cause.message;
  return `تعذّرت قراءة الملف: ${errorMessage(cause)}`;
}

function rowBadge(row: RowAssessment): { tone: Tone; label: string } {
  if (row.status === 'incomplete') return { tone: 'danger', label: 'ناقص' };
  if (row.status === 'empty') return { tone: 'neutral', label: 'بلا بيانات' };
  if (row.matchesReport === false) return { tone: 'warning', label: 'راجِع' };
  if (row.matchesReport === null || row.notes.length) return { tone: 'warning', label: 'راجِع' };
  return row.edited ? { tone: 'info', label: 'معدّل — مطابق' } : { tone: 'success', label: 'مطابق' };
}

export function PdfImport({
  state,
  setState,
  snapshots,
  organization,
  reload,
  notify,
}: {
  state: PdfImportState | null;
  setState: (next: PdfImportState | null | ((prev: PdfImportState | null) => PdfImportState | null)) => void;
  snapshots: MonthlySnapshot[];
  organization: string;
  reload: () => Promise<void>;
  notify: Notify;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      setState(await loadPdfImport(file));
    } catch (cause) {
      setState(null);
      setError(importErrorMessage(cause));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const summary = useMemo(() => (state ? assessReview(state.table, state.extraction) : null), [state]);

  const period = useMemo(() => {
    if (!state) return null;
    const year = parseNumberInput(state.year);
    const month = parseNumberInput(state.month);
    if (year === null || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
    if (month === null || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month };
  }, [state]);

  /** مكاتب مكتملة لها سجل محفوظ بنفس الشهر — تحتاج تأكيد الاستبدال */
  const existing = useMemo(() => {
    if (!summary || !period) return [] as OfficeName[];
    const ids = new Set(snapshots.map((snapshot) => snapshot.id));
    return summary.complete.filter((office) => ids.has(snapshotId(office, period.year, period.month)));
  }, [summary, period, snapshots]);

  const fileInput = (
    <input
      ref={fileRef}
      id="dq-pdf-file"
      type="file"
      accept="application/pdf,.pdf"
      className="dq-pdf__file"
      aria-label="ملف PDF"
      onChange={(event) => void pick(event.target.files?.[0])}
    />
  );

  if (!state || !summary) {
    return (
      <Panel title="رفع ملف PDF" id="dq-pdf">
        <div className="dq-pdf__pick">
          {fileInput}
          <Button variant="primary" icon="upload" disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? 'جارٍ قراءة الملف…' : 'اختيار ملف PDF'}
          </Button>
        </div>
        {error ? (
          <Callout tone="danger">
            <span role="alert">{error}</span>
          </Callout>
        ) : null}
      </Panel>
    );
  }

  const { extraction } = state;

  const setCell = (office: OfficeName, bucket: BucketId, field: ReviewField, value: string) =>
    setState((prev) =>
      prev
        ? { ...prev, table: { ...prev.table, [office]: { ...prev.table[office], [bucket]: { ...prev.table[office][bucket], [field]: value } } } }
        : prev,
    );

  const blocked = !period
    ? 'اختر الشهر والسنة.'
    : summary.incomplete.length
      ? `أكمل الخانات الناقصة أو أفرغ الصف كله: ${summary.incomplete.join('، ')}.`
      : !summary.complete.length
        ? 'لا يوجد مكتب مكتمل البيانات.'
        : null;

  const doExport = () => {
    if (!period || blocked) return;
    exportReport(reviewToSnapshots(summary, period), period, null, organization, notify, OFFICES);
  };

  const save = async (overwrite: boolean) => {
    if (!period || blocked) return;
    setSaving(true);
    try {
      const edited = new Set(summary.rows.filter((row) => row.edited).map((row) => row.office));
      const inputs = reviewToInputs(summary, period, '').map((input) => ({
        ...input,
        notes: `مستورد من PDF: ${state.fileName}${edited.has(input.branch as OfficeName) ? ' (مع تعديل يدوي)' : ''}`.slice(0, 300),
      }));
      const saved = await saveSnapshotsBatch(inputs, { overwrite });
      await reload();
      setConfirming(false);
      setState(null);
      setError(null);
      notify(`تم حفظ بيانات ${saved.length} مكتبًا لشهر ${periodLabel(period)}.`, 'success');
    } catch (cause) {
      if (cause instanceof ExistingSnapshotsError) {
        // سجلات حُفظت بعد فتح الصفحة (تبويب آخر): حدّث القائمة واطلب التأكيد
        await reload();
        setConfirming(true);
      }
      notify(errorMessage(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const needsConfirm = existing.length > 0 || summary.empty.length > 0 || summary.mismatched.length > 0;
  const reviewNotes = summary.rows.filter((row) => row.notes.length && !(row.status === 'empty'));
  const failedChecks = extraction.checks.filter((check) => !check.ok);

  return (
    <>
      <Panel
        title={`مراجعة بيانات PDF — ${state.fileName}`}
        id="dq-pdf"
        actions={
          <>
            {fileInput}
            <Button size="sm" icon="upload" disabled={reading || saving} onClick={() => fileRef.current?.click()}>
              ملف آخر
            </Button>
            <Button size="sm" icon="close" disabled={saving} onClick={() => setState(null)}>
              إلغاء
            </Button>
          </>
        }
      >
        {error ? (
          <Callout tone="danger">
            <span role="alert">{error}</span>
          </Callout>
        ) : null}

        <div className="dq-entry__period dq-pdf__period">
          <Field label="الشهر" htmlFor="dq-pdf-month" required error={!period && !state.month ? 'اختر الشهر.' : undefined}>
            <Select id="dq-pdf-month" value={state.month} onChange={(event) => setState((prev) => (prev ? { ...prev, month: event.target.value } : prev))}>
              <option value="">—</option>
              {MONTH_NAMES_AR.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="السنة" htmlFor="dq-pdf-year" required error={!period && state.month ? 'أدخل سنة صحيحة (2000–2100).' : undefined}>
            <Input id="dq-pdf-year" inputMode="numeric" value={state.year} onChange={(event) => setState((prev) => (prev ? { ...prev, year: event.target.value } : prev))} />
          </Field>
          <div className="dq-pdf__source" data-testid="dq-pdf-source">
            <span>
              القسم: <strong>{extraction.sectionTitle}</strong>
            </span>
            <span>
              الصفحات: <span dir="ltr">{extraction.pages.join(', ')}</span>
            </span>
            <span>{extraction.asOf ? <>حتى تاريخ: <span dir="ltr">{extraction.asOf.text}</span></> : 'تاريخ التقرير غير مقروء — اختر الشهر يدويًا'}</span>
          </div>
        </div>

        <ul className="dq-pdf__checks" data-testid="dq-pdf-checks">
          {extraction.checks.map((check) => (
            <li key={check.id} className={check.ok ? 'is-ok' : 'is-warn'}>
              <Icon name={check.ok ? 'check' : 'alert'} size={14} />
              <span>
                {check.label}
                {check.detail ? <small> — {check.detail}</small> : null}
              </span>
            </li>
          ))}
        </ul>

        {extraction.warnings.length || state.emptyPages.length ? (
          <Callout tone="warning">
            <ul>
              {state.emptyPages.length ? <li>صفحات بلا نص مقروء (صور): {state.emptyPages.join('، ')} — أي أرقام فيها لم تُقرأ.</li> : null}
              {extraction.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        <div className="dq-tablewrap">
          <table className="dq-table dq-pdf-table" data-testid="dq-pdf-table">
            <thead>
              <tr>
                <th rowSpan={2} className="dq-table__bucket">
                  المكتب
                </th>
                <th colSpan={BUCKET_IDS.length} className="dq-table__group">
                  عدد العملاء
                </th>
                <th colSpan={BUCKET_IDS.length} className="dq-table__group">
                  المبلغ
                </th>
                <th rowSpan={2}>إجمالي العملاء</th>
                <th rowSpan={2}>إجمالي المبلغ</th>
                <th rowSpan={2}>الحالة</th>
              </tr>
              <tr>
                {(['clients', 'amount'] as const).map((field) =>
                  BUCKETS.map((bucket) => (
                    <th key={`${field}-${bucket.id}`} dir="ltr">
                      {bucket.short}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row, rowIndex) => {
                const badge = rowBadge(row);
                const source = extraction.offices[rowIndex];
                return (
                  <tr key={row.office} data-office={row.office} data-status={row.status}>
                    <th scope="row" className="dq-table__bucket">
                      {row.office}
                    </th>
                    {(['clients', 'amount'] as const).map((field) =>
                      BUCKETS.map((bucket) => {
                        const cell = row.cells[bucket.id][field];
                        const original = source.buckets[bucket.id][field];
                        const flagged = cell.state !== 'ok' && row.status !== 'empty';
                        const editedCell = cell.state === 'ok' && !cell.fromPdf;
                        const hint =
                          cell.state === 'invalid'
                            ? cell.message
                            : cell.state === 'empty'
                              ? original.issue === 'conflict'
                                ? `قيم متعارضة في الملف: ${original.raw}`
                                : original.issue === 'unreadable'
                                  ? `قيمة غير مقروءة في الملف: ${original.raw}`
                                  : 'غير موجود في الملف'
                              : editedCell
                                ? original.value !== null
                                  ? `أُدخل يدويًا — المقروء من الملف: ${original.raw}`
                                  : 'أُدخل يدويًا'
                                : undefined;
                        return (
                          <td key={`${field}-${bucket.id}`}>
                            <input
                              className={`dq-input dq-pdf-input dq-pdf-input--${field}${flagged ? ' dq-input--error' : ''}${editedCell ? ' dq-pdf-input--edited' : ''}`}
                              dir="ltr"
                              inputMode={field === 'clients' ? 'numeric' : 'decimal'}
                              autoComplete="off"
                              aria-label={`${row.office} — ${field === 'clients' ? 'عدد العملاء' : 'المبلغ'} — ${bucket.label}`}
                              aria-invalid={flagged}
                              title={hint}
                              value={state.table[row.office][bucket.id][field]}
                              onChange={(event) => setCell(row.office, bucket.id, field, event.target.value)}
                            />
                          </td>
                        );
                      }),
                    )}
                    <td>
                      <span className="dq-num" dir="ltr">
                        {fmtInt(row.totalClients)}
                      </span>
                    </td>
                    <td>
                      <span className="dq-num" dir="ltr">
                        {fmtMoney(row.totalAmount)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="dq-table__bucket">
                  الإجمالي
                </th>
                {summary.totals.clients.map((value, index) => (
                  <td key={`c${index}`}>
                    <span className="dq-num" dir="ltr">
                      {fmtInt(value)}
                    </span>
                  </td>
                ))}
                {summary.totals.amounts.map((value, index) => (
                  <td key={`a${index}`}>
                    <span className="dq-num" dir="ltr">
                      {fmtMoney(value)}
                    </span>
                  </td>
                ))}
                <td data-testid="dq-pdf-total-clients">
                  <span className="dq-num" dir="ltr">
                    {fmtInt(summary.totals.totalClients)}
                  </span>
                </td>
                <td data-testid="dq-pdf-total-amount">
                  <span className="dq-num" dir="ltr">
                    {fmtMoney(summary.totals.totalAmount)}
                  </span>
                </td>
                <td>
                  <span className="dq-num">
                    {summary.complete.length} / {OFFICES.length}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {reviewNotes.length || summary.empty.length ? (
          <Callout tone="warning">
            <strong>يحتاج مراجعة:</strong>
            <ul data-testid="dq-pdf-notes">
              {reviewNotes.map((row) => (
                <li key={row.office}>
                  {row.office}: {row.notes.join(' ')}
                </li>
              ))}
              {summary.empty.length ? <li>بلا بيانات (لن تُحفظ إلا إذا أُدخلت يدويًا): {summary.empty.join('، ')}.</li> : null}
            </ul>
          </Callout>
        ) : null}

        {blocked ? (
          <p className="dq-conflict" role="alert">
            {blocked}
          </p>
        ) : existing.length && period ? (
          <p className="dq-conflict" role="alert">
            توجد بيانات محفوظة لشهر {periodLabel(period)} لعدد {existing.length} من هذه المكاتب — الحفظ سيطلب تأكيد استبدالها.
          </p>
        ) : null}

        <div className="dq-entry__actions">
          <Button variant="primary" icon="save" disabled={Boolean(blocked) || saving} onClick={() => (needsConfirm ? setConfirming(true) : void save(false))}>
            تأكيد وحفظ
          </Button>
          <Button icon="download" disabled={Boolean(blocked)} onClick={doExport}>
            تصدير Excel
          </Button>
        </div>
      </Panel>

      <Modal
        open={confirming}
        onClose={() => (saving ? undefined : setConfirming(false))}
        title="تأكيد حفظ بيانات PDF"
        size="md"
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button variant={existing.length ? 'danger' : 'primary'} icon="save" disabled={saving} onClick={() => void save(existing.length > 0)}>
              {existing.length ? 'استبدال وحفظ' : 'حفظ'}
            </Button>
          </>
        }
      >
        {period ? (
          <div className="dq-pdf__confirm">
            <p>
              حفظ بيانات {summary.complete.length} مكتبًا لشهر {periodLabel(period)}.
            </p>
            {existing.length ? (
              <Callout tone="danger">
                <strong>سيتم استبدال البيانات المحفوظة لهذا الشهر للمكاتب:</strong> {existing.join('، ')}.
              </Callout>
            ) : null}
            {summary.empty.length ? (
              <Callout tone="warning">
                <strong>لن تُحفظ (بلا بيانات):</strong> {summary.empty.join('، ')}.
              </Callout>
            ) : null}
            {summary.mismatched.length ? (
              <Callout tone="warning">
                <strong>إجماليها لا يطابق التقرير:</strong> {summary.mismatched.join('، ')}.
              </Callout>
            ) : null}
            {failedChecks.some((check) => check.id === 'duplicates') ? <Callout tone="warning">في الملف مكاتب مكررة — تأكد من مراجعتها.</Callout> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
