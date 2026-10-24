import type {
  AppSettings,
  Branch,
  DisbursementMinute,
  Employee,
  Evaluation,
  FieldVisit,
  Observation,
} from '../db/schema';
import { computeEmployeeStats, type Dataset, type EmployeeStats, type VisitMetrics, visitMetrics } from './analytics';
import { computeMinuteTimings, type MinuteTimings } from './minuteCalc';
import { calendarFromSettings } from './analytics';
import { monthLabel } from './format';

export type ReportPeriodType = 'monthly' | 'annual' | 'custom' | 'all';

export interface ReportPeriod {
  type: ReportPeriodType;
  year?: number;
  month?: number;
  from?: string;
  to?: string;
}

export interface EmployeeReportModel {
  organizationName: string;
  departmentName: string;
  generatedAt: string;
  period: ReportPeriod;
  periodLabel: string;
  employee: Employee;
  branchName: string;
  criteria: AppSettings['evaluationCriteria'];
  categories: AppSettings['observationCategories'];
  ratingScale: AppSettings['ratingScale'];
  stats: EmployeeStats;
  minutes: Array<{ minute: DisbursementMinute; timings: MinuteTimings }>;
  visits: Array<{ visit: FieldVisit; metrics: VisitMetrics }>;
  observations: Observation[];
  monthlyEvaluations: Evaluation[];
  annualEvaluations: Evaluation[];
  totals: {
    minutes: number;
    minutesClosed: number;
    minutesMet: number;
    compliancePercent: number | null;
    officerMinutes: number;
    waitingMinutes: number;
    visits: number;
    visitsCompleted: number;
    avgQuality: number | null;
    delayedReports: number;
    returnedReports: number;
    observations: number;
    observationsOpen: number;
    observationsRecurring: number;
  };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function periodLabel(period: ReportPeriod): string {
  if (period.type === 'monthly' && period.year && period.month) return monthLabel(period.year, period.month);
  if (period.type === 'annual' && period.year) return `السنة ${period.year}`;
  if (period.type === 'custom') {
    const from = period.from ? period.from.slice(0, 10) : '';
    const to = period.to ? period.to.slice(0, 10) : '';
    return `من ${from || 'البداية'} إلى ${to || 'الآن'}`;
  }
  return 'كل الفترات المسجلة';
}

function inPeriod(date: string | null | undefined, period: ReportPeriod): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  if (period.type === 'all') return true;
  if (period.type === 'monthly' && period.year && period.month) return day.startsWith(monthKey(period.year, period.month));
  if (period.type === 'annual' && period.year) return day.startsWith(String(period.year));
  if (period.type === 'custom') {
    if (period.from && day < period.from) return false;
    if (period.to && day > period.to) return false;
    return true;
  }
  return true;
}

function evaluationInPeriod(evaluation: Evaluation, period: ReportPeriod): boolean {
  if (period.type === 'all') return true;
  if (period.type === 'annual') return evaluation.year === period.year;
  if (period.type === 'monthly') {
    if (evaluation.periodType === 'monthly') return evaluation.year === period.year && evaluation.month === period.month;
    return evaluation.year === period.year;
  }
  if (period.type === 'custom') {
    const yearFrom = period.from ? Number(period.from.slice(0, 4)) : 0;
    const yearTo = period.to ? Number(period.to.slice(0, 4)) : 9999;
    return evaluation.year >= yearFrom && evaluation.year <= yearTo;
  }
  return true;
}

export function buildEmployeeReport(params: {
  settings: AppSettings;
  employee: Employee;
  branches: Branch[];
  minutes: DisbursementMinute[];
  visits: FieldVisit[];
  observations: Observation[];
  evaluations: Evaluation[];
  period: ReportPeriod;
  generatedAt?: Date;
}): EmployeeReportModel {
  const { settings, employee, branches, period } = params;
  const generatedAt = params.generatedAt ?? new Date();
  const calendar = calendarFromSettings(settings);

  const minutes = params.minutes
    .filter((m) => m.employeeId === employee.id && inPeriod(m.receivedAt, period))
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
  const visits = params.visits
    .filter((v) => v.employeeId === employee.id && inPeriod(v.visitDate, period))
    .sort((a, b) => (a.visitDate < b.visitDate ? -1 : 1));
  const observations = params.observations
    .filter((o) => o.employeeId === employee.id && inPeriod(o.date, period))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const evaluations = params.evaluations.filter((e) => e.employeeId === employee.id && evaluationInPeriod(e, period));

  const minuteRows = minutes.map((minute) => ({
    minute,
    timings: computeMinuteTimings(minute, calendar, settings.minutesDeadlineMinutes, settings.deadlineWarnPercent, generatedAt),
  }));

  const visitRows = visits.map((visit) => ({ visit, metrics: visitMetrics(visit, settings, generatedAt) }));

  const dataset: Dataset = {
    employees: [employee],
    branches,
    minutes,
    visits,
    observations,
    evaluations,
  };

  const stats = computeEmployeeStats(employee, dataset, settings, generatedAt);
  const closed = minuteRows.filter((row) => row.timings.isClosed);
  const met = closed.filter((row) => row.timings.slaStatus === 'met').length;
  const qualities = visits.map((v) => v.qualityScore).filter((q): q is number => typeof q === 'number');

  const monthlyEvaluations = evaluations
    .filter((e) => e.periodType === 'monthly')
    .sort((a, b) => (a.year === b.year ? (a.month ?? 0) - (b.month ?? 0) : a.year - b.year));
  const annualEvaluations = evaluations.filter((e) => e.periodType === 'annual').sort((a, b) => b.year - a.year);

  return {
    organizationName: settings.organizationName,
    departmentName: settings.departmentName,
    generatedAt: generatedAt.toISOString(),
    period,
    periodLabel: periodLabel(period),
    employee,
    branchName: branches.find((b) => b.id === employee.branchId)?.name ?? '—',
    criteria: settings.evaluationCriteria.filter((c) => c.active),
    categories: settings.observationCategories,
    ratingScale: settings.ratingScale,
    stats,
    minutes: minuteRows,
    visits: visitRows,
    observations,
    monthlyEvaluations,
    annualEvaluations,
    totals: {
      minutes: minutes.length,
      minutesClosed: closed.length,
      minutesMet: met,
      compliancePercent: closed.length ? (met / closed.length) * 100 : null,
      officerMinutes: closed.reduce((sum, row) => sum + row.timings.officerMinutes, 0),
      waitingMinutes: closed.reduce((sum, row) => sum + row.timings.waitingMinutes, 0),
      visits: visits.length,
      visitsCompleted: visits.filter((v) => v.status === 'completed').length,
      avgQuality: qualities.length ? qualities.reduce((a, b) => a + b, 0) / qualities.length : null,
      delayedReports: visitRows.filter((row) => row.metrics.reportDelayed && row.visit.status !== 'cancelled').length,
      returnedReports: visitRows.filter((row) => row.metrics.returnedForCorrections).length,
      observations: observations.length,
      observationsOpen: observations.filter((o) => o.status === 'open' || o.status === 'in_progress').length,
      observationsRecurring: observations.filter((o) => o.isRecurring).length,
    },
  };
}
