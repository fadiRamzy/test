/**
 * تخزين بيانات «تحليل ترحيل المتأخرات» في قاعدة IndexedDB مستقلة.
 *
 * القاعدة منفصلة عمدًا عن قاعدة النظام الرئيسية (risk-officer-suite) حتى لا تتغير
 * بنية أو إصدار قاعدة البيانات القائمة ولا تتأثر أي سجلات موجودة.
 * كل البيانات محلية في متصفح المستخدم فقط.
 */

import { isIndexedDbAvailable, StorageUnavailableError, ValidationError } from '../lib/errors';
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

export const DELINQUENCY_DB_NAME = 'risk-delinquency-analysis';
export const DELINQUENCY_DB_VERSION = 1;

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

/* ------------------------------- الاتصال ---------------------------------- */

let dbPromise: Promise<IDBDatabase> | null = null;
let currentName = DELINQUENCY_DB_NAME;

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('فشلت عملية على قاعدة بيانات المتأخرات'));
  });
}

/**
 * معاملة كتابة «صارمة»: لا تُعلَن مكتملة إلا بعد كتابة البيانات على القرص،
 * حتى لا تضيع آخر عملية حفظ إذا أُغلق المتصفح أو انقطع التيار مباشرة بعدها.
 */
function writeTx(db: IDBDatabase, stores: DelinquencyStore | DelinquencyStore[]): IDBTransaction {
  try {
    return db.transaction(stores, 'readwrite', { durability: 'strict' });
  } catch {
    return db.transaction(stores, 'readwrite');
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('فشلت الكتابة'));
    tx.onabort = () => reject(tx.error ?? new Error('أُلغيت الكتابة'));
  });
}

function open(name = currentName): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new StorageUnavailableError('التخزين المحلي (IndexedDB) غير متاح في هذا المتصفح.'));
  }
  if (dbPromise && name === currentName) return dbPromise;
  currentName = name;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DELINQUENCY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of DELINQUENCY_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // إغلاق مهذّب إذا طلب تبويب آخر ترقية القاعدة
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('تعذّر فتح قاعدة بيانات المتأخرات'));
    };
    request.onblocked = () => reject(new Error('قاعدة بيانات المتأخرات مفتوحة في تبويب آخر — أغلق التبويبات الأخرى.'));
  });
  return dbPromise;
}

const getDb = (): Promise<IDBDatabase> => dbPromise ?? open();

/** استخدام قاعدة بيانات مخصصة (للاختبارات) */
export async function useDelinquencyDatabase(name: string): Promise<void> {
  const existing = await dbPromise?.catch(() => null);
  existing?.close();
  dbPromise = null;
  await open(name);
}

export async function closeDelinquencyDatabase(): Promise<void> {
  const db = await dbPromise?.catch(() => null);
  db?.close();
  dbPromise = null;
}

async function getAll<T>(store: DelinquencyStore): Promise<T[]> {
  const db = await getDb();
  return req(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

async function getOne<T>(store: DelinquencyStore, id: string): Promise<T | undefined> {
  const db = await getDb();
  return req(db.transaction(store, 'readonly').objectStore(store).get(id) as IDBRequest<T | undefined>);
}

async function put<T extends { id: string }>(store: DelinquencyStore, record: T): Promise<T> {
  const db = await getDb();
  const tx = writeTx(db, store);
  tx.objectStore(store).put(record);
  await done(tx);
  return record;
}

async function remove(store: DelinquencyStore, id: string): Promise<void> {
  const db = await getDb();
  const tx = writeTx(db, store);
  tx.objectStore(store).delete(id);
  await done(tx);
}

async function replaceAll<T extends { id: string }>(store: DelinquencyStore, records: T[]): Promise<void> {
  const db = await getDb();
  const tx = writeTx(db, store);
  const objectStore = tx.objectStore(store);
  objectStore.clear();
  records.forEach((record) => objectStore.put(record));
  await done(tx);
}

export async function clearDelinquencyData(): Promise<void> {
  for (const store of DELINQUENCY_STORES) await replaceAll(store, []);
}

/**
 * يطلب من المتصفح اعتبار تخزين الموقع «دائمًا» حتى لا يُحذف تلقائيًا عند امتلاء القرص.
 * الطلب صامت في أغلب المتصفحات، وفشله لا يؤثر على الحفظ العادي في IndexedDB.
 */
let persistRequested = false;
export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) return true;
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    persistRequested = true;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
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
 * يحفظ عدة سجلات شهرية (مثل مكاتب شهر واحد مستوردة من PDF) في معاملة واحدة:
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

  const db = await getDb();
  const tx = writeTx(db, 'months');
  const finished = done(tx);
  const records: MonthlySnapshot[] = [];
  try {
    const store = tx.objectStore('months');
    const stored = await req(store.getAll() as IDBRequest<MonthlySnapshot[]>);
    const current = new Map(stored.map((row) => [row.id, row]));
    const existing = ids.map((id) => current.get(id)).filter((row): row is MonthlySnapshot => Boolean(row));
    if (existing.length && !options.overwrite) throw new ExistingSnapshotsError(existing.map(hydrateSnapshot));

    const now = nowIso();
    values.forEach((value, index) => {
      const record: MonthlySnapshot = {
        id: ids[index],
        branch: value.branch,
        year: value.year,
        month: value.month,
        buckets: value.buckets,
        notes: value.notes,
        createdAt: current.get(ids[index])?.createdAt ?? now,
        updatedAt: now,
      };
      store.put(record);
      records.push(record);
    });
  } catch (cause) {
    finished.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      /* المعاملة أُلغيت بالفعل */
    }
    throw cause;
  }
  await finished;
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
 * الأقسام الثلاثة تُكتب في معاملة واحدة: إما أن تنجح الاستعادة كلها أو لا يتغير شيء.
 * يعيد عدد السجلات التي كُتبت من كل قسم.
 */
export async function restoreDelinquencyData(
  backup: Partial<DelinquencyBackup>,
  mode: 'restore' | 'replace' | 'merge' = 'restore',
): Promise<Record<DelinquencyStore, number>> {
  const errors = validateDelinquencyBackup(backup);
  if (errors.length) throw new Error(errors[0]);

  type Row = { id: string; updatedAt?: string };
  const imported = { months: 0, clientLists: 0, comparisons: 0 } as Record<DelinquencyStore, number>;
  const db = await getDb();
  const tx = writeTx(db, [...DELINQUENCY_STORES]);
  const finished = done(tx);

  try {
    for (const store of DELINQUENCY_STORES) {
      const incoming = ((backup[store] as Row[] | undefined) ?? []).slice();
      const objectStore = tx.objectStore(store);
      if (mode === 'replace') {
        objectStore.clear();
        incoming.forEach((row) => objectStore.put(row));
        imported[store] = incoming.length;
      } else if (mode === 'restore') {
        incoming.forEach((row) => objectStore.put(row));
        imported[store] = incoming.length;
      } else {
        const existing = await req(objectStore.getAll() as IDBRequest<Row[]>);
        const current = new Map(existing.map((row) => [row.id, row]));
        for (const row of incoming) {
          const found = current.get(row.id);
          if (!found || (row.updatedAt ?? '') > (found.updatedAt ?? '')) {
            objectStore.put(row);
            imported[store] += 1;
          }
        }
      }
    }
  } catch (cause) {
    finished.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      /* المعاملة أُلغيت بالفعل */
    }
    throw cause;
  }
  await finished;
  return imported;
}

export async function delinquencyCounts(): Promise<Record<DelinquencyStore, number>> {
  const counts = {} as Record<DelinquencyStore, number>;
  for (const store of DELINQUENCY_STORES) counts[store] = (await getAll<unknown>(store)).length;
  return counts;
}
