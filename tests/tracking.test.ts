import { describe, expect, it } from 'vitest';
import { buildDashboard, minuteState, visitState, diffMinutes, matchMinuteFlag } from '../src/lib/tracking';
import type { Employee, Minute, Visit } from '../src/db/schema';

const base = { createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' };

function minute(patch: Partial<Minute> = {}): Minute {
  return {
    ...base,
    id: 'm1',
    refNo: 'M-1',
    employeeId: 'e1',
    branchRef: 'فرع أ',
    receivedAt: '2026-10-01T08:00:00.000Z',
    fileRequestedAt: null,
    fileReceivedAt: null,
    reviewStartedAt: null,
    finalResponseAt: null,
    status: 'open',
    observations: '',
    delayReason: '',
    ...patch,
  };
}

function visit(patch: Partial<Visit> = {}): Visit {
  return {
    ...base,
    id: 'v1',
    refNo: 'V-1',
    employeeId: 'e1',
    branchRef: 'فرع أ',
    departureAt: '2026-10-01T07:00:00.000Z',
    arrivalAt: null,
    completedAt: null,
    returnAt: null,
    reportSubmittedAt: null,
    reportReviewedAt: null,
    finalEmailAt: null,
    status: 'in_progress',
    reviewCycles: [],
    observations: '',
    ...patch,
  };
}

const employee: Employee = {
  ...base,
  id: 'e1',
  serial: 1,
  sector: 'القاهرة',
  governorate: 'القاهرة',
  name: 'موظف اختبار',
  code: 'RO-1',
  jobTitle: 'ضابط مخاطر',
  joiningDate: '2025-01-01T00:00:00.000Z',
  visitCount: 3,
  notes: '',
};

const NOW = new Date('2026-10-01T10:00:00.000Z');

describe('diffMinutes', () => {
  it('يحسب الفرق بالدقائق', () => {
    expect(diffMinutes('2026-10-01T08:00:00.000Z', '2026-10-01T09:30:00.000Z')).toBe(90);
  });
  it('يعيد null عند غياب البداية', () => {
    expect(diffMinutes(null, '2026-10-01T09:30:00.000Z')).toBeNull();
  });
});

describe('minuteState', () => {
  it('يميّز عدم طلب الملف عن انتظار الملف', () => {
    const state = minuteState(minute(), 60, NOW);
    expect(state.fileNotRequested).toBe(true);
    expect(state.waitingForFile).toBe(false);
    expect(state.reviewNotStarted).toBe(true);
  });

  it('يحسب انتظار الملف بشكل منفصل عن زمن المراجعة', () => {
    const state = minuteState(
      minute({
        fileRequestedAt: '2026-10-01T08:05:00.000Z',
        fileReceivedAt: '2026-10-01T08:35:00.000Z',
        reviewStartedAt: '2026-10-01T08:40:00.000Z',
        finalResponseAt: '2026-10-01T09:00:00.000Z',
        status: 'completed',
      }),
      60,
      NOW,
    );
    expect(state.waitingMinutes).toBe(30);
    expect(state.reviewMinutes).toBe(20);
    expect(state.totalMinutes).toBe(60);
    expect(state.isOpen).toBe(false);
    expect(state.overdue).toBe(false);
  });

  it('يرصد تجاوز المهلة أثناء المراجعة', () => {
    const state = minuteState(
      minute({ fileRequestedAt: '2026-10-01T08:05:00.000Z', reviewStartedAt: '2026-10-01T08:30:00.000Z' }),
      60,
      NOW,
    );
    expect(state.pendingFinalResponse).toBe(true);
    expect(state.overdue).toBe(true);
    expect(state.overdueBy).toBe(30);
  });

  it('لا يحسب التجاوز للدقيقة المكتملة داخل المهلة', () => {
    const state = minuteState(
      minute({ reviewStartedAt: '2026-10-01T08:30:00.000Z', finalResponseAt: '2026-10-01T09:00:00.000Z', status: 'completed' }),
      60,
      NOW,
    );
    expect(state.overdue).toBe(false);
  });

  it('يطابق عوامل التصفية', () => {
    const state = minuteState(minute({ fileRequestedAt: '2026-10-01T08:05:00.000Z', reviewStartedAt: '2026-10-01T08:30:00.000Z' }), 60, NOW);
    expect(matchMinuteFlag(state, 'pending_response')).toBe(true);
    expect(matchMinuteFlag(state, 'completed')).toBe(false);
    expect(matchMinuteFlag(state, 'all')).toBe(true);
  });
});

describe('visitState', () => {
  it('يرصد انتظار التقرير بعد العودة', () => {
    const state = visitState(visit({ returnAt: '2026-10-01T09:00:00.000Z', status: 'report_pending' }), 60, NOW);
    expect(state.reportPending).toBe(true);
    expect(state.reportDelayMinutes).toBe(60);
  });

  it('يرصد انتظار المراجعة بعد تسليم التقرير', () => {
    const state = visitState(
      visit({ returnAt: '2026-10-01T07:30:00.000Z', reportSubmittedAt: '2026-10-01T08:30:00.000Z' }),
      60,
      NOW,
    );
    expect(state.reportAwaitingReview).toBe(true);
    expect(state.overdue).toBe(true);
  });

  it('يعتبر آخر دورة تحتاج تصحيحًا', () => {
    const state = visitState(
      visit({
        reportSubmittedAt: '2026-10-01T08:00:00.000Z',
        reportReviewedAt: '2026-10-01T08:30:00.000Z',
        reviewCycles: [
          { id: 'c1', seq: 1, reviewedAt: '2026-10-01T08:30:00.000Z', observations: 'أ', corrections: 'ب', outcome: 'corrections' },
        ],
      }),
      60,
      NOW,
    );
    expect(state.needsCorrections).toBe(true);
    expect(state.cycles).toBe(1);
  });
});

describe('buildDashboard', () => {
  it('يجمع مؤشرات اليوم وحِمل العمل', () => {
    const counters = buildDashboard(
      {
        employees: [employee],
        minutes: [
          minute({ id: 'm1' }),
          minute({ id: 'm2', status: 'completed', reviewStartedAt: '2026-10-01T08:00:00.000Z', finalResponseAt: '2026-10-01T09:50:00.000Z' }),
        ],
        visits: [visit({ returnAt: '2026-10-01T09:00:00.000Z', status: 'report_pending' })],
        observations: [
          {
            ...base,
            id: 'o1',
            employeeId: 'e1',
            minuteId: null,
            visitId: null,
            cycleId: null,
            date: '2026-10-01',
            type: 'مستندات',
            text: 'ملاحظة',
            status: 'open',
            resolution: '',
          },
        ],
      },
      60,
      NOW,
    );
    expect(counters.incomingTotal).toBe(2);
    expect(counters.incomingToday).toBe(2);
    expect(counters.fileNotRequested).toBe(1);
    expect(counters.reportsPendingSubmission).toBe(1);
    expect(counters.openObservations).toBe(1);
    expect(counters.workload[0].employee.id).toBe('e1');
    expect(counters.workload[0].openMinutes).toBe(1);
  });
});
