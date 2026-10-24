import type {
  AppSettings,
  Branch,
  DisbursementMinute,
  Employee,
  Evaluation,
  FieldVisit,
  Observation,
} from '../db/schema';
import { computeMinuteTimings, type MinuteTimings } from './minuteCalc';
import { businessMinutesBetween, workingDaysBetween, type WorkCalendar } from './businessTime';
import { summarizeScores, type EvaluationSummary } from './evaluation';

export interface Dataset {
  employees: Employee[];
  branches: Branch[];
  minutes: DisbursementMinute[];
  visits: FieldVisit[];
  observations: Observation[];
  evaluations: Evaluation[];
}

export function calendarFromSettings(settings: AppSettings): WorkCalendar {
  return {
    workingHours: settings.workingHours,
    workingDays: settings.workingDays,
    holidays: settings.holidays,
  };
}

export function timingsMap(
  minutes: DisbursementMinute[],
  settings: AppSettings,
  now = new Date(),
): Map<string, MinuteTimings> {
  const calendar = calendarFromSettings(settings);
  const map = new Map<string, MinuteTimings>();
  for (const minute of minutes) {
    map.set(minute.id, computeMinuteTimings(minute, calendar, settings.minutesDeadlineMinutes, settings.deadlineWarnPercent, now));
  }
  return map;
}

export interface VisitMetrics {
  reportDelayHours: number | null;
  reportDelayed: boolean;
  returnedForCorrections: boolean;
  cycles: number;
  awaitingFinalEmail: boolean;
}

export function visitMetrics(visit: FieldVisit, settings: AppSettings, now = new Date()): VisitMetrics {
  const calendar = calendarFromSettings(settings);
  const start = visit.returnAt ?? visit.arrivalAt ?? visit.departureAt ?? `${visit.visitDate}T09:00:00`;
  const cycles = visit.reviewCycles?.length ?? 0;
  const returnedForCorrections =
    (visit.reviewCycles ?? []).some((c) => Boolean(c.correctionsRequestedAt) || Boolean(c.correctionsNotes?.trim())) ||
    Boolean(visit.correctionsAt);

  let reportDelayHours: number | null = null;
  if (visit.reportSubmittedAt) {
    reportDelayHours = Math.round((businessMinutesBetween(start, visit.reportSubmittedAt, calendar) / 60) * 10) / 10;
  } else {
    reportDelayHours = Math.round((businessMinutesBetween(start, now, calendar) / 60) * 10) / 10;
  }

  const reportDelayed = visit.reportSubmittedAt
    ? (reportDelayHours ?? 0) > settings.thresholds.reportDelayWarnHours
    : visit.status !== 'cancelled' && (reportDelayHours ?? 0) > settings.thresholds.reportDelayWarnHours;

  return {
    reportDelayHours,
    reportDelayed,
    returnedForCorrections,
    cycles,
    awaitingFinalEmail: Boolean(visit.reportSubmittedAt) && !visit.finalEmailAt,
  };
}

export interface EmployeeStats {
  employee: Employee;
  minutes: DisbursementMinute[];
  visits: FieldVisit[];
  observations: Observation[];
  evaluations: Evaluation[];
  minutesTotal: number;
  minutesClosed: number;
  minutesPending: number;
  minutesOverdue: number;
  minutesMet: number;
  minutesBreached: number;
  compliancePercent: number | null;
  avgOfficerMinutes: number | null;
  avgWaitingMinutes: number | null;
  visitsTotal: number;
  visitsCompleted: number;
  visitsThisMonth: number;
  visitDays: number;
  avgQuality: number | null;
  delayedReports: number;
  returnedReports: number;
  pendingActions: number;
  observationsTotal: number;
  observationsOpen: number;
  observationsRecurring: number;
  observationsResolved: number;
  latestMonthly: Evaluation | null;
  latestMonthlySummary: EvaluationSummary | null;
  annual: Evaluation | null;
  annualSummary: EvaluationSummary | null;
  monthlyAverages: Array<{ year: number; month: number; average: number | null }>;
}

export function computeEmployeeStats(
  employee: Employee,
  data: Dataset,
  settings: AppSettings,
  now = new Date(),
): EmployeeStats {
  const minutes = data.minutes.filter((m) => m.employeeId === employee.id);
  const visits = data.visits.filter((v) => v.employeeId === employee.id);
  const observations = data.observations.filter((o) => o.employeeId === employee.id);
  const evaluations = data.evaluations.filter((e) => e.employeeId === employee.id);

  const timings = timingsMap(minutes, settings, now);
  const all = Array.from(timings.values());
  const closed = all.filter((t) => t.isClosed);
  const met = closed.filter((t) => t.slaStatus === 'met').length;
  const breached = closed.filter((t) => t.slaStatus === 'breached').length;

  const qualityScores = visits.map((v) => v.qualityScore).filter((q): q is number => typeof q === 'number');
  const visitMetricsList = visits.map((v) => visitMetrics(v, settings, now));

  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const monthly = evaluations.filter((e) => e.periodType === 'monthly');
  const latestMonthly =
    monthly
      .slice()
      .sort((a, b) => (a.year === b.year ? (b.month ?? 0) - (a.month ?? 0) : b.year - a.year))[0] ?? null;
  const annual = evaluations.filter((e) => e.periodType === 'annual').sort((a, b) => b.year - a.year)[0] ?? null;

  const calendar = calendarFromSettings(settings);
  const visitDays = visits.reduce((sum, v) => sum + Math.max(1, workingDaysBetween(v.visitDate, v.visitDate, calendar)), 0);

  return {
    employee,
    minutes,
    visits,
    observations,
    evaluations,
    minutesTotal: minutes.length,
    minutesClosed: closed.length,
    minutesPending: all.filter((t) => !t.isClosed && t.slaStatus !== 'na').length,
    minutesOverdue: all.filter((t) => t.slaStatus === 'overdue').length,
    minutesMet: met,
    minutesBreached: breached,
    compliancePercent: closed.length ? (met / closed.length) * 100 : null,
    avgOfficerMinutes: closed.length ? Math.round(closed.reduce((s, t) => s + t.officerMinutes, 0) / closed.length) : null,
    avgWaitingMinutes: closed.length ? Math.round(closed.reduce((s, t) => s + t.waitingMinutes, 0) / closed.length) : null,
    visitsTotal: visits.length,
    visitsCompleted: visits.filter((v) => v.status === 'completed').length,
    visitsThisMonth: visits.filter((v) => v.visitDate.slice(0, 7) === `${currentYear}-${String(currentMonth).padStart(2, '0')}`).length,
    visitDays,
    avgQuality: qualityScores.length
      ? Math.round((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) * 10) / 10
      : null,
    delayedReports: visitMetricsList.filter((m, index) => m.reportDelayed && visits[index]?.status !== 'cancelled').length,
    returnedReports: visitMetricsList.filter((m) => m.returnedForCorrections).length,
    pendingActions: visits.filter((v) => Boolean(v.pendingActions?.trim())).length,
    observationsTotal: observations.length,
    observationsOpen: observations.filter((o) => o.status === 'open' || o.status === 'in_progress').length,
    observationsRecurring: observations.filter((o) => o.isRecurring).length,
    observationsResolved: observations.filter((o) => o.status === 'resolved' || o.status === 'closed').length,
    latestMonthly,
    latestMonthlySummary: latestMonthly
      ? summarizeScores(latestMonthly.scores, settings.evaluationCriteria, settings.ratingScale.max)
      : null,
    annual,
    annualSummary: annual ? summarizeScores(annual.scores, settings.evaluationCriteria, settings.ratingScale.max) : null,
    monthlyAverages: monthly
      .sort((a, b) => (a.year === b.year ? (a.month ?? 0) - (b.month ?? 0) : a.year - b.year))
      .map((e) => ({
        year: e.year,
        month: e.month ?? 0,
        average: summarizeScores(e.scores, settings.evaluationCriteria, settings.ratingScale.max).average,
      })),
  };
}

export interface DashboardMetrics {
  minutesTotal: number;
  minutesPending: number;
  minutesOverdue: number;
  minutesWarning: number;
  compliancePercent: number | null;
  minutesBreached: number;
  minutesMet: number;
  visitsTotal: number;
  visitsThisMonth: number;
  visitsPendingReports: number;
  delayedReports: number;
  returnedReports: number;
  observationsOpen: number;
  observationsRepeated: number;
  observationsTotal: number;
  employeesActive: number;
  employeesInactive: number;
  branchPerformance: Array<{
    branch: Branch;
    minutes: number;
    closed: number;
    compliancePercent: number | null;
    visits: number;
    openObservations: number;
  }>;
  workloads: Array<{
    employee: Employee;
    pendingMinutes: number;
    overdueMinutes: number;
    visits: number;
    openObservations: number;
  }>;
  evaluationTrend: Array<{ year: number; month: number; average: number | null; count: number }>;
  severityBreakdown: Array<{ severity: string; count: number }>;
}

export function computeDashboard(data: Dataset, settings: AppSettings, now = new Date()): DashboardMetrics {
  const timings = timingsMap(data.minutes, settings, now);
  const all = Array.from(timings.values());
  const closed = all.filter((t) => t.isClosed);
  const met = closed.filter((t) => t.slaStatus === 'met').length;

  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const visitInfo = data.visits.map((v) => ({ visit: v, metrics: visitMetrics(v, settings, now) }));

  const branchPerformance = data.branches
    .map((branch) => {
      const branchMinutes = data.minutes.filter((m) => m.branchId === branch.id);
      const branchTimings = branchMinutes.map((m) => timings.get(m.id)).filter((t): t is MinuteTimings => Boolean(t));
      const closedTimings = branchTimings.filter((t) => t.isClosed);
      const metCount = closedTimings.filter((t) => t.slaStatus === 'met').length;
      return {
        branch,
        minutes: branchMinutes.length,
        closed: closedTimings.length,
        compliancePercent: closedTimings.length ? (metCount / closedTimings.length) * 100 : null,
        visits: data.visits.filter((v) => v.branchId === branch.id).length,
        openObservations: data.observations.filter(
          (o) => o.branchId === branch.id && (o.status === 'open' || o.status === 'in_progress'),
        ).length,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  const workloads = data.employees
    .filter((e) => e.status === 'active')
    .map((employee) => {
      const empMinutes = data.minutes.filter((m) => m.employeeId === employee.id);
      const empTimings = empMinutes.map((m) => timings.get(m.id)).filter((t): t is MinuteTimings => Boolean(t));
      return {
        employee,
        pendingMinutes: empTimings.filter((t) => !t.isClosed && t.slaStatus !== 'na').length,
        overdueMinutes: empTimings.filter((t) => t.slaStatus === 'overdue').length,
        visits: data.visits.filter((v) => v.employeeId === employee.id && v.visitDate.startsWith(monthKey)).length,
        openObservations: data.observations.filter(
          (o) => o.employeeId === employee.id && (o.status === 'open' || o.status === 'in_progress'),
        ).length,
      };
    })
    .sort((a, b) => b.overdueMinutes + b.openObservations - (a.overdueMinutes + a.openObservations));

  const trendMap = new Map<string, { year: number; month: number; sum: number; count: number }>();
  for (const evaluation of data.evaluations.filter((e) => e.periodType === 'monthly' && e.month)) {
    const summary = summarizeScores(evaluation.scores, settings.evaluationCriteria, settings.ratingScale.max);
    if (summary.average === null) continue;
    const key = `${evaluation.year}-${evaluation.month}`;
    const entry = trendMap.get(key) ?? { year: evaluation.year, month: evaluation.month ?? 0, sum: 0, count: 0 };
    entry.sum += summary.average;
    entry.count += 1;
    trendMap.set(key, entry);
  }
  const evaluationTrend = Array.from(trendMap.values())
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .map((entry) => ({ year: entry.year, month: entry.month, average: entry.sum / entry.count, count: entry.count }));

  const severities = ['critical', 'high', 'medium', 'low'] as const;
  const severityBreakdown = severities.map((severity) => ({
    severity,
    count: data.observations.filter((o) => o.severity === severity && (o.status === 'open' || o.status === 'in_progress')).length,
  }));

  return {
    minutesTotal: data.minutes.length,
    minutesPending: all.filter((t) => !t.isClosed && t.slaStatus !== 'na').length,
    minutesOverdue: all.filter((t) => t.slaStatus === 'overdue').length,
    minutesWarning: all.filter((t) => t.slaStatus === 'warning').length,
    minutesBreached: all.filter((t) => t.slaStatus === 'breached').length,
    minutesMet: met,
    compliancePercent: closed.length ? (met / closed.length) * 100 : null,
    visitsTotal: data.visits.length,
    visitsThisMonth: data.visits.filter((v) => v.visitDate.startsWith(monthKey)).length,
    visitsPendingReports: data.visits.filter((v) => v.status === 'report_pending').length,
    delayedReports: visitInfo.filter((v) => v.metrics.reportDelayed && v.visit.status !== 'cancelled').length,
    returnedReports: visitInfo.filter((v) => v.metrics.returnedForCorrections).length,
    observationsOpen: data.observations.filter((o) => o.status === 'open' || o.status === 'in_progress').length,
    observationsRepeated: data.observations.filter((o) => o.isRecurring).length,
    observationsTotal: data.observations.length,
    employeesActive: data.employees.filter((e) => e.status === 'active').length,
    employeesInactive: data.employees.filter((e) => e.status !== 'active').length,
    branchPerformance,
    workloads,
    evaluationTrend,
    severityBreakdown,
  };
}

export function searchText(haystack: Array<string | null | undefined>, needle: string): boolean {
  if (!needle.trim()) return true;
  const normalized = needle.trim().toLowerCase();
  return haystack.some((value) => (value ?? '').toLowerCase().includes(normalized));
}

export function inDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!value) return !from && !to;
  const date = value.slice(0, 10);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function inMonth(value: string | null | undefined, month: string): boolean {
  if (!month) return true;
  if (!value) return false;
  return value.slice(0, 7) === month;
}
