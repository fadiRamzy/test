/**
 * محرك تحليل ترحيل المتأخرات الشهري — دوال حسابية خالصة (بدون واجهة أو تخزين).
 *
 * قواعد منهجية ثابتة:
 *  1) الإدخال الشهري إجمالي فقط: عدد العملاء المتأخرين وإجمالي مبلغ المتأخرات لكل شريحة.
 *  2) الفرق بين شهرين «صافي تغيّر» وليس حركة عملاء فعلية — لا تُستنتج أي أرقام ترحيل من الإجماليات.
 *  3) الترحيل الفعلي يُحسب فقط من قوائم عملاء بأرقام تعريف فردية (انظر delinquencyMigration.ts).
 *  4) صافي انخفاض المتأخرات لا يُصنَّف «تحصيلًا مؤكدًا» دون سجلات تحصيل فعلية.
 */

import { compareBranchNames } from './offices';

/* --------------------------------- الشرائح -------------------------------- */

export const BUCKETS = [
  { id: 'd1_30', label: '1–30 يوم', short: '1–30', from: 1, to: 30 },
  { id: 'd31_60', label: '31–60 يوم', short: '31–60', from: 31, to: 60 },
  { id: 'd61_90', label: '61–90 يوم', short: '61–90', from: 61, to: 90 },
  { id: 'd91_120', label: '91–120 يوم', short: '91–120', from: 91, to: 120 },
  { id: 'npl', label: 'أكثر من 120 يوم (NPL)', short: '+120 (NPL)', from: 121, to: null },
] as const;

export type BucketId = (typeof BUCKETS)[number]['id'];

export const BUCKET_IDS: BucketId[] = BUCKETS.map((bucket) => bucket.id);

export const NPL_BUCKET: BucketId = 'npl';

/** الشرائح المتقدمة (91 يومًا فأكثر) */
export const LATE_BUCKETS: BucketId[] = ['d91_120', 'npl'];

export const bucketIndex = (id: BucketId): number => BUCKET_IDS.indexOf(id);

export const bucketLabel = (id: BucketId): string => BUCKETS[bucketIndex(id)].label;

export const bucketShort = (id: BucketId): string => BUCKETS[bucketIndex(id)].short;

/** يحدد الشريحة من عدد أيام التأخير — يعيد null إذا لم يكن العميل متأخرًا (0 يوم أو أقل) */
export function bucketForDays(days: number): BucketId | null {
  if (!Number.isFinite(days) || days < 1) return null;
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  if (days <= 120) return 'd91_120';
  return 'npl';
}

/* ------------------------------ نموذج البيانات ---------------------------- */

export interface BucketValue {
  /** عدد العملاء المتأخرين في الشريحة */
  clients: number;
  /** إجمالي مبلغ المتأخرات في الشريحة */
  amount: number;
}

export type BucketValues = Record<BucketId, BucketValue>;

export interface MonthlySnapshot {
  /** معرّف ثابت مشتق من الفترة والفرع — انظر snapshotId */
  id: string;
  /** اسم الفرع (قد يكون فارغًا = الفرع الرئيسي) */
  branch: string;
  year: number;
  /** 1..12 */
  month: number;
  buckets: BucketValues;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const MONTH_NAMES_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export const DEFAULT_BRANCH_LABEL = 'الفرع الرئيسي';

export const MAX_CLIENTS = 100_000_000;
export const MAX_AMOUNT = 1_000_000_000_000_000;

export function emptyBuckets(): BucketValues {
  const values = {} as BucketValues;
  for (const id of BUCKET_IDS) values[id] = { clients: 0, amount: 0 };
  return values;
}

export const normalizeBranch = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export const branchLabel = (branch: string): string => normalizeBranch(branch) || DEFAULT_BRANCH_LABEL;

/** مفتاح الفترة YYYY-MM — صالح للترتيب الزمني كنص */
export const periodKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

export const snapshotPeriod = (snapshot: Pick<MonthlySnapshot, 'year' | 'month'>): string =>
  periodKey(snapshot.year, snapshot.month);

/** معرّف السجل الشهري: فترة + فرع (سجل واحد لكل فرع في كل شهر) */
export const snapshotId = (branch: string, year: number, month: number): string =>
  `${periodKey(year, month)}|${normalizeBranch(branch)}`;

export const periodLabel = (snapshot: Pick<MonthlySnapshot, 'year' | 'month'>): string =>
  `${MONTH_NAMES_AR[snapshot.month - 1] ?? '—'} ${snapshot.year}`;

/** ترتيب زمني تصاعدي ثم بحسب الفرع (المكاتب المعتمدة بترتيبها الثابت، ثم الباقي أبجديًا) */
export function sortSnapshots<T extends Pick<MonthlySnapshot, 'year' | 'month' | 'branch'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = snapshotPeriod(a);
    const pb = snapshotPeriod(b);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return compareBranchNames(normalizeBranch(a.branch), normalizeBranch(b.branch));
  });
}

/* ------------------------------ أدوات الأرقام ----------------------------- */

/** يحوّل الأرقام العربية-الهندية والفارسية إلى أرقام لاتينية */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/**
 * يقرأ رقمًا مكتوبًا يدويًا: يقبل الأرقام العربية، فواصل الآلاف (, أو ٬ أو مسافة) والفاصلة العشرية (. أو ٫).
 * يعيد null للنص الفارغ و NaN للنص غير الصالح.
 */
export function parseNumberInput(input: unknown): number | null {
  if (typeof input === 'number') return input;
  if (typeof input !== 'string') return null;
  const text = normalizeDigits(input)
    .replace(/[\s\u00a0\u200e\u200f٬,]/g, '')
    .replace(/٫/g, '.')
    .replace(/−/g, '-');
  if (!text) return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return Number.NaN;
  return Number(text);
}

/** تقريب مالي إلى خانتين عشريتين (نصف للأعلى، متماثل للسالب) دون أخطاء الفاصلة العائمة */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  const abs = Math.abs(value);
  // فوق هذا الحد لا تمثّل الأعداد العائمة كسور القروش أصلًا؛ تُعاد القيمة كما هي
  if (abs >= 1e15) return value;
  const text = String(abs);
  const rounded = text.includes('e') ? Math.round(abs * 100) / 100 : Number(`${Math.round(Number(`${text}e2`))}e-2`);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/**
 * دقة المبالغ: ثلاث خانات عشرية (مليم) — تقارير المحفظة تعرض المبالغ بثلاث خانات
 * ويجب حفظها كما هي دون تقريب. المبالغ ذات الخانتين لا تتأثر.
 */
export const MONEY_DECIMALS = 3;
const MONEY_UNITS = 10 ** MONEY_DECIMALS;

/** تقريب مالي إلى ثلاث خانات عشرية (نصف للأعلى، متماثل للسالب) دون أخطاء الفاصلة العائمة */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  const abs = Math.abs(value);
  if (abs >= 1e15) return value;
  const text = String(abs);
  const rounded = text.includes('e')
    ? Math.round(abs * MONEY_UNITS) / MONEY_UNITS
    : Number(`${Math.round(Number(`${text}e${MONEY_DECIMALS}`))}e-${MONEY_DECIMALS}`);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

const toUnits = (value: number): number => Math.round(roundMoney(value) * MONEY_UNITS);

/** فرق مالي دقيق (ب − أ) بالمليم ثم يعاد إلى ثلاث خانات */
export const moneyDiff = (a: number, b: number): number => {
  const diff = (toUnits(b) - toUnits(a)) / MONEY_UNITS;
  return Object.is(diff, -0) ? 0 : diff;
};

/** مجموع مالي دقيق */
export const moneySum = (values: number[]): number => values.reduce((sum, value) => sum + toUnits(value), 0) / MONEY_UNITS;

/**
 * نسبة التغير المئوية من أ إلى ب.
 * - أ = 0 و ب = 0 → 0
 * - أ = 0 و ب ≠ 0 → null (لا يوجد أساس للمقارنة؛ لا تُعرض نسبة مضللة)
 */
export function pctChange(a: number, b: number): number | null {
  if (a === 0) return b === 0 ? 0 : null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** حصة الجزء من الكل كنسبة مئوية — null عندما يكون الكل صفرًا */
export function sharePct(part: number, total: number): number | null {
  if (total === 0) return null;
  return (part / total) * 100;
}

/** متوسط المتأخرات للعميل — null عند عدم وجود عملاء */
export function averagePerClient(amount: number, clients: number): number | null {
  if (clients === 0) return null;
  return round2(amount / clients);
}

/* --------------------------------- التحقق -------------------------------- */

export interface SnapshotInput {
  branch?: string;
  year?: number | string | null;
  month?: number | string | null;
  buckets?: Partial<Record<BucketId, { clients?: unknown; amount?: unknown }>>;
  notes?: string;
}

export interface SnapshotValidation {
  ok: boolean;
  /** أخطاء تمنع الحفظ — المفتاح: year | month | `${bucket}.clients` | `${bucket}.amount` */
  errors: Record<string, string>;
  /** ملاحظات جودة بيانات لا تمنع الحفظ */
  warnings: string[];
  /** القيم المنظَّفة (صالحة للاستخدام عند ok = true) */
  value: { branch: string; year: number; month: number; buckets: BucketValues; notes: string };
}

/** يتحقق من مدخلات شهر واحد وينظّفها (أعداد صحيحة غير سالبة، مبالغ غير سالبة حتى ثلاث خانات عشرية) */
export function validateSnapshotInput(input: SnapshotInput): SnapshotValidation {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  const year = parseNumberInput(typeof input.year === 'number' ? input.year : String(input.year ?? ''));
  const month = parseNumberInput(typeof input.month === 'number' ? input.month : String(input.month ?? ''));

  if (year === null || !Number.isInteger(year) || year < 2000 || year > 2100) errors.year = 'أدخل سنة صحيحة (2000–2100).';
  if (month === null || !Number.isInteger(month) || month < 1 || month > 12) errors.month = 'اختر الشهر.';

  const buckets = emptyBuckets();
  for (const bucket of BUCKETS) {
    const raw = input.buckets?.[bucket.id] ?? {};

    const clients = parseNumberInput(raw.clients ?? '');
    if (clients === null) buckets[bucket.id].clients = 0;
    else if (Number.isNaN(clients)) errors[`${bucket.id}.clients`] = 'عدد العملاء يجب أن يكون رقمًا.';
    else if (clients < 0) errors[`${bucket.id}.clients`] = 'عدد العملاء لا يمكن أن يكون سالبًا.';
    else if (!Number.isInteger(clients)) errors[`${bucket.id}.clients`] = 'عدد العملاء يجب أن يكون عددًا صحيحًا.';
    else if (clients > MAX_CLIENTS) errors[`${bucket.id}.clients`] = 'عدد العملاء أكبر من الحد المسموح.';
    else buckets[bucket.id].clients = clients;

    const amount = parseNumberInput(raw.amount ?? '');
    if (amount === null) buckets[bucket.id].amount = 0;
    else if (Number.isNaN(amount)) errors[`${bucket.id}.amount`] = 'المبلغ يجب أن يكون رقمًا.';
    else if (amount < 0) errors[`${bucket.id}.amount`] = 'المبلغ لا يمكن أن يكون سالبًا.';
    else if (amount > MAX_AMOUNT) errors[`${bucket.id}.amount`] = 'المبلغ أكبر من الحد المسموح.';
    else buckets[bucket.id].amount = roundMoney(amount);
  }

  if (!Object.keys(errors).length) warnings.push(...bucketQualityWarnings(buckets));

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    warnings,
    value: {
      branch: normalizeBranch(input.branch),
      year: year ?? 0,
      month: month ?? 0,
      buckets,
      notes: (input.notes ?? '').trim(),
    },
  };
}

/** ملاحظات اتساق: عملاء دون مبلغ أو مبلغ دون عملاء */
export function bucketQualityWarnings(buckets: BucketValues, context = ''): string[] {
  const prefix = context ? `${context}: ` : '';
  const warnings: string[] = [];
  for (const bucket of BUCKETS) {
    const value = buckets[bucket.id];
    if (value.clients > 0 && value.amount === 0)
      warnings.push(`${prefix}شريحة ${bucket.label} بها عملاء دون مبلغ متأخرات.`);
    if (value.amount > 0 && value.clients === 0)
      warnings.push(`${prefix}شريحة ${bucket.label} بها مبلغ متأخرات دون عملاء.`);
  }
  return warnings;
}

/** يضمن بنية شرائح كاملة وصالحة لأي سجل مخزَّن (حماية من بيانات ناقصة أو قديمة) */
export function sanitizeBuckets(input: unknown): BucketValues {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, { clients?: unknown; amount?: unknown }>;
  const buckets = emptyBuckets();
  for (const id of BUCKET_IDS) {
    const clients = Number(source[id]?.clients);
    const amount = Number(source[id]?.amount);
    buckets[id] = {
      clients: Number.isFinite(clients) && clients > 0 ? Math.round(clients) : 0,
      amount: Number.isFinite(amount) && amount > 0 ? roundMoney(amount) : 0,
    };
  }
  return buckets;
}

/* -------------------------------- الإجماليات ------------------------------ */

export interface Totals {
  clients: number;
  amount: number;
}

export function snapshotTotals(buckets: BucketValues): Totals {
  return {
    clients: BUCKET_IDS.reduce((sum, id) => sum + buckets[id].clients, 0),
    amount: moneySum(BUCKET_IDS.map((id) => buckets[id].amount)),
  };
}

/* --------------------------------- المقارنة ------------------------------- */

export type Trend = 'up' | 'down' | 'flat';

const trendOf = (delta: number): Trend => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');

export interface ComparisonRow {
  bucket: BucketId;
  clientsA: number;
  clientsB: number;
  clientsDelta: number;
  clientsPct: number | null;
  clientsTrend: Trend;
  amountA: number;
  amountB: number;
  amountDelta: number;
  amountPct: number | null;
  amountTrend: Trend;
  /** حصة الشريحة من إجمالي مبلغ المتأخرات (٪) */
  amountShareA: number | null;
  amountShareB: number | null;
  /** تغير الحصة بالنقاط المئوية */
  amountShareDelta: number | null;
  clientsShareA: number | null;
  clientsShareB: number | null;
  /** متوسط المتأخرات للعميل */
  averageA: number | null;
  averageB: number | null;
}

export interface ComparisonTotals {
  clientsA: number;
  clientsB: number;
  clientsDelta: number;
  clientsPct: number | null;
  clientsTrend: Trend;
  amountA: number;
  amountB: number;
  amountDelta: number;
  amountPct: number | null;
  amountTrend: Trend;
  averageA: number | null;
  averageB: number | null;
}

/**
 * أداء الفرع بين الشهرين.
 * «النقص» و«الزيادة» هنا مجاميع التغيرات الصافية للشرائح، وليست تحصيلات أو صرفًا مؤكدًا.
 */
export interface BranchPerformance {
  /** مجموع النقص الصافي في مبالغ الشرائح التي انخفضت (قيمة موجبة) */
  amountReduction: number;
  /** مجموع الزيادة الصافية في مبالغ الشرائح التي ارتفعت */
  amountIncrease: number;
  /** صافي التغير الكلي في مبلغ المتأخرات = الزيادة − النقص */
  amountNet: number;
  amountPct: number | null;
  clientsReduction: number;
  clientsIncrease: number;
  clientsNet: number;
  clientsPct: number | null;
  bucketsIncreased: number;
  bucketsDecreased: number;
  bucketsUnchanged: number;
  /** اتجاه المتأخرات الكلي بحسب المبلغ */
  status: 'net_reduction' | 'net_increase' | 'no_change';
}

export interface PortfolioIndicators {
  /** حصة شريحة NPL من إجمالي مبلغ المتأخرات (٪) — ليست نسبة من إجمالي المحفظة القائمة */
  nplShareA: number | null;
  nplShareB: number | null;
  nplShareDelta: number | null;
  /** حصة 91 يومًا فأكثر من إجمالي مبلغ المتأخرات (٪) */
  lateShareA: number | null;
  lateShareB: number | null;
  lateShareDelta: number | null;
  /** حصة شريحة 1–30 من إجمالي مبلغ المتأخرات (٪) */
  earlyShareA: number | null;
  earlyShareB: number | null;
  /** أكبر شريحة تركّزًا بالمبلغ في شهر المقارنة */
  largestBucketB: BucketId | null;
}

export interface Comparison {
  a: MonthlySnapshot;
  b: MonthlySnapshot;
  rows: ComparisonRow[];
  totals: ComparisonTotals;
  performance: BranchPerformance;
  indicators: PortfolioIndicators;
  /** أفضل شريحة أداءً (أكبر انخفاض صافٍ بالمبلغ) — null عند انعدام أي تغير */
  best: BucketId | null;
  /** أسوأ شريحة أداءً (أكبر زيادة صافية بالمبلغ) — null عند انعدام أي تغير */
  worst: BucketId | null;
  /** هل سجلت أفضل شريحة انخفاضًا فعليًا؟ (false = كل الشرائح ارتفعت أو ثبتت) */
  bestImproved: boolean;
  /** هل سجلت أسوأ شريحة زيادة فعلية؟ (false = كل الشرائح انخفضت أو ثبتت) */
  worstDeteriorated: boolean;
  /** ترتيب الشرائح من الأفضل إلى الأسوأ */
  ranking: BucketId[];
  /** هل شهر الأساس أقدم من شهر المقارنة؟ */
  chronological: boolean;
  samePeriod: boolean;
  /** ملاحظات جودة البيانات */
  warnings: string[];
}

const sumShare = (buckets: BucketValues, ids: BucketId[], total: number): number | null =>
  sharePct(moneySum(ids.map((id) => buckets[id].amount)), total);

const diffOrNull = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : b - a);

/**
 * ترتيب الأداء: الأقل تغيرًا صافيًا بالمبلغ أفضل (الانخفاض الأكبر أولًا).
 * عند التعادل: نسبة التغير، ثم تغير عدد العملاء، ثم الشريحة الأقل خطورة أولًا.
 */
function rankRows(rows: ComparisonRow[]): ComparisonRow[] {
  const pct = (value: number | null) => (value === null ? Number.POSITIVE_INFINITY : value);
  return [...rows].sort((x, y) => {
    if (x.amountDelta !== y.amountDelta) return x.amountDelta - y.amountDelta;
    if (pct(x.amountPct) !== pct(y.amountPct)) return pct(x.amountPct) - pct(y.amountPct);
    if (x.clientsDelta !== y.clientsDelta) return x.clientsDelta - y.clientsDelta;
    return bucketIndex(x.bucket) - bucketIndex(y.bucket);
  });
}

/** يقارن شهرين (أ = شهر الأساس، ب = شهر المقارنة) ويحسب كل المؤشرات: ب − أ */
export function compareSnapshots(a: MonthlySnapshot, b: MonthlySnapshot): Comparison {
  const bucketsA = sanitizeBuckets(a.buckets);
  const bucketsB = sanitizeBuckets(b.buckets);
  const totalA = snapshotTotals(bucketsA);
  const totalB = snapshotTotals(bucketsB);

  const rows: ComparisonRow[] = BUCKET_IDS.map((bucket) => {
    const va = bucketsA[bucket];
    const vb = bucketsB[bucket];
    const clientsDelta = vb.clients - va.clients;
    const amountDelta = moneyDiff(va.amount, vb.amount);
    const amountShareA = sharePct(va.amount, totalA.amount);
    const amountShareB = sharePct(vb.amount, totalB.amount);
    return {
      bucket,
      clientsA: va.clients,
      clientsB: vb.clients,
      clientsDelta,
      clientsPct: pctChange(va.clients, vb.clients),
      clientsTrend: trendOf(clientsDelta),
      amountA: va.amount,
      amountB: vb.amount,
      amountDelta,
      amountPct: pctChange(va.amount, vb.amount),
      amountTrend: trendOf(amountDelta),
      amountShareA,
      amountShareB,
      amountShareDelta: diffOrNull(amountShareA, amountShareB),
      clientsShareA: sharePct(va.clients, totalA.clients),
      clientsShareB: sharePct(vb.clients, totalB.clients),
      averageA: averagePerClient(va.amount, va.clients),
      averageB: averagePerClient(vb.amount, vb.clients),
    };
  });

  const clientsDeltaTotal = totalB.clients - totalA.clients;
  const amountDeltaTotal = moneyDiff(totalA.amount, totalB.amount);

  const totals: ComparisonTotals = {
    clientsA: totalA.clients,
    clientsB: totalB.clients,
    clientsDelta: clientsDeltaTotal,
    clientsPct: pctChange(totalA.clients, totalB.clients),
    clientsTrend: trendOf(clientsDeltaTotal),
    amountA: totalA.amount,
    amountB: totalB.amount,
    amountDelta: amountDeltaTotal,
    amountPct: pctChange(totalA.amount, totalB.amount),
    amountTrend: trendOf(amountDeltaTotal),
    averageA: averagePerClient(totalA.amount, totalA.clients),
    averageB: averagePerClient(totalB.amount, totalB.clients),
  };

  const performance: BranchPerformance = {
    amountReduction: moneySum(rows.filter((row) => row.amountDelta < 0).map((row) => -row.amountDelta)),
    amountIncrease: moneySum(rows.filter((row) => row.amountDelta > 0).map((row) => row.amountDelta)),
    amountNet: amountDeltaTotal,
    amountPct: totals.amountPct,
    clientsReduction: rows.filter((row) => row.clientsDelta < 0).reduce((sum, row) => sum - row.clientsDelta, 0),
    clientsIncrease: rows.filter((row) => row.clientsDelta > 0).reduce((sum, row) => sum + row.clientsDelta, 0),
    clientsNet: clientsDeltaTotal,
    clientsPct: totals.clientsPct,
    bucketsIncreased: rows.filter((row) => row.amountDelta > 0).length,
    bucketsDecreased: rows.filter((row) => row.amountDelta < 0).length,
    bucketsUnchanged: rows.filter((row) => row.amountDelta === 0).length,
    status: amountDeltaTotal < 0 ? 'net_reduction' : amountDeltaTotal > 0 ? 'net_increase' : 'no_change',
  };

  const nplShareA = sharePct(bucketsA[NPL_BUCKET].amount, totalA.amount);
  const nplShareB = sharePct(bucketsB[NPL_BUCKET].amount, totalB.amount);
  const lateShareA = sumShare(bucketsA, LATE_BUCKETS, totalA.amount);
  const lateShareB = sumShare(bucketsB, LATE_BUCKETS, totalB.amount);

  let largestBucketB: BucketId | null = null;
  for (const row of rows) {
    if (row.amountB <= 0) continue;
    if (largestBucketB === null || row.amountB > bucketsB[largestBucketB].amount) largestBucketB = row.bucket;
  }

  const indicators: PortfolioIndicators = {
    nplShareA,
    nplShareB,
    nplShareDelta: diffOrNull(nplShareA, nplShareB),
    lateShareA,
    lateShareB,
    lateShareDelta: diffOrNull(lateShareA, lateShareB),
    earlyShareA: sharePct(bucketsA.d1_30.amount, totalA.amount),
    earlyShareB: sharePct(bucketsB.d1_30.amount, totalB.amount),
    largestBucketB,
  };

  const ranked = rankRows(rows);
  const anyChange = rows.some((row) => row.amountDelta !== 0 || row.clientsDelta !== 0);
  const bestRow = anyChange ? ranked[0] : null;
  const worstRow = anyChange ? ranked[ranked.length - 1] : null;

  const periodA = snapshotPeriod(a);
  const periodB = snapshotPeriod(b);

  return {
    a: { ...a, buckets: bucketsA },
    b: { ...b, buckets: bucketsB },
    rows,
    totals,
    performance,
    indicators,
    best: bestRow?.bucket ?? null,
    worst: worstRow?.bucket ?? null,
    bestImproved: bestRow ? bestRow.amountDelta < 0 : false,
    worstDeteriorated: worstRow ? worstRow.amountDelta > 0 : false,
    ranking: ranked.map((row) => row.bucket),
    chronological: periodA < periodB,
    samePeriod: periodA === periodB,
    warnings: [
      ...bucketQualityWarnings(bucketsA, periodLabel(a)),
      ...bucketQualityWarnings(bucketsB, periodLabel(b)),
    ],
  };
}

/* ------------------------------ مقارنة الفروع ------------------------------ */

export interface BranchComparisonRow {
  branch: string;
  comparison: Comparison;
}

/**
 * يقارن نفس الشهرين لكل فرع لديه بيانات في الفترتين.
 * @param periodA مفتاح الفترة YYYY-MM لشهر الأساس
 * @param periodB مفتاح الفترة YYYY-MM لشهر المقارنة
 */
export function compareBranches(snapshots: MonthlySnapshot[], periodA: string, periodB: string): BranchComparisonRow[] {
  const byBranch = new Map<string, { a?: MonthlySnapshot; b?: MonthlySnapshot }>();
  for (const snapshot of snapshots) {
    const branch = normalizeBranch(snapshot.branch);
    const period = snapshotPeriod(snapshot);
    if (period !== periodA && period !== periodB) continue;
    const entry = byBranch.get(branch) ?? {};
    if (period === periodA) entry.a = snapshot;
    if (period === periodB) entry.b = snapshot;
    byBranch.set(branch, entry);
  }
  const rows: BranchComparisonRow[] = [];
  for (const [branch, entry] of byBranch) {
    if (entry.a && entry.b) rows.push({ branch, comparison: compareSnapshots(entry.a, entry.b) });
  }
  return rows.sort((x, y) => x.comparison.totals.amountDelta - y.comparison.totals.amountDelta);
}

/* ------------------------------- التنسيق ---------------------------------- */

const LOCALE = 'ar-EG-u-nu-latn';
const intFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: MONEY_DECIMALS });
const pctFmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compactFmt = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });

const isMissing = (value: number | null | undefined): value is null | undefined =>
  value === null || value === undefined || Number.isNaN(value);

export const fmtInt = (value: number | null | undefined): string => (isMissing(value) ? '—' : intFmt.format(value));

export const fmtMoney = (value: number | null | undefined): string => (isMissing(value) ? '—' : moneyFmt.format(value));

export const fmtCompact = (value: number | null | undefined): string => (isMissing(value) ? '—' : compactFmt.format(value));

/** نسبة مئوية بلا إشارة: 12.5% */
export const fmtPct = (value: number | null | undefined): string => (isMissing(value) ? '—' : `${pctFmt.format(value)}%`);

const sign = (value: number): string => (value > 0 ? '+' : value < 0 ? '−' : '');

/** عدد صحيح بإشارة: +12 / −5 / 0 */
export const fmtSignedInt = (value: number | null | undefined): string =>
  isMissing(value) ? '—' : `${sign(value)}${intFmt.format(Math.abs(value))}`;

export const fmtSignedMoney = (value: number | null | undefined): string =>
  isMissing(value) ? '—' : `${sign(value)}${moneyFmt.format(Math.abs(value))}`;

export const fmtSignedPct = (value: number | null | undefined): string =>
  isMissing(value) ? '—' : `${sign(value)}${pctFmt.format(Math.abs(value))}%`;

/** فرق بالنقاط المئوية بإشارة: +2.4 نقطة */
export const fmtSignedPoints = (value: number | null | undefined): string =>
  isMissing(value) ? '—' : `${sign(value)}${pctFmt.format(Math.abs(value))} نقطة`;
