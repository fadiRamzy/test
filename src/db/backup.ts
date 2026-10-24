import {
  clearStore,
  countRecords,
  getAll,
  getById,
  putMany,
  readMeta,
  readSettings,
  writeMeta,
  writeSettings,
} from './database';
import { nowIso } from '../lib/utils';
import type {
  AppSettings,
  Branch,
  DisbursementMinute,
  Employee,
  EntityName,
  Evaluation,
  FieldVisit,
  Observation,
} from './schema';
import { ENTITY_LABELS, STORE_NAMES } from './schema';

export const BACKUP_APP_ID = 'risk-officer-management-system';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 3;

export interface BackupPayload {
  app: string;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  organizationName?: string;
  counts: Record<string, number>;
  settings: AppSettings;
  data: {
    employees: Employee[];
    branches: Branch[];
    minutes: DisbursementMinute[];
    visits: FieldVisit[];
    observations: Observation[];
    evaluations: Evaluation[];
  };
  checksum?: string;
}

const ENTITIES: EntityName[] = ['branches', 'employees', 'minutes', 'visits', 'observations', 'evaluations'];

async function sha256(text: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** إنشاء نسخة احتياطية كاملة من كل البيانات المحلية */
export async function createBackup(): Promise<BackupPayload> {
  const settings = await readSettings();
  const data = {
    employees: await getAll<Employee>('employees'),
    branches: await getAll<Branch>('branches'),
    minutes: await getAll<DisbursementMinute>('minutes'),
    visits: await getAll<FieldVisit>('visits'),
    observations: await getAll<Observation>('observations'),
    evaluations: await getAll<Evaluation>('evaluations'),
  };
  const counts: Record<string, number> = {};
  for (const entity of ENTITIES) counts[entity] = data[entity].length;

  const payload: BackupPayload = {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: nowIso(),
    organizationName: settings.organizationName,
    counts,
    settings,
    data,
  };
  const checksum = await sha256(JSON.stringify(data));
  if (checksum) payload.checksum = checksum;
  return payload;
}

export interface BackupValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  payload?: BackupPayload;
  summary?: { counts: Record<string, number>; exportedAt: string };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** التحقق من سلامة النسخة الاحتياطية قبل الاستعادة */
export async function validateBackup(raw: unknown): Promise<BackupValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: ['الملف لا يحتوي على كائن JSON صالح.'], warnings };
  }
  if (raw.app !== BACKUP_APP_ID) errors.push('هذا الملف ليس نسخة احتياطية من نظام إدارة ضباط المخاطر.');
  if (typeof raw.formatVersion !== 'number') errors.push('رقم إصدار صيغة النسخة الاحتياطية مفقود.');
  if (typeof raw.formatVersion === 'number' && raw.formatVersion > BACKUP_FORMAT_VERSION)
    errors.push('النسخة الاحتياطية أُنشئت بإصدار أحدث من التطبيق. حدّث التطبيق أولًا.');
  if (!isObject(raw.data)) errors.push('قسم البيانات (data) مفقود أو غير صالح.');

  const data = isObject(raw.data) ? raw.data : {};
  const counts: Record<string, number> = {};

  for (const entity of ENTITIES) {
    const rows = data[entity];
    if (rows === undefined) {
      errors.push(`قسم «${ENTITY_LABELS[entity]}» مفقود من النسخة الاحتياطية.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`قسم «${ENTITY_LABELS[entity]}» يجب أن يكون مصفوفة.`);
      continue;
    }
    counts[entity] = rows.length;
    const ids = new Set<string>();
    rows.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`${ENTITY_LABELS[entity]}: السجل رقم ${index + 1} غير صالح.`);
        return;
      }
      if (typeof row.id !== 'string' || !row.id) {
        errors.push(`${ENTITY_LABELS[entity]}: السجل رقم ${index + 1} بلا معرّف.`);
      } else if (ids.has(row.id)) {
        errors.push(`${ENTITY_LABELS[entity]}: معرّف مكرر (${row.id}).`);
      } else {
        ids.add(row.id);
      }
    });
  }

  if (errors.length === 0) {
    // تحقق مرجعي (تحذيرات فقط — لا يمنع الاستعادة)
    const employeeIds = new Set((data.employees as Employee[]).map((e) => e.id));
    const branchIds = new Set((data.branches as Branch[]).map((b) => b.id));
    const checkRefs = (rows: Array<Record<string, unknown>>, field: string, set: Set<string>, label: string) => {
      const orphans = rows.filter((r) => r[field] && !set.has(String(r[field])));
      if (orphans.length) warnings.push(`${label}: ${orphans.length} سجل يشير إلى عنصر غير موجود.`);
    };
    checkRefs(data.minutes as Array<Record<string, unknown>>, 'employeeId', employeeIds, 'دقائق الصرف');
    checkRefs(data.visits as Array<Record<string, unknown>>, 'employeeId', employeeIds, 'الزيارات');
    checkRefs(data.observations as Array<Record<string, unknown>>, 'employeeId', employeeIds, 'الملاحظات');
    checkRefs(data.evaluations as Array<Record<string, unknown>>, 'employeeId', employeeIds, 'التقييمات');
    checkRefs(data.employees as Array<Record<string, unknown>>, 'branchId', branchIds, 'الموظفون');
    checkRefs(data.minutes as Array<Record<string, unknown>>, 'branchId', branchIds, 'دقائق الصرف');

    if (typeof raw.checksum === 'string') {
      const expected = await sha256(JSON.stringify(data));
      if (expected && expected !== raw.checksum) {
        errors.push('بصمة التحقق (checksum) لا تطابق البيانات — الملف قد يكون تالفًا أو معدّلًا.');
      }
    } else {
      warnings.push('النسخة الاحتياطية لا تحتوي على بصمة تحقق؛ تم التحقق من البنية فقط.');
    }
  }

  if (errors.length) return { ok: false, errors, warnings, summary: { counts, exportedAt: String(raw.exportedAt ?? '') } };

  return {
    ok: true,
    errors,
    warnings,
    payload: raw as unknown as BackupPayload,
    summary: { counts, exportedAt: String(raw.exportedAt ?? '') },
  };
}

export interface RestoreResult {
  mode: 'replace' | 'merge';
  imported: Record<string, number>;
  safetyBackup: BackupPayload | null;
}

/**
 * استعادة نسخة احتياطية. تُنشأ نسخة أمان من البيانات الحالية قبل أي استبدال.
 * merge: يدمج بالسجلات (الأحدث updatedAt يفوز). replace: يستبدل كل البيانات.
 */
export async function restoreBackup(
  payload: BackupPayload,
  mode: 'replace' | 'merge' = 'replace',
): Promise<RestoreResult> {
  const validation = await validateBackup(payload);
  if (!validation.ok) {
    throw Object.assign(new Error('نسخة احتياطية غير صالحة'), { errors: validation.errors });
  }

  const safetyBackup = await createBackup();
  await writeMeta('safetyBackupAt', safetyBackup.exportedAt);

  const imported: Record<string, number> = {};

  for (const entity of ENTITIES) {
    const incoming = (payload.data[entity] ?? []) as Array<{ id: string; updatedAt?: string }>;
    if (mode === 'replace') {
      await clearStore(entity);
      await putMany(entity, incoming as never[]);
      imported[entity] = incoming.length;
    } else {
      const existingRows = await getAll<{ id: string; updatedAt?: string }>(entity);
      const map = new Map(existingRows.map((r) => [r.id, r]));
      let count = 0;
      for (const row of incoming) {
        const current = map.get(row.id);
        if (!current) {
          map.set(row.id, row);
          count += 1;
        } else if ((row.updatedAt ?? '') > (current.updatedAt ?? '')) {
          map.set(row.id, row);
          count += 1;
        }
      }
      await clearStore(entity);
      await putMany(entity, Array.from(map.values()) as never[]);
      imported[entity] = count;
    }
  }

  if (payload.settings) await writeSettings(payload.settings);
  await writeMeta('lastRestoreAt', nowIso());
  await writeMeta('lastRestoreMode', mode);

  return { mode, imported, safetyBackup };
}

/** نسخة الأمان المحفوظة محليًا (إن وجدت) */
export async function getSafetyBackupInfo(): Promise<{ at: string | null }> {
  return { at: await readMeta<string>('safetyBackupAt') };
}

export async function dataCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entity of ENTITIES) counts[entity] = await countRecords(entity);
  return counts;
}

export async function hasAnyData(): Promise<boolean> {
  const counts = await dataCounts();
  return Object.values(counts).some((c) => c > 0);
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `risk-officers-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}.json`;
}

/** حذف كل البيانات وإعادة التهيئة (بعد نسخة أمان) */
export async function resetAllWithSafetyBackup(): Promise<BackupPayload> {
  const safety = await createBackup();
  for (const entity of ENTITIES) await clearStore(entity);
  for (const store of STORE_NAMES) {
    if (store === 'audit' || store === 'settings' || store === 'meta') continue;
  }
  await writeMeta('lastResetAt', nowIso());
  return safety;
}

export async function readStoredSetting<T>(key: string): Promise<T | null> {
  const row = await getById<{ id: string; value: T }>('settings', key);
  return row?.value ?? null;
}
