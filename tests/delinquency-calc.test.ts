import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  BUCKET_IDS,
  bucketForDays,
  branchLabel,
  compareBranches,
  compareSnapshots,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSignedInt,
  fmtSignedMoney,
  fmtSignedPct,
  moneyDiff,
  moneySum,
  normalizeBranch,
  parseNumberInput,
  pctChange,
  periodLabel,
  round2,
  roundMoney,
  MONEY_DECIMALS,
  sharePct,
  snapshotId,
  snapshotTotals,
  sortSnapshots,
  validateSnapshotInput,
} from '../src/delinquency/lib/delinquency';
import { SEP, ZERO, makeSnapshot, oct, sep, toInput } from './delinquency-helpers';

describe('شرائح التأخير', () => {
  it('خمس شرائح بالحدود المطلوبة', () => {
    expect(BUCKETS.map((bucket) => bucket.label)).toEqual([
      '1–30 يوم',
      '31–60 يوم',
      '61–90 يوم',
      '91–120 يوم',
      'أكثر من 120 يوم (NPL)',
    ]);
    expect(BUCKET_IDS).toEqual(['d1_30', 'd31_60', 'd61_90', 'd91_120', 'npl']);
  });

  it('يحدد الشريحة من أيام التأخير عند كل الحدود', () => {
    const cases: Array<[number, string | null]> = [
      [-3, null],
      [0, null],
      [1, 'd1_30'],
      [30, 'd1_30'],
      [31, 'd31_60'],
      [60, 'd31_60'],
      [61, 'd61_90'],
      [90, 'd61_90'],
      [91, 'd91_120'],
      [120, 'd91_120'],
      [121, 'npl'],
      [5000, 'npl'],
    ];
    for (const [days, bucket] of cases) expect(bucketForDays(days)).toBe(bucket);
    expect(bucketForDays(Number.NaN)).toBeNull();
  });
});

describe('الأدوات الرقمية', () => {
  it('تقريب المبالغ لقرشين بلا أخطاء الفاصلة العائمة', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(-2.675)).toBe(-2.68);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(round2(1e21)).toBe(1e21);
  });

  it('المبالغ تُحفظ بثلاث خانات عشرية كما في تقارير المحفظة', () => {
    expect(MONEY_DECIMALS).toBe(3);
    expect(roundMoney(41207.563)).toBe(41207.563);
    expect(roundMoney(88310.27)).toBe(88310.27);
    expect(roundMoney(163500)).toBe(163500);
    expect(roundMoney(1.0005)).toBe(1.001);
    expect(roundMoney(-1.0005)).toBe(-1.001);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(roundMoney(-0.0001), 0)).toBe(true);
    expect(moneySum([41207.563, 88310.27, 120045.119, 37911.008, 512660.341])).toBe(800134.301);
    expect(moneyDiff(800134.301, 615022.79)).toBe(-185111.511);
    const result = validateSnapshotInput({ year: 2031, month: 9, buckets: { d1_30: { clients: 3, amount: '41,207.563' } } });
    expect(result.value.buckets.d1_30).toEqual({ clients: 3, amount: 41207.563 });
  });

  it('جمع وطرح المبالغ بالقروش', () => {
    expect(moneySum([0.1, 0.2])).toBe(0.3);
    expect(moneySum([450000.5, 380000, 290000.25, 210000, 720000])).toBe(2050000.75);
    expect(moneySum([])).toBe(0);
    expect(moneyDiff(0.3, 0.1)).toBe(-0.2);
    expect(moneyDiff(2050000.75, 2218251.35)).toBe(168250.6);
    expect(Object.is(moneyDiff(5.5, 5.5), 0)).toBe(true);
  });

  it('نسبة التغير: أساس صفري ← غير محددة، صفر لصفر ← 0', () => {
    expect(pctChange(100, 150)).toBe(50);
    expect(pctChange(200, 150)).toBe(-25);
    expect(pctChange(5, 0)).toBe(-100);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 5)).toBeNull();
  });

  it('الحصة من إجمالي صفري غير محددة', () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(0, 100)).toBe(0);
    expect(sharePct(10, 0)).toBeNull();
  });

  it('يقرأ الأرقام المكتوبة يدويًا (عربية، فواصل آلاف، علامة عشرية عربية)', () => {
    expect(parseNumberInput('١٢٬٣٤٥٫٦٧')).toBe(12345.67);
    expect(parseNumberInput('1,234,567.5')).toBe(1234567.5);
    expect(parseNumberInput(' 12 000 ')).toBe(12000);
    expect(parseNumberInput('۱۲۳')).toBe(123);
    expect(parseNumberInput('−5')).toBe(-5);
    expect(parseNumberInput('.5')).toBe(0.5);
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
    expect(parseNumberInput(undefined)).toBeNull();
    expect(parseNumberInput('abc')).toBeNaN();
    expect(parseNumberInput('1.2.3')).toBeNaN();
    expect(parseNumberInput('12عميل')).toBeNaN();
    expect(parseNumberInput(42)).toBe(42);
  });

  it('التنسيق بأرقام لاتينية وإشارات واضحة', () => {
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtMoney(2050000.75)).toBe('2,050,000.75');
    expect(fmtMoney(5)).toBe('5.00');
    expect(fmtPct(8.2073)).toBe('8.2%');
    expect(fmtSignedInt(21)).toBe('+21');
    expect(fmtSignedInt(-10)).toBe('−10');
    expect(fmtSignedInt(0)).toBe('0');
    expect(fmtSignedMoney(-39000)).toBe('−39,000.00');
    expect(fmtSignedMoney(168250.6)).toBe('+168,250.60');
    expect(fmtSignedPct(-10.263)).toBe('−10.3%');
    expect(fmtPct(null)).toBe('—');
    expect(fmtMoney(undefined)).toBe('—');
    expect(fmtInt(Number.NaN)).toBe('—');
  });
});

describe('هوية السجل الشهري', () => {
  it('سجل واحد لكل فرع في كل شهر مع توحيد اسم الفرع', () => {
    expect(snapshotId('  فرع   المنيا ', 2026, 9)).toBe('2026-09|فرع المنيا');
    expect(snapshotId('', 2026, 10)).toBe('2026-10|');
    expect(normalizeBranch('  أ   ب ')).toBe('أ ب');
    expect(normalizeBranch(undefined)).toBe('');
    expect(branchLabel('')).toBe('الفرع الرئيسي');
    expect(periodLabel({ year: 2026, month: 9 })).toBe('سبتمبر 2026');
  });

  it('الترتيب زمني ثم بحسب الفرع', () => {
    const rows = sortSnapshots([
      makeSnapshot('ب', 2026, 10, ZERO),
      makeSnapshot('أ', 2026, 10, ZERO),
      makeSnapshot('ب', 2025, 12, ZERO),
      makeSnapshot('أ', 2026, 2, ZERO),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['2025-12|ب', '2026-02|أ', '2026-10|أ', '2026-10|ب']);
  });
});

describe('التحقق من الإدخال الشهري', () => {
  it('يقبل إدخالًا صحيحًا ويقرّب المبالغ ويعامل الفارغ كصفر', () => {
    const result = validateSnapshotInput({
      branch: '  فرع   المنيا ',
      year: '2026',
      month: '9',
      notes: '  ملاحظة ',
      buckets: {
        d1_30: { clients: '١٢٠', amount: '450,000.5055' },
        d31_60: { clients: '', amount: '' },
        npl: { clients: 60, amount: 720000 },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.value.branch).toBe('فرع المنيا');
    expect(result.value.year).toBe(2026);
    expect(result.value.month).toBe(9);
    expect(result.value.notes).toBe('ملاحظة');
    expect(result.value.buckets.d1_30).toEqual({ clients: 120, amount: 450000.506 });
    expect(result.value.buckets.d31_60).toEqual({ clients: 0, amount: 0 });
    expect(result.value.buckets.d61_90).toEqual({ clients: 0, amount: 0 });
    expect(result.value.buckets.npl).toEqual({ clients: 60, amount: 720000 });
  });

  it('يرفض القيم السالبة والكسرية والنصية والخارجة عن الحدود', () => {
    const result = validateSnapshotInput({
      year: 1999,
      month: 13,
      buckets: {
        d1_30: { clients: '-3', amount: '-1' },
        d31_60: { clients: '2.5', amount: 'abc' },
        d61_90: { clients: 'x', amount: '1e3' },
        d91_120: { clients: '100000001', amount: '1000000000000001' },
      },
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        'year',
        'month',
        'd1_30.clients',
        'd1_30.amount',
        'd31_60.clients',
        'd31_60.amount',
        'd61_90.clients',
        'd61_90.amount',
        'd91_120.clients',
        'd91_120.amount',
      ].sort(),
    );
    expect(result.errors['d1_30.clients']).toMatch(/سالبًا/);
    expect(result.errors['d31_60.clients']).toMatch(/صحيحًا/);
    expect(result.errors['d61_90.clients']).toMatch(/رقمًا/);
    expect(result.errors['d91_120.amount']).toMatch(/الحد المسموح/);
    expect(result.warnings).toEqual([]);
  });

  it('يرفض غياب الشهر أو السنة', () => {
    const result = validateSnapshotInput({ year: '', month: null, buckets: {} });
    expect(result.ok).toBe(false);
    expect(result.errors.year).toBeTruthy();
    expect(result.errors.month).toBeTruthy();
  });

  it('ينبّه (دون منع) عند وجود عملاء بلا مبلغ أو مبلغ بلا عملاء', () => {
    const result = validateSnapshotInput({
      year: 2026,
      month: 1,
      buckets: { d1_30: { clients: 5, amount: 0 }, npl: { clients: 0, amount: 900 } },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('1–30');
    expect(result.warnings[1]).toContain('NPL');
  });

  it('شهر كله أصفار إدخال صالح', () => {
    const result = validateSnapshotInput(toInput('', 2026, 1, ZERO));
    expect(result.ok).toBe(true);
    expect(snapshotTotals(result.value.buckets)).toEqual({ clients: 0, amount: 0 });
  });
});

describe('مقارنة شهرين (سبتمبر ← أكتوبر)', () => {
  const comparison = compareSnapshots(sep(), oct());
  const row = (id: string) => comparison.rows.find((item) => item.bucket === id)!;

  it('إجماليات الشهرين وصافي التغير', () => {
    expect(comparison.totals.clientsA).toBe(335);
    expect(comparison.totals.clientsB).toBe(356);
    expect(comparison.totals.clientsDelta).toBe(21);
    expect(comparison.totals.clientsPct).toBeCloseTo((21 / 335) * 100, 10);
    expect(comparison.totals.amountA).toBe(2050000.75);
    expect(comparison.totals.amountB).toBe(2218251.35);
    expect(comparison.totals.amountDelta).toBe(168250.6);
    expect(comparison.totals.amountPct).toBeCloseTo((168250.6 / 2050000.75) * 100, 10);
    expect(comparison.totals.clientsTrend).toBe('up');
    expect(comparison.totals.amountTrend).toBe('up');
    expect(comparison.totals.averageA).toBe(6119.41);
    expect(comparison.totals.averageB).toBe(6231.04);
  });

  it('تغير العملاء والمبلغ والنسب لكل شريحة', () => {
    expect(comparison.rows.map((item) => item.clientsDelta)).toEqual([15, -10, 7, -2, 11]);
    expect(comparison.rows.map((item) => item.amountDelta)).toEqual([48500.25, -39000, 45500.25, -12000, 125250.1]);
    expect(row('d1_30').clientsPct).toBeCloseTo(12.5, 10);
    expect(row('d31_60').clientsPct).toBeCloseTo(-12.5, 10);
    expect(row('d61_90').clientsPct).toBeCloseTo((7 / 45) * 100, 10);
    expect(row('d91_120').clientsPct).toBeCloseTo((-2 / 30) * 100, 10);
    expect(row('npl').clientsPct).toBeCloseTo((11 / 60) * 100, 10);
    expect(row('d1_30').amountPct).toBeCloseTo((48500.25 / 450000.5) * 100, 10);
    expect(row('d31_60').amountPct).toBeCloseTo((-39000 / 380000) * 100, 10);
    expect(row('npl').amountPct).toBeCloseTo((125250.1 / 720000) * 100, 10);
    expect(comparison.rows.map((item) => item.amountTrend)).toEqual(['up', 'down', 'up', 'down', 'up']);
  });

  it('مجموع تغيرات الشرائح = تغير الإجمالي، والحصص مجموعها 100%', () => {
    expect(moneySum(comparison.rows.map((item) => item.amountDelta))).toBe(comparison.totals.amountDelta);
    expect(comparison.rows.reduce((sum, item) => sum + item.clientsDelta, 0)).toBe(comparison.totals.clientsDelta);
    expect(comparison.rows.reduce((sum, item) => sum + (item.amountShareA ?? 0), 0)).toBeCloseTo(100, 9);
    expect(comparison.rows.reduce((sum, item) => sum + (item.amountShareB ?? 0), 0)).toBeCloseTo(100, 9);
    expect(row('npl').amountShareA).toBeCloseTo((720000 / 2050000.75) * 100, 10);
    expect(row('npl').amountShareB).toBeCloseTo((845250.1 / 2218251.35) * 100, 10);
  });

  it('أداء الفرع: إجمالي النقص والزيادة والصافي', () => {
    const { performance } = comparison;
    expect(performance.amountReduction).toBe(51000);
    expect(performance.amountIncrease).toBe(219250.6);
    expect(performance.amountNet).toBe(168250.6);
    expect(moneyDiff(performance.amountReduction, performance.amountIncrease)).toBe(performance.amountNet);
    expect(performance.clientsReduction).toBe(12);
    expect(performance.clientsIncrease).toBe(33);
    expect(performance.clientsNet).toBe(21);
    expect(performance.bucketsIncreased).toBe(3);
    expect(performance.bucketsDecreased).toBe(2);
    expect(performance.bucketsUnchanged).toBe(0);
    expect(performance.status).toBe('net_increase');
  });

  it('أفضل وأسوأ شريحة بحسب صافي تغير المبلغ', () => {
    expect(comparison.best).toBe('d31_60');
    expect(comparison.bestImproved).toBe(true);
    expect(comparison.worst).toBe('npl');
    expect(comparison.worstDeteriorated).toBe(true);
    expect(comparison.ranking).toEqual(['d31_60', 'd91_120', 'd61_90', 'd1_30', 'npl']);
  });

  it('مؤشرات المحفظة', () => {
    const { indicators } = comparison;
    expect(indicators.nplShareA).toBeCloseTo(35.12193837, 6);
    expect(indicators.nplShareB).toBeCloseTo(38.10434286, 6);
    expect(indicators.nplShareDelta).toBeCloseTo(2.98240449, 6);
    expect(indicators.lateShareA).toBeCloseTo(((210000 + 720000) / 2050000.75) * 100, 9);
    expect(indicators.lateShareB).toBeCloseTo(((198000 + 845250.1) / 2218251.35) * 100, 9);
    expect(indicators.largestBucketB).toBe('npl');
    expect(comparison.chronological).toBe(true);
    expect(comparison.samePeriod).toBe(false);
    expect(comparison.warnings).toEqual([]);
  });

  it('عكس الشهرين يعكس الإشارات ويُعلَّم كترتيب غير زمني', () => {
    const reversed = compareSnapshots(oct(), sep());
    expect(reversed.totals.amountDelta).toBe(-168250.6);
    expect(reversed.totals.clientsDelta).toBe(-21);
    expect(reversed.performance.status).toBe('net_reduction');
    expect(reversed.performance.amountReduction).toBe(219250.6);
    expect(reversed.performance.amountIncrease).toBe(51000);
    expect(reversed.best).toBe('npl');
    expect(reversed.worst).toBe('d31_60');
    expect(reversed.chronological).toBe(false);
    expect(reversed.samePeriod).toBe(false);
  });

  it('لا يغيّر كائنات الإدخال', () => {
    const a = sep();
    const b = oct();
    const before = JSON.stringify([a, b]);
    compareSnapshots(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('حالات حدّية في المقارنة', () => {
  it('شهران متطابقان: لا تغير ولا أفضل/أسوأ', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, SEP), makeSnapshot('', 2026, 2, SEP));
    expect(comparison.totals.amountDelta).toBe(0);
    expect(comparison.totals.amountPct).toBe(0);
    expect(comparison.totals.clientsDelta).toBe(0);
    expect(comparison.performance.status).toBe('no_change');
    expect(comparison.performance.amountReduction).toBe(0);
    expect(comparison.performance.amountIncrease).toBe(0);
    expect(comparison.performance.bucketsUnchanged).toBe(5);
    expect(comparison.best).toBeNull();
    expect(comparison.worst).toBeNull();
    expect(comparison.rows.every((item) => item.amountTrend === 'flat' && item.clientsTrend === 'flat')).toBe(true);
  });

  it('نفس الشهر مرتين يُعلَّم samePeriod', () => {
    const comparison = compareSnapshots(sep(), sep());
    expect(comparison.samePeriod).toBe(true);
    expect(comparison.chronological).toBe(false);
  });

  it('أساس صفري: النسب غير محددة لا ما لا نهاية ولا NaN', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, ZERO), makeSnapshot('', 2026, 2, [[5, 1000], [0, 0], [0, 0], [0, 0], [2, 500]]));
    expect(comparison.totals.amountDelta).toBe(1500);
    expect(comparison.totals.amountPct).toBeNull();
    expect(comparison.totals.clientsPct).toBeNull();
    expect(comparison.totals.averageA).toBeNull();
    expect(comparison.rows[0].amountPct).toBeNull();
    expect(comparison.rows[0].clientsPct).toBeNull();
    expect(comparison.rows[1].amountPct).toBe(0);
    expect(comparison.rows.every((item) => item.amountShareA === null)).toBe(true);
    expect(comparison.rows[0].amountShareB).toBeCloseTo(66.6666667, 6);
    expect(comparison.indicators.nplShareA).toBeNull();
    expect(comparison.indicators.nplShareDelta).toBeNull();
    expect(comparison.performance.status).toBe('net_increase');
    expect(comparison.worst).toBe('d1_30');
    expect(comparison.best).toBe('d31_60');
    expect(comparison.bestImproved).toBe(false);
    const flat = JSON.stringify(comparison);
    expect(flat).not.toContain('NaN');
    expect(flat).not.toContain('Infinity');
  });

  it('الوصول إلى صفر: انخفاض 100% وحصص شهر المقارنة غير محددة', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, [[5, 1000], [0, 0], [0, 0], [0, 0], [2, 500]]), makeSnapshot('', 2026, 2, ZERO));
    expect(comparison.totals.amountPct).toBe(-100);
    expect(comparison.totals.clientsPct).toBe(-100);
    expect(comparison.rows[0].amountPct).toBe(-100);
    expect(comparison.rows.every((item) => item.amountShareB === null)).toBe(true);
    expect(comparison.indicators.largestBucketB).toBeNull();
    expect(comparison.performance.status).toBe('net_reduction');
    expect(comparison.performance.amountReduction).toBe(1500);
    expect(comparison.best).toBe('d1_30');
    expect(comparison.bestImproved).toBe(true);
    expect(comparison.worstDeteriorated).toBe(false);
  });

  it('شهران كلاهما أصفار', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, ZERO), makeSnapshot('', 2026, 2, ZERO));
    expect(comparison.totals.amountPct).toBe(0);
    expect(comparison.performance.status).toBe('no_change');
    expect(comparison.best).toBeNull();
    expect(comparison.indicators.nplShareB).toBeNull();
  });

  it('التعادل في تغير المبلغ يُحسم بالنسبة ثم العملاء ثم ترتيب الشريحة', () => {
    // الشريحتان 1–30 و31–60 انخفضتا 1,000؛ الثانية أساسها أصغر ← نسبة انخفاض أكبر ← الأفضل
    const a = makeSnapshot('', 2026, 1, [[10, 10000], [10, 5000], [10, 8000], [10, 8000], [10, 9000]]);
    const b = makeSnapshot('', 2026, 2, [[10, 9000], [10, 4000], [10, 8500], [12, 8500], [10, 9000]]);
    const comparison = compareSnapshots(a, b);
    expect(comparison.best).toBe('d31_60');
    // 61–90 و91–120 زادتا 500 بنفس النسبة؛ الثانية زاد عملاؤها ← الأسوأ
    expect(comparison.worst).toBe('d91_120');
    expect(comparison.ranking).toEqual(['d31_60', 'd1_30', 'npl', 'd61_90', 'd91_120']);
  });

  it('كل الشرائح مرتفعة: «الأفضل» هو الأقل زيادة وليس تحسنًا', () => {
    const a = makeSnapshot('', 2026, 1, [[1, 100], [1, 100], [1, 100], [1, 100], [1, 100]]);
    const b = makeSnapshot('', 2026, 2, [[2, 150], [2, 300], [2, 200], [2, 400], [2, 500]]);
    const comparison = compareSnapshots(a, b);
    expect(comparison.best).toBe('d1_30');
    expect(comparison.bestImproved).toBe(false);
    expect(comparison.worst).toBe('npl');
    expect(comparison.performance.amountReduction).toBe(0);
    expect(comparison.performance.bucketsIncreased).toBe(5);
  });

  it('قروش كثيرة لا تنتج فروقًا عائمة', () => {
    const a = makeSnapshot('', 2026, 1, [[1, 0.1], [1, 0.2], [1, 0.3], [1, 0.7], [1, 1.1]]);
    const b = makeSnapshot('', 2026, 2, [[1, 0.3], [1, 0.1], [1, 0.6], [1, 0.8], [1, 1.4]]);
    const comparison = compareSnapshots(a, b);
    expect(comparison.totals.amountA).toBe(2.4);
    expect(comparison.totals.amountB).toBe(3.2);
    expect(comparison.totals.amountDelta).toBe(0.8);
    expect(comparison.rows.map((item) => item.amountDelta)).toEqual([0.2, -0.1, 0.3, 0.1, 0.3]);
    expect(comparison.performance.amountIncrease).toBe(0.9);
    expect(comparison.performance.amountReduction).toBe(0.1);
  });

  it('بيانات مخزنة تالفة تُعامل كأصفار ولا تُسقط الحساب', () => {
    const broken = { ...sep(), buckets: { d1_30: { clients: 'x', amount: -5 }, npl: { clients: 3.6, amount: '12.3456' } } } as never;
    const comparison = compareSnapshots(broken, oct());
    expect(comparison.a.buckets.d1_30).toEqual({ clients: 0, amount: 0 });
    expect(comparison.a.buckets.d31_60).toEqual({ clients: 0, amount: 0 });
    expect(comparison.a.buckets.npl).toEqual({ clients: 4, amount: 12.346 });
    expect(Number.isFinite(comparison.totals.amountDelta)).toBe(true);
  });

  it('تحذيرات جودة البيانات تذكر الشهر', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, [[5, 0], [0, 0], [0, 0], [0, 0], [0, 0]]), makeSnapshot('', 2026, 2, [[0, 700], [0, 0], [0, 0], [0, 0], [0, 0]]));
    expect(comparison.warnings).toHaveLength(2);
    expect(comparison.warnings[0]).toContain('يناير 2026');
    expect(comparison.warnings[1]).toContain('فبراير 2026');
  });
});

describe('مقارنة الفروع', () => {
  it('ترتب الفروع من الأفضل للأسوأ وتستبعد من ينقصه شهر', () => {
    const rows = compareBranches(
      [
        sep(),
        oct(),
        makeSnapshot('فرع أسيوط', 2026, 9, [[50, 150000], [20, 80000], [10, 60000], [5, 30000], [0, 0]]),
        makeSnapshot('فرع أسيوط', 2026, 10, [[40, 120000], [22, 90000], [9, 50000], [5, 30000], [3, 21000]]),
        makeSnapshot('فرع ناقص', 2026, 9, SEP),
        makeSnapshot('فرع المنيا', 2026, 8, SEP),
      ],
      '2026-09',
      '2026-10',
    );
    expect(rows.map((item) => item.branch)).toEqual(['فرع أسيوط', 'فرع المنيا']);
    expect(rows[0].comparison.totals.amountDelta).toBe(-9000);
    expect(rows[0].comparison.performance.amountReduction).toBe(40000);
    expect(rows[0].comparison.performance.amountIncrease).toBe(31000);
    expect(rows[0].comparison.rows[4].amountPct).toBeNull();
    expect(rows[1].comparison.totals.amountDelta).toBe(168250.6);
  });

  it('لا فروع عند غياب أحد الشهرين', () => {
    expect(compareBranches([sep()], '2026-09', '2026-10')).toEqual([]);
  });
});
