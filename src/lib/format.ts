/** تنسيق التواريخ والأرقام بالعربية مع أرقام لاتينية (الأنسب لجداول مالية) */

const LOCALE = 'ar-EG-u-nu-latn';

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  calendar: 'gregory',
});

const shortDateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  calendar: 'gregory',
});

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  calendar: 'gregory',
});

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const numberFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const numberFmt1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function toDate(value?: string | number | Date | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value?: string | Date | null): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '—';
}

export function fmtShortDate(value?: string | Date | null): string {
  const d = toDate(value);
  return d ? shortDateFmt.format(d) : '—';
}

export function fmtDateTime(value?: string | Date | null): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : '—';
}

export function fmtTime(value?: string | Date | null): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : '—';
}

export function fmtNumber(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberFmt.format(value);
}

export function fmtDecimal(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberFmt1.format(value);
}

export function fmtCurrency(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${numberFmt.format(value)} ج.م`;
}

/** تحويل دقائق إلى صيغة مقروءة عربية */
export function fmtMinutes(totalMinutes?: number | null): string {
  if (totalMinutes === null || totalMinutes === undefined || Number.isNaN(totalMinutes)) return '—';
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.round(Math.abs(totalMinutes));
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const minutes = abs % 60;
  const parts: string[] = [];
  if (days) parts.push(`${numberFmt.format(days)} يوم`);
  if (hours) parts.push(`${numberFmt.format(hours)} ساعة`);
  if (minutes || parts.length === 0) parts.push(`${numberFmt.format(minutes)} دقيقة`);
  return sign + parts.join(' و');
}

export function fmtDurationShort(totalMinutes?: number | null): string {
  if (totalMinutes === null || totalMinutes === undefined || Number.isNaN(totalMinutes)) return '—';
  const abs = Math.round(Math.abs(totalMinutes));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (hours === 0) return `${minutes}د`;
  return minutes === 0 ? `${hours}س` : `${hours}س ${minutes}د`;
}

/**
 * صياغة عربية سليمة للعدد مع الاسم:
 * 0 → «لا يوجد …» أو صيغة الجمع، 1 → مفرد، 2 → مثنى، 3–10 → جمع، 11+ → مفرد منصوب.
 */
export function plural(
  count: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  const n = Math.abs(Math.round(count));
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${numberFmt.format(n)} ${forms.few}`;
  return `${numberFmt.format(n)} ${forms.many}`;
}

const NOUNS = {
  minute: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' },
  visit: { one: 'زيارة واحدة', two: 'زيارتان', few: 'زيارات', many: 'زيارة' },
  observation: { one: 'ملاحظة واحدة', two: 'ملاحظتان', few: 'ملاحظات', many: 'ملاحظة' },
  employee: { one: 'موظف واحد', two: 'موظفان', few: 'موظفون', many: 'موظفًا' },
  report: { one: 'تقرير واحد', two: 'تقريران', few: 'تقارير', many: 'تقريرًا' },
  evaluation: { one: 'تقييم واحد', two: 'تقييمان', few: 'تقييمات', many: 'تقييمًا' },
  branch: { one: 'فرع واحد', two: 'فرعان', few: 'فروع', many: 'فرعًا' },
  day: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا' },
} as const;

export function countNoun(count: number, noun: keyof typeof NOUNS): string {
  return plural(count, NOUNS[noun]);
}

export function fmtPercent(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${numberFmt1.format(value)}%`;
}

const MONTH_NAMES = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export function monthName(month?: number | null): string {
  if (!month || month < 1 || month > 12) return '—';
  return MONTH_NAMES[month - 1];
}

export function monthLabel(year: number, month: number | null): string {
  return month ? `${monthName(month)} ${year}` : `سنة ${year}`;
}

/** YYYY-MM-DD بالتوقيت المحلي */
export function toDateInputValue(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DDTHH:mm بالتوقيت المحلي (لحقول datetime-local) */
export function toDateTimeInputValue(value?: string | Date | null): string {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${toDateInputValue(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function todayInputValue(): string {
  return toDateInputValue(new Date());
}
