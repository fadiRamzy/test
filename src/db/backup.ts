import { clearStore, countRecords, getAll, putMany, readSettings, writeSettings, writeMeta } from './database';
import { nowIso } from '../lib/utils';
import {
  ENTITY_LABELS,
  type AppSettings,
  type Employee,
  type EntityName,
  type Evaluation,
  type Minute,
  type Observation,
  type Visit,
} from './schema';

export const BACKUP_APP = 'risk-officer-tracker';
export const BACKUP_FORMAT = 1;

export interface BackupPayload {
  app: string;
  formatVersion: number;
  exportedAt: string;
  counts: Record<EntityName, number>;
  settings: AppSettings;
  data: {
    employees: Employee[];
    minutes: Minute[];
    visits: Visit[];
    observations: Observation[];
    evaluations: Evaluation[];
  };
  checksum?: string;
}

const ENTITIES: EntityName[] = ['employees', 'minutes', 'visits', 'observations', 'evaluations'];

async function checksumOf(data: unknown): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export async function createBackup(): Promise<BackupPayload> {
  const settings = await readSettings();
  const data = {
    employees: await getAll<Employee>('employees'),
    minutes: await getAll<Minute>('minutes'),
    visits: await getAll<Visit>('visits'),
    observations: await getAll<Observation>('observations'),
    evaluations: await getAll<Evaluation>('evaluations'),
  };
  const counts = {} as Record<EntityName, number>;
  for (const entity of ENTITIES) counts[entity] = data[entity].length;
  const checksum = (await checksumOf(data)) ?? undefined;
  return { app: BACKUP_APP, formatVersion: BACKUP_FORMAT, exportedAt: nowIso(), counts, settings, data, checksum };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  payload?: BackupPayload;
  counts?: Record<string, number>;
  exportedAt?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function validateBackup(raw: unknown): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) return { ok: false, errors: ['الملف لا يحتوي على كائن JSON صالح.'], warnings };
  if (raw.app !== BACKUP_APP) errors.push('هذا الملف ليس نسخة احتياطية من هذا النظام.');
  if (typeof raw.formatVersion !== 'number') errors.push('إصدار صيغة النسخة الاحتياطية مفقود.');
  else if (raw.formatVersion > BACKUP_FORMAT) errors.push('النسخة أُنشئت بإصدار أحدث من التطبيق. حدّث التطبيق أولًا.');
  if (!isObject(raw.data)) errors.push('قسم البيانات (data) مفقود أو غير صالح.');

  const data = isObject(raw.data) ? raw.data : {};
  const counts: Record<string, number> = {};

  for (const entity of ENTITIES) {
    const rows = data[entity];
    if (rows === undefined) {
      errors.push(`قسم «${ENTITY_LABELS[entity]}» مفقود.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`قسم «${ENTITY_LABELS[entity]}» يجب أن يكون قائمة.`);
      continue;
    }
    counts[entity] = rows.length;
    const ids = new Set<string>();
    rows.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`${ENTITY_LABELS[entity]}: السجل ${index + 1} غير صالح.`);
        return;
      }
      if (typeof row.id !== 'string' || !row.id) errors.push(`${ENTITY_LABELS[entity]}: السجل ${index + 1} بلا معرّف.`);
      else if (ids.has(row.id)) errors.push(`${ENTITY_LABELS[entity]}: معرّف مكرر (${row.id}).`);
      else ids.add(row.id);
    });
  }

  if (!errors.length) {
    if (typeof raw.checksum === 'string') {
      const expected = await checksumOf(data);
      if (expected && expected !== raw.checksum) errors.push('بصمة التحقق غير مطابقة — الملف قد يكون معدّلًا أو تالفًا.');
    } else {
      warnings.push('لا تحتوي النسخة على بصمة تحقق؛ تم التحقق من البنية فقط.');
    }
    const employeeIds = new Set((data.employees as Employee[]).map((row) => row.id));
    const orphan = (rows: Array<Record<string, unknown>>, field: string, label: string) => {
      const count = rows.filter((row) => row[field] && !employeeIds.has(String(row[field]))).length;
      if (count) warnings.push(`${label}: ${count} سجلًا يشير إلى موظف غير موجود.`);
    };
    orphan(data.minutes as Array<Record<string, unknown>>, 'employeeId', 'دقائق الصرف');
    orphan(data.visits as Array<Record<string, unknown>>, 'employeeId', 'الزيارات');
    orphan(data.observations as Array<Record<string, unknown>>, 'employeeId', 'الملاحظات');
    orphan(data.evaluations as Array<Record<string, unknown>>, 'employeeId', 'التقييمات');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    payload: errors.length === 0 ? (raw as unknown as BackupPayload) : undefined,
    counts,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
  };
}

export interface RestoreResult {
  mode: 'replace' | 'merge';
  imported: Record<string, number>;
  safetyBackup: BackupPayload;
}

/** استعادة مع إنشاء نسخة أمان من البيانات الحالية قبل أي استبدال */
export async function restoreBackup(payload: BackupPayload, mode: 'replace' | 'merge'): Promise<RestoreResult> {
  const validation = await validateBackup(payload);
  if (!validation.ok) throw new Error(validation.errors[0] ?? 'نسخة غير صالحة');

  const safetyBackup = await createBackup();
  await writeMeta('safetyBackupAt', safetyBackup.exportedAt);

  const imported: Record<string, number> = {};
  for (const entity of ENTITIES) {
    const incoming = (payload.data[entity] ?? []) as Array<{ id: string; updatedAt?: string }>;
    if (mode === 'replace') {
      await clearStore(entity);
      await putMany(entity, incoming as never[]);
      imported[entity] = incoming.length;
      continue;
    }
    const existing = await getAll<{ id: string; updatedAt?: string }>(entity);
    const map = new Map(existing.map((row) => [row.id, row]));
    let changed = 0;
    for (const row of incoming) {
      const current = map.get(row.id);
      if (!current || (row.updatedAt ?? '') > (current.updatedAt ?? '')) {
        map.set(row.id, row);
        changed += 1;
      }
    }
    await clearStore(entity);
    await putMany(entity, Array.from(map.values()) as never[]);
    imported[entity] = changed;
  }

  if (payload.settings) await writeSettings(payload.settings);
  await writeMeta('lastRestoreAt', nowIso());
  await writeMeta('lastRestoreMode', mode);
  return { mode, imported, safetyBackup };
}

export async function dataCounts(): Promise<Record<EntityName, number>> {
  const counts = {} as Record<EntityName, number>;
  for (const entity of ENTITIES) counts[entity] = await countRecords(entity);
  return counts;
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `risk-tracker-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}.json`;
}

/** حذف كل البيانات مع إرجاع نسخة أمان */
export async function resetAllData(): Promise<BackupPayload> {
  const safety = await createBackup();
  for (const entity of ENTITIES) await clearStore(entity);
  return safety;
}
