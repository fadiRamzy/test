/**
 * تصدير تقرير المتأخرات الشهري إلى Excel.
 *
 * بنية التقرير: كل صف = فرع واحد.
 *   الفرع | 1-30 | 31-60 | 61-90 | 91-120 | NPL | مبلغ 1-30 | مبلغ 31-60 | مبلغ 61-90 | مبلغ 91-120 | مبلغ NPL | إجمالي العملاء | إجمالي المبلغ
 *
 * عند المقارنة بين شهرين تتكرر نفس البنية ثلاث مرات تحت بعضها:
 *   الشهر السابق، ثم الشهر الحالي، ثم الفرق (الحالي − السابق).
 *
 * الأعداد والمبالغ تُكتب كقيم فعلية؛ الإجماليات والفروق تُكتب كصيغ حية مع قيمها المحسوبة.
 */

import {
  BUCKET_IDS,
  branchLabel,
  moneyDiff,
  moneySum,
  normalizeBranch,
  periodKey,
  periodLabel,
  snapshotPeriod,
  snapshotTotals,
  type MonthlySnapshot,
} from './delinquency';
import { buildXlsx, cellRef, colName, type XlsxCell, type XlsxCellInput, type XlsxSheet, type XlsxStyle } from './xlsx';

export interface ReportPeriod {
  year: number;
  month: number;
}

export interface DelinquencyReportInput {
  /** السجلات الشهرية المتاحة (كل الفروع) — يؤخذ منها ما يخص الشهرين فقط */
  snapshots: MonthlySnapshot[];
  /** الشهر الحالي */
  current: ReportPeriod;
  /** الشهر السابق؛ بدونه يُصدَّر الشهر الحالي وحده */
  previous?: ReportPeriod | null;
  organization?: string;
  exportedAt?: Date;
}

export const SHEET_REPORT = 'تقرير المتأخرات';

/** عناوين الأعمدة بالترتيب المطلوب (العمود الأول اسم الفرع) */
export const REPORT_HEADERS = [
  'الفرع',
  '1-30',
  '31-60',
  '61-90',
  '91-120',
  'NPL',
  'مبلغ 1-30',
  'مبلغ 31-60',
  'مبلغ 61-90',
  'مبلغ 91-120',
  'مبلغ NPL',
  'إجمالي العملاء',
  'إجمالي المبلغ',
] as const;

const BUCKET_COUNT = BUCKET_IDS.length;
const COL_BRANCH = 0;
const COL_CLIENTS = 1;
const COL_AMOUNTS = COL_CLIENTS + BUCKET_COUNT;
const COL_TOTAL_CLIENTS = COL_AMOUNTS + BUCKET_COUNT;
const COL_TOTAL_AMOUNT = COL_TOTAL_CLIENTS + 1;
const LAST_COL = COL_TOTAL_AMOUNT;

const NA = '—';

/* --------------------------------- البيانات -------------------------------- */

/** أرقام صف واحد: خمسة أعداد عملاء، خمسة مبالغ، ثم الإجماليان */
export interface ReportFigures {
  clients: number[];
  amounts: number[];
  totalClients: number;
  totalAmount: number;
}

export interface ReportBranchRow {
  /** اسم الفرع كما يظهر في التقرير */
  branch: string;
  /** null = لا توجد بيانات لهذا الفرع في هذا الشهر */
  figures: ReportFigures | null;
}

export interface ReportSection {
  kind: 'previous' | 'current' | 'difference';
  title: string;
  rows: ReportBranchRow[];
  /** مجموع الفروع التي لها بيانات في هذا القسم */
  total: ReportFigures;
}

export interface DelinquencyReport {
  title: string;
  current: ReportPeriod;
  previous: ReportPeriod | null;
  /** الفروع بالترتيب نفسه في كل الأقسام */
  branches: string[];
  sections: ReportSection[];
  /** يوجد فرع بلا بيانات في أحد الشهرين */
  hasMissing: boolean;
}

function figuresOf(snapshot: MonthlySnapshot): ReportFigures {
  const totals = snapshotTotals(snapshot.buckets);
  return {
    clients: BUCKET_IDS.map((id) => snapshot.buckets[id].clients),
    amounts: BUCKET_IDS.map((id) => snapshot.buckets[id].amount),
    totalClients: totals.clients,
    totalAmount: totals.amount,
  };
}

/** الفرق = الحالي − السابق لكل خانة (المبالغ تُطرح بالقروش لتفادي أخطاء الكسور) */
function differenceOf(previous: ReportFigures, current: ReportFigures): ReportFigures {
  return {
    clients: current.clients.map((value, index) => value - previous.clients[index]),
    amounts: current.amounts.map((value, index) => moneyDiff(previous.amounts[index], value)),
    totalClients: current.totalClients - previous.totalClients,
    totalAmount: moneyDiff(previous.totalAmount, current.totalAmount),
  };
}

function sumFigures(rows: ReportBranchRow[]): ReportFigures {
  const present = rows.map((row) => row.figures).filter((figures): figures is ReportFigures => figures !== null);
  return {
    clients: BUCKET_IDS.map((_, index) => present.reduce((sum, figures) => sum + figures.clients[index], 0)),
    amounts: BUCKET_IDS.map((_, index) => moneySum(present.map((figures) => figures.amounts[index]))),
    totalClients: present.reduce((sum, figures) => sum + figures.totalClients, 0),
    totalAmount: moneySum(present.map((figures) => figures.totalAmount)),
  };
}

const keyOf = (period: ReportPeriod): string => periodKey(period.year, period.month);

/** يجهّز أرقام التقرير (دون أي تنسيق) — كل الحسابات هنا */
export function buildDelinquencyReport(input: DelinquencyReportInput): DelinquencyReport {
  const currentKey = keyOf(input.current);
  const previous = input.previous && keyOf(input.previous) !== currentKey ? input.previous : null;
  const previousKey = previous ? keyOf(previous) : null;

  const byBranch = new Map<string, { previous?: MonthlySnapshot; current?: MonthlySnapshot }>();
  for (const snapshot of input.snapshots) {
    const period = snapshotPeriod(snapshot);
    if (period !== currentKey && period !== previousKey) continue;
    const branch = normalizeBranch(snapshot.branch);
    const entry = byBranch.get(branch) ?? {};
    if (period === currentKey) entry.current = snapshot;
    else entry.previous = snapshot;
    byBranch.set(branch, entry);
  }
  if (!byBranch.size) throw new Error('لا توجد بيانات للتصدير.');

  const ordered = Array.from(byBranch.entries())
    .map(([branch, entry]) => ({ label: branchLabel(branch), entry }))
    .sort((x, y) => x.label.localeCompare(y.label, 'ar'));

  const labelCurrent = periodLabel(input.current);
  const labelPrevious = previous ? periodLabel(previous) : '';
  const chronological = previousKey === null || previousKey < currentKey;

  const section = (kind: ReportSection['kind'], title: string, pick: (entry: (typeof ordered)[number]['entry']) => ReportFigures | null): ReportSection => {
    const rows = ordered.map(({ label, entry }) => ({ branch: label, figures: pick(entry) }));
    return { kind, title, rows, total: sumFigures(rows) };
  };

  const sections: ReportSection[] = [];
  if (previous) {
    sections.push(
      section('previous', `${chronological ? 'الشهر السابق' : 'شهر الأساس'} — ${labelPrevious}`, (entry) =>
        entry.previous ? figuresOf(entry.previous) : null,
      ),
    );
  }
  sections.push(
    section(
      'current',
      previous ? `${chronological ? 'الشهر الحالي' : 'شهر المقارنة'} — ${labelCurrent}` : labelCurrent,
      (entry) => (entry.current ? figuresOf(entry.current) : null),
    ),
  );
  if (previous) {
    sections.push(
      section('difference', `الفرق (${labelCurrent} − ${labelPrevious})`, (entry) =>
        entry.previous && entry.current ? differenceOf(figuresOf(entry.previous), figuresOf(entry.current)) : null,
      ),
    );
  }

  return {
    title: previous ? `تقرير المتأخرات الشهري — ${labelPrevious} مقابل ${labelCurrent}` : `تقرير المتأخرات الشهري — ${labelCurrent}`,
    current: input.current,
    previous,
    branches: ordered.map((item) => item.label),
    sections,
    hasMissing: sections.some((item) => item.kind !== 'difference' && item.rows.some((row) => row.figures === null)),
  };
}

/* ---------------------------------- الورقة -------------------------------- */

const cell = (v: string | number | null, s: XlsxStyle, f?: string): XlsxCell => (f ? { v, s, f } : { v, s });

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateText = (date: Date): string => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** مرجع نطاق أفقي داخل الصف نفسه، مثل B7:F7 */
const rowRange = (fromCol: number, toCol: number, row: number): string => `${cellRef(fromCol, row)}:${cellRef(toCol, row)}`;

/** مواضع صفوف كل قسم داخل الورقة (فهارس تبدأ من 0) */
export interface ReportSectionLayout {
  kind: ReportSection['kind'];
  titleRow: number;
  headerRow: number;
  /** صف كل فرع بترتيب report.branches */
  branchRows: number[];
  /** صف الإجمالي (يظهر عند وجود أكثر من فرع) */
  totalRow: number | null;
}

export function buildReportSheet(report: DelinquencyReport, options: { organization?: string; exportedAt?: Date } = {}): {
  sheet: XlsxSheet;
  layout: ReportSectionLayout[];
} {
  const rows: XlsxCellInput[][] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};
  const layout: ReportSectionLayout[] = [];
  const fullRow = (row: number) => rowRange(COL_BRANCH, LAST_COL, row);

  rows.push([cell(report.title, 'title')]);
  merges.push(fullRow(0));
  rowHeights[0] = 26;

  const organization = (options.organization ?? '').trim();
  rows.push([cell(`${organization ? `${organization} · ` : ''}تاريخ التصدير: ${dateText(options.exportedAt ?? new Date())}`, 'subtitle')]);
  merges.push(fullRow(1));

  const withTotal = report.branches.length > 1;

  for (const section of report.sections) {
    rows.push([]);
    const isDiff = section.kind === 'difference';
    const intStyle: XlsxStyle = isDiff ? 'deltaInt' : 'int';
    const moneyStyle: XlsxStyle = isDiff ? 'deltaMoney' : 'money';
    const totalIntStyle: XlsxStyle = isDiff ? 'totalDeltaInt' : 'totalInt';
    const totalMoneyStyle: XlsxStyle = isDiff ? 'totalDeltaMoney' : 'totalMoney';

    const titleRow = rows.length;
    rows.push([cell(section.title, 'section'), ...Array.from({ length: LAST_COL }, () => cell(null, 'section'))]);
    merges.push(fullRow(titleRow));
    rowHeights[titleRow] = 22;

    const headerRow = rows.length;
    rows.push(REPORT_HEADERS.map((label) => cell(label, 'header')));
    rowHeights[headerRow] = 24;

    const previousLayout = layout.find((item) => item.kind === 'previous');
    const currentLayout = layout.find((item) => item.kind === 'current');

    const branchRows: number[] = [];
    section.rows.forEach((row, index) => {
      const r = rows.length;
      branchRows.push(r);
      const figures = row.figures;
      if (!figures) {
        rows.push([cell(row.branch, 'textBold'), ...Array.from({ length: LAST_COL }, () => cell(NA, 'na'))]);
        return;
      }
      const cells: XlsxCellInput[] = [cell(row.branch, 'textBold')];
      const diffFormula = (col: number): string | undefined =>
        isDiff && previousLayout && currentLayout
          ? `${cellRef(col, currentLayout.branchRows[index])}-${cellRef(col, previousLayout.branchRows[index])}`
          : undefined;
      figures.clients.forEach((value, bucket) => cells.push(cell(value, intStyle, diffFormula(COL_CLIENTS + bucket))));
      figures.amounts.forEach((value, bucket) => cells.push(cell(value, moneyStyle, diffFormula(COL_AMOUNTS + bucket))));
      cells.push(cell(figures.totalClients, intStyle, `SUM(${rowRange(COL_CLIENTS, COL_AMOUNTS - 1, r)})`));
      cells.push(cell(figures.totalAmount, moneyStyle, `SUM(${rowRange(COL_AMOUNTS, COL_TOTAL_CLIENTS - 1, r)})`));
      rows.push(cells);
    });

    let totalRow: number | null = null;
    if (withTotal) {
      totalRow = rows.length;
      const first = branchRows[0];
      const last = branchRows[branchRows.length - 1];
      const columnSum = (col: number) => `SUM(${colName(col)}${first + 1}:${colName(col)}${last + 1})`;
      const cells: XlsxCellInput[] = [cell('الإجمالي', 'totalText')];
      section.total.clients.forEach((value, bucket) => cells.push(cell(value, totalIntStyle, columnSum(COL_CLIENTS + bucket))));
      section.total.amounts.forEach((value, bucket) => cells.push(cell(value, totalMoneyStyle, columnSum(COL_AMOUNTS + bucket))));
      cells.push(cell(section.total.totalClients, totalIntStyle, columnSum(COL_TOTAL_CLIENTS)));
      cells.push(cell(section.total.totalAmount, totalMoneyStyle, columnSum(COL_TOTAL_AMOUNT)));
      rows.push(cells);
    }

    layout.push({ kind: section.kind, titleRow, headerRow, branchRows, totalRow });
  }

  if (report.hasMissing) {
    rows.push([]);
    const noteRow = rows.length;
    rows.push([cell(`${NA} لا توجد بيانات للفرع في هذا الشهر${report.previous ? '؛ الفرق يُحسب للفروع التي لها بيانات في الشهرين فقط' : ''}.`, 'note')]);
    merges.push(fullRow(noteRow));
  }

  const sheet: XlsxSheet = {
    name: SHEET_REPORT,
    rows,
    merges,
    rowHeights,
    widths: [26, ...Array.from({ length: BUCKET_COUNT }, () => 11), ...Array.from({ length: BUCKET_COUNT }, () => 17), 15, 19],
    fitToWidth: true,
  };
  return { sheet, layout };
}

/** يبني ملف ‎.xlsx لتقرير المتأخرات ويعيده كبايتات */
export function buildDelinquencyXlsx(input: DelinquencyReportInput): Uint8Array {
  const report = buildDelinquencyReport(input);
  const exportedAt = input.exportedAt ?? new Date();
  const { sheet } = buildReportSheet(report, { organization: input.organization, exportedAt });
  return buildXlsx([sheet], { title: report.title, creator: (input.organization ?? '').trim() || 'نظام تحليل ترحيل المتأخرات الشهري', date: exportedAt });
}

export function delinquencyFileName(current: ReportPeriod, previous?: ReportPeriod | null): string {
  const currentKey = keyOf(current);
  const previousKey = previous ? keyOf(previous) : null;
  return previousKey && previousKey !== currentKey
    ? `delinquency-report-${previousKey}-vs-${currentKey}.xlsx`
    : `delinquency-report-${currentKey}.xlsx`;
}
