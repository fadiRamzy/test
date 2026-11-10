/**
 * تحليل الترحيل الفعلي بين شرائح التأخير.
 *
 * الترحيل الفعلي (من شريحة إلى أخرى) لا يمكن استنتاجه من الأعداد الإجمالية؛
 * يتطلب قائمة عملاء بأرقام تعريف فردية لكل من الشهرين. هذا الملف:
 *  - يقرأ قوائم العملاء (لصق من الإكسل أو ملف CSV)،
 *  - يبني مصفوفة الترحيل الفعلية عند توفر القائمتين،
 *  - ويبني «إطار المصفوفة» من الإجماليات فقط (مجاميع الصفوف والأعمدة دون خلايا داخلية)
 *    حتى لا تُختلق أي أرقام ترحيل.
 */

import {
  BUCKETS,
  BUCKET_IDS,
  bucketForDays,
  bucketIndex,
  emptyBuckets,
  moneyDiff,
  moneySum,
  normalizeDigits,
  parseNumberInput,
  round2,
  type BucketId,
  type BucketValues,
} from './delinquency';

/* ------------------------------ قوائم العملاء ----------------------------- */

export interface ClientRecord {
  /** رقم تعريف العميل (أو رقم القرض) — فريد داخل الشهر */
  id: string;
  bucket: BucketId;
  /** أيام التأخير إن أُدخلت */
  days: number | null;
  /** مبلغ المتأخرات إن أُدخل */
  amount: number | null;
}

export interface ClientListIssue {
  line: number;
  message: string;
}

export interface ParsedClientList {
  clients: ClientRecord[];
  errors: ClientListIssue[];
  /** سطور لعملاء غير متأخرين (0 يوم) تم تجاهلها */
  notOverdue: number;
  /** عدد السطور المقروءة (بدون العنوان والسطور الفارغة) */
  lines: number;
  headerSkipped: boolean;
  /** هل كل العملاء لديهم مبلغ؟ */
  hasAmounts: boolean;
}

export const MAX_CLIENT_ROWS = 200_000;

const BUCKET_RANGE = /^(\d+)\s*[-–—]\s*(\d+)/;

/** يوحّد رقم العميل: إزالة المسافات وتحويل الأرقام العربية */
export const normalizeClientId = (value: string): string =>
  normalizeDigits(value).replace(/[\u200e\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();

/** يقرأ عمود «أيام التأخير» — يقبل عدد الأيام أو اسم الشريحة (1-30 … +120 / NPL) */
function parseDelay(field: string): { bucket: BucketId | null; days: number | null; ok: boolean } {
  const text = normalizeDigits(field).trim();
  if (!text) return { bucket: null, days: null, ok: false };

  if (/npl|متعثر/i.test(text) || /^(\+|>|أكثر من|اكثر من)\s*120/.test(text) || /^120\s*\+/.test(text))
    return { bucket: 'npl', days: null, ok: true };

  const range = BUCKET_RANGE.exec(text);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    const match = BUCKETS.find((bucket) => bucket.from === from && bucket.to === to);
    return match ? { bucket: match.id, days: null, ok: true } : { bucket: null, days: null, ok: false };
  }

  const days = parseNumberInput(text.replace(/\s*(يوم|يوما|يومًا|أيام|ايام|days?|d)\s*$/i, ''));
  if (days === null || Number.isNaN(days) || days < 0) return { bucket: null, days: null, ok: false };
  const whole = Math.floor(days);
  return { bucket: bucketForDays(whole), days: whole, ok: true };
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (/[;؛|]/.test(line)) return line.split(/[;؛|]/);
  if (line.includes('،')) return line.split('،');
  // فاصلة عادية: قد يكون المبلغ نفسه بفواصل آلاف، لذلك نقسم أول عمودين فقط
  const parts = line.split(',');
  if (parts.length <= 3) return parts;
  return [parts[0], parts[1], parts.slice(2).join('')];
}

/**
 * يقرأ قائمة عملاء نصية. كل سطر: رقم العميل، أيام التأخير (أو اسم الشريحة)، المبلغ (اختياري).
 * الفواصل المقبولة: Tab (لصق من الإكسل) أو ; أو ، أو , — وسطر العنوان يُتجاهل تلقائيًا.
 */
export function parseClientList(text: string): ParsedClientList {
  const clients: ClientRecord[] = [];
  const errors: ClientListIssue[] = [];
  const seen = new Map<string, number>();
  let notOverdue = 0;
  let lines = 0;
  let headerSkipped = false;
  let firstContentLine = true;

  const rawLines = text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/);

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    if (!raw.trim()) continue;
    const lineNo = index + 1;

    const fields = splitLine(raw).map((field) => field.trim().replace(/^"(.*)"$/, '$1').trim());
    const id = normalizeClientId(fields[0] ?? '');
    const delay = parseDelay(fields[1] ?? '');

    if (firstContentLine) {
      firstContentLine = false;
      // سطر عنوان: العمود الثاني ليس رقمًا ولا اسم شريحة
      if (!delay.ok && fields.length >= 2 && !/\d/.test(normalizeDigits(fields[1] ?? ''))) {
        headerSkipped = true;
        continue;
      }
    }

    lines += 1;
    if (lines > MAX_CLIENT_ROWS) {
      errors.push({ line: lineNo, message: `القائمة تتجاوز الحد الأقصى (${MAX_CLIENT_ROWS.toLocaleString('en-US')} سطر).` });
      break;
    }

    if (!id) {
      errors.push({ line: lineNo, message: 'رقم العميل مفقود.' });
      continue;
    }
    if (fields.length < 2 || !delay.ok) {
      errors.push({ line: lineNo, message: `أيام التأخير غير صالحة للعميل ${id}.` });
      continue;
    }

    let amount: number | null = null;
    const amountField = fields[2] ?? '';
    if (amountField) {
      const parsed = parseNumberInput(amountField);
      if (parsed === null || Number.isNaN(parsed) || parsed < 0) {
        errors.push({ line: lineNo, message: `مبلغ غير صالح للعميل ${id}.` });
        continue;
      }
      amount = round2(parsed);
    }

    const previous = seen.get(id);
    if (previous !== undefined) {
      errors.push({ line: lineNo, message: `رقم العميل ${id} مكرر (ورد أولًا في السطر ${previous}).` });
      continue;
    }
    seen.set(id, lineNo);

    if (delay.bucket === null) {
      notOverdue += 1;
      continue;
    }

    clients.push({ id, bucket: delay.bucket, days: delay.days, amount });
  }

  return {
    clients,
    errors,
    notOverdue,
    lines,
    headerSkipped,
    hasAmounts: clients.length > 0 && clients.every((client) => client.amount !== null),
  };
}

/** يحوّل قائمة العملاء إلى نص قابل للتعديل (Tab بين الأعمدة) */
export function serializeClientList(clients: ClientRecord[]): string {
  return clients
    .map((client) => {
      const delay = client.days !== null ? String(client.days) : BUCKETS[bucketIndex(client.bucket)].short.replace(' (NPL)', '');
      return [client.id, delay, client.amount !== null ? String(client.amount) : ''].join('\t').replace(/\t+$/, '');
    })
    .join('\n');
}

/** يجمع قائمة العملاء إلى أعداد ومبالغ لكل شريحة */
export function aggregateClientList(clients: ClientRecord[]): BucketValues {
  const buckets = emptyBuckets();
  const amounts: Record<BucketId, number[]> = { d1_30: [], d31_60: [], d61_90: [], d91_120: [], npl: [] };
  for (const client of clients) {
    buckets[client.bucket].clients += 1;
    if (client.amount !== null) amounts[client.bucket].push(client.amount);
  }
  for (const id of BUCKET_IDS) buckets[id].amount = moneySum(amounts[id]);
  return buckets;
}

export interface ReconciliationRow {
  bucket: BucketId;
  enteredClients: number;
  listClients: number;
  clientsDiff: number;
  enteredAmount: number;
  listAmount: number | null;
  amountDiff: number | null;
}

export interface Reconciliation {
  matches: boolean;
  rows: ReconciliationRow[];
}

/** يطابق الإجماليات المدخلة يدويًا مع قائمة العملاء لنفس الشهر */
export function reconcileWithList(buckets: BucketValues, clients: ClientRecord[]): Reconciliation {
  const fromList = aggregateClientList(clients);
  const hasAmounts = clients.length > 0 && clients.every((client) => client.amount !== null);
  const rows = BUCKET_IDS.map((bucket) => {
    const amountDiff = hasAmounts ? moneyDiff(buckets[bucket].amount, fromList[bucket].amount) : null;
    return {
      bucket,
      enteredClients: buckets[bucket].clients,
      listClients: fromList[bucket].clients,
      clientsDiff: fromList[bucket].clients - buckets[bucket].clients,
      enteredAmount: buckets[bucket].amount,
      listAmount: hasAmounts ? fromList[bucket].amount : null,
      amountDiff,
    };
  });
  return {
    matches: rows.every((row) => row.clientsDiff === 0 && (row.amountDiff === null || Math.abs(row.amountDiff) < 0.005)),
    rows,
  };
}

/* ----------------------------- مصفوفة الترحيل ----------------------------- */

/** حالة العميل في شهر الأساس: شريحة تأخير أو «غير متأخر/غير موجود» */
export type FromState = BucketId | 'new';
/** حالة العميل في شهر المقارنة: شريحة تأخير أو «خرج من قائمة المتأخرات» */
export type ToState = BucketId | 'exit';

export const FROM_STATES: FromState[] = [...BUCKET_IDS, 'new'];
export const TO_STATES: ToState[] = [...BUCKET_IDS, 'exit'];

export const NEW_STATE_LABEL = 'غير متأخر في شهر الأساس (دخول جديد)';
export const EXIT_STATE_LABEL = 'خرج من قائمة المتأخرات';

export interface MigrationCell {
  clients: number;
  /**
   * مبلغ المتأخرات المرتبط بالخلية: مبلغ شهر المقارنة للعملاء الباقين والداخلين،
   * ومبلغ شهر الأساس للعملاء الخارجين. null إذا لم تتوفر المبالغ.
   */
  amount: number | null;
}

export type MigrationMatrix = Record<FromState, Record<ToState, MigrationCell>>;

export interface BucketFlow {
  bucket: BucketId;
  /** عدد عملاء الشريحة في شهر الأساس */
  startClients: number;
  stayed: number;
  /** انتقلوا إلى شريحة أسوأ (أقدم) */
  forward: number;
  /** انتقلوا إلى شريحة أفضل (أحدث) */
  backward: number;
  exited: number;
  /** نسبة الترحيل للأسوأ من عملاء الشريحة (٪) */
  forwardRate: number | null;
  stayedRate: number | null;
  backwardRate: number | null;
  exitRate: number | null;
}

export interface MigrationResult {
  kind: 'actual';
  matrix: MigrationMatrix;
  hasAmounts: boolean;
  clientsA: number;
  clientsB: number;
  /** بقوا في نفس الشريحة */
  stayed: number;
  /** انتقلوا لشريحة أسوأ */
  forward: number;
  /** انتقلوا لشريحة أفضل */
  backward: number;
  /** كانوا متأخرين وخرجوا من القائمة — السبب غير معروف (سداد، تسوية، إعدام، إعادة جدولة…) */
  exited: number;
  /** دخلوا القائمة ولم يكونوا متأخرين في شهر الأساس */
  entered: number;
  /** دخلوا شريحة NPL من شرائح أخرى أو كدخول جديد */
  intoNpl: number;
  forwardRate: number | null;
  backwardRate: number | null;
  stayedRate: number | null;
  exitRate: number | null;
  /** مبلغ العملاء الخارجين (بحسب رصيدهم في شهر الأساس) — ليس تحصيلًا مؤكدًا */
  exitedAmount: number | null;
  enteredAmount: number | null;
  flows: BucketFlow[];
  rowTotals: Record<FromState, MigrationCell>;
  columnTotals: Record<ToState, MigrationCell>;
}

const rate = (part: number, total: number): number | null => (total === 0 ? null : (part / total) * 100);

function emptyMatrix(withAmounts: boolean): MigrationMatrix {
  const matrix = {} as MigrationMatrix;
  for (const from of FROM_STATES) {
    matrix[from] = {} as Record<ToState, MigrationCell>;
    for (const to of TO_STATES) matrix[from][to] = { clients: 0, amount: withAmounts ? 0 : null };
  }
  return matrix;
}

/**
 * يبني مصفوفة الترحيل الفعلية بمطابقة أرقام العملاء بين الشهرين.
 * الصفوف: حالة العميل في شهر الأساس — الأعمدة: حالته في شهر المقارنة.
 */
export function computeMigration(listA: ClientRecord[], listB: ClientRecord[]): MigrationResult {
  const hasAmounts =
    listA.length + listB.length > 0 &&
    listA.every((client) => client.amount !== null) &&
    listB.every((client) => client.amount !== null);

  const matrix = emptyMatrix(hasAmounts);
  const cents: Record<string, number> = {};
  const add = (from: FromState, to: ToState, amount: number | null) => {
    matrix[from][to].clients += 1;
    if (hasAmounts && amount !== null) {
      const key = `${from}>${to}`;
      cents[key] = (cents[key] ?? 0) + Math.round(amount * 100);
    }
  };

  const mapB = new Map(listB.map((client) => [client.id, client]));
  const seenA = new Set<string>();

  for (const client of listA) {
    if (seenA.has(client.id)) continue;
    seenA.add(client.id);
    const next = mapB.get(client.id);
    if (next) add(client.bucket, next.bucket, next.amount);
    else add(client.bucket, 'exit', client.amount);
  }
  const seenB = new Set<string>();
  for (const client of listB) {
    if (seenB.has(client.id)) continue;
    seenB.add(client.id);
    if (!seenA.has(client.id)) add('new', client.bucket, client.amount);
  }

  if (hasAmounts) {
    for (const from of FROM_STATES)
      for (const to of TO_STATES) matrix[from][to].amount = (cents[`${from}>${to}`] ?? 0) / 100;
  }

  const sumCells = (cells: MigrationCell[]): MigrationCell => ({
    clients: cells.reduce((sum, cell) => sum + cell.clients, 0),
    amount: hasAmounts ? moneySum(cells.map((cell) => cell.amount ?? 0)) : null,
  });

  const rowTotals = {} as Record<FromState, MigrationCell>;
  for (const from of FROM_STATES) rowTotals[from] = sumCells(TO_STATES.map((to) => matrix[from][to]));
  const columnTotals = {} as Record<ToState, MigrationCell>;
  for (const to of TO_STATES) columnTotals[to] = sumCells(FROM_STATES.map((from) => matrix[from][to]));

  const flows: BucketFlow[] = BUCKET_IDS.map((bucket) => {
    const index = bucketIndex(bucket);
    let forward = 0;
    let backward = 0;
    for (const to of BUCKET_IDS) {
      const count = matrix[bucket][to].clients;
      if (bucketIndex(to) > index) forward += count;
      else if (bucketIndex(to) < index) backward += count;
    }
    const startClients = rowTotals[bucket].clients;
    const stayed = matrix[bucket][bucket].clients;
    const exited = matrix[bucket].exit.clients;
    return {
      bucket,
      startClients,
      stayed,
      forward,
      backward,
      exited,
      forwardRate: rate(forward, startClients),
      stayedRate: rate(stayed, startClients),
      backwardRate: rate(backward, startClients),
      exitRate: rate(exited, startClients),
    };
  });

  const clientsA = seenA.size;
  const clientsB = seenB.size;
  const stayed = flows.reduce((sum, flow) => sum + flow.stayed, 0);
  const forward = flows.reduce((sum, flow) => sum + flow.forward, 0);
  const backward = flows.reduce((sum, flow) => sum + flow.backward, 0);
  const exited = flows.reduce((sum, flow) => sum + flow.exited, 0);
  const entered = rowTotals.new.clients;
  const intoNpl = columnTotals.npl.clients - matrix.npl.npl.clients;

  return {
    kind: 'actual',
    matrix,
    hasAmounts,
    clientsA,
    clientsB,
    stayed,
    forward,
    backward,
    exited,
    entered,
    intoNpl,
    forwardRate: rate(forward, clientsA),
    backwardRate: rate(backward, clientsA),
    stayedRate: rate(stayed, clientsA),
    exitRate: rate(exited, clientsA),
    exitedAmount: hasAmounts ? columnTotals.exit.amount : null,
    enteredAmount: hasAmounts ? rowTotals.new.amount : null,
    flows,
    rowTotals,
    columnTotals,
  };
}

/* ------------------------- إطار المصفوفة من الإجماليات -------------------- */

export interface NetChangeFrame {
  kind: 'aggregate';
  /** مجاميع الصفوف = أعداد/مبالغ شهر الأساس لكل شريحة */
  rowTotals: Record<BucketId, { clients: number; amount: number }>;
  /** مجاميع الأعمدة = أعداد/مبالغ شهر المقارنة لكل شريحة */
  columnTotals: Record<BucketId, { clients: number; amount: number }>;
  /** صافي التغير لكل شريحة (ب − أ) — ليس حركة عملاء */
  netClients: Record<BucketId, number>;
  netAmount: Record<BucketId, number>;
  /** الخلايا الداخلية غير معروفة دائمًا في هذا الوضع */
  cellsKnown: false;
}

/**
 * يبني إطار مصفوفة الترحيل من البيانات الإجمالية: المجاميع الطرفية وصافي التغير فقط.
 * لا تُملأ أي خلية داخلية — حركة العملاء الفعلية غير قابلة للاستنتاج من الإجماليات.
 */
export function buildNetChangeFrame(a: BucketValues, b: BucketValues): NetChangeFrame {
  const rowTotals = {} as NetChangeFrame['rowTotals'];
  const columnTotals = {} as NetChangeFrame['columnTotals'];
  const netClients = {} as Record<BucketId, number>;
  const netAmount = {} as Record<BucketId, number>;
  for (const id of BUCKET_IDS) {
    rowTotals[id] = { clients: a[id].clients, amount: a[id].amount };
    columnTotals[id] = { clients: b[id].clients, amount: b[id].amount };
    netClients[id] = b[id].clients - a[id].clients;
    netAmount[id] = moneyDiff(a[id].amount, b[id].amount);
  }
  return { kind: 'aggregate', rowTotals, columnTotals, netClients, netAmount, cellsKnown: false };
}
