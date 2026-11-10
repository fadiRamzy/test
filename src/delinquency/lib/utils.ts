/**
 * أدوات عامة صغيرة خاصة بنظام تحليل ترحيل المتأخرات.
 * النظام مستقل تمامًا: لا يستورد أي ملف من خارج مجلد src/delinquency.
 */

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** تنزيل ملف (نصي أو ثنائي) من المتصفح مباشرة دون أي خادم */
export function downloadBlob(filename: string, data: Blob | string | Uint8Array | ArrayBuffer, type = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('فشل قراءة الملف'));
    reader.readAsText(file, 'utf-8');
  });
}

const LOCALE = 'ar-EG-u-nu-latn';

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  calendar: 'gregory',
});
const numberFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

export const fmtDateTime = (value?: string | Date | null): string => {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
};

/** صياغة عربية سليمة للعدد مع الاسم (مفرد / مثنى / جمع / تمييز) */
export function countNoun(count: number, forms: { one: string; two: string; few: string; many: string }): string {
  const n = Math.abs(Math.round(count));
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${numberFmt.format(n)} ${forms.few}`;
  return `${numberFmt.format(n)} ${forms.many}`;
}

/** ختم زمني مناسب لأسماء الملفات: 2026-11-10_0915 */
export function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

type NounForms = { zero: string; one: string; two: string; few: string; many: string };

const withZero = (forms: NounForms) => (count: number): string => (Math.round(count) === 0 ? forms.zero : countNoun(count, forms));

/** «5 أشهر» · «شهران» · «12 شهرًا» · «لا أشهر» */
export const monthsNoun = withZero({ zero: 'لا أشهر', one: 'شهر واحد', two: 'شهران', few: 'أشهر', many: 'شهرًا' });
export const clientListsNoun = withZero({
  zero: 'لا قوائم عملاء',
  one: 'قائمة عملاء واحدة',
  two: 'قائمتا عملاء',
  few: 'قوائم عملاء',
  many: 'قائمة عملاء',
});
export const comparisonsNoun = withZero({
  zero: 'لا مقارنات محفوظة',
  one: 'مقارنة محفوظة واحدة',
  two: 'مقارنتان محفوظتان',
  few: 'مقارنات محفوظة',
  many: 'مقارنة محفوظة',
});
