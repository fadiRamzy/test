import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate, type Section } from '../router';
import { Badge, Button, Callout, EmptyState, Field, Icon, IconButton, Input, Modal, Select, Textarea, type IconName } from '../ui/kit';
import { useNotify, type Notify } from '../ui/toast';
import { ComparisonDashboard, Delta, Panel } from '../components/Dashboard';
import {
  deleteSavedComparison,
  deleteSnapshot,
  listClientLists,
  listSavedComparisons,
  listSnapshots,
  requestPersistentStorage,
  saveComparison,
  saveSnapshot,
  type ClientListRecord,
  type SavedComparison,
} from '../db/delinquencyDb';
import {
  BUCKETS,
  BUCKET_IDS,
  MONTH_NAMES_AR,
  branchLabel,
  compareBranches,
  compareSnapshots,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSignedMoney,
  moneySum,
  normalizeBranch,
  parseNumberInput,
  periodLabel,
  sharePct,
  snapshotId,
  snapshotPeriod,
  snapshotTotals,
  validateSnapshotInput,
  type BucketId,
  type MonthlySnapshot,
} from '../lib/delinquency';
import { exportReport, resolveSelection, type Selection } from '../lib/selection';
import { fmtDateTime } from '../lib/utils';
import { errorMessage } from '../lib/errors';
import { DataTab } from './DataTab';
import '../styles/delinquency.css';

/* --------------------------------- البيانات ------------------------------- */

export interface DelinquencyData {
  snapshots: MonthlySnapshot[];
  lists: Map<string, ClientListRecord>;
  saved: SavedComparison[];
}

const EMPTY_DATA: DelinquencyData = { snapshots: [], lists: new Map(), saved: [] };

function useDelinquencyData() {
  const [data, setData] = useState<DelinquencyData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [snapshots, lists, saved] = await Promise.all([listSnapshots(), listClientLists(), listSavedComparisons()]);
      setData({ snapshots, lists: new Map(lists.map((list) => [list.id, list])), saved });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر فتح بيانات المتأخرات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

/* ------------------------------ مسودة الإدخال ----------------------------- */

interface EntryDraft {
  editingId: string | null;
  branch: string;
  year: string;
  month: string;
  values: Record<BucketId, { clients: string; amount: string }>;
  notes: string;
}

function emptyValues(): EntryDraft['values'] {
  const values = {} as EntryDraft['values'];
  for (const id of BUCKET_IDS) values[id] = { clients: '', amount: '' };
  return values;
}

function newDraft(branch = '', year?: number, month?: number): EntryDraft {
  const now = new Date();
  return {
    editingId: null,
    branch,
    year: String(year ?? now.getFullYear()),
    month: String(month ?? now.getMonth() + 1),
    values: emptyValues(),
    notes: '',
  };
}

function draftFromSnapshot(snapshot: MonthlySnapshot): EntryDraft {
  const values = emptyValues();
  for (const id of BUCKET_IDS) {
    values[id] = { clients: String(snapshot.buckets[id].clients), amount: String(snapshot.buckets[id].amount) };
  }
  return {
    editingId: snapshot.id,
    branch: snapshot.branch,
    year: String(snapshot.year),
    month: String(snapshot.month),
    values,
    notes: snapshot.notes,
  };
}

const isDraftPristine = (draft: EntryDraft): boolean =>
  !draft.editingId &&
  !draft.notes.trim() &&
  BUCKET_IDS.every((id) => !draft.values[id].clients.trim() && !draft.values[id].amount.trim());

/* ---------------------------------- الصفحة -------------------------------- */

const TABS: Array<{ id: Section; path: string; label: string; icon: IconName }> = [
  { id: 'dashboard', path: '/', label: 'لوحة المقارنة', icon: 'chart' },
  { id: 'entry', path: '/entry', label: 'إدخال البيانات الشهرية', icon: 'edit' },
  { id: 'saved', path: '/saved', label: 'المقارنات المحفوظة', icon: 'history' },
  { id: 'data', path: '/data', label: 'النسخ الاحتياطي', icon: 'database' },
];

/** مساحة العمل الكاملة للنظام: التبويبات الأربعة ومحتواها. */
export function DelinquencyPage({
  section,
  itemId,
  organization,
  onOrganizationChange,
}: {
  section: Section;
  itemId?: string;
  organization: string;
  onOrganizationChange: (name: string) => void;
}) {
  const notify = useNotify();
  const { data, loading, error, reload } = useDelinquencyData();
  const active = section;

  const [selection, setSelection] = useState<Selection>({ branch: null, aId: null, bId: null });
  const [draft, setDraft] = useState<EntryDraft>(() => newDraft());

  const editSnapshot = useCallback((snapshot: MonthlySnapshot) => {
    setDraft(draftFromSnapshot(snapshot));
    navigate('/entry');
  }, []);

  return (
    <div className="dq">
      <nav className="dq-tabs dq-print-hide" aria-label="أقسام النظام">
        {TABS.map((tab) => (
          <a key={tab.id} href={`#${tab.path}`} className={`dq-tab${active === tab.id ? ' is-active' : ''}`} aria-current={active === tab.id ? 'page' : undefined}>
            <Icon name={tab.icon} size={15} />
            <span>{tab.label}</span>
          </a>
        ))}
      </nav>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {loading ? (
        <div className="dq-loading">جارٍ التحميل…</div>
      ) : active === 'entry' ? (
        <EntryTab data={data} draft={draft} setDraft={setDraft} reload={reload} notify={notify} onEdit={editSnapshot} />
      ) : active === 'saved' ? (
        itemId ? (
          <SavedView
            data={data}
            id={itemId}
            organization={organization}
            reload={reload}
            notify={notify}
            onOpenLive={(saved) => {
              setSelection({ branch: saved.branch, aId: saved.a.id, bId: saved.b.id });
              navigate('/');
            }}
          />
        ) : (
          <SavedList data={data} reload={reload} notify={notify} />
        )
      ) : active === 'data' ? (
        <DataTab
          data={data}
          selection={selection}
          reload={reload}
          notify={notify}
          organization={organization}
          onOrganizationChange={onOrganizationChange}
        />
      ) : (
        <LiveTab data={data} selection={selection} setSelection={setSelection} organization={organization} reload={reload} notify={notify} />
      )}
    </div>
  );
}

/* ------------------------------ تبويب المقارنة ---------------------------- */

function LiveTab({
  data,
  selection,
  setSelection,
  organization,
  reload,
  notify,
}: {
  data: DelinquencyData;
  selection: Selection;
  setSelection: (next: Selection) => void;
  organization: string;
  reload: () => Promise<void>;
  notify: Notify;
}) {
  const { snapshots } = data;
  const [saveOpen, setSaveOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { branches, branch, months, a, b, ready } = useMemo(() => resolveSelection(snapshots, selection), [snapshots, selection]);
  const comparison = useMemo(() => (a && b && a.id !== b.id ? compareSnapshots(a, b) : null), [a, b]);
  const branchRows = useMemo(
    () => (a && b && branches.length > 1 ? compareBranches(snapshots, snapshotPeriod(a), snapshotPeriod(b)) : []),
    [a, b, branches.length, snapshots],
  );

  if (!snapshots.length) {
    return (
      <Panel title="لوحة المقارنة">
        <EmptyState
          icon="chart"
          title="لا توجد بيانات شهرية بعد"
          action={
            <Button variant="primary" icon="plus" onClick={() => navigate('/entry')}>
              إدخال بيانات شهر
            </Button>
          }
        />
      </Panel>
    );
  }

  const pick = (patch: Partial<Selection>) => setSelection({ branch, aId: a?.id ?? null, bId: b?.id ?? null, ...patch });

  const openSave = () => {
    if (!a || !b) return;
    setTitle(`مقارنة ${periodLabel(a)} مع ${periodLabel(b)} — ${branchLabel(branch)}`);
    setNote('');
    setSaveOpen(true);
  };

  const doSave = async () => {
    if (!a || !b) return;
    setSaving(true);
    try {
      await saveComparison({ title, note, a, b });
      await reload();
      setSaveOpen(false);
      notify('تم حفظ المقارنة.', 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="dq-selector dq-print-hide" aria-label="اختيار الشهرين">
        {branches.length > 1 ? (
          <Field label="الفرع" htmlFor="dq-select-branch">
            <Select id="dq-select-branch" value={branch} onChange={(event) => setSelection({ branch: event.target.value, aId: null, bId: null })}>
              {branches.map((name) => (
                <option key={name} value={name}>
                  {branchLabel(name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="الشهر السابق" htmlFor="dq-select-a">
          <Select id="dq-select-a" value={a?.id ?? ''} onChange={(event) => pick({ aId: event.target.value })}>
            {months.map((month) => (
              <option key={month.id} value={month.id}>
                {periodLabel(month)}
              </option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          className="dq-swap"
          title="تبديل الشهرين"
          aria-label="تبديل الشهرين"
          disabled={!a || !b}
          onClick={() => pick({ aId: b?.id ?? null, bId: a?.id ?? null })}
        >
          ⇄
        </button>
        <Field label="الشهر الحالي" htmlFor="dq-select-b">
          <Select id="dq-select-b" value={b?.id ?? ''} onChange={(event) => pick({ bId: event.target.value })}>
            {months.map((month) => (
              <option key={month.id} value={month.id}>
                {periodLabel(month)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="dq-selector__actions">
          <Button icon="save" disabled={!ready} onClick={openSave}>
            حفظ المقارنة
          </Button>
          <Button variant="primary" icon="download" disabled={!ready} onClick={() => a && b && exportReport(snapshots, b, a, organization, notify)}>
            تصدير Excel
          </Button>
        </div>
      </section>

      {months.length < 2 ? (
        <Panel title="لوحة المقارنة">
          <EmptyState
            icon="calendar"
            title="أدخل شهرًا آخر لنفس الفرع لتظهر المقارنة"
            action={
              <Button variant="primary" icon="plus" onClick={() => navigate('/entry')}>
                إدخال بيانات شهر
              </Button>
            }
          />
        </Panel>
      ) : !comparison ? (
        <Panel title="لوحة المقارنة">
          <EmptyState icon="calendar" title="اختر شهرين مختلفين" />
        </Panel>
      ) : (
        <>
          {!comparison.chronological ? (
            <div className="dq-context">
              <Badge tone="warning">الشهر السابق المختار أحدث من الشهر الحالي</Badge>
            </div>
          ) : null}
          <ComparisonDashboard comparison={comparison} branches={branchRows} />
        </>
      )}

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="حفظ المقارنة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)}>إلغاء</Button>
            <Button variant="primary" icon="save" disabled={saving || !title.trim()} onClick={doSave}>
              حفظ
            </Button>
          </>
        }
      >
        <Field label="عنوان المقارنة" htmlFor="dq-save-title" required>
          <Input id="dq-save-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
        </Field>
        <Field label="ملاحظة (اختياري)" htmlFor="dq-save-note">
          <Textarea id="dq-save-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={600} />
        </Field>
      </Modal>
    </>
  );
}

/* ------------------------------- تبويب الإدخال ---------------------------- */

function EntryTab({
  data,
  draft,
  setDraft,
  reload,
  notify,
  onEdit,
}: {
  data: DelinquencyData;
  draft: EntryDraft;
  setDraft: (next: EntryDraft | ((prev: EntryDraft) => EntryDraft)) => void;
  reload: () => Promise<void>;
  notify: Notify;
  onEdit: (snapshot: MonthlySnapshot) => void;
}) {
  const { snapshots } = data;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MonthlySnapshot | null>(null);

  const branchOptions = useMemo(
    () =>
      Array.from(new Set(snapshots.map((snapshot) => normalizeBranch(snapshot.branch)).filter(Boolean))).sort((x, y) =>
        x.localeCompare(y, 'ar'),
      ),
    [snapshots],
  );

  const validation = useMemo(
    () => validateSnapshotInput({ branch: draft.branch, year: draft.year, month: draft.month, buckets: draft.values, notes: draft.notes }),
    [draft],
  );
  const liveTotals = useMemo(() => {
    let clients = 0;
    const amounts: number[] = [];
    for (const id of BUCKET_IDS) {
      const c = parseNumberInput(draft.values[id].clients);
      const m = parseNumberInput(draft.values[id].amount);
      if (c !== null && Number.isFinite(c) && c > 0) clients += Math.round(c);
      if (m !== null && Number.isFinite(m) && m > 0) amounts.push(m);
    }
    return { clients, amount: moneySum(amounts) };
  }, [draft.values]);

  const targetId =
    validation.errors.year || validation.errors.month ? null : snapshotId(draft.branch, validation.value.year, validation.value.month);
  const conflict = targetId && targetId !== draft.editingId ? snapshots.find((snapshot) => snapshot.id === targetId) ?? null : null;

  const setValue = (bucket: BucketId, key: 'clients' | 'amount', value: string) => {
    setDraft((prev) => ({ ...prev, values: { ...prev.values, [bucket]: { ...prev.values[bucket], [key]: value } } }));
    setErrors((prev) => {
      if (!prev[`${bucket}.${key}`]) return prev;
      const next = { ...prev };
      delete next[`${bucket}.${key}`];
      return next;
    });
  };

  const reset = () => {
    setDraft(newDraft(draft.branch, Number(draft.year) || undefined, Number(draft.month) || undefined));
    setErrors({});
  };

  const submit = async () => {
    if (!validation.ok) {
      setErrors(validation.errors);
      notify(Object.values(validation.errors)[0], 'error');
      return;
    }
    setSaving(true);
    try {
      // قائمة العملاء المحفوظة سابقًا لهذا الشهر (إن وُجدت) لا تُمس: تبقى مع السجل أو تنتقل معه.
      const record = await saveSnapshot(
        { branch: draft.branch, year: draft.year, month: draft.month, buckets: draft.values, notes: draft.notes },
        { editingId: draft.editingId ?? undefined, overwrite: Boolean(draft.editingId) },
      );
      void requestPersistentStorage();
      await reload();
      notify(`تم حفظ بيانات ${periodLabel(record)} — ${branchLabel(record.branch)}.`, 'success');
      const nextMonth = record.month === 12 ? 1 : record.month + 1;
      const nextYear = record.month === 12 ? record.year + 1 : record.year;
      setDraft(newDraft(record.branch, nextYear, nextMonth));
      setErrors({});
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'errors' in cause) setErrors((cause as { errors: Record<string, string> }).errors);
      notify(errorMessage(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSnapshot(deleting.id);
      await reload();
      if (draft.editingId === deleting.id) reset();
      notify(`تم حذف بيانات ${periodLabel(deleting)}.`, 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setDeleting(null);
    }
  };

  const editing = draft.editingId ? snapshots.find((snapshot) => snapshot.id === draft.editingId) ?? null : null;
  const rows = useMemo(() => [...snapshots].reverse(), [snapshots]);

  return (
    <>
      <Panel
        title={editing ? `تعديل بيانات ${periodLabel(editing)} — ${branchLabel(editing.branch)}` : 'إدخال بيانات شهر'}
        id="dq-entry"
        actions={
          editing || !isDraftPristine(draft) ? (
            <Button size="sm" icon="plus" onClick={reset}>
              شهر جديد
            </Button>
          ) : null
        }
      >
        <div className="dq-entry__period">
          <Field label="الشهر" htmlFor="dq-month" required error={errors.month}>
            <Select id="dq-month" value={draft.month} onChange={(event) => setDraft((prev) => ({ ...prev, month: event.target.value }))}>
              {MONTH_NAMES_AR.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="السنة" htmlFor="dq-year" required error={errors.year}>
            <Input id="dq-year" inputMode="numeric" value={draft.year} onChange={(event) => setDraft((prev) => ({ ...prev, year: event.target.value }))} />
          </Field>
          <Field label="الفرع" htmlFor="dq-branch">
            <Input
              id="dq-branch"
              list="dq-branch-options"
              placeholder="الفرع الرئيسي"
              value={draft.branch}
              onChange={(event) => setDraft((prev) => ({ ...prev, branch: event.target.value }))}
              maxLength={80}
            />
            <datalist id="dq-branch-options">
              {branchOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
        </div>

        {conflict ? (
          <p className="dq-conflict" role="alert">
            توجد بيانات محفوظة لشهر {periodLabel(conflict)} — {branchLabel(conflict.branch)}.{' '}
            <button type="button" className="dq-link" onClick={() => onEdit(conflict)}>
              تعديل البيانات المحفوظة
            </button>
          </p>
        ) : null}

        <div className="dq-tablewrap">
          <table className="dq-table dq-entry-table">
            <thead>
              <tr>
                <th className="dq-table__bucket">الشريحة</th>
                <th>عدد العملاء</th>
                <th>مبلغ المتأخرات</th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((bucket) => (
                <tr key={bucket.id}>
                  <th scope="row" className="dq-table__bucket">
                    <label htmlFor={`dq-clients-${bucket.id}`}>{bucket.label}</label>
                  </th>
                  <td>
                    <input
                      id={`dq-clients-${bucket.id}`}
                      className={`dq-input${errors[`${bucket.id}.clients`] ? ' dq-input--error' : ''}`}
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      aria-label={`عدد العملاء — ${bucket.label}`}
                      aria-invalid={Boolean(errors[`${bucket.id}.clients`])}
                      value={draft.values[bucket.id].clients}
                      onChange={(event) => setValue(bucket.id, 'clients', event.target.value)}
                    />
                    {errors[`${bucket.id}.clients`] ? <span className="dq-err">{errors[`${bucket.id}.clients`]}</span> : null}
                  </td>
                  <td>
                    <input
                      id={`dq-amount-${bucket.id}`}
                      className={`dq-input${errors[`${bucket.id}.amount`] ? ' dq-input--error' : ''}`}
                      dir="ltr"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      aria-label={`مبلغ المتأخرات — ${bucket.label}`}
                      aria-invalid={Boolean(errors[`${bucket.id}.amount`])}
                      value={draft.values[bucket.id].amount}
                      onChange={(event) => setValue(bucket.id, 'amount', event.target.value)}
                    />
                    {errors[`${bucket.id}.amount`] ? <span className="dq-err">{errors[`${bucket.id}.amount`]}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="dq-table__bucket">الإجمالي</th>
                <td data-testid="dq-entry-total-clients">
                  <span className="dq-num" dir="ltr">{fmtInt(liveTotals.clients)}</span>
                </td>
                <td data-testid="dq-entry-total-amount">
                  <span className="dq-num" dir="ltr">{fmtMoney(liveTotals.amount)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <Field label="ملاحظات (اختياري)" htmlFor="dq-notes">
          <Input id="dq-notes" value={draft.notes} maxLength={300} onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))} />
        </Field>

        <div className="dq-entry__actions">
          <Button variant="primary" icon="save" onClick={submit} disabled={saving}>
            {editing ? 'حفظ التعديلات' : 'حفظ بيانات الشهر'}
          </Button>
          {editing ? <Button onClick={reset}>إلغاء التعديل</Button> : null}
        </div>
      </Panel>

      <Panel title="الشهور المحفوظة" id="dq-months">
        {rows.length ? (
          <div className="dq-tablewrap">
            <table className="dq-table" data-testid="dq-months-table">
              <thead>
                <tr>
                  <th className="dq-table__bucket">الشهر</th>
                  <th>الفرع</th>
                  <th>عدد العملاء</th>
                  <th>مبلغ المتأخرات</th>
                  <th>حصة NPL</th>
                  <th className="dq-print-hide">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((snapshot) => {
                  const totals = snapshotTotals(snapshot.buckets);
                  return (
                    <tr key={snapshot.id} className={snapshot.id === draft.editingId ? 'dq-row--current' : undefined}>
                      <th scope="row" className="dq-table__bucket">{periodLabel(snapshot)}</th>
                      <td>{branchLabel(snapshot.branch)}</td>
                      <td><span className="dq-num" dir="ltr">{fmtInt(totals.clients)}</span></td>
                      <td><span className="dq-num" dir="ltr">{fmtMoney(totals.amount)}</span></td>
                      <td><span className="dq-num" dir="ltr">{fmtPct(sharePct(snapshot.buckets.npl.amount, totals.amount))}</span></td>
                      <td className="dq-print-hide">
                        <span className="dq-rowactions">
                          <IconButton icon="edit" label={`تعديل ${periodLabel(snapshot)} — ${branchLabel(snapshot.branch)}`} onClick={() => onEdit(snapshot)} />
                          <IconButton icon="trash" tone="danger" label={`حذف ${periodLabel(snapshot)} — ${branchLabel(snapshot.branch)}`} onClick={() => setDeleting(snapshot)} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="database" title="لا توجد شهور محفوظة" />
        )}
      </Panel>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="حذف بيانات الشهر"
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>إلغاء</Button>
            <Button variant="danger" icon="trash" onClick={confirmDelete}>
              حذف
            </Button>
          </>
        }
      >
        {deleting ? (
          <p>
            حذف بيانات {periodLabel(deleting)} — {branchLabel(deleting.branch)}؟
          </p>
        ) : null}
      </Modal>
    </>
  );
}

/* --------------------------- المقارنات المحفوظة --------------------------- */

function SavedList({ data, reload, notify }: { data: DelinquencyData; reload: () => Promise<void>; notify: Notify }) {
  const [deleting, setDeleting] = useState<SavedComparison | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSavedComparison(deleting.id);
      await reload();
      notify('تم حذف المقارنة المحفوظة.', 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <Panel title="المقارنات المحفوظة" id="dq-saved">
        {data.saved.length ? (
          <div className="dq-tablewrap">
            <table className="dq-table" data-testid="dq-saved-table">
              <thead>
                <tr>
                  <th className="dq-table__bucket">العنوان</th>
                  <th>الفرع</th>
                  <th>الشهران</th>
                  <th>فرق المبلغ</th>
                  <th>تاريخ الحفظ</th>
                  <th className="dq-print-hide">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {data.saved.map((saved) => {
                  const comparison = compareSnapshots(saved.a, saved.b);
                  return (
                    <tr key={saved.id}>
                      <th scope="row" className="dq-table__bucket">
                        <a href={`#/saved/${saved.id}`} className="dq-link">
                          {saved.title}
                        </a>
                        {saved.note ? <small className="dq-subtext">{saved.note}</small> : null}
                      </th>
                      <td>{branchLabel(saved.branch)}</td>
                      <td>
                        {periodLabel(saved.a)} ← {periodLabel(saved.b)}
                      </td>
                      <td><Delta value={comparison.totals.amountDelta} format={fmtSignedMoney} strong /></td>
                      <td>{fmtDateTime(saved.createdAt)}</td>
                      <td className="dq-print-hide">
                        <span className="dq-rowactions">
                          <Button size="sm" icon="chart" onClick={() => navigate(`/saved/${saved.id}`)}>
                            فتح
                          </Button>
                          <IconButton icon="trash" tone="danger" label={`حذف ${saved.title}`} onClick={() => setDeleting(saved)} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="history" title="لا توجد مقارنات محفوظة" />
        )}
      </Panel>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="حذف المقارنة المحفوظة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>إلغاء</Button>
            <Button variant="danger" icon="trash" onClick={confirmDelete}>
              حذف
            </Button>
          </>
        }
      >
        {deleting ? <p>حذف «{deleting.title}»؟</p> : null}
      </Modal>
    </>
  );
}

function SavedView({
  data,
  id,
  organization,
  reload,
  notify,
  onOpenLive,
}: {
  data: DelinquencyData;
  id: string;
  organization: string;
  reload: () => Promise<void>;
  notify: Notify;
  onOpenLive: (saved: SavedComparison) => void;
}) {
  const saved = data.saved.find((item) => item.id === id) ?? null;
  const [confirming, setConfirming] = useState(false);

  const comparison = useMemo(() => (saved ? compareSnapshots(saved.a, saved.b) : null), [saved]);

  if (!saved || !comparison) {
    return (
      <Panel title="المقارنات المحفوظة">
        <EmptyState
          icon="history"
          title="لم يتم العثور على هذه المقارنة"
          action={
            <Button icon="arrow-left" onClick={() => navigate('/saved')}>
              المقارنات المحفوظة
            </Button>
          }
        />
      </Panel>
    );
  }

  const liveAvailable = data.snapshots.some((snapshot) => snapshot.id === saved.a.id) && data.snapshots.some((snapshot) => snapshot.id === saved.b.id);

  const doDelete = async () => {
    try {
      await deleteSavedComparison(saved.id);
      await reload();
      notify('تم حذف المقارنة المحفوظة.', 'success');
      navigate('/saved');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <section className="dq-savedbar" aria-label="المقارنة المحفوظة">
        <div>
          <h2>{saved.title}</h2>
          <p>
            {branchLabel(saved.branch)} · {periodLabel(saved.a)} ← {periodLabel(saved.b)}
            {saved.note ? ` — ${saved.note}` : ''}
          </p>
        </div>
        <div className="dq-savedbar__actions dq-print-hide">
          <Button icon="arrow-left" onClick={() => navigate('/saved')}>
            رجوع
          </Button>
          {liveAvailable ? (
            <Button icon="chart" onClick={() => onOpenLive(saved)}>
              عرض البيانات الحالية
            </Button>
          ) : null}
          <Button variant="primary" icon="download" onClick={() => exportReport([saved.a, saved.b], saved.b, saved.a, organization, notify)}>
            تصدير Excel
          </Button>
          <IconButton icon="trash" tone="danger" label="حذف المقارنة" onClick={() => setConfirming(true)} />
        </div>
      </section>

      <ComparisonDashboard comparison={comparison} />

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="حذف المقارنة المحفوظة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>إلغاء</Button>
            <Button variant="danger" icon="trash" onClick={doDelete}>
              حذف
            </Button>
          </>
        }
      >
        <p>حذف «{saved.title}»؟</p>
      </Modal>
    </>
  );
}
