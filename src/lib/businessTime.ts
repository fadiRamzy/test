/**
 * حسابات وقت العمل الفعلي (Business Time).
 * تُحسب المدد داخل ساعات العمل وأيام العمل فقط، مع استثناء العطلات الرسمية.
 * جميع الحسابات بالتوقيت المحلي لجهاز المستخدم.
 */

export interface WorkCalendar {
  workingHours: { start: string; end: string };
  workingDays: number[];
  holidays: Array<{ date: string; name: string }>;
}

export const DEFAULT_CALENDAR: WorkCalendar = {
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4],
  holidays: [],
};

const MS_PER_MINUTE = 60_000;

export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function minutesToTime(value: number): string {
  const h = Math.floor(value / 60) % 24;
  const m = Math.round(value % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** مفتاح اليوم المحلي YYYY-MM-DD */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isHoliday(date: Date, cal: WorkCalendar): boolean {
  const key = dayKey(date);
  return cal.holidays.some((h) => h.date === key);
}

export function isWorkingDay(date: Date, cal: WorkCalendar): boolean {
  if (!cal.workingDays.includes(date.getDay())) return false;
  return !isHoliday(date, cal);
}

/** نافذة العمل لليوم المحدد، أو null إن كان يوم راحة/عطلة */
export function dayWindow(date: Date, cal: WorkCalendar): { start: Date; end: Date } | null {
  if (!isWorkingDay(date, cal)) return null;
  const startMin = timeToMinutes(cal.workingHours.start);
  const endMin = timeToMinutes(cal.workingHours.end);
  if (endMin <= startMin) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, startMin, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, endMin, 0, 0);
  return { start, end };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * عدد دقائق العمل بين لحظتين. يعيد 0 إذا كانت النهاية قبل البداية أو غير صالحة.
 */
export function businessMinutesBetween(
  startInput: string | Date | null | undefined,
  endInput: string | Date | null | undefined,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): number {
  if (!startInput || !endInput) return 0;
  const start = startInput instanceof Date ? startInput : new Date(startInput);
  const end = endInput instanceof Date ? endInput : new Date(endInput);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end.getTime() <= start.getTime()) return 0;

  let total = 0;
  let cursor = startOfDay(start);
  const lastDay = startOfDay(end);
  let guard = 0;
  while (cursor.getTime() <= lastDay.getTime() && guard++ < 4000) {
    const win = dayWindow(cursor, cal);
    if (win) {
      const from = Math.max(start.getTime(), win.start.getTime());
      const to = Math.min(end.getTime(), win.end.getTime());
      if (to > from) total += (to - from) / MS_PER_MINUTE;
    }
    cursor = addDays(cursor, 1);
  }
  return Math.round(total);
}

/**
 * إضافة عدد دقائق عمل إلى لحظة معينة، مع تخطي أيام الراحة والعطلات.
 * إن كانت لحظة البداية خارج ساعات العمل، تُزاح إلى أول وقت عمل متاح.
 */
export function addBusinessMinutes(
  startInput: string | Date,
  minutes: number,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): string {
  const start = startInput instanceof Date ? startInput : new Date(startInput);
  if (Number.isNaN(start.getTime())) return '';
  if (minutes <= 0) return start.toISOString();

  let remaining = minutes;
  let cursor = new Date(start.getTime());
  let guard = 0;

  while (remaining > 0 && guard++ < 4000) {
    const win = dayWindow(cursor, cal);
    if (!win) {
      cursor = startOfDay(addDays(cursor, 1));
      continue;
    }
    if (cursor.getTime() < win.start.getTime()) cursor = new Date(win.start.getTime());
    if (cursor.getTime() >= win.end.getTime()) {
      cursor = startOfDay(addDays(cursor, 1));
      continue;
    }
    const available = (win.end.getTime() - cursor.getTime()) / MS_PER_MINUTE;
    if (available >= remaining) {
      cursor = new Date(cursor.getTime() + remaining * MS_PER_MINUTE);
      remaining = 0;
    } else {
      remaining -= available;
      cursor = startOfDay(addDays(cursor, 1));
    }
  }
  return cursor.toISOString();
}

/** أول لحظة عمل صالحة عند/بعد التاريخ المحدد */
export function nextWorkingMoment(input: string | Date, cal: WorkCalendar = DEFAULT_CALENDAR): string {
  return addBusinessMinutes(input, 0.0001, cal);
}

/** عدد أيام العمل بين تاريخين (شامل البداية والنهاية) */
export function workingDaysBetween(startInput: string | Date, endInput: string | Date, cal: WorkCalendar): number {
  const start = startOfDay(startInput instanceof Date ? startInput : new Date(startInput));
  const end = startOfDay(endInput instanceof Date ? endInput : new Date(endInput));
  if (end < start) return 0;
  let count = 0;
  let cursor = start;
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard++ < 4000) {
    if (isWorkingDay(cursor, cal)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}
