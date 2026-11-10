/**
 * كاتب ملفات Excel (‎.xlsx) صغير بلا أي مكتبات خارجية — على نهج كاتب PDF الموجود في المشروع.
 * يدعم: عدة أوراق، اتجاه RTL، تنسيقات أرقام، ألوان، حدود، دمج خلايا، عرض أعمدة، وصيغ حية
 * (تُكتب الصيغة مع قيمتها المحسوبة، ويعيد Excel حسابها عند الفتح).
 *
 * الملف الناتج حزمة ZIP غير مضغوطة (Stored) وفق معيار Office Open XML.
 */

/* --------------------------------- الأنماط -------------------------------- */

export type XlsxStyle =
  | 'default'
  | 'title'
  | 'subtitle'
  | 'section'
  | 'header'
  | 'text'
  | 'textBold'
  | 'int'
  | 'money'
  | 'pct'
  | 'deltaInt'
  | 'deltaMoney'
  | 'deltaPct'
  | 'points'
  | 'totalText'
  | 'totalInt'
  | 'totalMoney'
  | 'totalPct'
  | 'totalDeltaInt'
  | 'totalDeltaMoney'
  | 'totalDeltaPct'
  | 'note'
  | 'na'
  | 'toneDanger'
  | 'toneWarning'
  | 'toneSuccess'
  | 'toneInfo';

interface StyleDef {
  font: number;
  fill: number;
  border: number;
  numFmt: number;
  horizontal?: 'right' | 'center' | 'left';
  wrap?: boolean;
  text?: boolean;
}

const NUM_FORMATS: Array<{ id: number; code: string }> = [
  { id: 164, code: '#,##0' },
  { id: 165, code: '#,##0.00' },
  { id: 166, code: '0.0%' },
  { id: 167, code: '[Red]+#,##0;[Color10]-#,##0;0' },
  { id: 168, code: '[Red]+#,##0.00;[Color10]-#,##0.00;0.00' },
  { id: 169, code: '[Red]+0.0%;[Color10]-0.0%;0.0%' },
  { id: 170, code: '[Red]+0.0;[Color10]-0.0;0.0' },
];

/** الخطوط: 0 عادي · 1 عريض · 2 عنوان · 3 رأس جدول أبيض · 4 ملاحظة مائلة · 5 باهت */
const FONTS = [
  '<font><sz val="11"/><color rgb="FF1A2B3D"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="11"/><color rgb="FF0A2540"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="15"/><color rgb="FF0A2540"/><name val="Calibri"/><family val="2"/></font>',
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
  '<font><i/><sz val="10"/><color rgb="FF4A5F74"/><name val="Calibri"/><family val="2"/></font>',
  '<font><sz val="10"/><color rgb="FF8A9CAE"/><name val="Calibri"/><family val="2"/></font>',
];

const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;

/** التعبئات: 0 بلا · 1 gray125 (إلزامي) · 2 كحلي · 3 إجمالي · 4 خطر · 5 تنبيه · 6 إيجابي · 7 معلومة · 8 قسم · 9 غير متاح */
const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  solid('FF0F3357'),
  solid('FFEEF5FB'),
  solid('FFFBE1E1'),
  solid('FFFDF0D2'),
  solid('FFD9F2E6'),
  solid('FFEEF5FB'),
  solid('FFD9E7F3'),
  solid('FFF3F5F8'),
];

const BORDERS = [
  '<border><left/><right/><top/><bottom/><diagonal/></border>',
  '<border><left style="thin"><color rgb="FFCDD9E5"/></left><right style="thin"><color rgb="FFCDD9E5"/></right><top style="thin"><color rgb="FFCDD9E5"/></top><bottom style="thin"><color rgb="FFCDD9E5"/></bottom><diagonal/></border>',
];

const STYLE_DEFS: Record<XlsxStyle, StyleDef> = {
  default: { font: 0, fill: 0, border: 0, numFmt: 0 },
  title: { font: 2, fill: 0, border: 0, numFmt: 0, horizontal: 'right', text: true },
  subtitle: { font: 4, fill: 0, border: 0, numFmt: 0, horizontal: 'right', text: true },
  section: { font: 1, fill: 8, border: 1, numFmt: 0, horizontal: 'right', text: true },
  header: { font: 3, fill: 2, border: 1, numFmt: 0, horizontal: 'center', wrap: true, text: true },
  text: { font: 0, fill: 0, border: 1, numFmt: 0, horizontal: 'right', wrap: true, text: true },
  textBold: { font: 1, fill: 0, border: 1, numFmt: 0, horizontal: 'right', wrap: true, text: true },
  int: { font: 0, fill: 0, border: 1, numFmt: 164, horizontal: 'center' },
  money: { font: 0, fill: 0, border: 1, numFmt: 165, horizontal: 'center' },
  pct: { font: 0, fill: 0, border: 1, numFmt: 166, horizontal: 'center' },
  deltaInt: { font: 0, fill: 0, border: 1, numFmt: 167, horizontal: 'center' },
  deltaMoney: { font: 0, fill: 0, border: 1, numFmt: 168, horizontal: 'center' },
  deltaPct: { font: 0, fill: 0, border: 1, numFmt: 169, horizontal: 'center' },
  points: { font: 0, fill: 0, border: 1, numFmt: 170, horizontal: 'center' },
  totalText: { font: 1, fill: 3, border: 1, numFmt: 0, horizontal: 'right', text: true },
  totalInt: { font: 1, fill: 3, border: 1, numFmt: 164, horizontal: 'center' },
  totalMoney: { font: 1, fill: 3, border: 1, numFmt: 165, horizontal: 'center' },
  totalPct: { font: 1, fill: 3, border: 1, numFmt: 166, horizontal: 'center' },
  totalDeltaInt: { font: 1, fill: 3, border: 1, numFmt: 167, horizontal: 'center' },
  totalDeltaMoney: { font: 1, fill: 3, border: 1, numFmt: 168, horizontal: 'center' },
  totalDeltaPct: { font: 1, fill: 3, border: 1, numFmt: 169, horizontal: 'center' },
  note: { font: 4, fill: 0, border: 0, numFmt: 0, horizontal: 'right', wrap: true, text: true },
  na: { font: 5, fill: 9, border: 1, numFmt: 0, horizontal: 'center', text: true },
  toneDanger: { font: 1, fill: 4, border: 1, numFmt: 0, horizontal: 'center', text: true },
  toneWarning: { font: 1, fill: 5, border: 1, numFmt: 0, horizontal: 'center', text: true },
  toneSuccess: { font: 1, fill: 6, border: 1, numFmt: 0, horizontal: 'center', text: true },
  toneInfo: { font: 1, fill: 7, border: 1, numFmt: 0, horizontal: 'center', text: true },
};

const STYLE_NAMES = Object.keys(STYLE_DEFS) as XlsxStyle[];
const styleIndex = (name: XlsxStyle | undefined): number => Math.max(0, STYLE_NAMES.indexOf(name ?? 'default'));

/* ---------------------------------- الخلايا ------------------------------- */

export interface XlsxCell {
  /** القيمة (أو القيمة المحسوبة للصيغة) */
  v?: string | number | null;
  /** صيغة Excel بدون علامة = */
  f?: string;
  s?: XlsxStyle;
}

export type XlsxCellInput = XlsxCell | string | number | null | undefined;

export interface XlsxSheet {
  name: string;
  rows: XlsxCellInput[][];
  /** عرض الأعمدة بوحدة الأحرف */
  widths?: number[];
  /** نطاقات الدمج مثل A1:F1 */
  merges?: string[];
  /** عدد الصفوف المثبتة أعلى الورقة */
  freezeRows?: number;
  /** ارتفاع صفوف محددة (فهرس يبدأ من 0) */
  rowHeights?: Record<number, number>;
  /** اتجاه الورقة من اليمين لليسار (افتراضي: نعم) */
  rtl?: boolean;
}

/** اسم العمود من فهرسه (0 → A، 26 → AA) */
export function colName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** مرجع الخلية من فهرس العمود والصف (كلاهما يبدأ من 0): (0,0) → A1 */
export const cellRef = (col: number, row: number): string => `${colName(col)}${row + 1}`;

/** مرجع مطلق: (0,0) → $A$1 */
export const absRef = (col: number, row: number): string => `$${colName(col)}$${row + 1}`;

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** اسم ورقة صالح: بلا رموز ممنوعة وبحد أقصى 31 حرفًا وفريد */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'ورقة').slice(0, 31);
  let candidate = base;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** يقتبس اسم الورقة لاستخدامه داخل الصيغ: 'اسم الورقة'!A1 */
export const sheetRef = (sheetName: string, ref: string): string => `'${sheetName.replace(/'/g, "''")}'!${ref}`;

function normalizeCell(input: XlsxCellInput): XlsxCell | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' || typeof input === 'number') return { v: input };
  return input;
}

function cellXml(input: XlsxCellInput, col: number, row: number): string {
  const cell = normalizeCell(input);
  if (!cell) return '';
  const ref = cellRef(col, row);
  const style = cell.s ? ` s="${styleIndex(cell.s)}"` : '';
  const value = cell.v;

  if (cell.f) {
    const formula = `<f>${escapeXml(cell.f)}</f>`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}>${formula}<v>${value}</v></c>`;
    if (typeof value === 'string') return `<c r="${ref}"${style} t="str">${formula}<v>${escapeXml(value)}</v></c>`;
    return `<c r="${ref}"${style}>${formula}</c>`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `<c r="${ref}"${style}/>`;
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === 'string' && value !== '') {
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }
  return cell.s ? `<c r="${ref}"${style}/>` : '';
}

function sheetXml(sheet: XlsxSheet, selected: boolean): string {
  const rtl = sheet.rtl !== false;
  const freeze = sheet.freezeRows && sheet.freezeRows > 0 ? sheet.freezeRows : 0;
  const pane = freeze
    ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
    : '';
  const view = `<sheetViews><sheetView${rtl ? ' rightToLeft="1"' : ''}${selected ? ' tabSelected="1"' : ''} workbookViewId="0"${
    pane ? `>${pane}</sheetView>` : '/>'
  }</sheetViews>`;

  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row.map((cell, colIndex) => cellXml(cell, colIndex, rowIndex)).join('');
      const height = sheet.rowHeights?.[rowIndex];
      if (!cells && !height) return '';
      return `<row r="${rowIndex + 1}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');

  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
    : '';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    view +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    merges +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="landscape"/>' +
    '</worksheet>'
  );
}

function stylesXml(): string {
  const xfs = STYLE_NAMES.map((name) => {
    const def = STYLE_DEFS[name];
    const align =
      def.horizontal || def.wrap || def.text
        ? `<alignment${def.horizontal ? ` horizontal="${def.horizontal}"` : ''} vertical="center"${def.wrap ? ' wrapText="1"' : ''}${
            def.text ? ' readingOrder="2"' : ''
          }/>`
        : '';
    const attrs =
      `numFmtId="${def.numFmt}" fontId="${def.font}" fillId="${def.fill}" borderId="${def.border}" xfId="0"` +
      (def.numFmt ? ' applyNumberFormat="1"' : '') +
      (def.font ? ' applyFont="1"' : '') +
      (def.fill ? ' applyFill="1"' : '') +
      (def.border ? ' applyBorder="1"' : '') +
      (align ? ' applyAlignment="1"' : '');
    return align ? `<xf ${attrs}>${align}</xf>` : `<xf ${attrs}/>`;
  }).join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${NUM_FORMATS.length}">${NUM_FORMATS.map(
      (format) => `<numFmt numFmtId="${format.id}" formatCode="${escapeXml(format.code)}"/>`,
    ).join('')}</numFmts>` +
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.join('')}</fills>` +
    `<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${STYLE_NAMES.length}">${xfs}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

/* ----------------------------------- ZIP ---------------------------------- */

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** ينشئ أرشيف ZIP غير مضغوط (Stored) */
export function zipStored(entries: ZipEntry[], date = new Date()): Uint8Array {
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate = (((Math.max(1980, date.getFullYear()) - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);

  const prepared = entries.map((entry) => ({ name: utf8(entry.name), data: entry.data, crc: crc32(entry.data) }));
  const localSize = prepared.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  let offset = 0;
  const offsets: number[] = [];
  for (const entry of prepared) {
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(entry.name, offset + 30);
    out.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }

  const centralStart = offset;
  prepared.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, dosTime, true);
    view.setUint16(offset + 14, dosDate, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, offsets[index], true);
    out.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}

/* --------------------------------- المصنّف -------------------------------- */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxOptions {
  title?: string;
  creator?: string;
  date?: Date;
}

/** يبني ملف ‎.xlsx كاملًا ويعيده كبايتات */
export function buildXlsx(sheets: XlsxSheet[], options: XlsxOptions = {}): Uint8Array {
  if (!sheets.length) throw new Error('لا توجد أوراق للتصدير.');
  const date = options.date ?? new Date();
  const used = new Set<string>();
  const named = sheets.map((sheet) => ({ ...sheet, name: safeSheetName(sheet.name, used) }));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    named
      .map(
        (_sheet, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(options.title ?? '')}</dc:title>` +
    `<dc:creator>${escapeXml(options.creator ?? '')}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    '</cp:coreProperties>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>' +
    `<sheets>${named
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join('')}</sheets>` +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    '</workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    named
      .map(
        (_sheet, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'docProps/core.xml', data: utf8(core) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
    { name: 'xl/styles.xml', data: utf8(stylesXml()) },
    ...named.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: utf8(sheetXml(sheet, index === 0)) })),
  ];

  return zipStored(entries, date);
}

/** أسماء الأوراق النهائية بعد التنظيف — بنفس ترتيب الإدخال (لبناء مراجع الصيغ بين الأوراق) */
export function resolveSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => safeSheetName(name, used));
}
