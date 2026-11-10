/**
 * ملف النسخة الاحتياطية الخاص بنظام تحليل ترحيل المتأخرات (JSON).
 * يحتوي الأشهر، قوائم العملاء، والمقارنات المحفوظة — وكلها بيانات في ذاكرة الصفحة.
 */
import { BUCKET_IDS } from './delinquency';
import {
  exportDelinquencyData,
  validateDelinquencyBackup,
  type DelinquencyBackup,
} from '../db/delinquencyDb';
import { fileStamp, nowIso } from './utils';

export const BACKUP_APP_ID = 'delinquency-migration-analysis';
export const BACKUP_FORMAT_VERSION = 1;

export interface DelinquencyBackupFile {
  app: typeof BACKUP_APP_ID;
  formatVersion: number;
  exportedAt: string;
  organization: string;
  counts: { months: number; clientLists: number; comparisons: number };
  data: DelinquencyBackup;
}

export async function createBackupFile(organization = ''): Promise<DelinquencyBackupFile> {
  const data = await exportDelinquencyData();
  return {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: nowIso(),
    organization,
    counts: { months: data.months.length, clientLists: data.clientLists.length, comparisons: data.comparisons.length },
    data,
  };
}

export const backupFileName = (date = new Date()): string => `نسخة-احتياطية-تحليل-المتأخرات_${fileStamp(date)}.json`;

export type ParsedBackup =
  | { ok: true; data: DelinquencyBackup; exportedAt: string | null; organization: string }
  | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** فحص بنية كل شهر حتى لا يدخل النظام سجل ناقص يعطّل الحسابات */
function monthProblems(months: unknown[]): string[] {
  const errors: string[] = [];
  months.forEach((row, index) => {
    if (errors.length >= 5 || !isRecord(row)) return;
    const label = `بيانات المتأخرات الشهرية: السجل ${index + 1}`;
    const year = row.year;
    const month = row.month;
    if (typeof year !== 'number' || !Number.isInteger(year) || typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
      errors.push(`${label} بلا شهر أو سنة صحيحين.`);
      return;
    }
    const buckets = row.buckets;
    if (!isRecord(buckets)) {
      errors.push(`${label} بلا بيانات شرائح.`);
      return;
    }
    for (const id of BUCKET_IDS) {
      const cell = buckets[id];
      if (!isRecord(cell) || !isCount(cell.clients) || !isCount(cell.amount)) {
        errors.push(`${label} يحتوي قيمة غير صالحة في إحدى الشرائح.`);
        return;
      }
    }
  });
  return errors;
}

/** يقرأ نص ملف نسخة احتياطية ويتحقق منه قبل أي استعادة */
export function parseBackupFile(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['الملف ليس بصيغة JSON صالحة.'] };
  }
  if (!isRecord(raw)) return { ok: false, errors: ['محتوى الملف غير صالح.'] };

  let data: unknown;
  if (raw.app === BACKUP_APP_ID) {
    if (typeof raw.formatVersion === 'number' && raw.formatVersion > BACKUP_FORMAT_VERSION) {
      return { ok: false, errors: ['هذه النسخة الاحتياطية من إصدار أحدث من النظام ولا يمكن قراءتها هنا.'] };
    }
    data = raw.data;
  } else if (isRecord(raw.delinquency)) {
    // نسخة شاملة سابقة كانت تتضمن قسم «delinquency»
    data = raw.delinquency;
  } else {
    return { ok: false, errors: ['هذا الملف ليس نسخة احتياطية لنظام تحليل ترحيل المتأخرات.'] };
  }

  const errors = validateDelinquencyBackup(data);
  if (!errors.length && isRecord(data) && Array.isArray(data.months)) errors.push(...monthProblems(data.months));
  if (errors.length) return { ok: false, errors };

  const section = data as Partial<DelinquencyBackup>;
  return {
    ok: true,
    data: {
      months: section.months ?? [],
      clientLists: section.clientLists ?? [],
      comparisons: section.comparisons ?? [],
    },
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    organization: typeof raw.organization === 'string' ? raw.organization : '',
  };
}
