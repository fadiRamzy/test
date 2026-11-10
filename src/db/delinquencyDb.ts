/**
 * تخزين بيانات «تحليل ترحيل المتأخرات» في قاعدة IndexedDB مستقلة.
 *
 * القاعدة منفصلة عمدًا عن قاعدة النظام الرئيسية (risk-officer-suite) حتى لا تتغير
 * بنية أو إصدار قاعدة البيانات القائمة ولا تتأثر أي سجلات موجودة.
 * كل البيانات محلية في متصفح المستخدم فقط.
 */

import { isIndexedDbAvailable, StorageUnavailableError } from './database';
import { ValidationError } from './repo';
import { nowIso, uid } from '../lib/utils';
import {
  branchLabel,
  normalizeBranch,
  periodLabel,
  sanitizeBuckets,
  snapshotId,
  sortSnapshots,
  validateSnapshotInput,
  type MonthlySnapshot,
  type SnapshotInput,
} from '../lib/delinquency';
import type { ClientRecord, MigrationResult } from '../lib/delinquencyMigration';

export const DELINQUENCY_DB_NAME = 'risk-delinquency-analysis';
export const DELINQUENCY_DB_VERSION = 1;

export const DELINQUENCY_STORES = ['months', 'clientLists', 'comparisons'] as const;
export type DelinquencyStore = (typeof DELINQUENCY_STORES)[number];

/** قائمة العملاء الاختيارية لشهر واحد (لحساب الترحيل الفعلي) — المعرّف = معرّف السجل الشهري */
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
  /** نتيجة الترحيل الفعلي وقت الحفظ (إن توفرت قوائم العملاء) */
  migration: MigrationResult | null;
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
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(record);
  await done(tx);
  return record;
}

async function remove(store: DelinquencyStore, id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await done(tx);
}

async function replaceAll<T extends { id: string }>(store: DelinquencyStore, records: T[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  objectStore.clear();
  records.forEach((record) => objectStore.put(record));
  await done(tx);
}

export async function clearDelinquencyData(): Promise<void> {
  for (const store of DELINQUENCY_STORES) await replaceAll(store, []);
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
  migration?: MigrationResult | null;
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
    migration: input.migration ? (JSON.parse(JSON.stringify(input.migration)) as MigrationResult) : null,
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
 * - replace: يستبدل بيانات المتأخرات كلها بما في النسخة.
 * - merge: يضيف الجديد ويحدّث ما له تاريخ تعديل أحدث.
 */
export async function restoreDelinquencyData(
  backup: Partial<DelinquencyBackup>,
  mode: 'replace' | 'merge',
): Promise<Record<DelinquencyStore, number>> {
  const errors = validateDelinquencyBackup(backup);
  if (errors.length) throw new Error(errors[0]);

  const imported = { months: 0, clientLists: 0, comparisons: 0 } as Record<DelinquencyStore, number>;
  for (const store of DELINQUENCY_STORES) {
    const incoming = ((backup[store] as Array<{ id: string; updatedAt?: string }> | undefined) ?? []).slice();
    if (mode === 'replace') {
      await replaceAll(store, incoming);
      imported[store] = incoming.length;
      continue;
    }
    const existing = await getAll<{ id: string; updatedAt?: string }>(store);
    const map = new Map(existing.map((row) => [row.id, row]));
    let changed = 0;
    for (const row of incoming) {
      const current = map.get(row.id);
      if (!current || (row.updatedAt ?? '') > (current.updatedAt ?? '')) {
        map.set(row.id, row);
        changed += 1;
      }
    }
    await replaceAll(store, Array.from(map.values()));
    imported[store] = changed;
  }
  return imported;
}

export async function delinquencyCounts(): Promise<Record<DelinquencyStore, number>> {
  const counts = {} as Record<DelinquencyStore, number>;
  for (const store of DELINQUENCY_STORES) counts[store] = (await getAll<unknown>(store)).length;
  return counts;
}
