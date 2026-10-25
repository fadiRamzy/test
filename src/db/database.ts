import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_SETTINGS,
  STORE_NAMES,
  type AppSettings,
  type StoreName,
} from './schema';

/**
 * طبقة IndexedDB. لا يوجد خادم ولا مزامنة: كل البيانات محلية في هذا المتصفح فقط.
 */

let dbPromise: Promise<IDBDatabase> | null = null;
let currentName = DB_NAME;

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

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('فشلت عملية على قاعدة البيانات'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('فشلت الكتابة في قاعدة البيانات'));
    tx.onabort = () => reject(tx.error ?? new Error('أُلغيت الكتابة في قاعدة البيانات'));
  });
}

export function openDatabase(name = currentName): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new StorageUnavailableError('التخزين المحلي (IndexedDB) غير متاح في هذا المتصفح.'));
  }
  if (dbPromise && name === currentName) return dbPromise;
  currentName = name;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const create = (store: StoreName, indexes: string[] = []) => {
        const objectStore = db.objectStoreNames.contains(store)
          ? request.transaction!.objectStore(store)
          : db.createObjectStore(store, { keyPath: 'id' });
        indexes.forEach((index) => {
          if (!objectStore.indexNames.contains(index)) objectStore.createIndex(index, index, { unique: false });
        });
      };
      create('employees', ['code', 'sector', 'governorate', 'serial']);
      create('minutes', ['employeeId', 'receivedAt', 'status']);
      create('visits', ['employeeId', 'status']);
      create('observations', ['employeeId', 'date', 'type', 'status', 'minuteId', 'visitId']);
      create('evaluations', ['employeeId', 'year']);
      create('settings');
      create('meta');
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذّر فتح قاعدة البيانات المحلية'));
    request.onblocked = () => reject(new Error('قاعدة البيانات مفتوحة في تبويب آخر — أغلق التبويبات الأخرى.'));
  });

  return dbPromise;
}

export async function getDb(): Promise<IDBDatabase> {
  return dbPromise ?? openDatabase();
}

/** استخدام قاعدة بيانات مخصصة (للاختبارات) */
export async function useDatabase(name: string): Promise<void> {
  const existing = await dbPromise?.catch(() => null);
  existing?.close();
  dbPromise = null;
  await openDatabase(name);
  await ensureSettings();
}

export async function closeDatabase(): Promise<void> {
  const db = await dbPromise?.catch(() => null);
  db?.close();
  dbPromise = null;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDb();
  return req(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getById<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await getDb();
  return req(db.transaction(store, 'readonly').objectStore(store).get(id) as IDBRequest<T | undefined>);
}

export async function putRecord<T extends { id: string }>(store: StoreName, record: T): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  await req(tx.objectStore(store).put(record));
  await txDone(tx);
  return record;
}

export async function putMany<T extends { id: string }>(store: StoreName, records: T[]): Promise<void> {
  if (!records.length) return;
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  records.forEach((record) => tx.objectStore(store).put(record));
  await txDone(tx);
}

export async function deleteRecord(store: StoreName, id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  await req(tx.objectStore(store).delete(id));
  await txDone(tx);
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  await req(tx.objectStore(store).clear());
  await txDone(tx);
}

export async function countRecords(store: StoreName): Promise<number> {
  const db = await getDb();
  return req(db.transaction(store, 'readonly').objectStore(store).count());
}

/* -------------------------------- الإعدادات ----------------------------- */

const SETTINGS_ID = 'app-settings';

export function mergeSettings(value?: Partial<AppSettings>): AppSettings {
  const v = value ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    sectors: Array.isArray(v.sectors) && v.sectors.length ? v.sectors : DEFAULT_SETTINGS.sectors,
    governorates: Array.isArray(v.governorates) && v.governorates.length ? v.governorates : DEFAULT_SETTINGS.governorates,
    observationTypes:
      Array.isArray(v.observationTypes) && v.observationTypes.length ? v.observationTypes : DEFAULT_SETTINGS.observationTypes,
    deadlineMinutes: Number(v.deadlineMinutes) > 0 ? Number(v.deadlineMinutes) : DEFAULT_SETTINGS.deadlineMinutes,
  };
}

export async function readSettings(): Promise<AppSettings> {
  const row = await getById<{ id: string; value: AppSettings }>('settings', SETTINGS_ID);
  return mergeSettings(row?.value);
}

export async function writeSettings(settings: AppSettings): Promise<AppSettings> {
  const value = { ...mergeSettings(settings), updatedAt: new Date().toISOString() };
  await putRecord('settings', { id: SETTINGS_ID, value });
  return value;
}

export async function ensureSettings(): Promise<void> {
  const row = await getById<{ id: string }>('settings', SETTINGS_ID);
  if (!row) await writeSettings({ ...DEFAULT_SETTINGS });
}

/* ------------------------------ بيانات وصفية ---------------------------- */

export async function readMeta<T>(key: string): Promise<T | null> {
  const row = await getById<{ id: string; value: T }>('meta', key);
  return row?.value ?? null;
}

export async function writeMeta<T>(key: string, value: T): Promise<void> {
  await putRecord('meta', { id: key, value });
}

export async function wipeAllData(): Promise<void> {
  for (const store of STORE_NAMES) {
    if (store === 'settings' || store === 'meta') continue;
    await clearStore(store);
  }
  await clearStore('settings');
  await ensureSettings();
  await clearStore('meta');
}
