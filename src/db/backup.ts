import { clearStore, countRecords, getAll, putMany, readSettings, writeSettings, writeMeta } from './database';
import { nowIso } from '../lib/utils';
import {
  ENTITY_LABELS,
  type AnnualNote,
  type AppSettings,
  type DailyMinute,
  type Employee,
  type EntityName,
  type FieldVisit,
  type Leave,
  type MonthlyEvaluation,
  type Observation,
  type VisitTiming,
} from './schema';

export const BACKUP_APP = 'risk-officer-suite';
export const BACKUP_FORMAT = 1;

export const ENTITIES: EntityName[] = [
  'employees',
  'monthlyEvaluations',
  'fieldVisits',
  'minutes',
  'visitTimings',
  'observations',
  'leaves',
  'annualNotes',
];

export interface BackupData {
  employees: Employee[];
  monthlyEvaluations: MonthlyEvaluation[];
  fieldVisits: FieldVisit[];
  minutes: DailyMinute[];
  visitTimings: VisitTiming[];
  observations: Observation[];
  leaves: Leave[];
  annualNotes: AnnualNote[];
}

export interface BackupPayload {
  app: string;
  formatVersion: number;
  exportedAt: string;
  counts: Record<EntityName, number>;
  settings: AppSettings;
  data: BackupData;
}

export async function createBackup(): Promise<BackupPayload> {
  const settings = await readSettings();
  const data: BackupData = {
    employees: await getAll<Employee>('employees'),
    monthlyEvaluations: await getAll<MonthlyEvaluation>('monthlyEvaluations'),
    fieldVisits: await getAll<FieldVisit>('fieldVisits'),
    minutes: await getAll<DailyMinute>('minutes'),
    visitTimings: await getAll<VisitTiming>('visitTimings'),
    observations: await getAll<Observation>('observations'),
    leaves: await getAll<Leave>('leaves'),
    annualNotes: await getAll<AnnualNote>('annualNotes'),
  };
  const counts = {} as Record<EntityName, number>;
  for (const entity of ENTITIES) counts[entity] = data[entity].length;
  return { app: BACKUP_APP, formatVersion: BACKUP_FORMAT, exportedAt: nowIso(), counts, settings, data };
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

export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(raw)) return { ok: false, errors: ['الملف لا يحتوي على كائن JSON صالح.'], warnings };
  if (raw.app !== BACKUP_APP) errors.push('هذا الملف ليس نسخة احتياطية من هذا النظام.');
  if (typeof raw.formatVersion !== 'number') errors.push('إصدار صيغة النسخة الاحتياطية مفقود.');
  else if (raw.formatVersion > BACKUP_FORMAT) errors.push('النسخة أُنشئت بإصدار أحدث من التطبيق.');
  if (!isObject(raw.data)) errors.push('قسم البيانات (data) مفقود أو غير صالح.');

  const data = isObject(raw.data) ? raw.data : {};
  const counts: Record<string, number> = {};

  for (const entity of ENTITIES) {
    const rows = data[entity];
    if (!Array.isArray(rows)) {
      // النسخ الاحتياطية الأقدم من إضافة «توقيت الزيارات» تُقبل بقسم فارغ
      if (entity === 'visitTimings') {
        counts[entity] = 0;
        warnings.push('النسخة لا تحتوي قسم «توقيت الزيارات» — سيُستورد فارغًا.');
        continue;
      }
      errors.push(`قسم «${ENTITY_LABELS[entity]}» مفقود أو ليس قائمة.`);
      continue;
    }
    counts[entity] = rows.length;
    const ids = new Set<string>();
    rows.forEach((row, index) => {
      if (!isObject(row) || typeof row.id !== 'string' || !row.id) {
        errors.push(`${ENTITY_LABELS[entity]}: السجل ${index + 1} غير صالح.`);
        return;
      }
      if (ids.has(row.id)) errors.push(`${ENTITY_LABELS[entity]}: معرّف مكرر (${row.id}).`);
      ids.add(row.id);
    });
  }

  if (!errors.length) {
    const employeeIds = new Set((data.employees as Employee[]).map((row) => row.id));
    for (const entity of ENTITIES.filter((name) => name !== 'employees')) {
      const orphan = (data[entity] as Array<{ employeeId?: string }>).filter(
        (row) => row.employeeId && !employeeIds.has(row.employeeId),
      ).length;
      if (orphan) warnings.push(`${ENTITY_LABELS[entity]}: ${orphan} سجلًا يشير إلى موظف غير موجود.`);
    }
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

export async function restoreBackup(payload: BackupPayload, mode: 'replace' | 'merge'): Promise<RestoreResult> {
  const validation = validateBackup(payload);
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
  return { mode, imported, safetyBackup };
}

export async function dataCounts(): Promise<Record<EntityName, number>> {
  const counts = {} as Record<EntityName, number>;
  for (const entity of ENTITIES) counts[entity] = await countRecords(entity);
  return counts;
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `risk-suite-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}.json`;
}

/** حذف كل البيانات بعد أخذ نسخة أمان */
export async function resetAllData(): Promise<BackupPayload> {
  const safety = await createBackup();
  for (const entity of ENTITIES) await clearStore(entity);
  return safety;
}
