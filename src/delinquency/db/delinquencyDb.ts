/**
 * بيانات «تحليل ترحيل المتأخرات» في ذاكرة الصفحة فقط.
 *
 * لا يُكتب أي شيء على الجهاز (لا IndexedDB ولا localStorage ولا sessionStorage):
 * تحديث الصفحة أو إغلاقها يبدأ ببيانات فارغة.
 */

import { ValidationError } from '../lib/errors';
import { nowIso, uid } from '../lib/utils';
import {
  branchLabel,
  normalizeBranch,
  periodLabel,
  sanitizeBuckets,
  snapshotId,
  sortSnapshots,
  validateSnapshotInput,
  type BucketId,
  type MonthlySnapshot,
  type SnapshotInput,
} from '../lib/delinquency';

/** اسم قاعدة IndexedDB التي كانت الإصدارات السابقة تحفظ فيها — تُحذف عند فتح الصفحة */
export const DELINQUENCY_DB_NAME = 'risk-delinquency-analysis';
/** مفتاح localStorage الذي كانت الإصدارات السابقة تحفظ فيه اسم الجهة */
export const LEGACY_ORGANIZATION_KEY = 'dq.organization';

export const DELINQUENCY_STORES = ['months', 'clientLists', 'comparisons'] as const;
export type DelinquencyStore = (typeof DELINQUENCY_STORES)[number];

/** عميل واحد داخل قائمة عملاء محفوظة سابقًا */
export interface ClientRecord {
  id: string;
  bucket: BucketId;
  days: number | null;
  amount: number | null;
}

/**
 * قائمة عملاء شهر واحد — المعرّف = معرّف السجل الشهري.
 * لم تعد الواجهة تعرضها أو تعدّلها، لكنها تبقى محفوظة كما هي وتدخل في النسخ الاحتياطي والاستعادة.
 */
export interface ClientListRecord {
  id: string;
  clients: ClientRecord[];
  createdAt: string;
  updatedAt: string;
}

/** مقارنة محفوظة: نسخة مجمّدة من بيانات الشهرين وقت الحفظ */
export interface SavedComparison {
  id: string;
  title: string;
  note: string;
  branch: string;
  a: MonthlySnapshot;
  b: MonthlySnapshot;
  /** حقل من إصدار سابق — يُحفظ كما هو إن وُجد ولا يُعرض */
  migration: unknown;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------- الذاكرة ---------------------------------- */

type Row = { id: string };
type Stores = Record<DelinquencyStore, Map<string, Row>>;

const emptyStores = (): Stores => ({ months: new Map(), clientLists: new Map(), comparisons: new Map() });

let memory: Stores = emptyStores();

/**
 * نسخة مستقلة من سجل حتى لا يتشارك المخزن ومن يقرأ منه الكائن نفسه.
 * السجلات بيانات بسيطة فقط؛ ما لا يمكن نسخه (دالة مثلًا) يُرفض ولا يُخزَّن.
 */
function copy<T>(value: T): T {
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error('سجل لا يمكن حفظه.');
  if (Array.isArray(value)) return value.map((item) => copy(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = copy(item);
    return out as T;
  }
  return value;
}

/** كل سجلات قسم مرتبة بالمعرّف */
const rowsOf = <T>(map: Map<string, Row>): T[] =>
  Array.from(map.keys())
    .sort()
    .map((id) => copy(map.get(id)) as unknown as T);

async function getAll<T>(store: DelinquencyStore): Promise<T[]> {
  return rowsOf<T>(memory[store]);
}

async function getOne<T>(store: DelinquencyStore, id: string): Promise<T | undefined> {
  const row = memory[store].get(id);
  return row ? (copy(row) as unknown as T) : undefined;
}

async function put<T extends { id: string }>(store: DelinquencyStore, record: T): Promise<T> {
  memory[store].set(record.id, copy(record));
  return record;
}

async function remove(store: DelinquencyStore, id: string): Promise<void> {
  memory[store].delete(id);
}

export async function clearDelinquencyData(): Promise<void> {
  memory = emptyStores();
}

/**
 * يحذف ما حفظته الإصدارات السابقة على الجهاز (قاعدة IndexedDB واسم الجهة في localStorage).
 * يُستدعى مرة عند فتح الصفحة؛ فشله لا يؤثر على عمل النظام.
 */
export function removeStoredData(): void {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) indexedDB.deleteDatabase(DELINQUENCY_DB_NAME);
  } catch {
    /* IndexedDB غير متاح */
  }
  try {
    window.localStorage.removeItem(LEGACY_ORGANIZATION_KEY);
  } catch {
    /* localStorage غير متاح */
  }
}

/* ---------------------------- السجلات الشهرية ----------------------------- */

function hydrateSnapshot(row: MonthlySnapshot): MonthlySnapshot {
  return {
    ...row,
    branch: normalizeBranch(row.branch),
    buckets: sanitizeBuckets(row.buckets),
    notes: typeof row.notes === 'string' ? row.notes : '',
  };
}

export async function listSnapshots(): Promise<MonthlySnapshot[]> {
  return sortSnapshots((await getAll<MonthlySnapshot>('months')).map(hydrateSnapshot));
}

export async function getSnapshot(id: string): Promise<MonthlySnapshot | undefined> {
  const row = await getOne<MonthlySnapshot>('months', id);
  return row ? hydrateSnapshot(row) : undefined;
}

export interface SaveSnapshotOptions {
  /**
   * معرّف السجل الجاري تعديله. إذا تغيّر الشهر أو الفرع أثناء التعديل يُنقل السجل (وقائمة عملائه)
   * إلى المفتاح الجديد، بشرط ألا يكون هناك سجل آخر محفوظ بنفس الشهر والفرع.
   */
  editingId?: string;
  /** السماح بالكتابة فوق سجل موجود لنفس الشهر والفرع عند الإضافة (افتراضي: نعم) */
  overwrite?: boolean;
}

/** يحفظ بيانات شهر واحد لفرع واحد (سجل واحد لكل شهر/فرع) */
export async function saveSnapshot(input: SnapshotInput, options: SaveSnapshotOptions = {}): Promise<MonthlySnapshot> {
  const validation = validateSnapshotInput(input);
  if (!validation.ok) throw new ValidationError(validation.errors);

  const { branch, year, month, buckets, notes } = validation.value;
  const id = snapshotId(branch, year, month);
  const existing = await getOne<MonthlySnapshot>('months', id);
  const editing = options.editingId ? await getOne<MonthlySnapshot>('months', options.editingId) : undefined;
  const moving = Boolean(editing && editing.id !== id);

  // التعديل في المكان (نفس الشهر والفرع) مسموح دائمًا. غير ذلك: لا يُكتب فوق سجل آخر عند
  // النقل أثناء التعديل، ولا عند الإضافة مع overwrite=false.
  const inPlace = Boolean(editing && editing.id === id);
  if (existing && !inPlace && (options.editingId !== undefined || options.overwrite === false)) {
    throw new ValidationError({
      month: `توجد بيانات محفوظة بالفعل لشهر ${periodLabel({ year, month })} — ${branchLabel(branch)}. عدّل السجل الموجود بدلًا من ذلك.`,
    });
  }

  const now = nowIso();
  const record: MonthlySnapshot = {
    id,
    branch,
    year,
    month,
    buckets,
    notes,
    createdAt: (moving ? editing?.createdAt : existing?.createdAt) ?? now,
    updatedAt: now,
  };
  await put('months', record);

  if (moving && editing) {
    const list = await getOne<ClientListRecord>('clientLists', editing.id);
    if (list) {
      await put('clientLists', { ...list, id, updatedAt: now });
      await remove('clientLists', editing.id);
    }
    await remove('months', editing.id);
  }
  return record;
}

export interface SaveBatchOptions {
  /** السماح باستبدال سجلات محفوظة لنفس الشهر والفرع (افتراضي: لا — يُرفض الحفظ كله) */
  overwrite?: boolean;
}

/** يُرمى عندما يتعارض حفظ مجموعة مع سجلات محفوظة ولم يؤكد المستخدم الاستبدال */
export class ExistingSnapshotsError extends ValidationError {
  existing: MonthlySnapshot[];
  constructor(existing: MonthlySnapshot[]) {
    super({
      month: `توجد بيانات محفوظة بالفعل لـ ${existing.map((row) => `${branchLabel(row.branch)} (${periodLabel(row)})`).join('، ')}. أكّد الاستبدال أولًا.`,
    });
    this.name = 'ExistingSnapshotsError';
    this.existing = existing;
  }
}

/**
 * يحفظ عدة سجلات شهرية (مثل مكاتب شهر واحد مستوردة من PDF) دفعة واحدة:
 * إما أن تُحفظ كلها أو لا يتغير شيء. لا يستبدل سجلًا محفوظًا إلا مع overwrite = true.
 * قوائم العملاء المحفوظة للسجلات المستبدلة لا تُمس.
 */
export async function saveSnapshotsBatch(inputs: SnapshotInput[], options: SaveBatchOptions = {}): Promise<MonthlySnapshot[]> {
  if (!inputs.length) throw new ValidationError({ month: 'لا توجد بيانات للحفظ.' });

  const values = inputs.map((input) => {
    const validation = validateSnapshotInput(input);
    if (!validation.ok) throw new ValidationError(validation.errors);
    return validation.value;
  });
  const ids = values.map((value) => snapshotId(value.branch, value.year, value.month));
  const repeated = values.find((_, index) => ids.indexOf(ids[index]) !== index);
  if (repeated) throw new ValidationError({ branch: `الفرع «${branchLabel(repeated.branch)}» مكرر في البيانات المطلوب حفظها.` });

  const current = memory.months as Map<string, MonthlySnapshot>;
  const existing = ids.map((id) => current.get(id)).filter((row): row is MonthlySnapshot => Boolean(row));
  if (existing.length && !options.overwrite) throw new ExistingSnapshotsError(existing.map((row) => hydrateSnapshot(copy(row))));

  const now = nowIso();
  const records = values.map((value, index): MonthlySnapshot => ({
    id: ids[index],
    branch: value.branch,
    year: value.year,
    month: value.month,
    buckets: value.buckets,
    notes: value.notes,
    createdAt: current.get(ids[index])?.createdAt ?? now,
    updatedAt: now,
  }));
  records.forEach((record) => current.set(record.id, copy(record)));
  return records;
}

/** يحذف بيانات الشهر وقائمة عملائه. المقارنات المحفوظة لا تتأثر (نسخ مجمّدة). */
export async function deleteSnapshot(id: string): Promise<void> {
  await remove('months', id);
  await remove('clientLists', id);
}

/* ------------------------------ قوائم العملاء ----------------------------- */

export async function listClientLists(): Promise<ClientListRecord[]> {
  return (await getAll<ClientListRecord>('clientLists')).map((row) => ({
    ...row,
    clients: Array.isArray(row.clients) ? row.clients : [],
  }));
}

export async function getClientList(snapshotKey: string): Promise<ClientListRecord | undefined> {
  const row = await getOne<ClientListRecord>('clientLists', snapshotKey);
  return row ? { ...row, clients: Array.isArray(row.clients) ? row.clients : [] } : undefined;
}

/** يحفظ قائمة عملاء شهر (أو يحذفها إذا كانت فارغة) */
export async function saveClientList(snapshotKey: string, clients: ClientRecord[]): Promise<void> {
  if (!clients.length) {
    await remove('clientLists', snapshotKey);
    return;
  }
  const ids = new Set<string>();
  for (const client of clients) {
    if (!client.id) throw new ValidationError({ clients: 'رقم عميل مفقود في القائمة.' });
    if (ids.has(client.id)) throw new ValidationError({ clients: `رقم العميل ${client.id} مكرر في القائمة.` });
    ids.add(client.id);
  }
  const existing = await getOne<ClientListRecord>('clientLists', snapshotKey);
  const now = nowIso();
  await put('clientLists', { id: snapshotKey, clients, createdAt: existing?.createdAt ?? now, updatedAt: now });
}

/* ---------------------------- المقارنات المحفوظة --------------------------- */

export async function listSavedComparisons(): Promise<SavedComparison[]> {
  const rows = await getAll<SavedComparison>('comparisons');
  return rows
    .filter((row) => row && row.a && row.b)
    .map((row) => ({ ...row, a: hydrateSnapshot(row.a), b: hydrateSnapshot(row.b), migration: row.migration ?? null }))
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0));
}

export async function getSavedComparison(id: string): Promise<SavedComparison | undefined> {
  const row = await getOne<SavedComparison>('comparisons', id);
  if (!row || !row.a || !row.b) return undefined;
  return { ...row, a: hydrateSnapshot(row.a), b: hydrateSnapshot(row.b), migration: row.migration ?? null };
}

export interface SaveComparisonInput {
  id?: string;
  title: string;
  note?: string;
  a: MonthlySnapshot;
  b: MonthlySnapshot;
}

/** يحفظ مقارنة بين شهرين كنسخة مجمّدة يمكن الرجوع إليها لاحقًا */
export async function saveComparison(input: SaveComparisonInput): Promise<SavedComparison> {
  const title = (input.title ?? '').trim();
  if (!title) throw new ValidationError({ title: 'أدخل عنوانًا للمقارنة.' });
  if (!input.a || !input.b) throw new ValidationError({ title: 'اختر شهرين للمقارنة.' });
  if (input.a.id === input.b.id) throw new ValidationError({ title: 'اختر شهرين مختلفين للمقارنة.' });

  const existing = input.id ? await getOne<SavedComparison>('comparisons', input.id) : undefined;
  const now = nowIso();
  const record: SavedComparison = {
    id: existing?.id ?? uid('dqc'),
    title,
    note: (input.note ?? '').trim(),
    branch: normalizeBranch(input.a.branch),
    a: hydrateSnapshot(JSON.parse(JSON.stringify(input.a)) as MonthlySnapshot),
    b: hydrateSnapshot(JSON.parse(JSON.stringify(input.b)) as MonthlySnapshot),
    migration: existing?.migration ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return put('comparisons', record);
}

export async function deleteSavedComparison(id: string): Promise<void> {
  await remove('comparisons', id);
}

/* ------------------------- النسخ الاحتياطي والاستعادة ---------------------- */

export interface DelinquencyBackup {
  months: MonthlySnapshot[];
  clientLists: ClientListRecord[];
  comparisons: SavedComparison[];
}

export async function exportDelinquencyData(): Promise<DelinquencyBackup> {
  return {
    months: await getAll<MonthlySnapshot>('months'),
    clientLists: await getAll<ClientListRecord>('clientLists'),
    comparisons: await getAll<SavedComparison>('comparisons'),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** يتحقق من قسم المتأخرات داخل نسخة احتياطية — يعيد قائمة أخطاء (فارغة = صالح) */
export function validateDelinquencyBackup(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ['قسم تحليل المتأخرات غير صالح.'];
  const labels: Record<DelinquencyStore, string> = {
    months: 'بيانات المتأخرات الشهرية',
    clientLists: 'قوائم عملاء المتأخرات',
    comparisons: 'مقارنات المتأخرات المحفوظة',
  };
  for (const store of DELINQUENCY_STORES) {
    const rows = raw[store];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      errors.push(`قسم «${labels[store]}» ليس قائمة.`);
      continue;
    }
    const ids = new Set<string>();
    rows.forEach((row, index) => {
      if (!isRecord(row) || typeof row.id !== 'string' || !row.id) {
        errors.push(`${labels[store]}: السجل ${index + 1} غير صالح.`);
        return;
      }
      if (ids.has(row.id)) errors.push(`${labels[store]}: معرّف مكرر (${row.id}).`);
      ids.add(row.id);
    });
  }
  return errors;
}

/**
 * يستعيد بيانات المتأخرات من نسخة احتياطية.
 * - restore (الافتراضي في الواجهة): كل سجل في النسخة يُكتب كما هو؛ السجل الموجود بنفس المعرّف
 *   يُستبدل بنسخة الملف، وما ليس في الملف يبقى دون مساس — فلا يُفقد أي سجل.
 * - replace: يستبدل بيانات المتأخرات كلها بما في النسخة.
 * - merge: يضيف الجديد ويحدّث ما له تاريخ تعديل أحدث.
 *
 * الأقسام الثلاثة تُعتمد معًا: إما أن تنجح الاستعادة كلها أو لا يتغير شيء.
 * يعيد عدد السجلات التي كُتبت من كل قسم.
 */
export async function restoreDelinquencyData(
  backup: Partial<DelinquencyBackup>,
  mode: 'restore' | 'replace' | 'merge' = 'restore',
): Promise<Record<DelinquencyStore, number>> {
  const errors = validateDelinquencyBackup(backup);
  if (errors.length) throw new Error(errors[0]);

  type Dated = Row & { updatedAt?: string };
  const imported = { months: 0, clientLists: 0, comparisons: 0 } as Record<DelinquencyStore, number>;
  // تُجهَّز الأقسام الثلاثة في نسخة جانبية ثم تُعتمد معًا
  const next = emptyStores();

  for (const store of DELINQUENCY_STORES) {
    const incoming = ((backup[store] as Dated[] | undefined) ?? []).slice();
    const target = mode === 'replace' ? next[store] : new Map(memory[store]);
    next[store] = target;
    if (mode === 'merge') {
      for (const row of incoming) {
        const found = target.get(row.id) as Dated | undefined;
        if (!found || (row.updatedAt ?? '') > (found.updatedAt ?? '')) {
          target.set(row.id, copy(row));
          imported[store] += 1;
        }
      }
    } else {
      incoming.forEach((row) => target.set(row.id, copy(row)));
      imported[store] = incoming.length;
    }
  }
  memory = next;
  return imported;
}

export async function delinquencyCounts(): Promise<Record<DelinquencyStore, number>> {
  const counts = {} as Record<DelinquencyStore, number>;
  for (const store of DELINQUENCY_STORES) counts[store] = (await getAll<unknown>(store)).length;
  return counts;
}
