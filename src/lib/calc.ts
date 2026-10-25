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

/* ------------------------- دقائق الصرف ------------------------------- */

/** فرق بالدقائق بين وقتين HH:MM في نفس اليوم */
export function timeDiffMinutes(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const start = parse(from);
  const end = parse(to);
  if (start === null || end === null) return null;
  const diff = end - start;
  return diff >= 0 ? diff : null;
}

export interface MinuteDurations {
  /** من استلام الدقيقة حتى الرد النهائي */
  totalMinutes: number | null;
  /** من طلب الملف حتى استلامه */
  fileWaitMinutes: number | null;
}

export function minuteDurations(minute: DisbursementMinute): MinuteDurations {
  return {
    totalMinutes: timeDiffMinutes(minute.minuteReceivedTime, minute.finalResponseTime),
    fileWaitMinutes: timeDiffMinutes(minute.fileRequestTime, minute.fileReceivedTime),
  };
}

/** "دقيقة غير مكتملة" = لم يُسجل وقت الرد النهائي بعد */
export function isMinuteOutstanding(minute: DisbursementMinute): boolean {
  return !minute.finalResponseTime || minute.status === 'open';
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
