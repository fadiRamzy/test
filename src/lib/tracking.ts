import type { Employee, Minute, Observation, Visit } from '../db/schema';

/** فرق الدقائق بين لحظتين (أو من لحظة حتى الآن) */
export function diffMinutes(from?: string | null, to?: string | null, now: Date = new Date()): number | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return null;
  const endDate = to ? new Date(to) : now;
  const end = endDate.getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

export interface MinuteState {
  isOpen: boolean;
  fileNotRequested: boolean;
  waitingForFile: boolean;
  reviewNotStarted: boolean;
  pendingFinalResponse: boolean;
  /** من طلب الملف حتى استلامه */
  waitingMinutes: number | null;
  /** من بدء المراجعة حتى الرد النهائي (أو الآن) */
  reviewMinutes: number | null;
  /** من ورود الدقيقة حتى الرد النهائي (أو الآن) */
  totalMinutes: number;
  deadlineMinutes: number;
  /** التجاوز: مدة المراجعة إن بدأت، وإلا الزمن المنقضي من الاستلام */
  measuredMinutes: number;
  overdue: boolean;
  overdueBy: number;
}

/**
 * حالة دقيقة الصرف محسوبة فقط من الطوابع الزمنية المسجلة يدويًا.
 * التمييز بين انتظار الملف وزمن المراجعة متاح متى سُجّلت الأوقات اللازمة.
 */
export function minuteState(minute: Minute, deadlineMinutes: number, now: Date = new Date()): MinuteState {
  const isOpen = minute.status === 'open';
  const fileNotRequested = isOpen && !minute.fileRequestedAt;
  const waitingForFile = isOpen && Boolean(minute.fileRequestedAt) && !minute.fileReceivedAt;
  const reviewNotStarted = isOpen && !minute.reviewStartedAt;
  const pendingFinalResponse = isOpen && Boolean(minute.reviewStartedAt) && !minute.finalResponseAt;

  const waitingMinutes = minute.fileRequestedAt ? diffMinutes(minute.fileRequestedAt, minute.fileReceivedAt, now) : null;
  const reviewMinutes = minute.reviewStartedAt ? diffMinutes(minute.reviewStartedAt, minute.finalResponseAt, now) : null;
  const totalMinutes = diffMinutes(minute.receivedAt, minute.finalResponseAt, now) ?? 0;
  const measuredMinutes = reviewMinutes ?? totalMinutes;
  const overdue = isOpen && deadlineMinutes > 0 && measuredMinutes > deadlineMinutes;

  return {
    isOpen,
    fileNotRequested,
    waitingForFile,
    reviewNotStarted,
    pendingFinalResponse,
    waitingMinutes,
    reviewMinutes,
    totalMinutes,
    deadlineMinutes,
    measuredMinutes,
    overdue,
    overdueBy: overdue ? measuredMinutes - deadlineMinutes : 0,
  };
}

export type MinuteFlag =
  | 'file_not_requested'
  | 'waiting_file'
  | 'review_not_started'
  | 'pending_response'
  | 'overdue'
  | 'completed'
  | 'cancelled'
  | 'all';

export const MINUTE_FLAG_LABELS: Record<MinuteFlag, string> = {
  all: 'الكل',
  file_not_requested: 'بانتظار طلب الملف',
  waiting_file: 'بانتظار استلام الملف',
  review_not_started: 'لم تبدأ المراجعة',
  pending_response: 'بانتظار الرد النهائي',
  overdue: 'متأخرة عن المهلة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export function matchMinuteFlag(state: MinuteState, flag: MinuteFlag): boolean {
  switch (flag) {
    case 'all':
      return true;
    case 'file_not_requested':
      return state.fileNotRequested;
    case 'waiting_file':
      return state.waitingForFile;
    case 'review_not_started':
      return state.reviewNotStarted;
    case 'pending_response':
      return state.pendingFinalResponse;
    case 'overdue':
      return state.overdue;
    case 'completed':
      return !state.isOpen;
    case 'cancelled':
      return false;
    default:
      return true;
  }
}

export interface VisitState {
  isOpen: boolean;
  reportPending: boolean;
  reportAwaitingReview: boolean;
  needsCorrections: boolean;
  reportDelayMinutes: number | null;
  reviewDelayMinutes: number | null;
  overdue: boolean;
  cycles: number;
  lastOutcome: Visit['reviewCycles'][number]['outcome'] | null;
}

/** حالة الزيارة والتقرير من الأوقات المسجلة ونتائج دورات المراجعة */
export function visitState(visit: Visit, deadlineMinutes: number, now: Date = new Date()): VisitState {
  const isOpen = visit.status !== 'completed' && visit.status !== 'cancelled';
  const reportPending = Boolean(visit.returnAt) && !visit.reportSubmittedAt;
  const reportAwaitingReview = Boolean(visit.reportSubmittedAt) && !visit.reportReviewedAt;
  const cycles = visit.reviewCycles ?? [];
  const lastOutcome = cycles.length ? cycles[cycles.length - 1].outcome : null;
  const needsCorrections = lastOutcome === 'corrections' || lastOutcome === 'rejected';

  const reportDelayMinutes = visit.returnAt ? diffMinutes(visit.returnAt, visit.reportSubmittedAt, now) : null;
  const reviewDelayMinutes = visit.reportSubmittedAt ? diffMinutes(visit.reportSubmittedAt, visit.reportReviewedAt, now) : null;
  const overdue =
    isOpen && deadlineMinutes > 0 && Boolean(reportAwaitingReview) && (reviewDelayMinutes ?? 0) > deadlineMinutes;

  return {
    isOpen,
    reportPending,
    reportAwaitingReview,
    needsCorrections,
    reportDelayMinutes,
    reviewDelayMinutes,
    overdue,
    cycles: cycles.length,
    lastOutcome,
  };
}

export type VisitFlag = 'all' | 'in_progress' | 'report_pending' | 'awaiting_review' | 'corrections' | 'completed';

export const VISIT_FLAG_LABELS: Record<VisitFlag, string> = {
  all: 'الكل',
  in_progress: 'جارية',
  report_pending: 'بانتظار التقرير',
  awaiting_review: 'بانتظار مراجعة التقرير',
  corrections: 'تحتاج تصحيحًا',
  completed: 'مكتملة',
};

/* ------------------------------- لوحة اليوم ----------------------------- */

export interface EmployeeWorkload {
  employee: Employee;
  openMinutes: number;
  overdueMinutes: number;
  openVisits: number;
  pendingReports: number;
  openObservations: number;
  visitsLogged: number;
}

export interface DashboardCounters {
  incomingToday: number;
  incomingTotal: number;
  fileNotRequested: number;
  waitingForFile: number;
  reviewNotStarted: number;
  pendingFinalResponse: number;
  overdueMinutes: number;
  visitsInProgress: number;
  reportsPendingSubmission: number;
  reportsPendingReview: number;
  overdueReports: number;
  openObservations: number;
  overdueTasks: number;
  workload: EmployeeWorkload[];
}

export function buildDashboard(
  data: { employees: Employee[]; minutes: Minute[]; visits: Visit[]; observations: Observation[] },
  deadlineMinutes: number,
  now: Date = new Date(),
): DashboardCounters {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const minuteStates = data.minutes.map((minute) => ({ minute, state: minuteState(minute, deadlineMinutes, now) }));
  const visitStates = data.visits.map((visit) => ({ visit, state: visitState(visit, deadlineMinutes, now) }));

  const openObservations = data.observations.filter((row) => row.status === 'open');

  const workload: EmployeeWorkload[] = data.employees
    .filter((employee) => !employee.archived)
    .map((employee) => {
      const minutes = minuteStates.filter((row) => row.minute.employeeId === employee.id);
      const visits = visitStates.filter((row) => row.visit.employeeId === employee.id);
      return {
        employee,
        openMinutes: minutes.filter((row) => row.state.isOpen).length,
        overdueMinutes: minutes.filter((row) => row.state.overdue).length,
        openVisits: visits.filter((row) => row.state.isOpen).length,
        pendingReports: visits.filter((row) => row.state.reportPending || row.state.reportAwaitingReview).length,
        openObservations: openObservations.filter((row) => row.employeeId === employee.id).length,
        visitsLogged: visits.length,
      };
    })
    .sort((a, b) => b.overdueMinutes + b.pendingReports - (a.overdueMinutes + a.pendingReports));

  const overdueMinutes = minuteStates.filter((row) => row.state.overdue).length;
  const overdueReports = visitStates.filter((row) => row.state.overdue).length;

  return {
    incomingToday: data.minutes.filter((row) => (row.receivedAt ?? '').slice(0, 10) === today).length,
    incomingTotal: data.minutes.length,
    fileNotRequested: minuteStates.filter((row) => row.state.fileNotRequested).length,
    waitingForFile: minuteStates.filter((row) => row.state.waitingForFile).length,
    reviewNotStarted: minuteStates.filter((row) => row.state.reviewNotStarted).length,
    pendingFinalResponse: minuteStates.filter((row) => row.state.pendingFinalResponse).length,
    overdueMinutes,
    visitsInProgress: data.visits.filter((row) => row.status === 'in_progress').length,
    reportsPendingSubmission: visitStates.filter((row) => row.state.reportPending).length,
    reportsPendingReview: visitStates.filter((row) => row.state.reportAwaitingReview).length,
    overdueReports,
    openObservations: openObservations.length,
    overdueTasks: overdueMinutes + overdueReports,
    workload,
  };
}
