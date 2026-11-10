/**
 * تصدير تحليل ترحيل المتأخرات إلى Excel بكل الحسابات.
 * الحسابات تُكتب كصيغ حية (مع قيمها المحسوبة) حتى يمكن مراجعتها وتدقيقها داخل Excel.
 */

import {
  BUCKETS,
  BUCKET_IDS,
  branchLabel,
  bucketLabel,
  periodLabel,
  snapshotPeriod,
  snapshotTotals,
  sortSnapshots,
  type BranchComparisonRow,
  type Comparison,
  type MonthlySnapshot,
} from './delinquency';
import {
  CAVEAT_COLLECTIONS,
  CAVEAT_MIGRATION,
  CAVEAT_NET_CHANGE,
  TONE_LABELS,
  type ExecutiveSummary,
  type ObservationTone,
} from './delinquencySummary';
import {
  EXIT_STATE_LABEL,
  FROM_STATES,
  NEW_STATE_LABEL,
  TO_STATES,
  buildNetChangeFrame,
  type MigrationResult,
} from './delinquencyMigration';
import {
  absRef,
  buildXlsx,
  cellRef,
  colName,
  resolveSheetNames,
  sheetRef,
  type XlsxCell,
  type XlsxCellInput,
  type XlsxSheet,
  type XlsxStyle,
} from './xlsx';

export interface DelinquencyExportInput {
  comparison: Comparison;
  summary: ExecutiveSummary;
  /** نتيجة الترحيل الفعلي إن توفرت قوائم العملاء للشهرين */
  migration: MigrationResult | null;
  /** كل الشهور المدخلة لنفس الفرع (تُعرض في ورقة البيانات) */
  history?: MonthlySnapshot[];
  /** مقارنة الفروع لنفس الشهرين (اختياري) */
  branches?: BranchComparisonRow[];
  organization?: string;
  /** عنوان وملاحظة المقارنة المحفوظة (اختياري) */
  savedTitle?: string;
  savedNote?: string;
  exportedAt?: Date;
}

export const SHEET_SUMMARY = 'الملخص التنفيذي';
export const SHEET_COMPARISON = 'مقارنة الشرائح';
export const SHEET_PERFORMANCE = 'أداء الفرع';
export const SHEET_MIGRATION = 'مصفوفة الترحيل';
export const SHEET_DATA = 'البيانات الشهرية';
export const SHEET_BRANCHES = 'مقارنة الفروع';

const NA = '—';
const UNAVAILABLE = 'غير متاح';

const c = (v: string | number | null, s: XlsxStyle, f?: string): XlsxCell => (f ? { v, s, f } : { v, s });
const text = (v: string, s: XlsxStyle = 'text'): XlsxCell => ({ v, s });

/** نسبة مئوية (قيمة 12.5) → كسر لخلية Excel (0.125)، أو «—» عند غياب الأساس */
const fraction = (pct: number | null): number | string => (pct === null ? NA : pct / 100);

const TONE_STYLE: Record<ObservationTone, XlsxStyle> = {
  danger: 'toneDanger',
  warning: 'toneWarning',
  success: 'toneSuccess',
  info: 'toneInfo',
};

const STATUS_TEXT: Record<Comparison['performance']['status'], string> = {
  net_increase: 'زيادة صافية في المتأخرات (تدهور)',
  net_reduction: 'انخفاض صافٍ في المتأخرات (تحسن صافٍ — ليس تحصيلًا مؤكدًا)',
  no_change: 'لا تغير في إجمالي المتأخرات',
};

const rowHeightFor = (value: string, charsPerLine: number): number =>
  Math.max(20, Math.ceil(value.length / charsPerLine) * 17 + 4);

const pad2 = (n: number) => String(n).padStart(2, '0');

const stampText = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/* --------------------------- ورقة مقارنة الشرائح --------------------------- */

/** فهرس (يبدأ من 0) أول صف بيانات وصف الإجمالي في ورقة المقارنة */
const CMP_FIRST = 4;
const CMP_TOTAL = CMP_FIRST + BUCKET_IDS.length;

function comparisonSheet(input: DelinquencyExportInput, context: string): XlsxSheet {
  const { comparison } = input;
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const totalRow = CMP_TOTAL + 1;
  const firstRow = CMP_FIRST + 1;
  const lastRow = CMP_TOTAL;

  const rows: XlsxCellInput[][] = [];
  rows.push([text('مقارنة شرائح التأخير بين الشهرين', 'title')]);
  rows.push([text(context, 'subtitle')]);
  rows.push([]);
  rows.push(
    [
      'الشريحة',
      `عدد العملاء — ${labelA}`,
      `عدد العملاء — ${labelB}`,
      'التغير في العملاء',
      'نسبة تغير العملاء',
      `مبلغ المتأخرات — ${labelA}`,
      `مبلغ المتأخرات — ${labelB}`,
      'التغير في المبلغ',
      'نسبة تغير المبلغ',
      `حصة المبلغ — ${labelA}`,
      `حصة المبلغ — ${labelB}`,
      'تغير الحصة (نقطة مئوية)',
      `متوسط المتأخرات للعميل — ${labelA}`,
      `متوسط المتأخرات للعميل — ${labelB}`,
      'تقييم الأداء',
    ].map((label) => text(label, 'header')),
  );

  comparison.rows.forEach((row, index) => {
    const r = firstRow + index;
    const verdict =
      row.bucket === comparison.best
        ? comparison.bestImproved
          ? 'الأفضل أداءً'
          : 'الأقل زيادة'
        : row.bucket === comparison.worst
          ? comparison.worstDeteriorated
            ? 'الأسوأ أداءً'
            : 'الأقل تحسنًا'
          : '';
    rows.push([
      text(bucketLabel(row.bucket), 'textBold'),
      c(row.clientsA, 'int'),
      c(row.clientsB, 'int'),
      c(row.clientsDelta, 'deltaInt', `C${r}-B${r}`),
      c(fraction(row.clientsPct), 'deltaPct', `IF(B${r}=0,IF(C${r}=0,0,"${NA}"),(C${r}-B${r})/B${r})`),
      c(row.amountA, 'money'),
      c(row.amountB, 'money'),
      c(row.amountDelta, 'deltaMoney', `G${r}-F${r}`),
      c(fraction(row.amountPct), 'deltaPct', `IF(F${r}=0,IF(G${r}=0,0,"${NA}"),(G${r}-F${r})/F${r})`),
      c(fraction(row.amountShareA), 'pct', `IF($F$${totalRow}=0,"${NA}",F${r}/$F$${totalRow})`),
      c(fraction(row.amountShareB), 'pct', `IF($G$${totalRow}=0,"${NA}",G${r}/$G$${totalRow})`),
      c(
        row.amountShareDelta === null ? NA : row.amountShareDelta,
        'points',
        `IF(OR($F$${totalRow}=0,$G$${totalRow}=0),"${NA}",(K${r}-J${r})*100)`,
      ),
      c(row.averageA === null ? NA : row.averageA, 'money', `IF(B${r}=0,"${NA}",ROUND(F${r}/B${r},2))`),
      c(row.averageB === null ? NA : row.averageB, 'money', `IF(C${r}=0,"${NA}",ROUND(G${r}/C${r},2))`),
      text(verdict, verdict.includes('الأسوأ') ? 'toneDanger' : verdict.includes('الأفضل') ? 'toneSuccess' : 'text'),
    ]);
  });

  const { totals } = comparison;
  const r = totalRow;
  rows.push([
    text('الإجمالي', 'totalText'),
    c(totals.clientsA, 'totalInt', `SUM(B${firstRow}:B${lastRow})`),
    c(totals.clientsB, 'totalInt', `SUM(C${firstRow}:C${lastRow})`),
    c(totals.clientsDelta, 'totalDeltaInt', `C${r}-B${r}`),
    c(fraction(totals.clientsPct), 'totalDeltaPct', `IF(B${r}=0,IF(C${r}=0,0,"${NA}"),(C${r}-B${r})/B${r})`),
    c(totals.amountA, 'totalMoney', `SUM(F${firstRow}:F${lastRow})`),
    c(totals.amountB, 'totalMoney', `SUM(G${firstRow}:G${lastRow})`),
    c(totals.amountDelta, 'totalDeltaMoney', `G${r}-F${r}`),
    c(fraction(totals.amountPct), 'totalDeltaPct', `IF(F${r}=0,IF(G${r}=0,0,"${NA}"),(G${r}-F${r})/F${r})`),
    c(totals.amountA === 0 ? NA : 1, 'totalPct', `IF(F${r}=0,"${NA}",SUM(J${firstRow}:J${lastRow}))`),
    c(totals.amountB === 0 ? NA : 1, 'totalPct', `IF(G${r}=0,"${NA}",SUM(K${firstRow}:K${lastRow}))`),
    text('', 'totalText'),
    c(totals.averageA === null ? NA : totals.averageA, 'totalMoney', `IF(B${r}=0,"${NA}",ROUND(F${r}/B${r},2))`),
    c(totals.averageB === null ? NA : totals.averageB, 'totalMoney', `IF(C${r}=0,"${NA}",ROUND(G${r}/C${r},2))`),
    text('', 'totalText'),
  ]);

  rows.push([]);
  rows.push([text('التغير = شهر المقارنة − شهر الأساس. الأحمر زيادة في المتأخرات والأخضر انخفاض. «—» تعني عدم وجود أساس للمقارنة (القيمة السابقة صفر).', 'note')]);
  rows.push([text(CAVEAT_NET_CHANGE, 'note')]);
  rows.push([text('تقييم الأداء: الأفضل = أكبر انخفاض صافٍ في المبلغ، الأسوأ = أكبر زيادة صافية في المبلغ.', 'note')]);

  const noteStart = CMP_TOTAL + 2;
  return {
    name: SHEET_COMPARISON,
    rows,
    widths: [26, 16, 16, 15, 14, 20, 20, 18, 14, 14, 14, 16, 20, 20, 16],
    merges: ['A1:O1', 'A2:O2', ...[0, 1, 2].map((offset) => `A${noteStart + offset + 1}:O${noteStart + offset + 1}`)],
    rowHeights: { 0: 26, 3: 38 },
    freezeRows: 4,
  };
}

/* ----------------------------- ورقة أداء الفرع ----------------------------- */

function performanceSheet(input: DelinquencyExportInput, context: string, cmpName: string): XlsxSheet {
  const { comparison } = input;
  const { performance } = comparison;
  const first = CMP_FIRST + 1;
  const last = CMP_TOTAL;
  const total = CMP_TOTAL + 1;
  const range = (col: string) => sheetRef(cmpName, `${col}${first}:${col}${last}`);

  const rows: XlsxCellInput[][] = [];
  rows.push([text('أداء الفرع بين الشهرين', 'title')]);
  rows.push([text(context, 'subtitle')]);
  rows.push([]);
  rows.push([text('المؤشر', 'header'), text('القيمة', 'header'), text('طريقة الحساب', 'header')]);

  // الصفوف تبدأ من الصف 5 في Excel
  rows.push([
    text('إجمالي النقص الصافي في مبالغ الشرائح المنخفضة', 'textBold'),
    c(performance.amountReduction, 'money', `-SUMIF(${range('H')},"<0")`),
    text('مجموع التغيرات السالبة في مبالغ الشرائح (قيمة موجبة). ليس تحصيلًا مؤكدًا.'),
  ]);
  rows.push([
    text('إجمالي الزيادة الصافية في مبالغ الشرائح المرتفعة', 'textBold'),
    c(performance.amountIncrease, 'money', `SUMIF(${range('H')},">0")`),
    text('مجموع التغيرات الموجبة في مبالغ الشرائح.'),
  ]);
  rows.push([
    text('صافي التغير في إجمالي مبلغ المتأخرات', 'totalText'),
    c(performance.amountNet, 'totalDeltaMoney', 'B6-B5'),
    text('الزيادة − النقص = إجمالي شهر المقارنة − إجمالي شهر الأساس.', 'totalText'),
  ]);
  rows.push([
    text('نسبة التغير في إجمالي مبلغ المتأخرات', 'textBold'),
    c(fraction(performance.amountPct), 'deltaPct', sheetRef(cmpName, `I${total}`)),
    text('صافي التغير ÷ إجمالي شهر الأساس.'),
  ]);
  rows.push([
    text('إجمالي النقص الصافي في أعداد عملاء الشرائح المنخفضة', 'textBold'),
    c(performance.clientsReduction, 'int', `-SUMIF(${range('D')},"<0")`),
    text('مجموع التغيرات السالبة في أعداد العملاء (قيمة موجبة).'),
  ]);
  rows.push([
    text('إجمالي الزيادة الصافية في أعداد عملاء الشرائح المرتفعة', 'textBold'),
    c(performance.clientsIncrease, 'int', `SUMIF(${range('D')},">0")`),
    text('مجموع التغيرات الموجبة في أعداد العملاء.'),
  ]);
  rows.push([
    text('صافي التغير في عدد العملاء المتأخرين', 'totalText'),
    c(performance.clientsNet, 'totalDeltaInt', 'B10-B9'),
    text('الزيادة − النقص = عملاء شهر المقارنة − عملاء شهر الأساس.', 'totalText'),
  ]);
  rows.push([
    text('نسبة التغير في عدد العملاء المتأخرين', 'textBold'),
    c(fraction(performance.clientsPct), 'deltaPct', sheetRef(cmpName, `E${total}`)),
    text('صافي التغير ÷ عملاء شهر الأساس.'),
  ]);
  rows.push([
    text('عدد الشرائح التي ارتفع مبلغها', 'textBold'),
    c(performance.bucketsIncreased, 'int', `COUNTIF(${range('H')},">0")`),
    text('من أصل خمس شرائح.'),
  ]);
  rows.push([
    text('عدد الشرائح التي انخفض مبلغها', 'textBold'),
    c(performance.bucketsDecreased, 'int', `COUNTIF(${range('H')},"<0")`),
    text('من أصل خمس شرائح.'),
  ]);
  rows.push([text('الحالة العامة للمتأخرات', 'textBold'), text(STATUS_TEXT[performance.status]), text('بحسب صافي التغير في المبلغ.')]);
  rows.push([
    text('أفضل شريحة أداءً', 'textBold'),
    text(comparison.best ? bucketLabel(comparison.best) : NA),
    text(comparison.best && !comparison.bestImproved ? 'لم تنخفض أي شريحة؛ هذه الأقل زيادة.' : 'أكبر انخفاض صافٍ في المبلغ.'),
  ]);
  rows.push([
    text('أسوأ شريحة أداءً', 'textBold'),
    text(comparison.worst ? bucketLabel(comparison.worst) : NA),
    text(comparison.worst && !comparison.worstDeteriorated ? 'لم ترتفع أي شريحة؛ هذه الأقل انخفاضًا.' : 'أكبر زيادة صافية في المبلغ.'),
  ]);

  rows.push([]);
  const noteStart = rows.length;
  rows.push([text(CAVEAT_COLLECTIONS, 'note')]);
  rows.push([text(CAVEAT_NET_CHANGE, 'note')]);

  return {
    name: SHEET_PERFORMANCE,
    rows,
    widths: [48, 34, 64],
    merges: ['A1:C1', 'A2:C2', `A${noteStart + 1}:C${noteStart + 1}`, `A${noteStart + 2}:C${noteStart + 2}`],
    rowHeights: { 0: 26, [noteStart]: 36, [noteStart + 1]: 22 },
  };
}

/* --------------------------- ورقة مصفوفة الترحيل --------------------------- */

const FROM_LABEL = (state: (typeof FROM_STATES)[number]): string => (state === 'new' ? NEW_STATE_LABEL : bucketLabel(state));
const TO_LABEL = (state: (typeof TO_STATES)[number]): string => (state === 'exit' ? EXIT_STATE_LABEL : bucketLabel(state));

function matrixBlock(
  rows: XlsxCellInput[][],
  title: string,
  migration: MigrationResult,
  kind: 'clients' | 'amount',
): void {
  const valueStyle: XlsxStyle = kind === 'clients' ? 'int' : 'money';
  const totalStyle: XlsxStyle = kind === 'clients' ? 'totalInt' : 'totalMoney';
  rows.push([text(title, 'section'), ...TO_STATES.map(() => text('', 'section')), text('', 'section')]);
  rows.push([
    text('من (شهر الأساس) ↓ / إلى (شهر المقارنة) ←', 'header'),
    ...TO_STATES.map((state) => text(TO_LABEL(state), 'header')),
    text('الإجمالي', 'header'),
  ]);
  const first = rows.length + 1;
  const lastCol = colName(TO_STATES.length);
  for (const from of FROM_STATES) {
    const r = rows.length + 1;
    rows.push([
      text(FROM_LABEL(from), 'textBold'),
      ...TO_STATES.map((to) => {
        if (from === 'new' && to === 'exit') return text(NA, 'na');
        const cell = migration.matrix[from][to];
        return c(kind === 'clients' ? cell.clients : cell.amount ?? 0, valueStyle);
      }),
      c(
        kind === 'clients' ? migration.rowTotals[from].clients : migration.rowTotals[from].amount ?? 0,
        totalStyle,
        `SUM(B${r}:${lastCol}${r})`,
      ),
    ]);
  }
  const last = rows.length;
  rows.push([
    text('الإجمالي', 'totalText'),
    ...TO_STATES.map((to, index) => {
      const col = colName(index + 1);
      return c(
        kind === 'clients' ? migration.columnTotals[to].clients : migration.columnTotals[to].amount ?? 0,
        totalStyle,
        `SUM(${col}${first}:${col}${last})`,
      );
    }),
    c(
      kind === 'clients'
        ? FROM_STATES.reduce((sum, from) => sum + migration.rowTotals[from].clients, 0)
        : Math.round(FROM_STATES.reduce((sum, from) => sum + (migration.rowTotals[from].amount ?? 0) * 100, 0)) / 100,
      totalStyle,
      `SUM(${colName(TO_STATES.length + 1)}${first}:${colName(TO_STATES.length + 1)}${last})`,
    ),
  ]);
}

function migrationSheet(input: DelinquencyExportInput, context: string): XlsxSheet {
  const { comparison, migration } = input;
  const rows: XlsxCellInput[][] = [];
  const merges: string[] = ['A1:H1', 'A2:H2'];
  const rowHeights: Record<number, number> = { 0: 26 };
  const note = (value: string) => {
    rows.push([text(value, 'note')]);
    merges.push(`A${rows.length}:H${rows.length}`);
    rowHeights[rows.length - 1] = rowHeightFor(value, 120);
  };

  if (migration) {
    rows.push([text('مصفوفة الترحيل الفعلية بين شرائح التأخير (بحسب أرقام العملاء)', 'title')]);
    rows.push([text(context, 'subtitle')]);
    rows.push([]);
    matrixBlock(rows, 'عدد العملاء', migration, 'clients');
    rows.push([]);
    if (migration.hasAmounts) {
      matrixBlock(rows, 'مبلغ المتأخرات (رصيد شهر المقارنة؛ وللخارجين رصيد شهر الأساس)', migration, 'amount');
      rows.push([]);
    }

    rows.push([text('حركة عملاء كل شريحة', 'section'), ...Array.from({ length: 7 }, () => text('', 'section'))]);
    rows.push(
      ['الشريحة في شهر الأساس', 'عدد العملاء', 'بقوا في الشريحة', 'انتقلوا لشريحة أسوأ', 'تحسنوا لشريحة أحدث', 'خرجوا من القائمة', 'نسبة الترحيل للأسوأ', 'نسبة الخروج'].map(
        (label) => text(label, 'header'),
      ),
    );
    const flowFirst = rows.length + 1;
    for (const flow of migration.flows) {
      const r = rows.length + 1;
      rows.push([
        text(bucketLabel(flow.bucket), 'textBold'),
        c(flow.startClients, 'int', `C${r}+D${r}+E${r}+F${r}`),
        c(flow.stayed, 'int'),
        c(flow.forward, 'int'),
        c(flow.backward, 'int'),
        c(flow.exited, 'int'),
        c(fraction(flow.forwardRate), 'pct', `IF(B${r}=0,"${NA}",D${r}/B${r})`),
        c(fraction(flow.exitRate), 'pct', `IF(B${r}=0,"${NA}",F${r}/B${r})`),
      ]);
    }
    const flowLast = rows.length;
    const r = rows.length + 1;
    rows.push([
      text('الإجمالي', 'totalText'),
      ...['B', 'C', 'D', 'E', 'F'].map((col, index) =>
        c(
          [migration.clientsA, migration.stayed, migration.forward, migration.backward, migration.exited][index],
          'totalInt',
          `SUM(${col}${flowFirst}:${col}${flowLast})`,
        ),
      ),
      c(fraction(migration.forwardRate), 'totalPct', `IF(B${r}=0,"${NA}",D${r}/B${r})`),
      c(fraction(migration.exitRate), 'totalPct', `IF(B${r}=0,"${NA}",F${r}/B${r})`),
    ]);
    rows.push([]);
    rows.push([text('عملاء دخلوا قائمة المتأخرات (لم يكونوا متأخرين في شهر الأساس)', 'textBold'), c(migration.entered, 'int')]);
    rows.push([text('عملاء انتقلوا إلى شريحة NPL (من شرائح أخرى أو دخول جديد)', 'textBold'), c(migration.intoNpl, 'int')]);
    if (migration.hasAmounts) {
      rows.push([text('رصيد العملاء الخارجين من القائمة (بحسب شهر الأساس) — ليس تحصيلًا مؤكدًا', 'textBold'), c(migration.exitedAmount ?? 0, 'money')]);
      rows.push([text('رصيد العملاء الداخلين الجدد (بحسب شهر المقارنة)', 'textBold'), c(migration.enteredAmount ?? 0, 'money')]);
    }
    rows.push([]);
    note('المصفوفة محسوبة بمطابقة رقم العميل بين قائمتي الشهرين. «خرج من قائمة المتأخرات» يعني أن العميل لم يعد ضمن المتأخرين، دون تحديد السبب (سداد، تسوية، إعادة جدولة، إعدام…).');
    note(CAVEAT_COLLECTIONS);
  } else {
    const frame = buildNetChangeFrame(comparison.a.buckets, comparison.b.buckets);
    rows.push([text('مصفوفة الترحيل — إطار من البيانات الإجمالية (حركة العملاء الفعلية غير متاحة)', 'title')]);
    rows.push([text(context, 'subtitle')]);
    rows.push([]);
    rows.push([text('عدد العملاء', 'section'), ...Array.from({ length: 6 }, () => text('', 'section'))]);
    rows.push([
      text('من (شهر الأساس) ↓ / إلى (شهر المقارنة) ←', 'header'),
      ...BUCKETS.map((bucket) => text(bucket.label, 'header')),
      text(`إجمالي ${periodLabel(comparison.a)}`, 'header'),
    ]);
    const first = rows.length + 1;
    for (const from of BUCKET_IDS) {
      rows.push([
        text(bucketLabel(from), 'textBold'),
        ...BUCKET_IDS.map(() => text(UNAVAILABLE, 'na')),
        c(frame.rowTotals[from].clients, 'totalInt'),
      ]);
    }
    const totalsRow = rows.length + 1;
    rows.push([
      text(`إجمالي ${periodLabel(comparison.b)}`, 'totalText'),
      ...BUCKET_IDS.map((id) => c(frame.columnTotals[id].clients, 'totalInt')),
      text('', 'totalText'),
    ]);
    rows.push([
      text('صافي التغير في العملاء (المقارنة − الأساس)', 'textBold'),
      ...BUCKET_IDS.map((id, index) =>
        c(frame.netClients[id], 'deltaInt', `${cellRef(index + 1, totalsRow - 1)}-${absRef(6, first - 1 + index)}`),
      ),
      text('', 'text'),
    ]);
    rows.push([
      text('صافي التغير في المبلغ (المقارنة − الأساس)', 'textBold'),
      ...BUCKET_IDS.map((id) => c(frame.netAmount[id], 'deltaMoney')),
      text('', 'text'),
    ]);
    rows.push([]);
    note(CAVEAT_MIGRATION);
    note('المعروف من البيانات الإجمالية هو مجاميع الصفوف (أعداد شهر الأساس) ومجاميع الأعمدة (أعداد شهر المقارنة) وصافي التغير فقط. الخلايا الداخلية (من شريحة إلى شريحة) تُترك «غير متاح» عمدًا حتى لا تُختلق أرقام ترحيل.');
    note('لحساب المصفوفة الفعلية: أضف قائمة العملاء (رقم العميل، أيام التأخير، المبلغ اختياريًا) لكل من الشهرين من شاشة إدخال البيانات.');
  }

  return { name: SHEET_MIGRATION, rows, widths: [46, 18, 18, 18, 18, 22, 22, 18], merges, rowHeights };
}

/* --------------------------- ورقة البيانات الشهرية ------------------------- */

function dataSheet(input: DelinquencyExportInput, context: string): XlsxSheet {
  const { comparison } = input;
  const byId = new Map<string, MonthlySnapshot>();
  for (const snapshot of [...(input.history ?? []), comparison.a, comparison.b]) byId.set(`${snapshotPeriod(snapshot)}|${snapshot.branch}`, snapshot);
  // بيانات المقارنة نفسها لها الأولوية (مهم للمقارنات المحفوظة)
  byId.set(`${snapshotPeriod(comparison.a)}|${comparison.a.branch}`, comparison.a);
  byId.set(`${snapshotPeriod(comparison.b)}|${comparison.b.branch}`, comparison.b);
  const history = sortSnapshots(Array.from(byId.values()));

  const rows: XlsxCellInput[][] = [];
  rows.push([text('البيانات الشهرية المدخلة', 'title')]);
  rows.push([text(context, 'subtitle')]);
  rows.push([]);
  rows.push(
    [
      'الشهر',
      'الفرع',
      ...BUCKETS.flatMap((bucket) => [`عملاء ${bucket.short}`, `مبلغ ${bucket.short}`]),
      'إجمالي العملاء',
      'إجمالي المبلغ',
      'ملاحظات',
    ].map((label) => text(label, 'header')),
  );

  const clientCols = BUCKET_IDS.map((_id, index) => colName(2 + index * 2));
  const amountCols = BUCKET_IDS.map((_id, index) => colName(3 + index * 2));
  for (const snapshot of history) {
    const r = rows.length + 1;
    const totals = snapshotTotals(snapshot.buckets);
    rows.push([
      text(periodLabel(snapshot), 'textBold'),
      text(branchLabel(snapshot.branch)),
      ...BUCKET_IDS.flatMap((id) => [c(snapshot.buckets[id].clients, 'int'), c(snapshot.buckets[id].amount, 'money')]),
      c(totals.clients, 'totalInt', clientCols.map((col) => `${col}${r}`).join('+')),
      c(totals.amount, 'totalMoney', amountCols.map((col) => `${col}${r}`).join('+')),
      text(snapshot.notes ?? ''),
    ]);
  }

  return {
    name: SHEET_DATA,
    rows,
    widths: [18, 20, ...BUCKET_IDS.flatMap(() => [13, 18]), 16, 20, 36],
    merges: ['A1:O1', 'A2:O2'],
    rowHeights: { 0: 26, 3: 34 },
    freezeRows: 4,
  };
}

/* ---------------------------- ورقة مقارنة الفروع --------------------------- */

function branchesSheet(input: DelinquencyExportInput, context: string): XlsxSheet {
  const { comparison } = input;
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const rows: XlsxCellInput[][] = [];
  rows.push([text('أداء الفروع بين الشهرين', 'title')]);
  rows.push([text(context, 'subtitle')]);
  rows.push([]);
  rows.push(
    [
      'الفرع',
      `العملاء — ${labelA}`,
      `العملاء — ${labelB}`,
      'التغير في العملاء',
      'نسبة تغير العملاء',
      `المبلغ — ${labelA}`,
      `المبلغ — ${labelB}`,
      'صافي التغير في المبلغ',
      'نسبة تغير المبلغ',
      'إجمالي النقص في الشرائح المنخفضة',
      'إجمالي الزيادة في الشرائح المرتفعة',
    ].map((label) => text(label, 'header')),
  );
  const first = rows.length + 1;
  for (const row of input.branches ?? []) {
    const r = rows.length + 1;
    const { totals, performance } = row.comparison;
    rows.push([
      text(branchLabel(row.branch), 'textBold'),
      c(totals.clientsA, 'int'),
      c(totals.clientsB, 'int'),
      c(totals.clientsDelta, 'deltaInt', `C${r}-B${r}`),
      c(fraction(totals.clientsPct), 'deltaPct', `IF(B${r}=0,IF(C${r}=0,0,"${NA}"),(C${r}-B${r})/B${r})`),
      c(totals.amountA, 'money'),
      c(totals.amountB, 'money'),
      c(totals.amountDelta, 'deltaMoney', `G${r}-F${r}`),
      c(fraction(totals.amountPct), 'deltaPct', `IF(F${r}=0,IF(G${r}=0,0,"${NA}"),(G${r}-F${r})/F${r})`),
      c(performance.amountReduction, 'money'),
      c(performance.amountIncrease, 'money'),
    ]);
  }
  const last = rows.length;
  const r = rows.length + 1;
  const all = (input.branches ?? []).map((row) => row.comparison);
  const sum = (pick: (cmp: Comparison) => number) => Math.round(all.reduce((acc, cmp) => acc + pick(cmp) * 100, 0)) / 100;
  const totalClientsA = sum((cmp) => cmp.totals.clientsA);
  const totalClientsB = sum((cmp) => cmp.totals.clientsB);
  const totalAmountA = sum((cmp) => cmp.totals.amountA);
  const totalAmountB = sum((cmp) => cmp.totals.amountB);
  const pct = (a: number, b: number): number | string => (a === 0 ? (b === 0 ? 0 : NA) : (b - a) / a);
  rows.push([
    text('إجمالي الفروع', 'totalText'),
    c(totalClientsA, 'totalInt', `SUM(B${first}:B${last})`),
    c(totalClientsB, 'totalInt', `SUM(C${first}:C${last})`),
    c(totalClientsB - totalClientsA, 'totalDeltaInt', `C${r}-B${r}`),
    c(pct(totalClientsA, totalClientsB), 'totalDeltaPct', `IF(B${r}=0,IF(C${r}=0,0,"${NA}"),(C${r}-B${r})/B${r})`),
    c(totalAmountA, 'totalMoney', `SUM(F${first}:F${last})`),
    c(totalAmountB, 'totalMoney', `SUM(G${first}:G${last})`),
    c(Math.round((totalAmountB - totalAmountA) * 100) / 100, 'totalDeltaMoney', `G${r}-F${r}`),
    c(pct(totalAmountA, totalAmountB), 'totalDeltaPct', `IF(F${r}=0,IF(G${r}=0,0,"${NA}"),(G${r}-F${r})/F${r})`),
    c(sum((cmp) => cmp.performance.amountReduction), 'totalMoney', `SUM(J${first}:J${last})`),
    c(sum((cmp) => cmp.performance.amountIncrease), 'totalMoney', `SUM(K${first}:K${last})`),
  ]);
  rows.push([]);
  rows.push([text(CAVEAT_COLLECTIONS, 'note')]);

  return {
    name: SHEET_BRANCHES,
    rows,
    widths: [26, 16, 16, 15, 14, 20, 20, 20, 14, 24, 24],
    merges: ['A1:K1', 'A2:K2', `A${rows.length}:K${rows.length}`],
    rowHeights: { 0: 26, 3: 38, [rows.length - 1]: 30 },
    freezeRows: 4,
  };
}

/* --------------------------- ورقة الملخص التنفيذي -------------------------- */

function summarySheet(input: DelinquencyExportInput, context: string, cmpName: string): XlsxSheet {
  const { comparison, summary } = input;
  const { totals, indicators } = comparison;
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const total = CMP_TOTAL + 1;
  const nplRow = CMP_TOTAL; // صف شريحة NPL في ورقة المقارنة (آخر شريحة)
  const lateRow = CMP_TOTAL - 1;
  const ref = (cell: string) => sheetRef(cmpName, cell);

  const rows: XlsxCellInput[][] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = { 0: 28 };
  const merged = (value: string, style: XlsxStyle, charsPerLine = 110) => {
    rows.push([text(value, style), ...Array.from({ length: 4 }, () => text('', style))]);
    merges.push(`A${rows.length}:E${rows.length}`);
    if (style !== 'section' && style !== 'title') rowHeights[rows.length - 1] = rowHeightFor(value, charsPerLine);
  };

  merged('تحليل ترحيل المتأخرات الشهري — الملخص التنفيذي', 'title');
  merged(context, 'subtitle');
  if (input.savedTitle) merged(`المقارنة المحفوظة: ${input.savedTitle}${input.savedNote ? ` — ${input.savedNote}` : ''}`, 'subtitle');
  merged(`تاريخ التصدير: ${stampText(input.exportedAt ?? new Date())}`, 'subtitle');
  rows.push([]);

  merged('الحالة العامة', 'section');
  merged(summary.headline, TONE_STYLE[summary.tone]);
  rows.push([]);

  merged('المؤشرات الرئيسية', 'section');
  rows.push(['المؤشر', labelA, labelB, 'التغير', 'نسبة التغير'].map((label) => text(label, 'header')));

  let r = rows.length + 1;
  rows.push([
    text('إجمالي مبلغ المتأخرات', 'textBold'),
    c(totals.amountA, 'money', ref(`F${total}`)),
    c(totals.amountB, 'money', ref(`G${total}`)),
    c(totals.amountDelta, 'deltaMoney', `C${r}-B${r}`),
    c(fraction(totals.amountPct), 'deltaPct', ref(`I${total}`)),
  ]);
  r = rows.length + 1;
  rows.push([
    text('عدد العملاء المتأخرين', 'textBold'),
    c(totals.clientsA, 'int', ref(`B${total}`)),
    c(totals.clientsB, 'int', ref(`C${total}`)),
    c(totals.clientsDelta, 'deltaInt', `C${r}-B${r}`),
    c(fraction(totals.clientsPct), 'deltaPct', ref(`E${total}`)),
  ]);
  r = rows.length + 1;
  const avgDelta = totals.averageA === null || totals.averageB === null ? NA : Math.round((totals.averageB - totals.averageA) * 100) / 100;
  const avgPct =
    totals.averageA === null || totals.averageB === null ? NA : totals.averageA === 0 ? (totals.averageB === 0 ? 0 : NA) : (totals.averageB - totals.averageA) / totals.averageA;
  rows.push([
    text('متوسط المتأخرات للعميل', 'textBold'),
    c(totals.averageA === null ? NA : totals.averageA, 'money', ref(`M${total}`)),
    c(totals.averageB === null ? NA : totals.averageB, 'money', ref(`N${total}`)),
    c(avgDelta, 'deltaMoney', `IFERROR(ROUND(C${r}-B${r},2),"${NA}")`),
    c(avgPct, 'deltaPct', `IFERROR(IF(B${r}=0,IF(C${r}=0,0,"${NA}"),(C${r}-B${r})/B${r}),"${NA}")`),
  ]);
  r = rows.length + 1;
  rows.push([
    text('حصة NPL (أكثر من 120 يوم) من إجمالي المتأخرات', 'textBold'),
    c(fraction(indicators.nplShareA), 'pct', ref(`J${nplRow}`)),
    c(fraction(indicators.nplShareB), 'pct', ref(`K${nplRow}`)),
    c(indicators.nplShareDelta === null ? NA : indicators.nplShareDelta, 'points', `IFERROR((C${r}-B${r})*100,"${NA}")`),
    text('نقطة مئوية', 'text'),
  ]);
  r = rows.length + 1;
  rows.push([
    text('حصة 91 يومًا فأكثر من إجمالي المتأخرات', 'textBold'),
    c(fraction(indicators.lateShareA), 'pct', `IFERROR(${ref(`J${lateRow}`)}+${ref(`J${nplRow}`)},"${NA}")`),
    c(fraction(indicators.lateShareB), 'pct', `IFERROR(${ref(`K${lateRow}`)}+${ref(`K${nplRow}`)},"${NA}")`),
    c(indicators.lateShareDelta === null ? NA : indicators.lateShareDelta, 'points', `IFERROR((C${r}-B${r})*100,"${NA}")`),
    text('نقطة مئوية', 'text'),
  ]);
  rows.push([
    text('أفضل شريحة أداءً', 'textBold'),
    text(comparison.best ? `${bucketLabel(comparison.best)}${comparison.bestImproved ? '' : ' (الأقل زيادة)'}` : NA),
    text('', 'text'),
    text('', 'text'),
    text('', 'text'),
  ]);
  merges.push(`B${rows.length}:E${rows.length}`);
  rows.push([
    text('أسوأ شريحة أداءً', 'textBold'),
    text(comparison.worst ? `${bucketLabel(comparison.worst)}${comparison.worstDeteriorated ? '' : ' (الأقل تحسنًا)'}` : NA),
    text('', 'text'),
    text('', 'text'),
    text('', 'text'),
  ]);
  merges.push(`B${rows.length}:E${rows.length}`);
  rows.push([]);

  merged('أبرز ملاحظات المخاطر', 'section');
  rows.push([text('المستوى', 'header'), text('الملاحظة', 'header'), text('التفاصيل', 'header'), text('', 'header'), text('', 'header')]);
  merges.push(`C${rows.length}:E${rows.length}`);
  for (const observation of summary.observations) {
    rows.push([
      text(TONE_LABELS[observation.tone], TONE_STYLE[observation.tone]),
      text(observation.title, 'textBold'),
      text(observation.text),
      text('', 'text'),
      text('', 'text'),
    ]);
    merges.push(`C${rows.length}:E${rows.length}`);
    rowHeights[rows.length - 1] = Math.max(rowHeightFor(observation.text, 62), rowHeightFor(observation.title, 30));
  }
  rows.push([]);

  merged('تنبيهات منهجية', 'section');
  for (const caveat of summary.caveats) merged(caveat, 'note', 120);

  return { name: SHEET_SUMMARY, rows, widths: [44, 30, 24, 24, 24], merges, rowHeights };
}

/* --------------------------------- التجميع -------------------------------- */

export function buildDelinquencySheets(input: DelinquencyExportInput): XlsxSheet[] {
  const { comparison } = input;
  const context = [
    input.organization ? `الجهة: ${input.organization}` : '',
    `الفرع: ${branchLabel(comparison.a.branch)}`,
    `شهر الأساس: ${periodLabel(comparison.a)}`,
    `شهر المقارنة: ${periodLabel(comparison.b)}`,
  ]
    .filter(Boolean)
    .join(' — ');

  const withBranches = (input.branches?.length ?? 0) > 1;
  const names = resolveSheetNames([
    SHEET_SUMMARY,
    SHEET_COMPARISON,
    SHEET_PERFORMANCE,
    SHEET_MIGRATION,
    ...(withBranches ? [SHEET_BRANCHES] : []),
    SHEET_DATA,
  ]);
  const cmpName = names[1];

  return [
    summarySheet(input, context, cmpName),
    comparisonSheet(input, context),
    performanceSheet(input, context, cmpName),
    migrationSheet(input, context),
    ...(withBranches ? [branchesSheet(input, context)] : []),
    dataSheet(input, context),
  ];
}

/** يبني ملف Excel الكامل لتحليل المقارنة */
export function buildDelinquencyXlsx(input: DelinquencyExportInput): Uint8Array {
  return buildXlsx(buildDelinquencySheets(input), {
    title: `تحليل ترحيل المتأخرات — ${periodLabel(input.comparison.a)} مقابل ${periodLabel(input.comparison.b)}`,
    creator: input.organization ?? 'إدارة المخاطر',
    date: input.exportedAt,
  });
}

export function delinquencyFileName(comparison: Comparison): string {
  const branch = comparison.a.branch.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return `delinquency-${snapshotPeriod(comparison.a)}-vs-${snapshotPeriod(comparison.b)}${branch ? `-${branch}` : ''}.xlsx`;
}
