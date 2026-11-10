/**
 * تحديد الشهرين المعروضين في لوحة المقارنة، وشهري تقرير Excel، وتنزيل التقرير.
 */
import type { Notify } from '../ui/toast';
import { snapshotPeriod, type MonthlySnapshot } from './delinquency';
import { buildDelinquencyXlsx, delinquencyFileName } from './delinquencyExcel';
import { errorMessage } from './errors';
import { downloadBlob } from './utils';
import { XLSX_MIME } from './xlsx';

export interface Selection {
  branch: string | null;
  aId: string | null;
  bId: string | null;
}

/**
 * يحدد الفرع والشهرين المعروضين: اختيار المستخدم إن وُجد، وإلا فرع أحدث شهر مُدخل
 * وآخر شهرين له (الأقدم = الشهر السابق).
 */
export function resolveSelection(snapshots: MonthlySnapshot[], selection: Selection) {
  const branches = Array.from(new Set(snapshots.map((snapshot) => snapshot.branch))).sort((x, y) => x.localeCompare(y, 'ar'));
  const branch =
    selection.branch !== null && branches.includes(selection.branch)
      ? selection.branch
      : snapshots.length
        ? snapshots[snapshots.length - 1].branch
        : '';
  const months = snapshots.filter((snapshot) => snapshot.branch === branch);
  const b = months.find((month) => month.id === selection.bId) ?? months[months.length - 1] ?? null;
  const a = months.find((month) => month.id === selection.aId) ?? (b ? [...months].reverse().find((month) => month.id !== b.id) ?? null : null);
  return { branches, branch, months, a, b, ready: Boolean(a && b && a.id !== b.id) };
}

/**
 * شهرا تقرير Excel: الشهران المختاران في لوحة المقارنة إن كانا جاهزين،
 * وإلا آخر شهرين مُدخلين في النظام كله (أو الشهر الوحيد المتاح).
 */
export function reportPeriods(snapshots: MonthlySnapshot[], selection: Selection): { current: MonthlySnapshot; previous: MonthlySnapshot | null } | null {
  if (!snapshots.length) return null;
  const picked = resolveSelection(snapshots, selection);
  if (picked.ready && picked.a && picked.b) return { current: picked.b, previous: picked.a };
  const current = snapshots[snapshots.length - 1];
  const currentPeriod = snapshotPeriod(current);
  const previous = [...snapshots].reverse().find((snapshot) => snapshotPeriod(snapshot) < currentPeriod) ?? null;
  return { current, previous };
}

/** ينزّل تقرير Excel (كل الفروع) للشهرين المحددين */
export function exportReport(
  snapshots: MonthlySnapshot[],
  current: MonthlySnapshot,
  previous: MonthlySnapshot | null,
  organization: string,
  notify: Notify,
): void {
  try {
    const bytes = buildDelinquencyXlsx({ snapshots, current, previous, organization });
    downloadBlob(delinquencyFileName(current, previous), bytes, XLSX_MIME);
    notify('تم تنزيل ملف Excel.', 'success');
  } catch (cause) {
    notify(errorMessage(cause), 'error');
  }
}
