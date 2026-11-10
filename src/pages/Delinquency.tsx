import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { navigate } from '../state/router';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { ComparisonDashboard, Delta, Panel } from '../components/delinquency/Dashboard';
import {
  deleteSavedComparison,
  deleteSnapshot,
  listClientLists,
  listSavedComparisons,
  listSnapshots,
  saveClientList,
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
import {
  aggregateClientList,
  computeMigration,
  parseClientList,
  reconcileWithList,
  serializeClientList,
  type ClientRecord,
} from '../lib/delinquencyMigration';
import { buildExecutiveSummary } from '../lib/delinquencySummary';
import { buildDelinquencyXlsx, delinquencyFileName } from '../lib/delinquencyExcel';
import { XLSX_MIME } from '../lib/xlsx';
import { downloadBlob, readTextFile } from '../lib/utils';
import { fmtDateTime } from '../lib/format';
import '../styles/delinquency.css';

/* --------------------------------- البيانات ------------------------------- */

interface DelinquencyData {
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

const errorMessage = (cause: unknown): string => {
  if (cause && typeof cause === 'object' && 'errors' in cause) {
    const first = Object.values((cause as { errors: Record<string, string> }).errors)[0];
    if (first) return first;
  }
  return cause instanceof Error ? cause.message : 'حدث خطأ غير متوقع.';
};

/* ------------------------------ مسودة الإدخال ----------------------------- */

interface EntryDraft {
  editingId: string | null;
  branch: string;
  year: string;
  month: string;
  values: Record<BucketId, { clients: string; amount: string }>;
  notes: string;
  clientsText: string;
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
    clientsText: '',
  };
}

function draftFromSnapshot(snapshot: MonthlySnapshot, clients: ClientRecord[] | undefined): EntryDraft {
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
    clientsText: clients?.length ? serializeClientList(clients) : '',
  };
}

const isDraftPristine = (draft: EntryDraft): boolean =>
  !draft.editingId &&
  !draft.notes.trim() &&
  !draft.clientsText.trim() &&
  BUCKET_IDS.every((id) => !draft.values[id].clients.trim() && !draft.values[id].amount.trim());

/* ---------------------------------- الصفحة -------------------------------- */

type Section = 'dashboard' | 'entry' | 'saved';

const TABS: Array<{ id: Section; path: string; label: string; icon: 'chart' | 'edit' | 'history' }> = [
  { id: 'dashboard', path: '/delinquency', label: 'لوحة المقارنة', icon: 'chart' },
  { id: 'entry', path: '/delinquency/entry', label: 'إدخال البيانات الشهرية', icon: 'edit' },
  { id: 'saved', path: '/delinquency/saved', label: 'المقارنات المحفوظة', icon: 'history' },
];

export function DelinquencyPage({ section, itemId }: { section?: string; itemId?: string }) {
  const { settings, notify } = useApp();
  const { data, loading, error, reload } = useDelinquencyData();
  const active: Section = section === 'entry' ? 'entry' : section === 'saved' ? 'saved' : 'dashboard';

  const [selection, setSelection] = useState<{ branch: string | null; aId: string | null; bId: string | null }>({
    branch: null,
    aId: null,
    bId: null,
  });
  const [draft, setDraft] = useState<EntryDraft>(() => newDraft());
  const [clientsOpen, setClientsOpen] = useState(false);

  const editSnapshot = useCallback(
    (snapshot: MonthlySnapshot, openClients = false) => {
      setDraft(draftFromSnapshot(snapshot, data.lists.get(snapshot.id)?.clients));
      setClientsOpen(openClients || Boolean(data.lists.get(snapshot.id)?.clients.length));
      navigate('/delinquency/entry');
    },
    [data.lists],
  );

  return (
    <div className="dq">
      <PageHeader
        eyebrow="تحليل المحفظة"
        title="تحليل ترحيل المتأخرات الشهري"
        description="أدخل عدد العملاء المتأخرين ومبلغ المتأخرات لكل شريحة شهريًا، ثم قارن أي شهرين لمعرفة صافي التغير وأداء الفرع."
      />

      <nav className="dq-tabs print-hide" aria-label="أقسام تحليل المتأخرات">
        {TABS.map((tab) => (
          <a key={tab.id} href={`#${tab.path}`} className={`dq-tab${active === tab.id ? ' is-active' : ''}`} aria-current={active === tab.id ? 'page' : undefined}>
            <Icon name={tab.icon} size={15} />
            <span>{tab.label}</span>
            {tab.id === 'saved' && data.saved.length ? <span className="dq-tab__count">{data.saved.length}</span> : null}
          </a>
        ))}
      </nav>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {loading ? (
        <div className="loading">جارٍ فتح بيانات المتأخرات…</div>
      ) : active === 'entry' ? (
        <EntryTab
          data={data}
          draft={draft}
          setDraft={setDraft}
          clientsOpen={clientsOpen}
          setClientsOpen={setClientsOpen}
          reload={reload}
          notify={notify}
          knownBranches={settings.branches}
          onEdit={editSnapshot}
        />
      ) : active === 'saved' ? (
        itemId ? (
          <SavedView
            data={data}
            id={itemId}
            organization={settings.organizationName}
            reload={reload}
            notify={notify}
            onOpenLive={(saved) => {
              setSelection({ branch: saved.branch, aId: saved.a.id, bId: saved.b.id });
              navigate('/delinquency');
            }}
          />
        ) : (
          <SavedList data={data} reload={reload} notify={notify} />
        )
      ) : (
        <LiveTab
          data={data}
          selection={selection}
          setSelection={setSelection}
          organization={settings.organizationName}
          reload={reload}
          notify={notify}
          onEdit={editSnapshot}
        />
      )}
    </div>
  );
}

type Notify = ReturnType<typeof useApp>['notify'];

/* ------------------------------ تبويب المقارنة ---------------------------- */

function LiveTab({
  data,
  selection,
  setSelection,
  organization,
  reload,
  notify,
  onEdit,
}: {
  data: DelinquencyData;
  selection: { branch: string | null; aId: string | null; bId: string | null };
  setSelection: (next: { branch: string | null; aId: string | null; bId: string | null }) => void;
  organization: string;
  reload: () => Promise<void>;
  notify: Notify;
  onEdit: (snapshot: MonthlySnapshot, openClients?: boolean) => void;
}) {
  const { snapshots, lists } = data;
  const [saveOpen, setSaveOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const branches = useMemo(
    () => Array.from(new Set(snapshots.map((snapshot) => snapshot.branch))).sort((x, y) => x.localeCompare(y, 'ar')),
    [snapshots],
  );

  // الفرع الافتراضي: فرع أحدث شهر مُدخل
  const branch =
    selection.branch !== null && branches.includes(selection.branch)
      ? selection.branch
      : snapshots.length
        ? snapshots[snapshots.length - 1].branch
        : '';
  const months = useMemo(() => snapshots.filter((snapshot) => snapshot.branch === branch), [snapshots, branch]);

  // الافتراضي: آخر شهرين مُدخلين للفرع (الأقدم = الأساس)
  const b = months.find((month) => month.id === selection.bId) ?? months[months.length - 1] ?? null;
  const a =
    months.find((month) => month.id === selection.aId) ??
    (b ? [...months].reverse().find((month) => month.id !== b.id) ?? null : null);

  const ready = Boolean(a && b && a.id !== b.id);
  const comparison = useMemo(() => (a && b && a.id !== b.id ? compareSnapshots(a, b) : null), [a, b]);

  const listA = a ? lists.get(a.id) : undefined;
  const listB = b ? lists.get(b.id) : undefined;
  const migration = useMemo(
    () => (ready && listA?.clients.length && listB?.clients.length ? computeMigration(listA.clients, listB.clients) : null),
    [ready, listA, listB],
  );
  const reconciliation = useMemo(
    () => ({
      a: a && listA?.clients.length ? reconcileWithList(a.buckets, listA.clients) : null,
      b: b && listB?.clients.length ? reconcileWithList(b.buckets, listB.clients) : null,
    }),
    [a, b, listA, listB],
  );
  const summary = useMemo(() => (comparison ? buildExecutiveSummary(comparison, migration) : null), [comparison, migration]);
  const branchRows = useMemo(
    () => (a && b && branches.length > 1 ? compareBranches(snapshots, snapshotPeriod(a), snapshotPeriod(b)) : []),
    [a, b, branches.length, snapshots],
  );

  if (!snapshots.length) {
    return (
      <Panel title="ابدأ بإدخال بيانات شهرين" icon="chart">
        <EmptyState
          icon="chart"
          title="لا توجد بيانات شهرية بعد"
          description="أدخل عدد العملاء المتأخرين ومبلغ المتأخرات لكل شريحة لشهرين على الأقل (مثل سبتمبر وأكتوبر) لتظهر المقارنة تلقائيًا."
          action={
            <Button variant="primary" icon="plus" onClick={() => navigate('/delinquency/entry')}>
              إدخال بيانات شهر
            </Button>
          }
        />
      </Panel>
    );
  }

  const pick = (patch: Partial<{ branch: string | null; aId: string | null; bId: string | null }>) =>
    setSelection({ branch, aId: a?.id ?? null, bId: b?.id ?? null, ...patch });

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
      await saveComparison({ title, note, a, b, migration });
      await reload();
      setSaveOpen(false);
      notify('تم حفظ المقارنة. يمكنك الرجوع إليها من «المقارنات المحفوظة».', 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const doExport = () => {
    if (!comparison || !summary) return;
    try {
      const bytes = buildDelinquencyXlsx({ comparison, summary, migration, history: months, branches: branchRows, organization });
      downloadBlob(delinquencyFileName(comparison), bytes, XLSX_MIME);
      notify('تم تنزيل ملف Excel بكل الحسابات.', 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    }
  };

  const missingList = a && !listA?.clients.length ? a : b && !listB?.clients.length ? b : a;

  return (
    <>
      <section className="dq-selector print-hide" aria-label="اختيار الشهرين">
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
        <Field label="شهر الأساس" htmlFor="dq-select-a">
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
        <Field label="شهر المقارنة" htmlFor="dq-select-b">
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
          <Button variant="primary" icon="download" disabled={!ready} onClick={doExport}>
            تصدير Excel
          </Button>
        </div>
      </section>

      {months.length < 2 ? (
        <Panel title="أدخل شهرًا آخر للمقارنة" icon="calendar">
          <EmptyState
            icon="calendar"
            title={`يوجد شهر واحد فقط لـ ${branchLabel(branch)}`}
            description="المقارنة تحتاج بيانات شهرين. أضف بيانات شهر آخر لنفس الفرع."
            action={
              <Button variant="primary" icon="plus" onClick={() => navigate('/delinquency/entry')}>
                إدخال بيانات شهر
              </Button>
            }
          />
        </Panel>
      ) : !comparison || !summary || !a || !b ? (
        <Callout tone="warning">اختر شهرين مختلفين للمقارنة.</Callout>
      ) : (
        <>
          <div className="dq-context">
            <span>
              <strong>{branchLabel(branch)}</strong> · {periodLabel(a)} <span aria-hidden="true">←</span> {periodLabel(b)}
            </span>
            {!comparison.chronological ? <Badge tone="warning">شهر الأساس أحدث من شهر المقارنة</Badge> : null}
          </div>
          <ComparisonDashboard
            comparison={comparison}
            summary={summary}
            migration={migration}
            history={months}
            branches={branchRows}
            reconciliation={reconciliation}
            migrationActions={
              missingList ? (
                <Button size="sm" icon="upload" onClick={() => onEdit(missingList, true)}>
                  {migration ? 'تعديل قوائم العملاء' : 'إضافة قوائم العملاء'}
                </Button>
              ) : null
            }
          />
        </>
      )}

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="حفظ المقارنة"
        subtitle="تُحفظ نسخة مجمّدة من بيانات الشهرين؛ تعديل البيانات لاحقًا لا يغيّر المقارنة المحفوظة."
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
  clientsOpen,
  setClientsOpen,
  reload,
  notify,
  knownBranches,
  onEdit,
}: {
  data: DelinquencyData;
  draft: EntryDraft;
  setDraft: (next: EntryDraft | ((prev: EntryDraft) => EntryDraft)) => void;
  clientsOpen: boolean;
  setClientsOpen: (open: boolean) => void;
  reload: () => Promise<void>;
  notify: Notify;
  knownBranches: string[];
  onEdit: (snapshot: MonthlySnapshot, openClients?: boolean) => void;
}) {
  const { snapshots, lists } = data;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MonthlySnapshot | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const branchOptions = useMemo(
    () =>
      Array.from(new Set([...knownBranches, ...snapshots.map((snapshot) => snapshot.branch)].map(normalizeBranch).filter(Boolean))).sort((x, y) =>
        x.localeCompare(y, 'ar'),
      ),
    [knownBranches, snapshots],
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

  const parsedClients = useMemo(() => (draft.clientsText.trim() ? parseClientList(draft.clientsText) : null), [draft.clientsText]);

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
    setClientsOpen(false);
  };

  const fillFromList = () => {
    if (!parsedClients || parsedClients.errors.length || !parsedClients.clients.length) return;
    const totals = aggregateClientList(parsedClients.clients);
    setDraft((prev) => {
      const values = { ...prev.values };
      for (const id of BUCKET_IDS) {
        values[id] = {
          clients: String(totals[id].clients),
          amount: parsedClients.hasAmounts ? String(totals[id].amount) : prev.values[id].amount,
        };
      }
      return { ...prev, values };
    });
    setErrors({});
    notify(
      parsedClients.hasAmounts ? 'تمت تعبئة الأعداد والمبالغ من قائمة العملاء.' : 'تمت تعبئة الأعداد من قائمة العملاء (القائمة بلا مبالغ).',
      'success',
    );
  };

  const submit = async () => {
    if (!validation.ok) {
      setErrors(validation.errors);
      notify(Object.values(validation.errors)[0], 'error');
      return;
    }
    let clients: ClientRecord[] = [];
    if (parsedClients) {
      if (parsedClients.errors.length) {
        setErrors({ clients: 'صحّح أخطاء قائمة العملاء أو احذف القائمة قبل الحفظ.' });
        setClientsOpen(true);
        notify('قائمة العملاء بها أخطاء — صحّحها أو احذفها قبل الحفظ.', 'error');
        return;
      }
      clients = parsedClients.clients;
    }
    setSaving(true);
    try {
      const record = await saveSnapshot(
        { branch: draft.branch, year: draft.year, month: draft.month, buckets: draft.values, notes: draft.notes },
        { editingId: draft.editingId ?? undefined, overwrite: Boolean(draft.editingId) },
      );
      await saveClientList(record.id, clients);
      await reload();
      notify(`تم حفظ بيانات ${periodLabel(record)} — ${branchLabel(record.branch)}.`, 'success');
      const nextMonth = record.month === 12 ? 1 : record.month + 1;
      const nextYear = record.month === 12 ? record.year + 1 : record.year;
      setDraft(newDraft(record.branch, nextYear, nextMonth));
      setErrors({});
      setClientsOpen(false);
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'errors' in cause) setErrors((cause as { errors: Record<string, string> }).errors);
      notify(errorMessage(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickFile = async (file: File) => {
    try {
      const text = await readTextFile(file);
      setDraft((prev) => ({ ...prev, clientsText: text }));
      setClientsOpen(true);
    } catch (cause) {
      notify(errorMessage(cause), 'error');
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
        subtitle="لكل شريحة: عدد العملاء المتأخرين وإجمالي مبلغ المتأخرات فقط."
        icon="edit"
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
          <Field label="الفرع (اختياري)" htmlFor="dq-branch" hint="اتركه فارغًا إذا كنت تتابع فرعًا واحدًا.">
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
          <Callout tone="warning">
            توجد بيانات محفوظة بالفعل لشهر {periodLabel(conflict)} — {branchLabel(conflict.branch)}.{' '}
            <button type="button" className="dq-link" onClick={() => onEdit(conflict)}>
              تحميل البيانات المحفوظة للتعديل
            </button>
          </Callout>
        ) : null}

        <div className="dq-tablewrap">
          <table className="dq-table dq-entry-table">
            <thead>
              <tr>
                <th className="dq-table__bucket">شريحة التأخير</th>
                <th>عدد العملاء المتأخرين</th>
                <th>إجمالي مبلغ المتأخرات</th>
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
                      className={`input dq-input${errors[`${bucket.id}.clients`] ? ' dq-input--error' : ''}`}
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
                      className={`input dq-input${errors[`${bucket.id}.amount`] ? ' dq-input--error' : ''}`}
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

        {validation.ok && validation.warnings.length ? (
          <Callout tone="warning">
            <ul className="dq-plainlist">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        <details className="dq-details" open={clientsOpen} onToggle={(event) => setClientsOpen((event.target as HTMLDetailsElement).open)}>
          <summary>
            <Icon name="employees" size={15} />
            <span>قائمة العملاء (اختياري) — مطلوبة فقط لحساب الترحيل الفعلي بين الشرائح</span>
            {parsedClients && !parsedClients.errors.length && parsedClients.clients.length ? (
              <Badge tone="success">{fmtInt(parsedClients.clients.length)} عميل</Badge>
            ) : null}
          </summary>
          <div className="dq-details__body">
            <p className="dq-hint">
              كل سطر: <strong>رقم العميل</strong>، <strong>أيام التأخير</strong>، <strong>المبلغ</strong> (اختياري). يمكن اللصق مباشرة من Excel أو رفع ملف CSV. أرقام العملاء تُستخدم لمطابقة العميل بين الشهرين، ولا تغادر هذا الجهاز.
            </p>
            <Textarea
              id="dq-clients-text"
              aria-label="قائمة العملاء"
              dir="ltr"
              rows={7}
              className="dq-clients-text"
              placeholder={'10254\t45\t3200.50\n10311\t12\t950\n10388\t135\t18000'}
              value={draft.clientsText}
              onChange={(event) => setDraft((prev) => ({ ...prev, clientsText: event.target.value }))}
            />
            <div className="dq-details__actions">
              <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                رفع ملف CSV
              </Button>
              <Button
                size="sm"
                icon="check"
                disabled={!parsedClients || Boolean(parsedClients.errors.length) || !parsedClients.clients.length}
                onClick={fillFromList}
              >
                تعبئة الشرائح من القائمة
              </Button>
              {draft.clientsText ? (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setDraft((prev) => ({ ...prev, clientsText: '' }))}>
                  مسح القائمة
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="visually-hidden"
                aria-label="اختيار ملف قائمة العملاء"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void pickFile(file);
                  event.target.value = '';
                }}
              />
            </div>
            {parsedClients ? (
              parsedClients.errors.length ? (
                <Callout tone="danger">
                  <strong>
                    {fmtInt(parsedClients.errors.length)} خطأ في القائمة — لن تُحفظ حتى تُصحَّح:
                  </strong>
                  <ul className="dq-plainlist">
                    {parsedClients.errors.slice(0, 6).map((issue) => (
                      <li key={`${issue.line}-${issue.message}`}>
                        سطر {issue.line}: {issue.message}
                      </li>
                    ))}
                    {parsedClients.errors.length > 6 ? <li>… و{fmtInt(parsedClients.errors.length - 6)} أخطاء أخرى</li> : null}
                  </ul>
                </Callout>
              ) : (
                <Callout tone="success">
                  تمت قراءة {fmtInt(parsedClients.clients.length)} عميل متأخر
                  {parsedClients.notOverdue ? `، وتجاهل ${fmtInt(parsedClients.notOverdue)} غير متأخر (0 يوم)` : ''}
                  {parsedClients.hasAmounts ? ' — مع المبالغ.' : ' — بدون مبالغ (ستُحسب مصفوفة الأعداد فقط).'}
                </Callout>
              )
            ) : null}
            {errors.clients ? <span className="dq-err">{errors.clients}</span> : null}
          </div>
        </details>

        <Field label="ملاحظات (اختياري)" htmlFor="dq-notes">
          <Input id="dq-notes" value={draft.notes} onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))} maxLength={300} />
        </Field>

        <div className="dq-entry__actions">
          <Button variant="primary" icon="save" disabled={saving} onClick={submit}>
            {editing ? 'حفظ التعديلات' : 'حفظ بيانات الشهر'}
          </Button>
          {editing ? <Button onClick={reset}>إلغاء التعديل</Button> : null}
        </div>
      </Panel>

      <Panel title="الشهور المحفوظة" subtitle={`${fmtInt(snapshots.length)} سجل شهري`} icon="database" id="dq-months">
        {rows.length ? (
          <div className="dq-tablewrap">
            <table className="dq-table" data-testid="dq-months-table">
              <thead>
                <tr>
                  <th className="dq-table__bucket">الشهر</th>
                  <th>الفرع</th>
                  <th>العملاء المتأخرون</th>
                  <th>مبلغ المتأخرات</th>
                  <th>حصة NPL</th>
                  <th>قائمة العملاء</th>
                  <th>آخر تعديل</th>
                  <th className="print-hide">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((snapshot) => {
                  const totals = snapshotTotals(snapshot.buckets);
                  const list = lists.get(snapshot.id);
                  return (
                    <tr key={snapshot.id} className={snapshot.id === draft.editingId ? 'dq-row--current' : undefined}>
                      <th scope="row" className="dq-table__bucket">{periodLabel(snapshot)}</th>
                      <td>{branchLabel(snapshot.branch)}</td>
                      <td><span className="dq-num" dir="ltr">{fmtInt(totals.clients)}</span></td>
                      <td><span className="dq-num" dir="ltr">{fmtMoney(totals.amount)}</span></td>
                      <td><span className="dq-num" dir="ltr">{fmtPct(sharePct(snapshot.buckets.npl.amount, totals.amount))}</span></td>
                      <td>{list?.clients.length ? <Badge tone="success">{fmtInt(list.clients.length)} عميل</Badge> : <span className="dq-muted">—</span>}</td>
                      <td>{fmtDateTime(snapshot.updatedAt)}</td>
                      <td className="print-hide">
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
          <EmptyState icon="database" title="لا توجد شهور محفوظة" description="احفظ بيانات أول شهر من النموذج أعلاه." />
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
            سيُحذف سجل {periodLabel(deleting)} — {branchLabel(deleting.branch)} وقائمة عملائه إن وُجدت. المقارنات المحفوظة سابقًا لا تتأثر.
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
      <Panel title="المقارنات المحفوظة" subtitle="نسخ مجمّدة من مقارنات سابقة يمكن فتحها وتصديرها في أي وقت" icon="history" id="dq-saved">
        {data.saved.length ? (
          <div className="dq-tablewrap">
            <table className="dq-table" data-testid="dq-saved-table">
              <thead>
                <tr>
                  <th className="dq-table__bucket">العنوان</th>
                  <th>الفرع</th>
                  <th>الشهران</th>
                  <th>صافي تغير المبلغ</th>
                  <th>الترحيل</th>
                  <th>تاريخ الحفظ</th>
                  <th className="print-hide">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {data.saved.map((saved) => {
                  const comparison = compareSnapshots(saved.a, saved.b);
                  return (
                    <tr key={saved.id}>
                      <th scope="row" className="dq-table__bucket">
                        <a href={`#/delinquency/saved/${saved.id}`} className="dq-link">
                          {saved.title}
                        </a>
                        {saved.note ? <small className="dq-subtext">{saved.note}</small> : null}
                      </th>
                      <td>{branchLabel(saved.branch)}</td>
                      <td>
                        {periodLabel(saved.a)} ← {periodLabel(saved.b)}
                      </td>
                      <td><Delta value={comparison.totals.amountDelta} format={fmtSignedMoney} strong /></td>
                      <td>{saved.migration ? <Badge tone="success">فعلي</Badge> : <Badge tone="neutral">صافي تغير</Badge>}</td>
                      <td>{fmtDateTime(saved.createdAt)}</td>
                      <td className="print-hide">
                        <span className="dq-rowactions">
                          <Button size="sm" icon="chart" onClick={() => navigate(`/delinquency/saved/${saved.id}`)}>
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
          <EmptyState
            icon="history"
            title="لا توجد مقارنات محفوظة"
            description="من «لوحة المقارنة» اختر شهرين ثم اضغط «حفظ المقارنة» للرجوع إليها لاحقًا."
            action={
              <Button icon="chart" onClick={() => navigate('/delinquency')}>
                الانتقال إلى لوحة المقارنة
              </Button>
            }
          />
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
        {deleting ? <p>سيُحذف «{deleting.title}» من المقارنات المحفوظة. بيانات الشهور نفسها لا تتأثر.</p> : null}
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
  const summary = useMemo(() => (comparison ? buildExecutiveSummary(comparison, saved?.migration ?? null) : null), [comparison, saved]);

  if (!saved || !comparison || !summary) {
    return (
      <Panel title="المقارنة غير موجودة" icon="history">
        <EmptyState
          icon="history"
          title="لم يتم العثور على هذه المقارنة"
          description="ربما حُذفت. ارجع إلى قائمة المقارنات المحفوظة."
          action={
            <Button icon="arrow-left" onClick={() => navigate('/delinquency/saved')}>
              المقارنات المحفوظة
            </Button>
          }
        />
      </Panel>
    );
  }

  const liveA = data.snapshots.find((snapshot) => snapshot.id === saved.a.id);
  const liveB = data.snapshots.find((snapshot) => snapshot.id === saved.b.id);
  const sameBuckets = (x: MonthlySnapshot | undefined, y: MonthlySnapshot) => Boolean(x) && JSON.stringify(x!.buckets) === JSON.stringify(y.buckets);
  const liveAvailable = Boolean(liveA && liveB);
  const changedSince = liveAvailable && (!sameBuckets(liveA, saved.a) || !sameBuckets(liveB, saved.b));

  const doExport = () => {
    try {
      const bytes = buildDelinquencyXlsx({
        comparison,
        summary,
        migration: saved.migration,
        history: [saved.a, saved.b],
        organization,
        savedTitle: saved.title,
        savedNote: saved.note,
      });
      downloadBlob(delinquencyFileName(comparison), bytes, XLSX_MIME);
      notify('تم تنزيل ملف Excel للمقارنة المحفوظة.', 'success');
    } catch (cause) {
      notify(errorMessage(cause), 'error');
    }
  };

  const doDelete = async () => {
    try {
      await deleteSavedComparison(saved.id);
      await reload();
      notify('تم حذف المقارنة المحفوظة.', 'success');
      navigate('/delinquency/saved');
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
          <span className="dq-savedbar__eyebrow">مقارنة محفوظة · {fmtDateTime(saved.createdAt)}</span>
          <h2>{saved.title}</h2>
          <p>
            {branchLabel(saved.branch)} · {periodLabel(saved.a)} ← {periodLabel(saved.b)}
            {saved.note ? ` — ${saved.note}` : ''}
          </p>
        </div>
        <div className="dq-savedbar__actions print-hide">
          <Button icon="arrow-left" onClick={() => navigate('/delinquency/saved')}>
            رجوع
          </Button>
          {liveAvailable ? (
            <Button icon="chart" onClick={() => onOpenLive(saved)}>
              عرض البيانات الحالية
            </Button>
          ) : null}
          <Button variant="primary" icon="download" onClick={doExport}>
            تصدير Excel
          </Button>
          <IconButton icon="trash" tone="danger" label="حذف المقارنة" onClick={() => setConfirming(true)} />
        </div>
      </section>

      {changedSince ? (
        <Callout tone="warning">
          بيانات أحد الشهرين عُدّلت بعد حفظ هذه المقارنة. المعروض هنا هو النسخة المجمّدة وقت الحفظ؛ اضغط «عرض البيانات الحالية» لرؤية المقارنة بالأرقام المحدَّثة.
        </Callout>
      ) : null}

      <ComparisonDashboard comparison={comparison} summary={summary} migration={saved.migration} history={[saved.a, saved.b]} frozen />

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
        <p>سيُحذف «{saved.title}» من المقارنات المحفوظة. بيانات الشهور نفسها لا تتأثر.</p>
      </Modal>
    </>
  );
}
