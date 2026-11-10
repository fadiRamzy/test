import { describe, expect, it } from 'vitest';
import {
  annualSummary,
  dashboardCounts,
  employmentMonths,
  isMinuteOutstanding,
  leaveTotals,
  minuteDurations,
  minuteTiming,
  monthlyTotals,
  ratingFor,
  monthlyVisitSummary,
  timeDiffMinutes,
  timeDiffMinutesAcrossMidnight,
  visitTiming,
  visitsByMonth,
} from '../src/lib/calc';
import {
  DEFAULT_RATING_THRESHOLDS,
  type DailyMinute,
  type Employee,
  type FieldVisit,
  type Leave,
  type MonthlyEvaluation,
  type VisitTiming,
} from '../src/db/schema';

const base = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

const employee: Employee = {
  ...base,
  id: 'e1',
  employeeNo: 1,
  name: 'موظف اختبار',
  code: 'RO-1',
  sector: 'قطاع القاهرة',
  governorate: 'القاهرة',
  jobTitle: 'ضابط مخاطر',
  employmentDate: '2025-01-01',
  branches: 'فرع أ، فرع ب',
  status: 'active',
  archived: false,
  notes: '',
};

function monthly(patch: Partial<MonthlyEvaluation>): MonthlyEvaluation {
  return {
    ...base,
    id: Math.random().toString(36).slice(2),
    employeeId: 'e1',
    year: 2026,
    month: 1,
    visits: 0,
    scores: {},
    notes: '',
    ...patch,
  };
}

describe('إجمالي التقييم الشهري (معادلة الملف: الزيارات + الدرجات الثمانية)', () => {
  it('يجمع الزيارات مع مجموع الدرجات', () => {
    const totals = monthlyTotals(
      { c1: 5, c2: 4, c3: 3, c4: 4, c5: 5, c6: 4, c7: 3, c8: 5 },
      7,
    );
    expect(totals.scoresSum).toBe(33);
    expect(totals.visits).toBe(7);
    expect(totals.total).toBe(40);
    expect(totals.complete).toBe(true);
  });

  it('يعتبر الصف ناقصًا ويحسب المسجل فقط', () => {
    const totals = monthlyTotals({ c1: 4, c2: 5 }, 3);
    expect(totals.scoresSum).toBe(9);
    expect(totals.total).toBe(12);
    expect(totals.complete).toBe(false);
    expect(totals.missing).toHaveLength(6);
  });

  it('لا يعتبر الزيارات أو الدرجات الناقصة أصفارًا مخترعة', () => {
    const totals = monthlyTotals({}, null);
    expect(totals.total).toBe(0);
    expect(totals.complete).toBe(false);
    expect(totals.visits).toBe(0);
  });
});

describe('عتبات التقدير السنوي من الملف', () => {
  const cases: Array<[number, string]> = [
    [0, 'ضعيف'],
    [239, 'ضعيف'],
    [240, 'مقبول'],
    [279, 'مقبول'],
    [280, 'جيد'],
    [329, 'جيد'],
    [330, 'جيد جدًا'],
    [429, 'جيد جدًا'],
    [430, 'ممتاز'],
    [600, 'ممتاز'],
  ];

  it.each(cases)('%i نقطة ← %s', (points, label) => {
    expect(ratingFor(points, DEFAULT_RATING_THRESHOLDS)).toBe(label);
  });

  it('لا يصدر تقديرًا عند غياب النقاط', () => {
    expect(ratingFor(null, DEFAULT_RATING_THRESHOLDS)).toBeNull();
  });
});

describe('الملخص السنوي', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('يجمع الزيارات والنقاط من الشهور المسجلة فقط ويحدد الناقص', () => {
    const evaluations = [
      monthly({ month: 1, visits: 5, scores: { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5, c6: 5, c7: 5, c8: 5 } }),
      monthly({ month: 2, visits: 3, scores: { c1: 4, c2: 4, c3: 4, c4: 4, c5: 4, c6: 4, c7: 4, c8: 4 } }),
    ];
    const summary = annualSummary(evaluations, employee, 2026, DEFAULT_RATING_THRESHOLDS, now);
    expect(summary.visits).toBe(8);
    expect(summary.points).toBe(40 + 5 + 32 + 3);
    expect(summary.evaluatedMonths).toEqual([1, 2]);
    expect(summary.missingMonths).toEqual([3, 4, 5, 6]);
    expect(summary.completeMonths).toEqual([1, 2]);
  });

  it('لا يحسب تقديرًا لموظف بلا تقييمات', () => {
    const summary = annualSummary([], employee, 2026, DEFAULT_RATING_THRESHOLDS, now);
    expect(summary.points).toBe(0);
    expect(summary.rating).toBeNull();
    expect(summary.evaluatedMonths).toEqual([]);
  });

  it('يطبّق العتبات على مجموع النقاط', () => {
    const evaluations = Array.from({ length: 11 }, (_, index) =>
      monthly({ year: 2025, month: index + 1, visits: 0, scores: { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5, c6: 5, c7: 5, c8: 5 } }),
    );
    const summary = annualSummary(evaluations, employee, 2025, DEFAULT_RATING_THRESHOLDS, now);
    expect(summary.points).toBe(440);
    expect(summary.rating).toBe('ممتاز');
    expect(summary.missingMonths).toEqual([12]);
  });

  it('يحدد الأشهر الناقصة داخل السنة السابقة كاملة', () => {
    const summary = annualSummary([monthly({ year: 2025, month: 3 })], employee, 2025, DEFAULT_RATING_THRESHOLDS, now);
    expect(summary.missingMonths).toHaveLength(11);
    expect(summary.evaluatedMonths).toEqual([3]);
  });

  it('يحسب مدة الخدمة بالأشهر', () => {
    expect(employmentMonths('2025-01-01', 2025, now)).toBe(12);
    expect(employmentMonths('2026-01-01', 2026, now)).toBe(6);
  });
});

describe('ملخص الزيارات الشهري', () => {
  const visit = (patch: Partial<FieldVisit>): FieldVisit => ({
    ...base,
    id: Math.random().toString(36).slice(2),
    employeeId: 'e1',
    region: 'القاهرة',
    branch: 'فرع أ',
    visitDate: '2026-03-05',
    visitType: 'زيارة ميدانية',
    reference: '',
    status: 'completed',
    reportSubmittedAt: null,
    reportReviewedAt: null,
    revisions: null,
    finalAssessment: '',
    notes: '',
    ...patch,
  });

  it('يوزع الزيارات على الشهور ويجمع الإجمالي', () => {
    const summary = visitsByMonth(
      [visit({ visitDate: '2026-01-10' }), visit({ visitDate: '2026-01-20' }), visit({ visitDate: '2026-12-01' })],
      2026,
    );
    expect(summary.byMonth[0]).toBe(2);
    expect(summary.byMonth[11]).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('يستثني الزيارات الملغاة والسنة الأخرى', () => {
    const summary = visitsByMonth([visit({ status: 'cancelled' }), visit({ visitDate: '2025-03-05' })], 2026);
    expect(summary.total).toBe(0);
  });
});

describe('محاضر يومية', () => {
  const minute = (patch: Partial<DailyMinute>): DailyMinute => ({
    ...base,
    id: 'm1',
    employeeId: 'e1',
    fileRequestTime: '',
    fileReceivedTime: '',
    responseTime: '',
    inspectionResult: 'no_notes',
    ...patch,
  });

  it('يحسب المدة بين وقتين', () => {
    expect(timeDiffMinutes('09:00', '10:30')).toBe(90);
    expect(timeDiffMinutes('', '10:30')).toBeNull();
    expect(timeDiffMinutes('10:00', '09:00')).toBeNull();
  });

  it('يحسب مدة الإجراء وانتظار الملف', () => {
    const durations = minuteDurations(minute({ fileRequestTime: '09:05', fileReceivedTime: '09:35', responseTime: '10:20' }));
    expect(durations.totalMinutes).toBe(45);
    expect(durations.fileWaitMinutes).toBe(30);
  });

  it('لا يعدّ المحضر متأخرًا عند 60 دقيقة بالضبط', () => {
    const timing = minuteTiming(minute({ fileReceivedTime: '09:00', responseTime: '10:00' }));
    expect(timing.minutes).toBe(60);
    expect(timing.delayed).toBe(false);
    expect(timing.invalid).toBe(false);
  });

  it('يعدّ المحضر متأخرًا عند تجاوز 60 دقيقة بدقيقة واحدة', () => {
    const timing = minuteTiming(minute({ fileReceivedTime: '09:00', responseTime: '10:01' }));
    expect(timing.minutes).toBe(61);
    expect(timing.delayed).toBe(true);
  });

  it('يرفض المدة السالبة ولا ينتج مؤشر تأخير', () => {
    const timing = minuteTiming(minute({ fileReceivedTime: '10:00', responseTime: '09:00' }));
    expect(timing.minutes).toBeNull();
    expect(timing.delayed).toBe(false);
    expect(timing.invalid).toBe(true);
  });

  it('لا يحسب مدة عند نقص التوقيتات', () => {
    expect(minuteTiming(minute({ fileReceivedTime: '09:00' })).invalid).toBe(true);
    expect(minuteTiming(minute({ responseTime: '10:00' })).invalid).toBe(true);
    expect(minuteTiming(minute({})).minutes).toBeNull();
  });

  it('يعتبر المحضر غير منتهٍ عند غياب وقت الرد', () => {
    expect(isMinuteOutstanding(minute({}))).toBe(true);
    expect(isMinuteOutstanding(minute({ responseTime: '10:00' }))).toBe(false);
  });
});

describe('توقيت الزيارات', () => {
  const visit = (patch: Partial<VisitTiming>): VisitTiming => ({
    ...base,
    id: Math.random().toString(36).slice(2),
    employeeId: 'e1',
    visitDate: '2026-03-10',
    branch: 'فرع أ',
    clientName: 'عميل',
    location: 'المعادي',
    departureTime: '09:00',
    returnTime: '09:35',
    ...patch,
  });

  it('يحسب مدة الزيارة بالدقائق', () => {
    expect(visitTiming(visit({})).minutes).toBe(35);
    expect(visitTiming(visit({ departureTime: '09:00', returnTime: '10:10' })).minutes).toBe(70);
  });

  it('يدعم عبور منتصف الليل', () => {
    expect(timeDiffMinutesAcrossMidnight('23:30', '00:15')).toBe(45);
    expect(visitTiming(visit({ departureTime: '23:30', returnTime: '00:15' })).minutes).toBe(45);
  });

  it('لا ينتج مدة للزيارات ناقصة التوقيت', () => {
    const result = visitTiming(visit({ returnTime: '' }));
    expect(result.minutes).toBeNull();
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('الرجوع');
  });

  it('يلخص الشهر لكل موظف (بلا متوسط) ويستبعد المدد غير الصالحة', () => {
    const summaries = monthlyVisitSummary(
      [
        visit({ id: 'v1', employeeId: 'e1', visitDate: '2026-03-02', departureTime: '09:00', returnTime: '09:35' }),
        visit({ id: 'v2', employeeId: 'e1', visitDate: '2026-03-01', departureTime: '10:00', returnTime: '12:00' }),
        visit({ id: 'v3', employeeId: 'e1', visitDate: '2026-03-03', departureTime: '', returnTime: '' }),
        visit({ id: 'v4', employeeId: 'e2', visitDate: '2026-03-04', departureTime: '08:00', returnTime: '08:30' }),
        visit({ id: 'v5', employeeId: 'e2', visitDate: '2026-04-01', departureTime: '08:00', returnTime: '09:00' }),
      ],
      [
        { id: 'e1', name: 'أحمد' },
        { id: 'e2', name: 'باسم' },
      ],
      2026,
      3,
    );

    const first = summaries.find((row) => row.employeeId === 'e1')!;
    expect(first.totalVisits).toBe(3);
    expect(first.validVisits).toBe(2);
    expect(first.invalidVisits).toBe(1);
    expect(first.totalMinutes).toBe(155);
    expect(first.visits.map((row) => row.visit.id)).toEqual(['v2', 'v1', 'v3']);

    const second = summaries.find((row) => row.employeeId === 'e2')!;
    expect(second.totalVisits).toBe(1); // زيارة أبريل مستبعدة
    expect(second.totalMinutes).toBe(30);
  });

  it('يرجع نتيجة فارغة لشهر بلا زيارات', () => {
    expect(monthlyVisitSummary([visit({})], [{ id: 'e1', name: 'أحمد' }], 2026, 5)).toEqual([]);
  });

  it('يفلتر بموظف واحد عند الطلب', () => {
    const summaries = monthlyVisitSummary(
      [visit({ employeeId: 'e1' }), visit({ employeeId: 'e2' })],
      [
        { id: 'e1', name: 'أحمد' },
        { id: 'e2', name: 'باسم' },
      ],
      2026,
      3,
      'e2',
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0].employeeId).toBe('e2');
  });
});

describe('الإجازات والأذونات', () => {
  const leave = (patch: Partial<Leave>): Leave => ({
    ...base,
    id: Math.random().toString(36).slice(2),
    employeeId: 'e1',
    type: 'إجازة سنوية',
    startDate: '2026-02-01',
    endDate: '2026-02-03',
    unit: 'days',
    days: 3,
    hours: null,
    notes: '',
    ...patch,
  });

  it('يفصل الأيام عن الساعات', () => {
    const totals = leaveTotals([leave({}), leave({ unit: 'hours', days: null, hours: 2 }), leave({ days: 1 })]);
    expect(totals.days).toBe(4);
    expect(totals.hours).toBe(2);
    expect(totals.records).toBe(3);
  });
});

describe('لوحة المتابعة', () => {
  it('يحسب المؤشرات للشهر المختار', () => {
    const counts = dashboardCounts(
      {
        employees: [employee, { ...employee, id: 'e2', employeeNo: 2, name: 'ثانٍ' }],
        evaluations: [monthly({ employeeId: 'e1', month: 3, visits: 2, scores: { c1: 1, c2: 1, c3: 1, c4: 1, c5: 1, c6: 1, c7: 1, c8: 1 } })],
        visits: [
          { ...base, id: 'v1', employeeId: 'e1', region: '', branch: 'ب', visitDate: '2026-03-02', visitType: 'زيارة', reference: '', status: 'completed', reportSubmittedAt: null, reportReviewedAt: null, revisions: null, finalAssessment: '', notes: '' },
        ],
        minutes: [
          { ...base, id: 'm1', employeeId: 'e1', fileRequestTime: '', fileReceivedTime: '09:00', responseTime: '', inspectionResult: 'no_notes' },
        ],
        observations: [
          { ...base, id: 'o1', employeeId: 'e1', date: '2026-03-02', source: 'ملاحظة مباشرة', branch: '', reference: '', category: '', severity: 'low', details: 'ملاحظة', correctiveAction: '', notificationDate: null, status: 'open', resolutionDate: null, recurrence: false, followUpNotes: '' },
        ],
      },
      2026,
      3,
    );

    expect(counts.activeEmployees).toBe(2);
    expect(counts.visitsInPeriod).toBe(1);
    expect(counts.evaluationsCompleted).toBe(1);
    expect(counts.evaluationsMissing).toBe(1);
    expect(counts.employeesWithoutEvaluation.map((row) => row.id)).toEqual(['e2']);
    expect(counts.openObservations).toBe(1);
    expect(counts.outstandingMinutes).toBe(1);
  });
});
