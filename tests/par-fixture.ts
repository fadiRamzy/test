/**
 * تقرير «اعمار الديون» اصطناعي للاختبارات — بنفس بنية التقرير الحقيقي لكن بأرقام مختلَقة كلها.
 *
 * البنية (كما في التقرير الفعلي):
 *   قسم «المتأخرات» (جدولان) ثم قسم «المحفظة قي ظل المخاطرة» (جدولان)، كل جدول ينقسم على عدة صفحات
 *   ويتكرر رأسه في كل صفحة: سطر عناوين الشرائح، عنوان القسم في الركن، ثم سطر «العدد / القيمة».
 *
 * يُنتج: عناصر نصية بمواضعها (لاختبار المحلّل مباشرة)، وملف PDF فعلي (لاختبار القراءة عبر pdf.js).
 */
import { OFFICES } from '../src/delinquency/lib/offices';
import type { PdfTextItem } from '../src/delinquency/lib/parReport';

export const PAR_TITLE = 'المحفظة قي ظل المخاطرة';
export const ARREARS_TITLE = 'المتأخرات';

/** [العدد، المبلغ بالمليم] */
type Pair = [number, number];

export interface FixtureOffice {
  name: string;
  /** شرائح المحفظة في ظل المخاطر: 1-30، 31-60، 61-90، 91-120، أكثر من 120 */
  par: Pair[];
  /** شرائح قسم المتأخرات (أرقام مختلفة عمدًا) */
  arrears: Pair[];
}

/** أرقام مختلَقة ثابتة لكل مكتب (لا علاقة لها بأي تقرير حقيقي) */
export function fixtureOffices(names: readonly string[] = OFFICES): FixtureOffice[] {
  return names.map((name, i) => {
    const par: Pair[] = [0, 1, 2, 3, 4].map((b) => {
      // بعض الشرائح صفرية؛ وشريحة NPL لبعض المكاتب تتجاوز الألف (لاختبار فواصل الآلاف في الأعداد)
      const count = (i * 7 + b * 5 + 3) % 11 === 0 ? 0 : ((i * 13 + b * 29 + 4) % 37) + (b === 4 ? 1100 * (i % 2) : 0);
      if (count === 0) return [0, 0];
      const mills = count * 1_234_567 + i * 10_125 + b * 331;
      // مبالغ بثلاث خانات عشرية، أو خانتين (31-60)، أو بلا كسور (61-90) — كما تظهر في التقارير
      return [count, b === 1 ? mills - (mills % 10) : b === 2 ? mills - (mills % 1000) : mills];
    });
    const arrears: Pair[] = par.map(([count, mills], b) => [count + 100 + b, mills + 55_555_555]);
    return { name, par, arrears };
  });
}

/** ينسّق المبلغ كما في التقرير: فواصل آلاف، وحتى ثلاث خانات عشرية بلا أصفار زائدة */
export function fmtAmount(mills: number): string {
  const whole = Math.floor(mills / 1000);
  const fraction = String(mills % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

export const fmtCount = (count: number): string => count.toLocaleString('en-US');

export const amountOf = (mills: number): number => mills / 1000;

/* ---------------------------------- التخطيط -------------------------------- */

export interface FixtureItem extends PdfTextItem {
  tag?: { section: string; row: string; label: string; occurrence: number; kind: 'count' | 'amount' | 'name' };
}

interface ColumnSpec {
  label: string;
  value: (office: FixtureOffice) => Pair;
}

const sum = (pairs: Pair[]): Pair => pairs.reduce<Pair>((acc, [c, m]) => [acc[0] + c, acc[1] + m], [0, 0]);
const bucket = (key: 'par' | 'arrears', index: number) => (office: FixtureOffice) => office[key][index];
const overall = (key: 'par' | 'arrears') => (office: FixtureOffice) => sum(office[key]);
/** عمود «المجموع» في التقرير = الإجمالي + مجموع الشرائح (أي ضعف الإجمالي) */
const doubled = (key: 'par' | 'arrears') => (office: FixtureOffice): Pair => {
  const [c, m] = sum(office[key]);
  return [c * 2, m * 2];
};

const TABLES: Array<{ title: string; columns: ColumnSpec[] }> = [
  {
    title: ARREARS_TITLE,
    columns: [
      { label: '1-30', value: bucket('arrears', 0) },
      { label: '1-5555555', value: overall('arrears') },
      { label: '1-30', value: bucket('arrears', 0) },
      { label: '31-60', value: bucket('arrears', 1) },
      { label: '61-90', value: bucket('arrears', 2) },
      { label: '91-120', value: bucket('arrears', 3) },
    ],
  },
  {
    title: ARREARS_TITLE,
    columns: [
      { label: '121-99999', value: bucket('arrears', 4) },
      { label: 'المجموع', value: doubled('arrears') },
    ],
  },
  {
    title: PAR_TITLE,
    columns: [
      { label: '1-30', value: bucket('par', 0) },
      { label: '1-5555555', value: overall('par') },
      { label: '1-30', value: bucket('par', 0) },
      { label: '121-99999', value: bucket('par', 4) },
      { label: '31-60', value: bucket('par', 1) },
      { label: '121-99999', value: bucket('par', 4) },
    ],
  },
  {
    title: PAR_TITLE,
    columns: [
      { label: '61-90', value: bucket('par', 2) },
      { label: '121-99999', value: bucket('par', 4) },
      { label: '91-120', value: bucket('par', 3) },
      { label: '121-99999', value: bucket('par', 4) },
      { label: 'المجموع', value: doubled('par') },
    ],
  },
];

const CHAR_WIDTH = 4;
const PAGE_BOTTOM = 570;
const ROW_PITCH = 25;
export const GRAND_ROW = 'المجموع الكلي';

export interface FixtureOptions {
  offices?: FixtureOffice[];
  /** تاريخ «حتى تاريخ» (افتراضي 30/09/2031) */
  asOf?: string | null;
  /** الجداول المطلوب رسمها (افتراضي: كلها) */
  tables?: number[];
  /** بدون صف «المجموع الكلي» */
  noGrandRow?: boolean;
}

/** يبني عناصر النص للتقرير الاصطناعي بإحداثيات الصفحة المعروضة (794×595) */
export function buildFixtureItems(options: FixtureOptions = {}): FixtureItem[] {
  const offices = options.offices ?? fixtureOffices();
  const asOf = options.asOf === undefined ? '30/09/2031' : options.asOf;
  const items: FixtureItem[] = [];
  let page = 0;
  let y = 0;

  const put = (text: string, centre: number, baseline: number, tag?: FixtureItem['tag']) => {
    const width = Array.from(text).length * CHAR_WIDTH;
    items.push({ page, x: centre - width / 2, y: baseline, width, height: 8, text, ...(tag ? { tag } : {}) });
  };

  const newPage = () => {
    page += 1;
    put('test.user', 70, 24);
    put('شركة تجريبية للتمويل ترخيص رقم 99', 408, 41);
    put('05/10/2031', 70, 41);
    put('اعمار الديون', 398, 69);
    put(`${page}/9`, 65, 69);
    put('المكتب', 397, 94);
    put('حتى تاريخ', 448, 112);
    if (asOf) put(asOf, 368, 112);
    y = 137.5;
  };

  const header = (table: (typeof TABLES)[number]) => {
    table.columns.forEach((column, k) => {
      const wide = column.label === 'المجموع';
      put(column.label, (wide ? 631 : 642) - 100 * k, y);
      put('العدد', 672 - 100 * k, y + 15);
      put('القيمة', (wide ? 611 : 622) - 100 * k, y + 15);
    });
    put(table.title, 733, y + 7.5);
    y += 35;
  };

  newPage();
  (options.tables ?? TABLES.map((_, index) => index)).forEach((tableIndex) => {
    const table = TABLES[tableIndex];
    if (y + 35 + ROW_PITCH > PAGE_BOTTOM) newPage();
    header(table);

    const occurrenceOf = (k: number) => table.columns.slice(0, k).filter((column) => column.label === table.columns[k].label).length;
    const row = (name: string, values: Pair[]) => {
      if (y > PAGE_BOTTOM) {
        newPage();
        header(table);
      }
      put(name, 733, y, { section: table.title, row: name, label: '', occurrence: 0, kind: 'name' });
      values.forEach(([count, mills], k) => {
        const wide = table.columns[k].label === 'المجموع';
        const tag = { section: table.title, row: name, label: table.columns[k].label, occurrence: occurrenceOf(k) };
        put(fmtCount(count), 672 - 100 * k, y, { ...tag, kind: 'count' });
        put(fmtAmount(mills), (wide ? 611 : 622) - 100 * k, y, { ...tag, kind: 'amount' });
      });
      y += ROW_PITCH;
    };

    for (const office of offices) row(office.name, table.columns.map((column) => column.value(office)));
    if (!options.noGrandRow) row(GRAND_ROW, table.columns.map((column) => sum(offices.map((office) => column.value(office)))));
    y += 12;
  });
  return items;
}

export type Tag = NonNullable<FixtureItem['tag']>;

/** يعثر على عناصر خانة محددة (في كل مواضع تكرارها) */
export function findCells(items: FixtureItem[], match: Partial<Tag>): FixtureItem[] {
  return items.filter((item) => item.tag && (Object.keys(match) as Array<keyof Tag>).every((key) => item.tag?.[key] === match[key]));
}

/* ------------------------------- كتابة ملف PDF ----------------------------- */

const isRtl = (text: string): boolean => /[\u0600-\u06FF]/.test(text);

/**
 * يكتب العناصر في ملف PDF حقيقي (بدون ضغط): صفحات 595×794 مع دوران 90° كما في التقرير الفعلي،
 * وخط بترميز خاص مع جدول ToUnicode، والنص العربي مكتوب بترتيبه البصري كما تفعل مولّدات التقارير.
 */
export function buildFixturePdf(items: PdfTextItem[], options: { pages?: number } = {}): Uint8Array {
  const chars = Array.from(new Set(items.flatMap((item) => Array.from(item.text)))).sort();
  if (chars.length > 220) throw new Error('عدد الحروف أكبر من ترميز الخط التجريبي');
  const codeOf = new Map(chars.map((char, index) => [char, index + 33]));
  const hex = (text: string) => {
    const visual = isRtl(text) ? Array.from(text).reverse() : Array.from(text);
    return visual.map((char) => (codeOf.get(char) as number).toString(16).padStart(2, '0')).join('');
  };

  const pageCount = Math.max(options.pages ?? 0, ...items.map((item) => item.page), 1);
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);

  // 1: الفهرس، 2: شجرة الصفحات، 3: الخط، 4: ToUnicode، ثم لكل صفحة: كائن الصفحة ومحتواها
  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: pageCount }, (_, index) => `${5 + index * 2} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  const lastChar = 32 + Math.max(chars.length, 1);
  add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 33 /LastChar ${lastChar} /Widths [${chars.map(() => 500).join(' ') || '500'}] /ToUnicode 4 0 R >>`,
  );
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Fixture def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    ...chars.map((char, index) => `1 beginbfchar <${(index + 33).toString(16).padStart(2, '0')}> <${(char.codePointAt(0) as number).toString(16).padStart(4, '0')}> endbfchar`),
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);

  for (let page = 1; page <= pageCount; page += 1) {
    // مع الدوران 90°: س المعروضة = ص في فضاء الصفحة، وص المعروضة = س في فضاء الصفحة
    const content = items
      .filter((item) => item.page === page)
      .map((item) => `BT /F1 8 Tf 0 1 -1 0 ${item.y.toFixed(2)} ${item.x.toFixed(2)} Tm <${hex(item.text)}> Tj ET`)
      .join('\n');
    const stream = content || '0 0 595 794 re f';
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 794] /Rotate 90 /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + (page - 1) * 2} 0 R >>`);
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (char) => char.charCodeAt(0));
}
