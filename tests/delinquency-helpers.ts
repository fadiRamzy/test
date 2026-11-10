import { BUCKET_IDS, emptyBuckets, snapshotId, type MonthlySnapshot } from '../src/lib/delinquency';

/** [عدد العملاء، المبلغ] لكل شريحة بالترتيب: 1–30، 31–60، 61–90، 91–120، NPL */
export type BucketPairs = [number, number][];

export function makeSnapshot(branch: string, year: number, month: number, pairs: BucketPairs): MonthlySnapshot {
  const buckets = emptyBuckets();
  BUCKET_IDS.forEach((id, index) => {
    buckets[id] = { clients: pairs[index][0], amount: pairs[index][1] };
  });
  return {
    id: snapshotId(branch, year, month),
    branch,
    year,
    month,
    buckets,
    notes: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

export const toInput = (branch: string, year: number, month: number, pairs: BucketPairs) => ({
  branch,
  year,
  month,
  notes: '',
  buckets: Object.fromEntries(BUCKET_IDS.map((id, index) => [id, { clients: pairs[index][0], amount: pairs[index][1] }])),
});

export const SEP: BucketPairs = [[120, 450000.5], [80, 380000], [45, 290000.25], [30, 210000], [60, 720000]];
export const OCT: BucketPairs = [[135, 498500.75], [70, 341000], [52, 335500.5], [28, 198000], [71, 845250.1]];
export const ZERO: BucketPairs = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];

export const sep = () => makeSnapshot('فرع المنيا', 2026, 9, SEP);
export const oct = () => makeSnapshot('فرع المنيا', 2026, 10, OCT);

/** قائمتا عملاء صغيرتان تغطيان كل أنواع الحركة */
export const LIST_A = 'C1\t10\t1000\nC2\t40\t2000\nC3\t70\t3000\nC4\t100\t4000\nC5\t200\t5000\nC6\t15\t600';
export const LIST_B = 'C1\t40\t1100\nC2\t20\t1500\nC3\t70\t3000\nC4\t130\t4200\nC7\t5\t300\nC8\t150\t900';

/* ------------------------- قارئ ZIP بسيط (ملفات غير مضغوطة) ---------------- */

/** يقرأ ملف ZIP بطريقة التخزين (بدون ضغط) ويتحقق من CRC كل ملف */
export function unzipStored(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  const files = new Map<string, string>();

  // سجل نهاية الدليل المركزي
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: لا يوجد سجل نهاية الدليل المركزي');
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('ZIP: توقيع دليل مركزي غير صالح');
    const method = view.getUint16(pointer + 10, true);
    const crc = view.getUint32(pointer + 16, true);
    const size = view.getUint32(pointer + 20, true);
    const nameLen = view.getUint16(pointer + 28, true);
    const extraLen = view.getUint16(pointer + 30, true);
    const commentLen = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
    if (method !== 0) throw new Error(`ZIP: الملف ${name} مضغوط`);

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP: توقيع ملف محلي غير صالح');
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(start, start + size);
    if (crc32Check(data) !== crc) throw new Error(`ZIP: CRC غير مطابق للملف ${name}`);
    files.set(name, decoder.decode(data));
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** تنفيذ مستقل لـ CRC-32 (للتحقق من تنفيذ التطبيق) */
function crc32Check(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ParsedCell {
  ref: string;
  /** القيمة المخزنة (نص أو رقم) */
  value: string | number | null;
  formula: string | null;
}

/** يحلل XML ورقة عمل ويعيد خريطة الخلايا بحسب المرجع (A1) */
export function parseSheet(xml: string): Map<string, ParsedCell> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML غير صالح');
  const cells = new Map<string, ParsedCell>();
  for (const node of Array.from(doc.getElementsByTagName('c'))) {
    const ref = node.getAttribute('r') ?? '';
    const type = node.getAttribute('t');
    const formulaNode = node.getElementsByTagName('f')[0];
    const valueNode = node.getElementsByTagName('v')[0];
    const inline = node.getElementsByTagName('t')[0];
    let value: string | number | null = null;
    if (type === 'inlineStr') value = inline?.textContent ?? '';
    else if (type === 'str') value = valueNode?.textContent ?? '';
    else if (valueNode) value = Number(valueNode.textContent);
    cells.set(ref, { ref, value, formula: formulaNode ? formulaNode.textContent ?? '' : null });
  }
  return cells;
}

/** أسماء الأوراق بالترتيب مع مسار ملف كل ورقة */
export function workbookSheets(files: Map<string, string>): Array<{ name: string; path: string }> {
  const doc = new DOMParser().parseFromString(files.get('xl/workbook.xml') ?? '', 'application/xml');
  return Array.from(doc.getElementsByTagName('sheet')).map((node, index) => ({
    name: node.getAttribute('name') ?? '',
    path: `xl/worksheets/sheet${index + 1}.xml`,
  }));
}

/* --------------------- مُقيِّم صيغ مستقل (للتحقق من Excel) ------------------ */

export type CellValue = number | string | boolean | null;

class FormulaError extends Error {}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ref'; sheet: string | null; ref: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === ' ') {
      i += 1;
    } else if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < formula.length) {
        if (formula[j] === '"' && formula[j + 1] === '"') {
          value += '"';
          j += 2;
        } else if (formula[j] === '"') break;
        else {
          value += formula[j];
          j += 1;
        }
      }
      tokens.push({ kind: 'str', value });
      i = j + 1;
    } else if (ch === "'") {
      // مرجع بورقة أخرى: 'اسم الورقة'!A1
      let j = i + 1;
      let sheet = '';
      while (j < formula.length) {
        if (formula[j] === "'" && formula[j + 1] === "'") {
          sheet += "'";
          j += 2;
        } else if (formula[j] === "'") break;
        else {
          sheet += formula[j];
          j += 1;
        }
      }
      if (formula[j + 1] !== '!') throw new Error(`صيغة غير مفهومة: ${formula}`);
      const match = /^\$?[A-Z]+\$?\d+/.exec(formula.slice(j + 2));
      if (!match) throw new Error(`مرجع غير صالح في: ${formula}`);
      tokens.push({ kind: 'ref', sheet, ref: match[0].replace(/\$/g, '') });
      i = j + 2 + match[0].length;
    } else if (/\d|\./.test(ch)) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(formula.slice(i));
      if (!match) throw new Error(`رقم غير صالح في: ${formula}`);
      tokens.push({ kind: 'num', value: Number(match[0]) });
      i += match[0].length;
    } else if (/[A-Z$]/.test(ch)) {
      const ref = /^\$?[A-Z]+\$?\d+/.exec(formula.slice(i));
      const name = /^[A-Z]+(?=\()/.exec(formula.slice(i));
      if (name) {
        tokens.push({ kind: 'name', value: name[0] });
        i += name[0].length;
      } else if (ref) {
        tokens.push({ kind: 'ref', sheet: null, ref: ref[0].replace(/\$/g, '') });
        i += ref[0].length;
      } else throw new Error(`رمز غير مفهوم في: ${formula}`);
    } else {
      const two = formula.slice(i, i + 2);
      if (two === '<>' || two === '<=' || two === '>=') {
        tokens.push({ kind: 'op', value: two });
        i += 2;
      } else if ('+-*/(),:=<>'.includes(ch)) {
        tokens.push({ kind: 'op', value: ch });
        i += 1;
      } else throw new Error(`رمز غير مفهوم «${ch}» في: ${formula}`);
    }
  }
  return tokens;
}

const splitRef = (ref: string): { col: number; row: number } => {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) throw new Error(`مرجع غير صالح: ${ref}`);
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(match[2]) };
};

const joinRef = (col: number, row: number): string => {
  let name = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row}`;
};

const excelRound = (value: number, digits: number): number => {
  const abs = Math.abs(value);
  const rounded = Number(`${Math.round(Number(`${abs}e${digits}`))}e${-digits}`);
  return value < 0 ? -rounded : rounded;
};

const toNumber = (value: CellValue): number => {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new FormulaError('#VALUE!');
};

function matchesCriterion(value: CellValue, criterion: string): boolean {
  const match = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(criterion);
  const op = match?.[1] ?? '=';
  const target = Number(match?.[2]);
  if (typeof value !== 'number' || Number.isNaN(target)) return false;
  if (op === '<') return value < target;
  if (op === '>') return value > target;
  if (op === '<=') return value <= target;
  if (op === '>=') return value >= target;
  if (op === '<>') return value !== target;
  return value === target;
}

/**
 * يعيد حساب كل صيغ المصنف من القيم الخام فقط (دون الاعتماد على القيم المخزنة للصيغ).
 * يدعم ما يستخدمه التصدير: + − × ÷، المقارنات، IF، IFERROR، OR، SUM، SUMIF، COUNTIF، ROUND.
 */
export function recalcWorkbook(sheets: Map<string, Map<string, ParsedCell>>): (sheet: string, ref: string) => CellValue {
  const memo = new Map<string, CellValue>();
  const active = new Set<string>();

  const valueOf = (sheet: string, ref: string): CellValue => {
    const key = `${sheet}!${ref}`;
    if (memo.has(key)) return memo.get(key) as CellValue;
    const cells = sheets.get(sheet);
    if (!cells) throw new Error(`ورقة غير موجودة في الصيغة: ${sheet}`);
    const cell = cells.get(ref);
    let value: CellValue;
    if (!cell) value = null;
    else if (cell.formula === null) value = cell.value;
    else {
      if (active.has(key)) throw new Error(`مرجع دائري عند ${key}`);
      active.add(key);
      value = evaluate(cell.formula, sheet);
      active.delete(key);
    }
    memo.set(key, value);
    return value;
  };

  const evaluate = (formula: string, sheet: string): CellValue => {
    const tokens = tokenize(formula);
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (value: string) => peek()?.kind === 'op' && (peek() as { value: string }).value === value;
    const expect = (value: string) => {
      if (!isOp(value)) throw new Error(`متوقع «${value}» في: ${formula}`);
      pos += 1;
    };

    type Lazy = () => CellValue;

    const rangeValues = (): CellValue[] => {
      const first = tokens[pos];
      if (first?.kind !== 'ref') throw new Error(`متوقع نطاق في: ${formula}`);
      pos += 1;
      const targetSheet = first.sheet ?? sheet;
      if (!isOp(':')) return [valueOf(targetSheet, first.ref)];
      pos += 1;
      const second = tokens[pos];
      if (second?.kind !== 'ref') throw new Error(`نطاق ناقص في: ${formula}`);
      pos += 1;
      const from = splitRef(first.ref);
      const to = splitRef(second.ref);
      const values: CellValue[] = [];
      for (let row = from.row; row <= to.row; row += 1)
        for (let col = from.col; col <= to.col; col += 1) values.push(valueOf(targetSheet, joinRef(col, row)));
      return values;
    };

    const parseArgsLazy = (): Lazy[] => {
      // يلتقط حدود كل وسيط دون تقييمه (لتقييم IF/IFERROR بشكل كسول)
      const args: Lazy[] = [];
      for (;;) {
        const start = pos;
        let depth = 0;
        while (pos < tokens.length) {
          const token = tokens[pos];
          if (token.kind === 'op' && token.value === '(') depth += 1;
          else if (token.kind === 'op' && token.value === ')') {
            if (depth === 0) break;
            depth -= 1;
          } else if (token.kind === 'op' && token.value === ',' && depth === 0) break;
          pos += 1;
        }
        const end = pos;
        args.push(() => {
          const saved = pos;
          pos = start;
          try {
            const value = comparison();
            if (pos !== end) throw new Error(`وسيط غير مفهوم في: ${formula}`);
            return value;
          } finally {
            // يُستعاد الموضع حتى لو رمى الوسيط خطأ صيغة (ليلتقطه IFERROR)
            pos = saved;
          }
        });
        if (isOp(',')) pos += 1;
        else break;
      }
      return args;
    };

    const call = (name: string): CellValue => {
      expect('(');
      if (name === 'SUM' || name === 'SUMIF' || name === 'COUNTIF') {
        const values = rangeValues();
        if (name === 'SUM') {
          const all = [...values];
          while (isOp(',')) {
            pos += 1;
            all.push(...rangeValues());
          }
          expect(')');
          return all.reduce<number>((sum, value) => (typeof value === 'number' ? sum + value : sum), 0);
        }
        expect(',');
        const criterion = tokens[pos];
        if (criterion?.kind !== 'str') throw new Error(`معيار غير مدعوم في: ${formula}`);
        pos += 1;
        expect(')');
        const hits = values.filter((value) => matchesCriterion(value, criterion.value));
        return name === 'COUNTIF' ? hits.length : hits.reduce<number>((sum, value) => sum + (value as number), 0);
      }
      const args = parseArgsLazy();
      expect(')');
      if (name === 'IF') return args[0]() ? args[1]() : args[2] ? args[2]() : false;
      if (name === 'IFERROR') {
        try {
          return args[0]();
        } catch (error) {
          if (error instanceof FormulaError) return args[1]();
          throw error;
        }
      }
      if (name === 'OR') return args.some((arg) => Boolean(arg()));
      if (name === 'ROUND') return excelRound(toNumber(args[0]()), toNumber(args[1]()));
      throw new Error(`دالة غير مدعومة في المُقيِّم: ${name}`);
    };

    const primary = (): CellValue => {
      const token = tokens[pos];
      if (!token) throw new Error(`صيغة ناقصة: ${formula}`);
      if (token.kind === 'num' || token.kind === 'str') {
        pos += 1;
        return token.value;
      }
      if (token.kind === 'ref') {
        pos += 1;
        return valueOf(token.sheet ?? sheet, token.ref);
      }
      if (token.kind === 'name') {
        pos += 1;
        return call(token.value);
      }
      if (token.value === '(') {
        pos += 1;
        const value = comparison();
        expect(')');
        return value;
      }
      if (token.value === '-') {
        pos += 1;
        return -toNumber(primary());
      }
      if (token.value === '+') {
        pos += 1;
        return toNumber(primary());
      }
      throw new Error(`رمز غير متوقع «${token.value}» في: ${formula}`);
    };

    const term = (): CellValue => {
      let left = primary();
      while (isOp('*') || isOp('/')) {
        const op = (tokens[pos] as { value: string }).value;
        pos += 1;
        const right = toNumber(primary());
        if (op === '/' && right === 0) throw new FormulaError('#DIV/0!');
        left = op === '*' ? toNumber(left) * right : toNumber(left) / right;
      }
      return left;
    };

    const sum = (): CellValue => {
      let left = term();
      while (isOp('+') || isOp('-')) {
        const op = (tokens[pos] as { value: string }).value;
        pos += 1;
        const right = toNumber(term());
        left = op === '+' ? toNumber(left) + right : toNumber(left) - right;
      }
      return left;
    };

    const comparison = (): CellValue => {
      const left = sum();
      const token = tokens[pos];
      if (token?.kind !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(token.value)) return left;
      pos += 1;
      const right = sum();
      // مقارنة Excel: الخلية الفارغة تساوي صفرًا، والنص لا يساوي رقمًا
      const a = left === null ? 0 : left;
      const b = right === null ? 0 : right;
      if (token.value === '=') return a === b;
      if (token.value === '<>') return a !== b;
      if (typeof a !== 'number' || typeof b !== 'number') throw new FormulaError('#VALUE!');
      if (token.value === '<') return a < b;
      if (token.value === '>') return a > b;
      if (token.value === '<=') return a <= b;
      return a >= b;
    };

    const result = comparison();
    if (pos !== tokens.length) throw new Error(`بقايا غير مفهومة في: ${formula}`);
    return result;
  };

  return valueOf;
}

/** يفتح ملف xlsx ويعيد أوراقه (بالاسم) بعد تحليل خلاياها */
export function openWorkbook(bytes: Uint8Array) {
  const files = unzipStored(bytes);
  const order = workbookSheets(files);
  const sheets = new Map<string, Map<string, ParsedCell>>();
  for (const sheet of order) sheets.set(sheet.name, parseSheet(files.get(sheet.path) ?? ''));
  return { files, order, sheets };
}

export const closeTo = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
