import {
  EVALUATION_CRITERIA,
  MONTHS_AR,
  SCORE_MAX,
  SCORE_MIN,
  type CriterionId,
  type CriterionScores,
  type DisbursementMinute,
  type Employee,
  type FieldVisit,
  type Leave,
  type MonthlyEvaluation,
  type Observation,
  type RatingThreshold,
} from '../db/schema';

/* ------------------------- التقييم الشهري ----------------------------- */

export interface MonthlyTotals {
  /** مجموع الدرجات الثمانية المسجلة */
  scoresSum: number;
  /** عدد المعايير المسجلة */
  scoredCount: number;
  /** عدد الزيارات كما أُدخل */
  visits: number;
  /**
   * إجمالي نقاط الشهر حسب معادلة الملف:
   * مجموع الدرجات الثمانية + عدد الزيارات
   */
  total: number;
  /** هل سُجلت كل المعايير الثمانية والزيارات؟ */
  complete: boolean;
  missing: CriterionId[];
}

/**
 * معادلة الإكسل الأصلية: إجمالي الشهر = عدد الزيارات + مجموع درجات المعايير الثمانية.
 * لا أوزان ولا معاملات إضافية.
 */
export function monthlyTotals(scores: CriterionScores | undefined, visits: number | null | undefined): MonthlyTotals {
  let sum = 0;
  let count = 0;
  const missing: CriterionId[] = [];

  for (const criterion of EVALUATION_CRITERIA) {
    const raw = scores?.[criterion.id];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    if (value === null) missing.push(criterion.id);
    else {
      sum += value;
      count += 1;
    }
  }

  const visitCount = typeof visits === 'number' && Number.isFinite(visits) ? visits : 0;

  return {
    scoresSum: sum,
    scoredCount: count,
    visits: visitCount,
    total: sum + visitCount,
    complete: missing.length === 0,
    missing,
  };
}

export function isScoreValid(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= SCORE_MIN && value <= SCORE_MAX;
}

/* ------------------------- التقييم السنوي ----------------------------- */

export function ratingFor(points: number | null, thresholds: RatingThreshold[]): string | null {
  if (points === null || !Number.isFinite(points)) return null;
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const threshold of sorted) {
    if (points >= threshold.min) return threshold.label;
  }
  return sorted.length ? sorted[sorted.length - 1].label : null;
}

/** عدد أشهر الخدمة من تاريخ التعيين حتى نهاية السنة المختارة (أو حتى اليوم لو كانت السنة الحالية) */
export function employmentMonths(employmentDate: string, year: number, now: Date = new Date()): number | null {
  if (!employmentDate) return null;
  const start = new Date(employmentDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = year === now.getFullYear() ? now : new Date(year, 11, 31);
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  return Math.max(0, months);
}

export interface AnnualSummary {
  year: number;
  /** مجموع الزيارات من الشهور المسجلة */
  visits: number;
  /** مجموع نقاط الشهور المسجلة */
  points: number;
  /** الشهور التي فيها تقييم فعلي */
  evaluatedMonths: number[];
  /** الشهور الناقصة داخل نطاق السنة */
  missingMonths: number[];
  /** التقييم = عتبات الملف على مجموع النقاط */
  rating: string | null;
  employmentMonths: number | null;
  /** هل الشهور المكتملة (كل المعايير مسجلة) */
  completeMonths: number[];
  incompleteMonths: number[];
}

export function annualSummary(
  evaluations: MonthlyEvaluation[],
  employee: Employee,
  year: number,
  thresholds: RatingThreshold[],
  now: Date = new Date(),
): AnnualSummary {
  const forYear = evaluations.filter((row) => row.employeeId === employee.id && row.year === year);
  const byMonth = new Map<number, MonthlyEvaluation>();
  for (const row of forYear) byMonth.set(row.month, row);

  const evaluatedMonths: number[] = [];
  const missingMonths: number[] = [];
  const completeMonths: number[] = [];
  const incompleteMonths: number[] = [];
  let visits = 0;
  let points = 0;

  // نطاق الشهور: كل شهور السنة للسنوات السابقة، وحتى الشهر الحالي للسنة الجارية
  const lastMonth = year < now.getFullYear() ? 12 : year === now.getFullYear() ? now.getMonth() + 1 : 0;

  for (let month = 1; month <= lastMonth; month += 1) {
    const row = byMonth.get(month);
    if (!row) {
      missingMonths.push(month);
      continue;
    }
    evaluatedMonths.push(month);
    const totals = monthlyTotals(row.scores, row.visits);
    visits += totals.visits;
    points += totals.total;
    if (totals.complete) completeMonths.push(month);
    else incompleteMonths.push(month);
  }

  const hasEvaluation = evaluatedMonths.length > 0;
  return {
    year,
    visits,
    points,
    evaluatedMonths,
    missingMonths,
    completeMonths,
    incompleteMonths,
    // لا يُحسب تصنيف لمن لم يُقيَّم أي شهر — لا نعتبر الشهور الناقصة أصفارًا
    rating: hasEvaluation ? ratingFor(points, thresholds) : null,
    employmentMonths: employmentMonths(employee.employmentDate, year, now),
  };
}

export function monthsLabel(months: number[]): string {
  if (!months.length) return '—';
  return months.map((month) => MONTHS_AR[month - 1]).join('، ');
}

/* ------------------------- الزيارات الميدانية ------------------------- */

export interface VisitMonthlySummary {
  /** عدد الزيارات لكل شهر (1..12) */
  byMonth: number[];
  total: number;
}

export function visitsByMonth(visits: FieldVisit[], year: number, employeeId?: string, region?: string): VisitMonthlySummary {
  const byMonth = new Array(12).fill(0) as number[];
  for (const visit of visits) {
    if (!visit.visitDate) continue;
    if (employeeId && visit.employeeId !== employeeId) continue;
    if (region && visit.region !== region) continue;
    const date = new Date(visit.visitDate);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year) continue;
    if (visit.status === 'cancelled') continue;
    byMonth[date.getMonth()] += 1;
  }
  return { byMonth, total: byMonth.reduce((a, b) => a + b, 0) };
}

/* --------------------------- الأوقات والمدد ---------------------------- */

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** يحوّل وقت HH:MM إلى عدد دقائق من منتصف الليل، أو null إذا كان غير صالح */
export function parseTimeToMinutes(value?: string | null): number | null {
  if (!value) return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * فرق بالدقائق بين وقتين HH:MM في نفس اليوم.
 * يعيد null إذا كان أي وقت مفقودًا/غير صالح أو كان الفرق سالبًا.
 */
export function timeDiffMinutes(from?: string | null, to?: string | null): number | null {
  const start = parseTimeToMinutes(from);
  const end = parseTimeToMinutes(to);
  if (start === null || end === null) return null;
  const diff = end - start;
  return diff >= 0 ? diff : null;
}

/**
 * فرق بالدقائق مع دعم عبور منتصف الليل (الزيارات):
 * إذا كان وقت النهاية أصغر من وقت البداية تُحسب الزيادة يومًا كاملًا.
 */
export function timeDiffMinutesAcrossMidnight(from?: string | null, to?: string | null): number | null {
  const start = parseTimeToMinutes(from);
  const end = parseTimeToMinutes(to);
  if (start === null || end === null) return null;
  const diff = end - start;
  return diff >= 0 ? diff : diff + 24 * 60;
}

/** عتبة التأخير في المحاضر: التأخير عندما تتجاوز المدة 60 دقيقة (60 نفسها ليست تأخيرًا) */
export const MINUTE_DELAY_THRESHOLD = 60;

/* --------------------------- محاضر يومية ------------------------------- */

export interface MinuteTiming {
  /** المدة بالدقائق بين استلام الملف والرد عليه */
  minutes: number | null;
  /** متأخر فقط عند تجاوز 60 دقيقة */
  delayed: boolean;
  /** التوقيتات ناقصة أو غير متسقة — لا مدة ولا تأخير */
  invalid: boolean;
  /** سبب عدم صلاحية المدة */
  reason: string | null;
}

export function minuteTiming(minute: {
  fileReceivedTime?: string | null;
  responseTime?: string | null;
  finalResponseTime?: string | null;
}): MinuteTiming {
  const received = minute.fileReceivedTime ?? '';
  const response = minute.responseTime || minute.finalResponseTime || '';
  const receivedMinutes = parseTimeToMinutes(received);
  const responseMinutes = parseTimeToMinutes(response);

  if (!received && !response) return { minutes: null, delayed: false, invalid: true, reason: 'توقيتات المحضر غير مسجلة' };
  if (!received) return { minutes: null, delayed: false, invalid: true, reason: 'توقيت استلام الملف غير مسجل' };
  if (!response) return { minutes: null, delayed: false, invalid: true, reason: 'توقيت الرد على الملف غير مسجل' };
  if (receivedMinutes === null) return { minutes: null, delayed: false, invalid: true, reason: 'توقيت استلام الملف غير صالح' };
  if (responseMinutes === null) return { minutes: null, delayed: false, invalid: true, reason: 'توقيت الرد على الملف غير صالح' };

  const diff = responseMinutes - receivedMinutes;
  if (diff < 0) return { minutes: null, delayed: false, invalid: true, reason: 'توقيت الرد يسبق توقيت الاستلام' };

  return { minutes: diff, delayed: diff > MINUTE_DELAY_THRESHOLD, invalid: false, reason: null };
}

export interface MinuteDurations {
  /** من استلام الملف حتى الرد على الملف */
  totalMinutes: number | null;
  /** من طلب الملف حتى استلامه */
  fileWaitMinutes: number | null;
}

export function minuteDurations(minute: {
  fileRequestTime?: string | null;
  fileReceivedTime?: string | null;
  responseTime?: string | null;
  finalResponseTime?: string | null;
}): MinuteDurations {
  return {
    totalMinutes: minuteTiming(minute).minutes,
    fileWaitMinutes: timeDiffMinutes(minute.fileRequestTime, minute.fileReceivedTime),
  };
}

/** محضر لم يُسجل فيه توقيت الرد بعد */
export function isMinuteOutstanding(minute: { responseTime?: string | null; finalResponseTime?: string | null }): boolean {
  return !(minute.responseTime || minute.finalResponseTime);
}

/* --------------------------- توقيت الزيارات ---------------------------- */

export interface VisitTimingResult {
  /** مدة الزيارة بالدقائق (تدعم عبور منتصف الليل) */
  minutes: number | null;
  /** هل المدة صالحة لحساب الإجماليات؟ */
  valid: boolean;
  reason: string | null;
}

export function visitTiming(visit: {
  departureTime?: string | null;
  returnTime?: string | null;
}): VisitTimingResult {
  const departure = visit.departureTime ?? '';
  const back = visit.returnTime ?? '';
  if (!departure && !back) return { minutes: null, valid: false, reason: 'توقيتات الزيارة غير مسجلة' };
  if (!departure) return { minutes: null, valid: false, reason: 'توقيت التحرك غير مسجل' };
  if (!back) return { minutes: null, valid: false, reason: 'توقيت الرجوع غير مسجل' };
  if (parseTimeToMinutes(departure) === null) return { minutes: null, valid: false, reason: 'توقيت التحرك غير صالح' };
  if (parseTimeToMinutes(back) === null) return { minutes: null, valid: false, reason: 'توقيت الرجوع غير صالح' };
  const minutes = timeDiffMinutesAcrossMidnight(departure, back);
  if (minutes === null) return { minutes: null, valid: false, reason: 'مدة غير صالحة' };
  return { minutes, valid: true, reason: null };
}

export function visitDurationMinutes(visit: { departureTime?: string | null; returnTime?: string | null }): number | null {
  return visitTiming(visit).minutes;
}

export interface EmployeeVisitSummary {
  employeeId: string;
  employeeName: string;
  /** عدد الزيارات المسجلة */
  totalVisits: number;
  /** عدد الزيارات ذات المدة الصالحة */
  validVisits: number;
  /** عدد الزيارات ذات المدة الناقصة/غير الصالحة */
  invalidVisits: number;
  /** مجموع المدد الصالحة بالدقائق */
  totalMinutes: number;
  /** متوسط المدة = مجموع المدد الصالحة ÷ عدد الزيارات الصالحة */
  averageMinutes: number | null;
  /** كل زيارات الشهر مرتبة زمنيًا */
  visits: Array<{ visit: import('../db/schema').VisitTiming; timing: VisitTimingResult }>;
}

/** يستخرج السنة والشهر من تاريخ نصي YYYY-MM-DD دون أي تحويل زمني */
export function dateParts(value?: string | null): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** تصفية الزيارات حسب الشهر والسنة (بناءً على تاريخ الزيارة المسجل) */
export function visitsInMonth<T extends { visitDate?: string | null }>(
  visits: T[],
  year: number,
  month: number,
  employeeId?: string | null,
): T[] {
  return visits.filter((visit) => {
    if (employeeId && (visit as { employeeId?: string }).employeeId !== employeeId) return false;
    const parts = dateParts(visit.visitDate);
    return Boolean(parts && parts.year === year && parts.month === month);
  });
}

/**
 * ملخص شهري للزيارات لكل موظف: العدد، مجموع المدد، المتوسط، وكل تفاصيل الزيارات.
 * الزيارات ذات المدة غير الصالحة تبقى ظاهرة لكنها مستبعدة من المجموع والمتوسط.
 */
export function monthlyVisitSummary(
  visits: Array<{ id: string; employeeId: string; visitDate?: string | null; departureTime?: string | null; returnTime?: string | null }>,
  employees: Array<{ id: string; name: string }>,
  year: number,
  month: number,
  employeeId?: string | null,
): EmployeeVisitSummary[] {
  const selected = visitsInMonth(visits, year, month, employeeId);
  const groups = new Map<string, typeof selected>();
  for (const visit of selected) {
    const list = groups.get(visit.employeeId);
    if (list) list.push(visit);
    else groups.set(visit.employeeId, [visit]);
  }

  const summaries: EmployeeVisitSummary[] = [];
  for (const [id, list] of groups) {
    const sorted = [...list].sort((a, b) => {
      const dateA = a.visitDate ?? '';
      const dateB = b.visitDate ?? '';
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      const depA = parseTimeToMinutes(a.departureTime) ?? Number.MAX_SAFE_INTEGER;
      const depB = parseTimeToMinutes(b.departureTime) ?? Number.MAX_SAFE_INTEGER;
      return depA - depB;
    });
    const details = sorted.map((visit) => ({ visit: visit as import('../db/schema').VisitTiming, timing: visitTiming(visit) }));
    const valid = details.filter((row) => row.timing.valid && row.timing.minutes !== null);
    const totalMinutes = valid.reduce((sum, row) => sum + (row.timing.minutes ?? 0), 0);
    summaries.push({
      employeeId: id,
      employeeName: employees.find((row) => row.id === id)?.name ?? 'موظف غير معروف',
      totalVisits: details.length,
      validVisits: valid.length,
      invalidVisits: details.length - valid.length,
      totalMinutes,
      averageMinutes: valid.length ? totalMinutes / valid.length : null,
      visits: details,
    });
  }

  return summaries.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ar'));
}

/* --------------------------- الإجازات -------------------------------- */

export interface LeaveTotals {
  days: number;
  hours: number;
  records: number;
}

export function leaveTotals(leaves: Leave[], employeeId?: string): LeaveTotals {
  const rows = employeeId ? leaves.filter((row) => row.employeeId === employeeId) : leaves;
  let days = 0;
  let hours = 0;
  for (const row of rows) {
    if (row.unit === 'days') days += row.days ?? 0;
    else hours += row.hours ?? 0;
  }
  return { days, hours, records: rows.length };
}

/* --------------------------- لوحة المعلومات --------------------------- */

export interface DashboardData {
  employees: Employee[];
  evaluations: MonthlyEvaluation[];
  visits: FieldVisit[];
  minutes: DisbursementMinute[];
  observations: Observation[];
}

export interface DashboardCounts {
  activeEmployees: number;
  visitsInPeriod: number;
  evaluationsCompleted: number;
  evaluationsMissing: number;
  openObservations: number;
  outstandingMinutes: number;
  employeesWithoutEvaluation: Employee[];
}

export function dashboardCounts(data: DashboardData, year: number, month: number): DashboardCounts {
  const active = data.employees.filter((employee) => !employee.archived && employee.status === 'active');
  const monthEvaluations = data.evaluations.filter((row) => row.year === year && row.month === month);
  const evaluatedIds = new Set(monthEvaluations.map((row) => row.employeeId));
  const employeesWithoutEvaluation = active.filter((employee) => !evaluatedIds.has(employee.id));

  const periodVisits = data.visits.filter((visit) => {
    if (!visit.visitDate) return false;
    const date = new Date(visit.visitDate);
    return date.getFullYear() === year && date.getMonth() + 1 === month && visit.status !== 'cancelled';
  });

  return {
    activeEmployees: active.length,
    visitsInPeriod: periodVisits.length,
    evaluationsCompleted: monthEvaluations.filter((row) => monthlyTotals(row.scores, row.visits).complete).length,
    evaluationsMissing: employeesWithoutEvaluation.length,
    openObservations: data.observations.filter((row) => row.status === 'open').length,
    outstandingMinutes: data.minutes.filter(isMinuteOutstanding).length,
    employeesWithoutEvaluation,
  };
}
