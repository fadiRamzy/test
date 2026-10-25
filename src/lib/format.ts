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

/** وقت HH:MM (نظام 24 ساعة داخليًا) → عرض عربي بنظام 12 ساعة: 14:00 → «2 م» · 09:30 → «9:30 ص» */
export function fmtTime(value?: string | null): string {
  if (!value) return '—';
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return value;
  const hours24 = Number(match[1]);
  const minutes = Number(match[2]);
  const period = hours24 < 12 ? 'ص' : 'م';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes ? `${hours12}:${pad(minutes)} ${period}` : `${hours12} ${period}`;
}

/** يقسم وقت HH:MM إلى أجزاء نظام 12 ساعة (تُستخدم في حقل الإدخال) */
export function splitTime12(value?: string | null): { hours: string; minutes: string; period: 'ص' | 'م' } {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((value ?? '').trim());
  if (!match) return { hours: '', minutes: '00', period: 'ص' };
  const hours24 = Number(match[1]);
  return {
    hours: String(hours24 % 12 === 0 ? 12 : hours24 % 12),
    minutes: match[2],
    period: hours24 < 12 ? 'ص' : 'م',
  };
}

/** يجمع أجزاء نظام 12 ساعة في وقت HH:MM (24 ساعة) — ساعة فارغة تعني بلا وقت */
export function joinTime12(hours: string, minutes: string, period: 'ص' | 'م'): string {
  if (!hours) return '';
  const hours12 = Math.min(12, Math.max(1, Number(hours) || 12));
  const mins = Math.min(59, Math.max(0, Number(minutes) || 0));
  const hours24 = (hours12 % 12) + (period === 'م' ? 12 : 0);
  return `${String(hours24).padStart(2, '0')}:${pad(mins)}`;
}

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

/** كلمات عربية صحيحة للمدة: 45 دقيقة · ساعة و12 دقيقة · ساعتان و5 دقائق · 12 ساعة و45 دقيقة */
function minutesWords(value: number): string {
  if (value === 1) return 'دقيقة واحدة';
  if (value === 2) return 'دقيقتان';
  if (value >= 3 && value <= 10) return `${value} دقائق`;
  return `${value} دقيقة`;
}

function hoursWords(value: number): string {
  if (value === 1) return 'ساعة';
  if (value === 2) return 'ساعتان';
  if (value >= 3 && value <= 10) return `${value} ساعات`;
  return `${value} ساعة`;
}

/**
 * مدة بالدقائق → نص عربي مقروء.
 * أقل من 60 دقيقة تُعرض بالدقائق، و60 أو أكثر تُعرض بالساعات والدقائق.
 */
export function fmtDurationWords(minutes?: number | null): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return minutesWords(total);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${hoursWords(hours)} و${minutesWords(mins)}` : hoursWords(hours);
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
