import { describe, expect, it } from 'vitest';
import { computeMinuteTimings, summarizeMinutes } from '../src/lib/minuteCalc';
import type { DisbursementMinute } from '../src/db/schema';
import type { WorkCalendar } from '../src/lib/businessTime';

const calendar: WorkCalendar = {
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4],
  holidays: [],
};

const base: DisbursementMinute = {
  id: 'm1',
  createdAt: '2026-01-04T08:00:00.000Z',
  updatedAt: '2026-01-04T08:00:00.000Z',
  refNo: 'MIN-1',
  branchId: 'b1',
  employeeId: 'e1',
  clientRef: 'CL-1',
  financingType: 'تمويل مشروع صغير',
  amount: 10000,
  outcome: 'approved',
  status: 'completed',
  receivedAt: new Date('2026-01-04T09:00:00').toISOString(),
  fileRequestedAt: null,
  fileReceivedAt: null,
  reviewStartedAt: null,
  clarificationRequestedAt: null,
  clarificationRespondedAt: null,
  finalResponseAt: null,
  notes: '',
};

describe('حساب زمن دقيقة الصرف', () => {
  it('يعتبر الدقيقة داخل المهلة عند الرد قبل انتهائها', () => {
    const timings = computeMinuteTimings(
      { ...base, finalResponseAt: new Date('2026-01-04T09:45:00').toISOString() },
      calendar,
      60,
      80,
    );
    expect(timings.slaStatus).toBe('met');
    expect(timings.elapsedMinutes).toBe(45);
    expect(timings.remainingMinutes).toBe(15);
  });

  it('يرصد تجاوز المهلة عند الرد بعدها', () => {
    const timings = computeMinuteTimings(
      { ...base, finalResponseAt: new Date('2026-01-04T11:00:00').toISOString() },
      calendar,
      60,
      80,
    );
    expect(timings.slaStatus).toBe('breached');
    expect(timings.elapsedMinutes).toBe(120);
  });

  it('يميّز زمن انتظار الفرع من زمن معالجة الضابط', () => {
    const timings = computeMinuteTimings(
      {
        ...base,
        fileRequestedAt: new Date('2026-01-04T09:05:00').toISOString(),
        fileReceivedAt: new Date('2026-01-04T09:35:00').toISOString(),
        finalResponseAt: new Date('2026-01-04T09:55:00').toISOString(),
      },
      calendar,
      60,
      80,
    );
    expect(timings.waitingMinutes).toBe(30);
    // 5 دقائق قبل طلب الملف + 20 دقيقة بعد استلامه
    expect(timings.officerMinutes).toBe(25);
    expect(timings.elapsedMinutes).toBe(55);
    expect(timings.slaStatus).toBe('met');
  });

  it('يحسب انتظار الاستيضاح ضمن زمن الفرع', () => {
    const timings = computeMinuteTimings(
      {
        ...base,
        clarificationRequestedAt: new Date('2026-01-04T09:10:00').toISOString(),
        clarificationRespondedAt: new Date('2026-01-04T10:10:00').toISOString(),
        finalResponseAt: new Date('2026-01-04T10:20:00').toISOString(),
      },
      calendar,
      60,
      80,
    );
    expect(timings.waitingMinutes).toBe(60);
    expect(timings.officerMinutes).toBe(20);
    // 80 دقيقة عمل > 60 → تجاوز
    expect(timings.slaStatus).toBe('breached');
  });

  it('يصنّف الدقيقة المفتوحة المتأخرة كـ «متأخر»', () => {
    const timings = computeMinuteTimings(
      { ...base, status: 'in_progress', finalResponseAt: null },
      calendar,
      60,
      80,
      new Date('2026-01-04T11:30:00'),
    );
    expect(timings.slaStatus).toBe('overdue');
    expect(timings.isClosed).toBe(false);
  });

  it('يعطي تحذيرًا عند الاقتراب من المهلة', () => {
    const timings = computeMinuteTimings(
      { ...base, status: 'in_progress', finalResponseAt: null },
      calendar,
      60,
      80,
      new Date('2026-01-04T09:50:00'),
    );
    expect(timings.slaStatus).toBe('warning');
    expect(timings.percentUsed).toBeGreaterThan(80);
  });

  it('يتعامل مع غياب وقت الاستلام', () => {
    const timings = computeMinuteTimings({ ...base, receivedAt: '' }, calendar, 60);
    expect(timings.slaStatus).toBe('na');
    expect(timings.dueAt).toBeNull();
  });

  it('يلخّص نسب الالتزام', () => {
    const summary = summarizeMinutes([
      computeMinuteTimings({ ...base, finalResponseAt: new Date('2026-01-04T09:30:00').toISOString() }, calendar, 60),
      computeMinuteTimings({ ...base, id: 'm2', finalResponseAt: new Date('2026-01-04T12:00:00').toISOString() }, calendar, 60),
    ]);
    expect(summary.closed).toBe(2);
    expect(summary.met).toBe(1);
    expect(summary.breached).toBe(1);
    expect(summary.compliancePercent).toBe(50);
  });
});
