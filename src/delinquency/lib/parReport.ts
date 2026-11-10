/**
 * قراءة تقرير «اعمار الديون» (PDF) واستخراج قسم «المحفظة في ظل المخاطر» فقط.
 *
 * التقرير يحتوي قسمين متشابهين في الشكل والشرائح:
 *   - «المتأخرات»                 ← يُتجاهل تمامًا
 *   - «المحفظة في ظل المخاطرة»    ← المصدر الوحيد للأرقام
 *
 * كل جدول في التقرير يبدأ برأس من ثلاثة أسطر: عناوين الشرائح (مثل 1-30)، وعنوان القسم في
 * خانة الركن، ثم سطر «العدد / القيمة». الجدول العريض يُقسَّم إلى أجزاء، ويتكرر الرأس في كل
 * صفحة. لذلك تُحدَّد هوية كل جزء من عنوان القسم المكتوب في رأسه هو، ولا يُفترض شيء من
 * ترتيب الصفحات.
 *
 * هذه الوحدة دالة خالصة تعمل على عناصر نصية بمواضعها (س، ص) — لا تعتمد على مكتبة PDF.
 * القاعدة: لا تخمين. أي خانة غير مؤكدة تُترك فارغة (null) مع ملاحظة للمراجعة اليدوية.
 */

import { BUCKET_IDS, bucketLabel, moneySum, normalizeDigits, type BucketId } from './delinquency';
import { OFFICES, matchOffice, normalizeArabic, type OfficeName } from './offices';

/* --------------------------------- الأنواع -------------------------------- */

/** عنصر نصي من صفحة PDF بإحداثيات الصفحة كما تُعرض (س من اليسار، ص من الأعلى) */
export interface PdfTextItem {
  page: number;
  /** الحافة اليسرى */
  x: number;
  /** خط الأساس */
  y: number;
  width: number;
  height: number;
  text: string;
}

export type ParErrorCode = 'no-text' | 'no-section' | 'no-offices';

export class ParReportError extends Error {
  code: ParErrorCode;
  constructor(code: ParErrorCode, message: string) {
    super(message);
    this.name = 'ParReportError';
    this.code = code;
  }
}

export type ParFigureIssue = 'missing' | 'unreadable' | 'conflict';

export interface ParFigure {
  /** القيمة المؤكدة، أو null إن لم تُقرأ بثقة */
  value: number | null;
  /** النص كما ورد في الملف (إن وُجد) */
  raw: string | null;
  issue?: ParFigureIssue;
}

export interface ParOfficeResult {
  office: OfficeName;
  /** ورد المكتب في قسم «المحفظة في ظل المخاطر» */
  found: boolean;
  buckets: Record<BucketId, { clients: ParFigure; amount: ParFigure }>;
  /** عمود إجمالي المكتب في التقرير (1-5555555) — يُستخدم للتحقق فقط */
  reportTotal: { clients: number | null; amount: number | null };
  /** ملاحظات تستدعي المراجعة اليدوية */
  warnings: string[];
}

export interface ParCheck {
  id: 'section' | 'offices' | 'duplicates' | 'figures' | 'office-totals' | 'column-totals';
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ParExtraction {
  /** عنوان القسم كما ورد في الملف */
  sectionTitle: string;
  /** الصفحات التي أُخذت منها الأرقام */
  pages: number[];
  /** تاريخ التقرير «حتى تاريخ» إن وُجد */
  asOf: { year: number; month: number; day: number; text: string } | null;
  /** المكاتب التسعة عشر بالترتيب المعتمد دائمًا */
  offices: ParOfficeResult[];
  /** أسماء وردت في القسم وليست من القائمة المعتمدة */
  extraOffices: string[];
  /** أقسام أخرى وُجدت في الملف وتم تجاهلها */
  ignoredSections: string[];
  checks: ParCheck[];
  /** ملاحظات عامة على الملف */
  warnings: string[];
  /** عدد الخانات التي تحتاج إدخالًا يدويًا */
  unresolved: number;
}

/* ------------------------------ قراءة الأرقام ----------------------------- */

const toAscii = (text: string): string =>
  normalizeDigits(text.normalize('NFKC'))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/٬/g, ',')
    .replace(/٫/g, '.')
    .trim();

const NUMERIC_TOKEN = /^[\d.,]+$/;
const INT_PATTERN = /^(\d{1,3}(,\d{3})+|\d+)$/;
const AMOUNT_PATTERN = /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

/** عدد عملاء: عدد صحيح، مع فواصل آلاف اختيارية. يعيد null إن لم يكن النص عددًا صحيحًا سليمًا. */
export function parseReportCount(raw: string): number | null {
  const text = toAscii(raw);
  if (!INT_PATTERN.test(text)) return null;
  const value = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

/** مبلغ: فواصل آلاف اختيارية وكسر عشري حتى ثلاث خانات. يعيد null لغير ذلك (لا تقريب ولا تخمين). */
export function parseReportAmount(raw: string): number | null {
  const text = toAscii(raw);
  if (!AMOUNT_PATTERN.test(text)) return null;
  const decimals = text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
  if (decimals > 3) return null;
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------ تحليل الصفحات ----------------------------- */

interface Token {
  page: number;
  /** مركز النص أفقيًا */
  cx: number;
  x: number;
  y: number;
  text: string;
  numeric: boolean;
}

interface Row {
  page: number;
  y: number;
  tokens: Token[];
}

const ROW_TOLERANCE = 3;

function tokensOf(items: PdfTextItem[]): Token[] {
  const tokens: Token[] = [];
  for (const item of items) {
    const text = item.text.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (!text) continue;
    const ascii = toAscii(text);
    const parts = ascii.split(/\s+/);
    // عنصر واحد يضم عدة أرقام متجاورة: يُقسَّم بنسبة مواضع الحروف
    if (parts.length > 1 && parts.every((part) => NUMERIC_TOKEN.test(part))) {
      const total = ascii.length;
      let offset = 0;
      for (const part of parts) {
        const start = ascii.indexOf(part, offset);
        offset = start + part.length;
        const from = item.x + (start / total) * item.width;
        const width = (part.length / total) * item.width;
        tokens.push({ page: item.page, x: from, cx: from + width / 2, y: item.y, text: part, numeric: true });
      }
      continue;
    }
    tokens.push({ page: item.page, x: item.x, cx: item.x + item.width / 2, y: item.y, text, numeric: NUMERIC_TOKEN.test(ascii) });
  }
  return tokens;
}

function rowsOf(tokens: Token[]): Row[] {
  const sorted = [...tokens].sort((a, b) => a.page - b.page || a.y - b.y || b.cx - a.cx);
  const rows: Row[] = [];
  for (const token of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === token.page && Math.abs(token.y - last.y) <= ROW_TOLERANCE) last.tokens.push(token);
    else rows.push({ page: token.page, y: token.y, tokens: [token] });
  }
  for (const row of rows) row.tokens.sort((a, b) => b.cx - a.cx);
  return rows;
}

const KEY_COUNT = normalizeArabic('العدد');
const KEY_AMOUNT = normalizeArabic('القيمة');
const KEY_SUM = normalizeArabic('المجموع');
const KEY_GRAND_ROW = normalizeArabic('المجموع الكلي');
const KEY_ARREARS = normalizeArabic('المتأخرات');
const KEY_PORTFOLIO = normalizeArabic('المحفظة');
const KEY_RISK = normalizeArabic('المخاطر');

const reverseText = (text: string): string => Array.from(text).reverse().join('');
/** يطابق النص أو معكوسه (بعض الملفات تخزّن العربية بترتيب بصري) */
const keyMatches = (text: string, test: (key: string) => boolean): boolean => test(normalizeArabic(text)) || test(normalizeArabic(reverseText(text)));

type SectionKind = 'par' | 'arrears' | 'other';

function sectionKind(title: string): SectionKind {
  // العنوان في الملف قد يُكتب «المحفظة قي ظل المخاطرة» — المطابقة بكلمتي «المحفظة» و«المخاطر»
  if (keyMatches(title, (key) => key.includes(KEY_PORTFOLIO) && key.includes(KEY_RISK))) return 'par';
  if (keyMatches(title, (key) => key.includes(KEY_ARREARS))) return 'arrears';
  return 'other';
}

type ColumnKey = BucketId | 'overall' | 'grand';

const RANGE_LABEL = /^(\d+)\s*-\s*(\d+)$/;

const isLabelText = (text: string): boolean => RANGE_LABEL.test(toAscii(text)) || keyMatches(text, (key) => key === KEY_SUM);

/** يحدد معنى عنوان العمود: شريحة من الخمس، أو إجمالي المكتب (1-5555555)، أو «المجموع» */
function columnKeyOf(label: string): ColumnKey | null {
  if (keyMatches(label, (key) => key === KEY_SUM)) return 'grand';
  const match = RANGE_LABEL.exec(toAscii(label));
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from === 1 && to === 30) return 'd1_30';
  if (from === 31 && to === 60) return 'd31_60';
  if (from === 61 && to === 90) return 'd61_90';
  if (from === 91 && to === 120) return 'd91_120';
  if (from === 121 && to > 121) return 'npl';
  if (from === 1 && to > 120) return 'overall';
  return null;
}

interface Column {
  label: string;
  key: ColumnKey | null;
  kind: 'count' | 'amount';
  cx: number;
  /** رقم عنوان الشريحة الذي يتبعه العمود (العناوين المكررة مثل 121-99999 لها أرقام مختلفة) */
  group: number;
}

interface TableRow {
  page: number;
  name: string;
  /** نص كل عمود (بترتيب columns)، أو null إن خلت الخانة */
  cells: Array<string | null>;
  /** نصوص لم تُنسب إلى عمود أو تزاحمت على عمود واحد */
  stray: string[];
}

interface Chunk {
  page: number;
  title: string;
  kind: SectionKind;
  columns: Column[];
  /** خلل في بنية الرأس يمنع الوثوق بأعمدة هذا الجزء */
  broken: string | null;
  rows: TableRow[];
  signature: string;
}

const isSubHeaderRow = (row: Row): boolean =>
  row.tokens.length >= 2 && row.tokens.every((token) => keyMatches(token.text, (key) => key === KEY_COUNT || key === KEY_AMOUNT));

function chunksOf(rows: Row[]): Chunk[] {
  const chunks: Chunk[] = [];
  const pages = Array.from(new Set(rows.map((row) => row.page)));

  for (const page of pages) {
    const pageRows = rows.filter((row) => row.page === page);
    // رؤوس الجداول في الصفحة: [فهرس سطر العناوين، فهرس سطر العدد/القيمة]
    const heads: Array<{ labelIndex: number; subIndex: number }> = [];
    pageRows.forEach((row, index) => {
      if (!isSubHeaderRow(row)) return;
      let labelIndex = -1;
      for (let back = index - 1; back >= 0 && row.y - pageRows[back].y <= 32; back -= 1) {
        if (pageRows[back].tokens.some((token) => isLabelText(token.text))) {
          labelIndex = back;
          break;
        }
      }
      heads.push({ labelIndex: labelIndex === -1 ? index : labelIndex, subIndex: index });
    });

    heads.forEach((head, headIndex) => {
      const subRow = pageRows[head.subIndex];
      const headRows = pageRows.slice(head.labelIndex, head.subIndex + 1);
      const subTokens = subRow.tokens;
      const rightEdge = Math.max(...subTokens.map((token) => token.cx));

      const labelTokens = headRows.flatMap((row) => row.tokens).filter((token) => isLabelText(token.text));
      const titleTokens = headRows
        .flatMap((row) => row.tokens)
        .filter((token) => !isLabelText(token.text) && !subTokens.includes(token) && token.cx > rightEdge)
        .sort((a, b) => a.y - b.y || b.cx - a.cx);
      const title = titleTokens.map((token) => token.text).join(' ').replace(/\s+/g, ' ').trim();

      // كل عنوان شريحة يملك عمودين بالضبط: «العدد» و«القيمة»
      let broken: string | null = null;
      const columns: Column[] = subTokens.map((token) => {
        let group = -1;
        labelTokens.forEach((label, index) => {
          if (group === -1 || Math.abs(label.cx - token.cx) < Math.abs(labelTokens[group].cx - token.cx)) group = index;
        });
        const best = group === -1 ? null : labelTokens[group];
        const kind: Column['kind'] = keyMatches(token.text, (key) => key === KEY_COUNT) ? 'count' : 'amount';
        return { label: best ? toAscii(best.text) : '', key: best ? columnKeyOf(best.text) : null, kind, cx: token.cx, group };
      });
      if (!labelTokens.length) broken = 'لم يُعثر على عناوين الشرائح في رأس الجدول';
      else {
        labelTokens.forEach((label, group) => {
          const owned = columns.filter((column) => column.group === group);
          const counts = owned.filter((column) => column.kind === 'count').length;
          const amounts = owned.filter((column) => column.kind === 'amount').length;
          if (counts !== 1 || amounts !== 1) broken = `عمود «${toAscii(label.text)}» لا يقابله «العدد» و«القيمة» مرة واحدة لكل منهما`;
        });
      }

      const spacing = columns
        .map((column) => column.cx)
        .sort((a, b) => a - b)
        .reduce((min, cx, index, all) => (index ? Math.min(min, cx - all[index - 1]) : min), Number.POSITIVE_INFINITY);
      const reach = Number.isFinite(spacing) ? spacing / 2 : 20;

      const nextStart = headIndex + 1 < heads.length ? heads[headIndex + 1].labelIndex : pageRows.length;
      const tableRows: TableRow[] = [];
      for (const row of pageRows.slice(head.subIndex + 1, nextStart)) {
        const nameTokens = row.tokens.filter((token) => !token.numeric);
        const numberTokens = row.tokens.filter((token) => token.numeric);
        // صف بيانات = اسم على يمين الأعمدة + أرقام
        if (!nameTokens.length || !numberTokens.length) continue;
        if (nameTokens.some((token) => token.cx <= rightEdge)) continue;
        const cells: Array<string | null> = columns.map(() => null);
        const stray: string[] = [];
        for (const token of numberTokens) {
          let best = -1;
          columns.forEach((column, index) => {
            if (best === -1 || Math.abs(column.cx - token.cx) < Math.abs(columns[best].cx - token.cx)) best = index;
          });
          if (best === -1 || Math.abs(columns[best].cx - token.cx) > reach || cells[best] !== null) stray.push(token.text);
          else cells[best] = token.text;
        }
        tableRows.push({ page, name: nameTokens.map((token) => token.text).join(' ').replace(/\s+/g, ' ').trim(), cells, stray });
      }

      chunks.push({
        page,
        title,
        kind: sectionKind(title),
        columns,
        broken,
        rows: tableRows,
        signature: columns.map((column) => `${column.label}/${column.kind}`).join('|'),
      });
    });
  }
  return chunks;
}

/* ------------------------------- تاريخ التقرير ---------------------------- */

const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const KEY_AS_OF = normalizeArabic('حتى تاريخ');

function asOfDate(rows: Row[]): ParExtraction['asOf'] {
  const found = new Set<string>();
  for (const row of rows) {
    if (!row.tokens.some((token) => keyMatches(token.text, (key) => key.includes(KEY_AS_OF)))) continue;
    for (const token of row.tokens) if (DATE_PATTERN.test(toAscii(token.text))) found.add(toAscii(token.text));
  }
  // تواريخ مختلفة بين الصفحات = لا ثقة؛ يختار المستخدم الشهر يدويًا
  if (found.size !== 1) return null;
  const text = Array.from(found)[0];
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return { year, month, day, text };
}

/* ---------------------------------- التجميع ------------------------------- */

interface Occurrence {
  page: number;
  clients: string | null;
  amount: string | null;
}

const AMOUNT_TOLERANCE = 0.0051;
const same = (a: number, b: number): boolean => Math.abs(a - b) <= AMOUNT_TOLERANCE;

function settle(raws: Array<string | null>, parse: (raw: string) => number | null): ParFigure {
  const present = raws.filter((raw): raw is string => raw !== null);
  if (!present.length) return { value: null, raw: null, issue: 'missing' };
  const parsed = present.map(parse);
  if (parsed.some((value) => value === null)) return { value: null, raw: present.join(' / '), issue: 'unreadable' };
  const distinct = Array.from(new Set(parsed as number[]));
  if (distinct.length > 1) return { value: null, raw: Array.from(new Set(present)).join(' / '), issue: 'conflict' };
  return { value: distinct[0], raw: present[0] };
}

const emptyFigure = (): ParFigure => ({ value: null, raw: null, issue: 'missing' });

const fmt = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * يستخرج أرقام قسم «المحفظة في ظل المخاطر» للمكاتب التسعة عشر من عناصر نص الملف.
 * يرمي ParReportError إذا لم يوجد نص، أو لم يوجد القسم المطلوب، أو لم يُعثر على أي مكتب فيه.
 */
export function parseParReport(items: PdfTextItem[]): ParExtraction {
  const tokens = tokensOf(items);
  if (!tokens.length) throw new ParReportError('no-text', 'الملف لا يحتوي نصًا يمكن قراءته.');

  const rows = rowsOf(tokens);
  const chunks = chunksOf(rows);
  const parChunks = chunks.filter((chunk) => chunk.kind === 'par');
  const ignoredSections = Array.from(new Set(chunks.filter((chunk) => chunk.kind !== 'par' && chunk.title).map((chunk) => chunk.title)));

  if (!parChunks.length) {
    throw new ParReportError(
      'no-section',
      ignoredSections.length
        ? `لم يُعثر في الملف على قسم «المحفظة في ظل المخاطر». الأقسام الموجودة: ${ignoredSections.join('، ')} — ولا تُؤخذ الأرقام منها.`
        : 'لم يُعثر في الملف على قسم «المحفظة في ظل المخاطر».',
    );
  }

  const warnings: string[] = [];
  for (const chunk of chunks) {
    if (chunk.kind === 'other' && chunk.rows.length) {
      warnings.push(chunk.title ? `جدول بعنوان «${chunk.title}» في صفحة ${chunk.page} تم تجاهله.` : `جدول بلا عنوان قسم في صفحة ${chunk.page} تم تجاهله.`);
    }
  }
  for (const chunk of parChunks) {
    if (chunk.broken) warnings.push(`صفحة ${chunk.page}: ${chunk.broken} — أرقام هذا الجزء لم تُستخدم.`);
    for (const column of chunk.columns) {
      if (column.key === null && column.kind === 'count' && !chunk.broken) warnings.push(`صفحة ${chunk.page}: عمود غير معروف «${column.label}» تم تجاهله.`);
    }
  }
  const usable = parChunks.filter((chunk) => !chunk.broken);

  // تجميع كل ظهور لكل (اسم صف، عمود)
  const table = new Map<string, { name: string; pages: Set<number>; perSignature: Map<string, number>; cells: Map<ColumnKey, Occurrence[]>; stray: string[] }>();
  for (const chunk of usable) {
    for (const row of chunk.rows) {
      const office = matchOffice(row.name);
      const isGrand = keyMatches(row.name, (key) => key === KEY_GRAND_ROW);
      const id = office ?? (isGrand ? '#grand' : `?${normalizeArabic(row.name)}`);
      const entry = table.get(id) ?? { name: office ?? row.name, pages: new Set<number>(), perSignature: new Map<string, number>(), cells: new Map<ColumnKey, Occurrence[]>(), stray: [] };
      entry.pages.add(chunk.page);
      entry.perSignature.set(chunk.signature, (entry.perSignature.get(chunk.signature) ?? 0) + 1);
      entry.stray.push(...row.stray);

      // كل عنوان شريحة = زوج (العدد، القيمة)؛ العناوين المكررة تُعامل كظهور مستقل لنفس الشريحة
      const pairs = new Map<number, { key: ColumnKey; clients: string | null; amount: string | null }>();
      chunk.columns.forEach((column, index) => {
        if (column.key === null) return;
        const slot = column.group;
        const pair = pairs.get(slot) ?? { key: column.key, clients: null, amount: null };
        if (column.kind === 'count') pair.clients = row.cells[index];
        else pair.amount = row.cells[index];
        pairs.set(slot, pair);
      });
      for (const pair of pairs.values()) {
        const list = entry.cells.get(pair.key) ?? [];
        list.push({ page: chunk.page, clients: pair.clients, amount: pair.amount });
        entry.cells.set(pair.key, list);
      }
      table.set(id, entry);
    }
  }

  const officeEntries = OFFICES.map((office) => ({ office, entry: table.get(office) }));
  if (!officeEntries.some((item) => item.entry)) {
    throw new ParReportError('no-offices', 'وُجد قسم «المحفظة في ظل المخاطر» لكن لم يُعثر فيه على أي مكتب من المكاتب المطلوبة.');
  }

  const figureOf = (entry: (typeof officeEntries)[number]['entry'], key: ColumnKey) => {
    const list = entry?.cells.get(key) ?? [];
    return {
      clients: settle(list.map((item) => item.clients), parseReportCount),
      amount: settle(list.map((item) => item.amount), parseReportAmount),
    };
  };

  let unresolved = 0;
  const duplicates: string[] = [];
  const mismatched: string[] = [];
  let verifiedOffices = 0;

  const offices: ParOfficeResult[] = officeEntries.map(({ office, entry }) => {
    const buckets = {} as ParOfficeResult['buckets'];
    const officeWarnings: string[] = [];

    if (!entry) {
      for (const id of BUCKET_IDS) buckets[id] = { clients: emptyFigure(), amount: emptyFigure() };
      unresolved += BUCKET_IDS.length * 2;
      return { office, found: false, buckets, reportTotal: { clients: null, amount: null }, warnings: ['المكتب غير موجود في قسم «المحفظة في ظل المخاطر» بالملف.'] };
    }

    for (const id of BUCKET_IDS) {
      buckets[id] = figureOf(entry, id);
      for (const [field, figure] of [['عدد العملاء', buckets[id].clients], ['المبلغ', buckets[id].amount]] as const) {
        if (figure.value !== null) continue;
        unresolved += 1;
        const reason =
          figure.issue === 'conflict'
            ? `قيم متعارضة في الملف (${figure.raw})`
            : figure.issue === 'unreadable'
              ? `قيمة غير مقروءة (${figure.raw})`
              : 'غير موجود في الملف';
        officeWarnings.push(`${field} — ${bucketLabel(id)}: ${reason}.`);
      }
    }

    if (Array.from(entry.perSignature.values()).some((count) => count > 1)) {
      duplicates.push(office);
      officeWarnings.push('المكتب مكرر في الجدول نفسه — راجع الأرقام.');
    }
    if (entry.stray.length) officeWarnings.push(`أرقام في صف المكتب لم تُنسب إلى عمود: ${entry.stray.join('، ')}.`);

    const overall = figureOf(entry, 'overall');
    const reportTotal = { clients: overall.clients.value, amount: overall.amount.value };

    const complete = BUCKET_IDS.every((id) => buckets[id].clients.value !== null && buckets[id].amount.value !== null);
    if (complete) {
      const clients = BUCKET_IDS.reduce((sum, id) => sum + (buckets[id].clients.value as number), 0);
      const amount = moneySum(BUCKET_IDS.map((id) => buckets[id].amount.value as number));
      if (reportTotal.clients === null || reportTotal.amount === null) {
        officeWarnings.push('إجمالي المكتب (عمود 1-5555555) غير مقروء — تعذّر التحقق من مجموع الشرائح.');
      } else if (clients !== reportTotal.clients || !same(amount, reportTotal.amount)) {
        mismatched.push(office);
        officeWarnings.push(
          `مجموع الشرائح (${fmt(clients)} عميل، ${fmt(amount)}) لا يطابق إجمالي المكتب في التقرير (${fmt(reportTotal.clients)} عميل، ${fmt(reportTotal.amount)}).`,
        );
      } else {
        verifiedOffices += 1;
      }
      for (const id of BUCKET_IDS) {
        const c = buckets[id].clients.value as number;
        const a = buckets[id].amount.value as number;
        if ((c === 0) !== (a === 0)) officeWarnings.push(`${bucketLabel(id)}: ${c === 0 ? 'مبلغ دون عملاء' : 'عملاء دون مبلغ'} — راجع الخانتين.`);
      }
    }

    return { office, found: true, buckets, reportTotal, warnings: officeWarnings };
  });

  const extraOffices = Array.from(table.entries())
    .filter(([id]) => id.startsWith('?'))
    .map(([, entry]) => entry.name);
  if (extraOffices.length) warnings.push(`أسماء في القسم ليست من المكاتب التسعة عشر ولم تُستورد: ${extraOffices.join('، ')}.`);

  /* ------------------------------ فحوص المطابقة --------------------------- */

  const found = offices.filter((office) => office.found).length;
  const missingNames = offices.filter((office) => !office.found).map((office) => office.office);
  const checks: ParCheck[] = [
    { id: 'section', label: 'القسم المقروء: «المحفظة في ظل المخاطر» فقط', ok: true, detail: ignoredSections.length ? `تم تجاهل: ${ignoredSections.join('، ')}` : undefined },
    { id: 'offices', label: `المكاتب: ${found} من ${OFFICES.length}`, ok: found === OFFICES.length, detail: missingNames.length ? `غير موجود: ${missingNames.join('، ')}` : undefined },
    { id: 'duplicates', label: 'لا مكاتب مكررة', ok: duplicates.length === 0, detail: duplicates.length ? `مكرر: ${duplicates.join('، ')}` : undefined },
    { id: 'figures', label: 'كل الخانات مقروءة', ok: unresolved === 0, detail: unresolved ? `${unresolved} خانة تحتاج إدخالًا يدويًا` : undefined },
    {
      id: 'office-totals',
      label: 'مجموع شرائح كل مكتب = إجماليه في التقرير',
      ok: verifiedOffices === found && found > 0,
      detail: verifiedOffices === found ? undefined : mismatched.length ? `غير مطابق: ${mismatched.join('، ')}` : `تم التحقق من ${verifiedOffices} من ${found}`,
    },
  ];

  // مجاميع الأعمدة مقابل صف «المجموع الكلي» (يشمل كل صفوف القسم، حتى غير المدرجة في القائمة)
  const grand = table.get('#grand');
  if (grand) {
    const dataEntries = Array.from(table.entries()).filter(([id]) => id !== '#grand').map(([, entry]) => entry);
    const columnSum = (key: ColumnKey) => {
      const figures = dataEntries.map((entry) => figureOf(entry, key));
      if (figures.some((figure) => figure.clients.value === null || figure.amount.value === null)) return null;
      return {
        clients: figures.reduce((sum, figure) => sum + (figure.clients.value as number), 0),
        amount: moneySum(figures.map((figure) => figure.amount.value as number)),
      };
    };
    const failures: string[] = [];
    let compared = 0;
    const keys: Array<{ key: ColumnKey; label: string }> = [
      { key: 'd1_30', label: '1-30' },
      { key: 'd31_60', label: '31-60' },
      { key: 'd61_90', label: '61-90' },
      { key: 'd91_120', label: '91-120' },
      { key: 'npl', label: 'أكثر من 120' },
      { key: 'overall', label: 'الإجمالي' },
    ];
    const matched: string[] = [];
    for (const { key, label } of keys) {
      const expected = figureOf(grand, key);
      const actual = columnSum(key);
      if (expected.clients.value === null || expected.amount.value === null || actual === null) continue;
      compared += 1;
      if (actual.clients !== expected.clients.value || Math.abs(actual.amount - expected.amount.value) > 0.05) {
        failures.push(`${label}: مجموع المكاتب ${fmt(actual.clients)} عميل / ${fmt(actual.amount)} — والمكتوب في صف «المجموع الكلي» ${fmt(expected.clients.value)} عميل / ${fmt(expected.amount.value)}`);
      } else {
        matched.push(label);
      }
    }
    checks.push({
      id: 'column-totals',
      label: 'مجاميع الأعمدة = صف «المجموع الكلي» في التقرير',
      ok: compared > 0 && failures.length === 0,
      detail: failures.length
        ? `${failures.join('؛ ')}.${matched.length ? ` مطابق: ${matched.join('، ')}.` : ''} أرقام المكاتب مأخوذة من صفوف المكاتب نفسها لا من صف المجموع.`
        : compared === 0
          ? 'تعذّرت المقارنة'
          : undefined,
    });
  } else {
    checks.push({ id: 'column-totals', label: 'مجاميع الأعمدة = صف «المجموع الكلي»', ok: false, detail: 'صف «المجموع الكلي» غير موجود في القسم' });
  }

  return {
    sectionTitle: parChunks[0].title,
    pages: Array.from(new Set(usable.map((chunk) => chunk.page))).sort((a, b) => a - b),
    asOf: asOfDate(rows),
    offices,
    extraOffices,
    ignoredSections,
    checks,
    warnings,
    unresolved,
  };
}
