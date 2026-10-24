import type { DisbursementMinute } from '../db/schema';
import { addBusinessMinutes, businessMinutesBetween, type WorkCalendar } from './businessTime';

export type SlaStatus = 'met' | 'breached' | 'pending' | 'warning' | 'overdue' | 'na';

export interface MinuteTimings {
  /** الموعد النهائي المحسوب بتوقيت العمل */
  dueAt: string | null;
  /** دقائق العمل المنقضية من الاستلام حتى الرد النهائي أو اللحظة الحالية */
  elapsedMinutes: number;
  /** وقت معالجة ضابط المخاطر */
  officerMinutes: number;
  /** وقت انتظار الفرع/المعلومات */
  waitingMinutes: number;
  slaStatus: SlaStatus;
  /** الدقائق المتبقية قبل تجاوز المهلة (0 إن تجاوزت) */
  remainingMinutes: number;
  /** نسبة استهلاك المهلة */
  percentUsed: number;
  isClosed: boolean;
}

interface TimelineEvent {
  key: string;
  at: Date;
  isRequest: boolean;
}

function buildTimeline(minute: DisbursementMinute): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (key: string, value?: string | null, isRequest = false) => {
    if (!value) return;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return;
    events.push({ key, at, isRequest });
  };
  push('received', minute.receivedAt);
  push('file_requested', minute.fileRequestedAt, true);
  push('file_received', minute.fileReceivedAt);
  push('review_started', minute.reviewStartedAt);
  push('clarification_requested', minute.clarificationRequestedAt, true);
  push('clarification_responded', minute.clarificationRespondedAt);
  push('final_response', minute.finalResponseAt);
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * حساب أزمنة دقيقة الصرف: المهلة، حالة الالتزام، وزمن الضابط مقابل زمن انتظار الفرع.
 * يعتمد فقط على الطوابع الزمنية المسجلة فعليًا.
 */
export function computeMinuteTimings(
  minute: DisbursementMinute,
  calendar: WorkCalendar,
  deadlineMinutes: number,
  warnPercent = 80,
  now: Date = new Date(),
): MinuteTimings {
  const received = minute.receivedAt ? new Date(minute.receivedAt) : null;
  const validReceived = received && !Number.isNaN(received.getTime());

  if (!validReceived) {
    return {
      dueAt: null,
      elapsedMinutes: 0,
      officerMinutes: 0,
      waitingMinutes: 0,
      slaStatus: 'na',
      remainingMinutes: 0,
      percentUsed: 0,
      isClosed: false,
    };
  }

  const dueAt = addBusinessMinutes(received, deadlineMinutes, calendar);
  const closed = Boolean(minute.finalResponseAt);
  const end = closed ? new Date(minute.finalResponseAt as string) : now;
  const elapsedMinutes = businessMinutesBetween(received, end, calendar);

  const timeline = buildTimeline(minute);
  let waitingMinutes = 0;
  for (let i = 0; i < timeline.length - 1; i += 1) {
    const current = timeline[i];
    const next = timeline[i + 1];
    if (current.isRequest) {
      waitingMinutes += businessMinutesBetween(current.at, next.at, calendar);
    }
  }
  const boundedWaiting = Math.min(waitingMinutes, elapsedMinutes);
  const officerMinutes = Math.max(0, elapsedMinutes - boundedWaiting);

  let slaStatus: SlaStatus;
  if (minute.status === 'cancelled') {
    slaStatus = 'na';
  } else if (closed) {
    slaStatus = elapsedMinutes <= deadlineMinutes ? 'met' : 'breached';
  } else if (elapsedMinutes > deadlineMinutes) {
    slaStatus = 'overdue';
  } else if (deadlineMinutes > 0 && elapsedMinutes >= (deadlineMinutes * warnPercent) / 100) {
    slaStatus = 'warning';
  } else {
    slaStatus = 'pending';
  }

  const remainingMinutes = Math.max(0, deadlineMinutes - elapsedMinutes);
  const percentUsed = deadlineMinutes > 0 ? Math.min(100, (elapsedMinutes / deadlineMinutes) * 100) : 0;

  return {
    dueAt,
    elapsedMinutes,
    officerMinutes,
    waitingMinutes: boundedWaiting,
    slaStatus,
    remainingMinutes,
    percentUsed,
    isClosed: closed,
  };
}

export const SLA_LABELS: Record<SlaStatus, string> = {
  met: 'داخل المهلة',
  breached: 'تجاوز المهلة',
  pending: 'جارٍ — داخل المهلة',
  warning: 'قارب المهلة',
  overdue: 'متأخر',
  na: 'غير محسوب',
};

export function slaTone(status: SlaStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'met':
      return 'success';
    case 'warning':
      return 'warning';
    case 'breached':
    case 'overdue':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** الملخص الإحصائي لمجموعة دقائق */
export function summarizeMinutes(timings: MinuteTimings[]) {
  const closed = timings.filter((t) => t.isClosed);
  const met = closed.filter((t) => t.slaStatus === 'met').length;
  return {
    total: timings.length,
    closed: closed.length,
    met,
    breached: closed.filter((t) => t.slaStatus === 'breached').length,
    overdue: timings.filter((t) => t.slaStatus === 'overdue').length,
    warning: timings.filter((t) => t.slaStatus === 'warning').length,
    pending: timings.filter((t) => t.slaStatus === 'pending').length,
    compliancePercent: closed.length ? (met / closed.length) * 100 : null,
    avgOfficerMinutes: closed.length
      ? Math.round(closed.reduce((sum, t) => sum + t.officerMinutes, 0) / closed.length)
      : null,
    avgWaitingMinutes: closed.length
      ? Math.round(closed.reduce((sum, t) => sum + t.waitingMinutes, 0) / closed.length)
      : null,
  };
}
