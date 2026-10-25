/** تنسيق عربي للتواريخ والأرقام (أرقام لاتينية للجداول) */

const LOCALE = 'ar-EG-u-nu-latn';
const pad = (n: number) => String(n).padStart(2, '0');

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'long', year: 'numeric', calendar: 'gregory' });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', calendar: 'gregory' });
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

export function toDate(value?: string | number | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const fmtDate = (value?: string | Date | null) => {
  const date = toDate(value);
  return date ? dateFmt.format(date) : '—';
};

export const fmtShortDate = (value?: string | Date | null) => {
  const date = toDate(value);
  return date ? shortDateFmt.format(date) : '—';
};

export const fmtDateTime = (value?: string | Date | null) => {
  const date = toDate(value);
  return date ? dateTimeFmt.format(date) : '—';
};

export const fmtNumber = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : numberFmt.format(value);

export const fmtAvg = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(2);

/** مدة بالدقائق → نص عربي مقروء */
export function fmtDuration(minutes?: number | null): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const abs = Math.round(Math.abs(minutes));
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  const parts: string[] = [];
  if (days) parts.push(`${numberFmt.format(days)} يوم`);
  if (hours) parts.push(`${numberFmt.format(hours)} ساعة`);
  if (mins || !parts.length) parts.push(`${numberFmt.format(mins)} دقيقة`);
  return parts.join(' و');
}

export function fmtDurationShort(minutes?: number | null): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const abs = Math.round(Math.abs(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (!hours) return `${mins}د`;
  return mins ? `${hours}س ${mins}د` : `${hours}س`;
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthName = (month?: number | null) => (!month || month < 1 || month > 12 ? '—' : MONTHS[month - 1]);
export const monthLabel = (year: number, month: number | null) => (month ? `${monthName(month)} ${year}` : `سنة ${year}`);

/** صياغة عربية سليمة للعدد مع الاسم */
export function countNoun(
  count: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  const n = Math.abs(Math.round(count));
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${numberFmt.format(n)} ${forms.few}`;
  return `${numberFmt.format(n)} ${forms.many}`;
}

export const NOUNS = {
  minute: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' },
  visit: { one: 'زيارة واحدة', two: 'زيارتان', few: 'زيارات', many: 'زيارة' },
  observation: { one: 'ملاحظة واحدة', two: 'ملاحظتان', few: 'ملاحظات', many: 'ملاحظة' },
  employee: { one: 'موظف واحد', two: 'موظفان', few: 'موظفون', many: 'موظفًا' },
  report: { one: 'تقرير واحد', two: 'تقريران', few: 'تقارير', many: 'تقريرًا' },
  cycle: { one: 'دورة واحدة', two: 'دورتان', few: 'دورات', many: 'دورة' },
} as const;

/* ------------------------- حقول الإدخال (محلي) -------------------------- */

export function toDateInputValue(value?: string | Date | null): string {
  const date = toDate(value);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

export function toDateTimeInputValue(value?: string | Date | null): string {
  const date = toDate(value);
  return date
    ? `${toDateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    : '';
}

export function fromDateTimeInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const todayInputValue = () => toDateInputValue(new Date());
export const nowDateTimeInputValue = () => toDateTimeInputValue(new Date());
