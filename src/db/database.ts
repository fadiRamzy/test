import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_SETTINGS,
  STORE_NAMES,
  type AppSettings,
  type AuditEntry,
  type StoreName,
} from './schema';
import { DATA_MIGRATIONS, upgradeSchema } from './migrations';

/**
 * طبقة الوصول إلى IndexedDB. كل البيانات محلية داخل المتصفح ولا تُرسل لأي خادم.
 */

let dbPromise: Promise<IDBDatabase> | null = null;
let currentDbName = DB_NAME;

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('فشل تنفيذ العملية على قاعدة البيانات'));
  });
}

export function openDatabase(dbName = currentDbName): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new StorageUnavailableError('التخزين المحلي (IndexedDB) غير متاح في هذا المتصفح.'));
  }
  if (dbPromise && dbName === currentDbName) return dbPromise;

  currentDbName = dbName;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction as IDBTransaction;
      upgradeSchema(db, transaction);
      const oldVersion = event.oldVersion ?? 0;

      // ترحيلات البيانات تُنفّذ بعد اكتمال الترقية الهيكلية
      transaction.oncomplete = () => {
        void runDataMigrations(db, oldVersion);
      };
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذّر فتح قاعدة البيانات المحلية'));
    request.onblocked = () =>
      reject(new Error('قاعدة البيانات مفتوحة في تبويب آخر. أغلق التبويبات الأخرى ثم أعد المحاولة.'));
  });

  return dbPromise;
}

async function runDataMigrations(db: IDBDatabase, fromVersion: number): Promise<void> {
  const pending = DATA_MIGRATIONS.filter((m) => m.version > fromVersion);
  const applied = await readMeta<number>('dataVersion').catch(() => null);
  const startFrom = typeof applied === 'number' ? applied : fromVersion;
  for (const migration of pending.filter((m) => m.version > startFrom)) {
    await migration.up(db);
    await writeMeta('dataVersion', migration.version);
  }
}

export async function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) return openDatabase();
  return dbPromise;
}

/** استخدام قاعدة بيانات مخصصة (للاختبارات) */
export async function useDatabase(dbName: string): Promise<void> {
  if (dbPromise) {
    const existing = await dbPromise.catch(() => null);
    existing?.close();
  }
  dbPromise = null;
  currentDbName = dbName;
  await openDatabase(dbName);
  await ensureDefaults();
}

export async function closeDatabase(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

export async function deleteDatabase(dbName = currentDbName): Promise<void> {
  await closeDatabase();
  await requestToPromise(indexedDB.deleteDatabase(dbName));
}

/* ------------------------------------------------------------------ */
/* عمليات عامة                                                        */
/* ------------------------------------------------------------------ */

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getById<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await getDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).get(id) as IDBRequest<T | undefined>);
}

export async function putRecord<T extends { id: string }>(store: StoreName, record: T): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  await requestToPromise(tx.objectStore(store).put(record));
  await transactionDone(tx);
  return record;
}

export async function putMany<T extends { id: string }>(store: StoreName, records: T[]): Promise<number> {
  if (!records.length) return 0;
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  records.forEach((record) => objectStore.put(record));
  await transactionDone(tx);
  return records.length;
}

export async function hardDelete(store: StoreName, id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  await requestToPromise(tx.objectStore(store).delete(id));
  await transactionDone(tx);
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  await requestToPromise(tx.objectStore(store).clear());
  await transactionDone(tx);
}

export async function countRecords(store: StoreName): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).count());
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('فشلت عملية الكتابة في قاعدة البيانات'));
    tx.onabort = () => reject(tx.error ?? new Error('أُلغيت عملية الكتابة في قاعدة البيانات'));
  });
}

/* ------------------------------------------------------------------ */
/* الإعدادات                                                          */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'app-settings';

export async function readSettings(): Promise<AppSettings> {
  const stored = await getById<{ id: string; value: AppSettings }>('settings', SETTINGS_KEY);
  if (!stored?.value) return { ...DEFAULT_SETTINGS };
  return mergeSettings(stored.value);
}

export function mergeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const v = value ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    workingHours: { ...DEFAULT_SETTINGS.workingHours, ...(v.workingHours ?? {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(v.thresholds ?? {}) },
    ratingScale: { ...DEFAULT_SETTINGS.ratingScale, ...(v.ratingScale ?? {}) },
    holidays: Array.isArray(v.holidays) ? v.holidays : DEFAULT_SETTINGS.holidays,
    workingDays: Array.isArray(v.workingDays) ? v.workingDays : DEFAULT_SETTINGS.workingDays,
    observationCategories:
      Array.isArray(v.observationCategories) && v.observationCategories.length
        ? v.observationCategories
        : DEFAULT_SETTINGS.observationCategories,
    evaluationCriteria:
      Array.isArray(v.evaluationCriteria) && v.evaluationCriteria.length
        ? v.evaluationCriteria
        : DEFAULT_SETTINGS.evaluationCriteria,
  };
}

export async function writeSettings(settings: AppSettings): Promise<AppSettings> {
  const value = { ...mergeSettings(settings), updatedAt: new Date().toISOString() };
  await putRecord('settings', { id: SETTINGS_KEY, value });
  return value;
}

/* ------------------------------------------------------------------ */
/* بيانات وصفية                                                       */
/* ------------------------------------------------------------------ */

export async function readMeta<T>(key: string): Promise<T | null> {
  const row = await getById<{ id: string; value: T }>('meta', key);
  return row?.value ?? null;
}

export async function writeMeta<T>(key: string, value: T): Promise<void> {
  await putRecord('meta', { id: key, value });
}

/* ------------------------------------------------------------------ */
/* سجل التغييرات                                                      */
/* ------------------------------------------------------------------ */

export async function appendAudit(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }): Promise<void> {
  const db = await getDb();
  const record: AuditEntry = { ...entry, at: entry.at ?? new Date().toISOString() };
  const tx = db.transaction('audit', 'readwrite');
  tx.objectStore('audit').add(record);
  await transactionDone(tx);
}

export async function readAudit(limit = 300): Promise<AuditEntry[]> {
  const db = await getDb();
  const tx = db.transaction('audit', 'readonly');
  const store = tx.objectStore('audit');
  const rows = await requestToPromise(store.getAll() as IDBRequest<AuditEntry[]>);
  return rows
    .filter((r) => !r.isDemo)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

/** تهيئة الإعدادات الافتراضية عند أول تشغيل */
export async function ensureDefaults(): Promise<void> {
  const existing = await getById<{ id: string }>('settings', SETTINGS_KEY);
  if (!existing) await writeSettings({ ...DEFAULT_SETTINGS });
  const seeded = await readMeta<boolean>('seededAt');
  if (!seeded) await writeMeta('seededAt', new Date().toISOString());
}

/** حذف كل البيانات المحلية وإعادة التهيئة */
export async function wipeAllData(): Promise<void> {
  for (const store of STORE_NAMES) {
    if (store === 'settings' || store === 'meta') continue;
    await clearStore(store);
  }
  await clearStore('settings');
  await ensureDefaults();
}

/** توفير مساحة التخزين (إن كان مدعومًا) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}
