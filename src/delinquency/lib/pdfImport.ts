/**
 * نموذج مراجعة بيانات PDF قبل الحفظ: جدول المكاتب التسعة عشر بخانات قابلة للتعديل.
 * دوال خالصة: تحويل نتيجة القراءة إلى خانات نصية، تقييم كل صف، وتجهيز السجلات للحفظ والتصدير.
 *
 * القاعدة: الخانة الفارغة ليست صفرًا. لا يُحفظ صف إلا إذا كانت خاناته العشر كلها مُدخلة وصحيحة.
 */

import {
  BUCKET_IDS,
  MAX_AMOUNT,
  MAX_CLIENTS,
  emptyBuckets,
  moneySum,
  normalizeDigits,
  parseNumberInput,
  roundMoney,
  snapshotId,
  type BucketId,
  type BucketValues,
  type MonthlySnapshot,
  type SnapshotInput,
} from './delinquency';
import type { OfficeName } from './offices';
import type { ParExtraction, ParFigure, ParOfficeResult } from './parReport';

export type ReviewField = 'clients' | 'amount';

/** نصوص خانات مكتب واحد كما تظهر في حقول المراجعة */
export type ReviewValues = Record<BucketId, Record<ReviewField, string>>;

export type ReviewTable = Record<OfficeName, ReviewValues>;

export type CellState = 'ok' | 'empty' | 'invalid';

export interface CellAssessment {
  state: CellState;
  /** القيمة الرقمية عند state = ok */
  value: number | null;
  /** القيمة مطابقة لما قُرئ من الملف (false = عدّلها المستخدم أو أدخلها يدويًا) */
  fromPdf: boolean;
  message?: string;
}

export type RowStatus = 'complete' | 'empty' | 'incomplete';

export interface RowAssessment {
  office: OfficeName;
  status: RowStatus;
  cells: Record<BucketId, Record<ReviewField, CellAssessment>>;
  /** إجماليا الصف (من الخانات الصحيحة فقط؛ null إن لم يكتمل الصف) */
  totalClients: number | null;
  totalAmount: number | null;
  /** مطابقة إجمالي الصف لإجمالي المكتب في التقرير: null = لا مرجع للمقارنة */
  matchesReport: boolean | null;
  /** عدد الخانات الفارغة أو غير الصحيحة */
  pending: number;
  /** عُدّلت خانة واحدة على الأقل يدويًا */
  edited: boolean;
  /** ملاحظات تُعرض بجوار الصف */
  notes: string[];
}

/** نص الخانة الابتدائي: الرقم كما كُتب في الملف (بفواصل الآلاف)، أو فارغ إن لم يُقرأ بثقة */
function initialText(figure: ParFigure): string {
  if (figure.value === null || figure.raw === null) return '';
  return normalizeDigits(figure.raw.normalize('NFKC')).replace(/٬/g, ',').replace(/٫/g, '.').trim();
}

export function reviewTableFrom(extraction: ParExtraction): ReviewTable {
  const table = {} as ReviewTable;
  for (const office of extraction.offices) {
    const values = {} as ReviewValues;
    for (const id of BUCKET_IDS) {
      values[id] = { clients: initialText(office.buckets[id].clients), amount: initialText(office.buckets[id].amount) };
    }
    table[office.office] = values;
  }
  return table;
}

function assessCell(text: string, field: ReviewField, source: ParFigure): CellAssessment {
  const parsed = parseNumberInput(text);
  if (parsed === null) return { state: 'empty', value: null, fromPdf: false };
  const invalid = (message: string): CellAssessment => ({ state: 'invalid', value: null, fromPdf: false, message });
  if (Number.isNaN(parsed)) return invalid('ليس رقمًا');
  if (parsed < 0) return invalid('لا يمكن أن يكون سالبًا');
  if (field === 'clients') {
    if (!Number.isInteger(parsed)) return invalid('عدد العملاء يجب أن يكون عددًا صحيحًا');
    if (parsed > MAX_CLIENTS) return invalid('أكبر من الحد المسموح');
  } else {
    if (parsed > MAX_AMOUNT) return invalid('أكبر من الحد المسموح');
    if (roundMoney(parsed) !== parsed) return invalid('المبلغ بثلاث خانات عشرية على الأكثر');
  }
  return { state: 'ok', value: parsed, fromPdf: source.value !== null && source.value === parsed };
}

const AMOUNT_TOLERANCE = 0.0005;

export function assessRow(values: ReviewValues, source: ParOfficeResult): RowAssessment {
  const cells = {} as RowAssessment['cells'];
  let pending = 0;
  let filled = 0;
  let edited = false;
  for (const id of BUCKET_IDS) {
    cells[id] = {
      clients: assessCell(values[id].clients, 'clients', source.buckets[id].clients),
      amount: assessCell(values[id].amount, 'amount', source.buckets[id].amount),
    };
    for (const field of ['clients', 'amount'] as const) {
      const cell = cells[id][field];
      if (cell.state !== 'ok') pending += 1;
      if (cell.state !== 'empty') filled += 1;
      // معدَّلة = قيمتها الحالية تختلف عمّا قُرئ من الملف
      if (cell.state === 'invalid' || cell.value !== source.buckets[id][field].value) edited = true;
    }
  }

  const status: RowStatus = pending === 0 ? 'complete' : filled === 0 ? 'empty' : 'incomplete';
  const notes: string[] = [];
  let totalClients: number | null = null;
  let totalAmount: number | null = null;
  let matchesReport: boolean | null = null;

  if (status === 'complete') {
    totalClients = BUCKET_IDS.reduce((sum, id) => sum + (cells[id].clients.value as number), 0);
    totalAmount = moneySum(BUCKET_IDS.map((id) => cells[id].amount.value as number));
    const { clients, amount } = source.reportTotal;
    if (clients !== null && amount !== null) {
      matchesReport = totalClients === clients && Math.abs(totalAmount - amount) <= AMOUNT_TOLERANCE;
      if (!matchesReport) {
        notes.push(`الإجمالي لا يطابق إجمالي المكتب في التقرير (${clients.toLocaleString('en-US')} عميل، ${amount.toLocaleString('en-US', { maximumFractionDigits: 3 })}).`);
      }
    } else {
      notes.push('لا يوجد إجمالي للمكتب في التقرير للمقارنة.');
    }
    for (const id of BUCKET_IDS) {
      const c = cells[id].clients.value as number;
      const a = cells[id].amount.value as number;
      if ((c === 0) !== (a === 0)) notes.push(c === 0 ? 'شريحة بها مبلغ دون عملاء.' : 'شريحة بها عملاء دون مبلغ.');
    }
  } else if (status === 'empty') {
    notes.push(source.found ? 'لم تُقرأ أرقام هذا المكتب — أدخلها يدويًا أو اتركه دون حفظ.' : 'المكتب غير موجود في الملف — أدخل أرقامه يدويًا أو اتركه دون حفظ.');
  } else {
    notes.push(`${pending} خانة ناقصة أو غير صحيحة.`);
  }

  return { office: source.office, status, cells, totalClients, totalAmount, matchesReport, pending, edited, notes: Array.from(new Set(notes)) };
}

export interface ReviewSummary {
  rows: RowAssessment[];
  complete: OfficeName[];
  empty: OfficeName[];
  incomplete: OfficeName[];
  /** صفوف مكتملة لكن إجماليها لا يطابق التقرير */
  mismatched: OfficeName[];
  /** مجاميع الأعمدة للصفوف المكتملة */
  totals: { clients: number[]; amounts: number[]; totalClients: number; totalAmount: number };
  /** يمكن الحفظ والتصدير: لا صف ناقص، وصف واحد مكتمل على الأقل */
  ready: boolean;
}

export function assessReview(table: ReviewTable, extraction: ParExtraction): ReviewSummary {
  const rows = extraction.offices.map((office) => assessRow(table[office.office], office));
  const completeRows = rows.filter((row) => row.status === 'complete');
  const totals = {
    clients: BUCKET_IDS.map((id) => completeRows.reduce((sum, row) => sum + (row.cells[id].clients.value as number), 0)),
    amounts: BUCKET_IDS.map((id) => moneySum(completeRows.map((row) => row.cells[id].amount.value as number))),
    totalClients: completeRows.reduce((sum, row) => sum + (row.totalClients as number), 0),
    totalAmount: moneySum(completeRows.map((row) => row.totalAmount as number)),
  };
  const names = (status: RowStatus) => rows.filter((row) => row.status === status).map((row) => row.office);
  const incomplete = names('incomplete');
  return {
    rows,
    complete: names('complete'),
    empty: names('empty'),
    incomplete,
    mismatched: completeRows.filter((row) => row.matchesReport === false).map((row) => row.office),
    totals,
    ready: incomplete.length === 0 && completeRows.length > 0,
  };
}

function bucketsOf(row: RowAssessment): BucketValues {
  const buckets = emptyBuckets();
  for (const id of BUCKET_IDS) {
    buckets[id] = { clients: row.cells[id].clients.value as number, amount: row.cells[id].amount.value as number };
  }
  return buckets;
}

/** مدخلات الحفظ: المكاتب المكتملة فقط، بالترتيب المعتمد */
export function reviewToInputs(summary: ReviewSummary, period: { year: number; month: number }, notes: string): SnapshotInput[] {
  return summary.rows
    .filter((row) => row.status === 'complete')
    .map((row) => ({ branch: row.office, year: period.year, month: period.month, buckets: bucketsOf(row), notes }));
}

/** سجلات مؤقتة (غير محفوظة) لبناء ملف Excel من جدول المراجعة كما هو */
export function reviewToSnapshots(summary: ReviewSummary, period: { year: number; month: number }): MonthlySnapshot[] {
  const now = new Date().toISOString();
  return summary.rows
    .filter((row) => row.status === 'complete')
    .map((row) => ({
      id: snapshotId(row.office, period.year, period.month),
      branch: row.office,
      year: period.year,
      month: period.month,
      buckets: bucketsOf(row),
      notes: '',
      createdAt: now,
      updatedAt: now,
    }));
}
