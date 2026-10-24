import type { StoreName } from './schema';

/** ترقية هيكل المتاجر والمؤشرات (IndexedDB upgrade) */
export function upgradeSchema(db: IDBDatabase, transaction: IDBTransaction): void {
  const ensure = (
    name: StoreName,
    indexes: Array<{ name: string; keyPath: string; unique?: boolean }>,
    autoIncrement = false,
  ) => {
    const store = db.objectStoreNames.contains(name)
      ? transaction.objectStore(name)
      : db.createObjectStore(name, { keyPath: 'id', autoIncrement });
    for (const index of indexes) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
      }
    }
  };

  ensure('employees', [
    { name: 'employeeCode', keyPath: 'employeeCode', unique: true },
    { name: 'branchId', keyPath: 'branchId' },
    { name: 'status', keyPath: 'status' },
    { name: 'deletedAt', keyPath: 'deletedAt' },
  ]);
  ensure('branches', [
    { name: 'code', keyPath: 'code', unique: true },
    { name: 'deletedAt', keyPath: 'deletedAt' },
  ]);
  ensure('minutes', [
    { name: 'employeeId', keyPath: 'employeeId' },
    { name: 'branchId', keyPath: 'branchId' },
    { name: 'receivedAt', keyPath: 'receivedAt' },
    { name: 'status', keyPath: 'status' },
    { name: 'deletedAt', keyPath: 'deletedAt' },
  ]);
  ensure('visits', [
    { name: 'employeeId', keyPath: 'employeeId' },
    { name: 'branchId', keyPath: 'branchId' },
    { name: 'visitDate', keyPath: 'visitDate' },
    { name: 'deletedAt', keyPath: 'deletedAt' },
  ]);
  ensure('observations', [
    { name: 'employeeId', keyPath: 'employeeId' },
    { name: 'branchId', keyPath: 'branchId' },
    { name: 'visitId', keyPath: 'visitId' },
    { name: 'minuteId', keyPath: 'minuteId' },
    { name: 'date', keyPath: 'date' },
    { name: 'status', keyPath: 'status' },
    { name: 'deletedAt', keyPath: 'deletedAt' },
  ]);
  ensure('evaluations', [
    { name: 'employeeId', keyPath: 'employeeId' },
    { name: 'period', keyPath: 'periodKey' },
    { name: 'deletedAt', keyPath: 'deletedAt' },
  ]);
  ensure('audit', [{ name: 'at', keyPath: 'at' }, { name: 'entity', keyPath: 'entity' }], true);
  ensure('settings', []);
  ensure('meta', []);
}

/** ترقيات البيانات (Data migrations) — تُنفّذ مرة واحدة لكل إصدار */
export interface DataMigration {
  version: number;
  description: string;
  up: (db: IDBDatabase) => Promise<void>;
}

function readAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function writeAll(db: IDBDatabase, store: StoreName, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!rows.length) return resolve();
    const transaction = db.transaction(store, 'readwrite');
    const objectStore = transaction.objectStore(store);
    rows.forEach((row) => objectStore.put(row));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const DATA_MIGRATIONS: DataMigration[] = [
  {
    version: 2,
    description: 'ضمان وجود مصفوفات دورات المراجعة والمتابعات',
    up: async (db) => {
      const visits = await readAll<{ id: string; reviewCycles?: unknown }>(db, 'visits');
      const patched = visits
        .filter((v) => !Array.isArray(v.reviewCycles))
        .map((v) => ({ ...v, reviewCycles: [] }));
      await writeAll(db, 'visits', patched);

      const observations = await readAll<{ id: string; followUps?: unknown }>(db, 'observations');
      const patchedObs = observations
        .filter((o) => !Array.isArray(o.followUps))
        .map((o) => ({ ...o, followUps: [] }));
      await writeAll(db, 'observations', patchedObs);
    },
  },
  {
    version: 3,
    description: 'إضافة مفتاح الفترة للتقييمات وتوحيد القيم القديمة',
    up: async (db) => {
      const evaluations = await readAll<Record<string, unknown>>(db, 'evaluations');
      const patched = evaluations.map((e) => ({
        ...e,
        periodKey: `${e.periodType === 'annual' ? 'annual' : 'monthly'}-${e.year}-${e.month ?? 0}`,
        comments: (e.comments as Record<string, string>) ?? {},
        scores: (e.scores as Record<string, number | null>) ?? {},
      }));
      await writeAll(db, 'evaluations', patched);
    },
  },
];
