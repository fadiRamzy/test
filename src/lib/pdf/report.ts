/**
 * تقرير PDF لبيانات الموظفين (توقيت الزيارات + محاضر اليومية) — مطابق لقالب Word المرجعي.
 * كل القيم تُمرَّر من السجلات المحفوظة؛ لا بيانات ثابتة داخل هذا الملف.
 */
import { PdfDocument, type PdfFontSource } from './writer';
import { measureText, wrapText } from './shape';

export const PAGE_WIDTH = 612; // 8.5in
export const PAGE_HEIGHT = 792; // 11in

/** الجدول: 483pt = 6.708in، يبدأ 1in من اليسار و 0.62in من الأعلى */
const TABLE_LEFT = 72;
const TABLE_WIDTH = 483;
const TABLE_RIGHT = TABLE_LEFT + TABLE_WIDTH;
const BLOCK_TOP = 44.64;
const PAGE_BOTTOM = PAGE_HEIGHT - 40;
const BLOCK_GAP = 22;

/** ألوان القالب المرجعي */
const COLORS = {
  header: '0.749 0.749 0.749', // #BFBFBF
  border: '0.6 0.6 0.6', // #999999
  altRow: '0.949 0.949 0.949', // #F2F2F2
  white: '1 1 1',
  text: '0 0 0',
  navy: '0.043 0.165 0.29',
  orange: '0.961 0.510 0.125',
  muted: '0.35 0.35 0.35',
};

/** الأعمدة بالترتيب من اليمين إلى اليسار (المجموع 483pt) */
const COLUMNS = [
  { key: 'serial', label: 'م', width: 23.45, annual: 'م', size: 11, padX: 2.5 },
  { key: 'branch', label: 'فرع الزيارة', width: 54.85, annual: 'فرع الزيارة', size: 11, padX: 5.5 },
  { key: 'visits', label: 'زيارت الشهر', width: 58.5, annual: 'زيارات السنة', size: 11, padX: 5.5 },
  { key: 'client', label: 'اسم العميل', width: 108, annual: 'اسم العميل', size: 11, padX: 5.5 },
  { key: 'date', label: 'تاريخ الزيارة', width: 72, annual: 'تاريخ الزيارة', size: 10.5, padX: 5.5 },
  { key: 'duration', label: 'مدة الزيارة', width: 81, annual: 'مدة الزيارة', size: 10, padX: 5.5 },
  { key: 'minutes', label: 'عدد محاضر الشهر', width: 85.2, annual: 'عدد محاضر السنة', size: 11, padX: 5.5 },
] as const;

/** أحجام الخطوط: الجسم 11pt (Calibri/Arial في المرجع) · الرؤوس 11pt عريض · «م» 14pt */
const CELL_FONT = 11;
const HEADER_FONT = 11;
const SERIAL_HEADER_FONT = 14;
const LINE_HEIGHT = 13.4;

/** هوامش داخل الخلايا (5.5–6 نقطة أفقيًا · 2.5–3 رأسيًا) */
const PAD_X = 5.5;
const PAD_Y = 2.75;

/** ارتفاعات الصفوف */
const EMPLOYEE_HEADER_HEIGHT = 21.6;
const EMPLOYEE_NAME_CELL = 78.3;
const HEADER_ROW_HEIGHT = 21.6;
const DATA_ROW_HEIGHT = 22;

/** مساحة الشعار والزخرفة المرجعية: 2.14 × 2.58 بوصة = 154 × 186 نقطة */
const BRAND_WIDTH = 154;
const BRAND_HEIGHT = 186;

export interface ReportVisit {
  branch: string;
  clientName: string;
  /** YYYY/MM/DD */
  date: string;
  /** مدة مقروءة أو '' عند عدم صلاحيتها */
  duration: string;
}

export interface ReportEmployeeBlock {
  name: string;
  visitCount: number;
  minuteCount: number;
  visits: ReportVisit[];
  /** ملاحظة اختيارية تُطبع أسفل الجدول (مثل: زيارات بلا تاريخ) */
  footnote?: string;
}

export interface ReportInput {
  regular: PdfFontSource;
  bold: PdfFontSource;
  blocks: ReportEmployeeBlock[];
  periodLabel: string;
  periodKind: 'month' | 'year';
  excludedNote?: string | null;
}

/** مواضع الأعمدة من اليمين إلى اليسار */
function columnLefts() {
  const lefts: number[] = [];
  let cursor = TABLE_RIGHT;
  for (const column of COLUMNS) {
    lefts.push(cursor - column.width);
    cursor -= column.width;
  }
  return lefts;
}

export async function buildCashReportPdf(input: ReportInput): Promise<Uint8Array> {
  const doc = new PdfDocument(PAGE_WIDTH, PAGE_HEIGHT);
  doc.addFont('CASHArabic-Regular', 'F1', input.regular);
  doc.addFont('CASHArabic-Bold', 'F2', input.bold);
  const metrics = input.regular.metrics;
  const lefts = columnLefts();
  const monthHeaders = input.periodKind === 'month';

  const headerLabels = COLUMNS.map((column) => (monthHeaders ? column.label : column.annual));
  const headerTextWidth = COLUMNS.map((column) => column.width - column.padX * 2);
  const headerLines = headerLabels.map((label, index) => wrapText(label, HEADER_FONT, headerTextWidth[index], metrics));
  const headerHeight = Math.max(
    HEADER_ROW_HEIGHT,
    Math.max(...headerLines.map((lines) => lines.length)) * LINE_HEIGHT + PAD_Y * 2,
  );

  let page = doc.newPage();
  let cursorTop = BLOCK_TOP;

  /** نص متعدد الأسطر متمركز أفقيًا ورأسيًا داخل خلية */
  const cellText = (
    lines: string[],
    left: number,
    top: number,
    width: number,
    height: number,
    options: { font: 'regular' | 'bold'; size: number; color?: string; padX?: number },
  ) => {
    const padX = options.padX ?? PAD_X;
    const lineHeight = LINE_HEIGHT * (options.size / CELL_FONT);
    const blockHeight = lines.length * lineHeight;
    const startTop = top + Math.max(PAD_Y, (height - blockHeight) / 2);
    lines.forEach((line, index) => {
      page.text(line, {
        x: left + padX,
        top: startTop + index * lineHeight,
        font: options.font,
        size: options.size,
        color: options.color ?? COLORS.text,
        align: 'center',
        maxWidth: width - padX * 2,
      });
    });
  };

  const drawBrand = () => {
    // علامة CASH أعلى اليسار داخل مساحة 154×186 نقطة (2.14×2.58 بوصة) — رسم متجهي بلا تمديد لصور
    const topY = PAGE_HEIGHT - 1;
    const bottomY = PAGE_HEIGHT - BRAND_HEIGHT;
    const wedge = Math.min(BRAND_WIDTH - 36, 118);
    page.path(`0 ${topY} m ${wedge} ${topY} l 0 ${bottomY} l h`, COLORS.navy);
    page.path(
      `${wedge - 16} ${topY} m ${wedge} ${topY} l 12 ${bottomY} l ${wedge - 40} ${bottomY} l h`,
      COLORS.orange,
    );
    page.text('CASH', { x: 12, top: 13, font: 'bold', size: 21, color: COLORS.orange, align: 'left', maxWidth: 84 });
    page.text('إدارة المخاطر', { x: 12, top: 41, font: 'regular', size: 8, color: '1 1 1', align: 'left', maxWidth: 74 });
  };

  const drawPeriodLabel = () => {
    page.text(input.periodLabel, {
      x: TABLE_LEFT,
      top: 18,
      font: 'bold',
      size: 10,
      color: COLORS.navy,
      align: 'right',
      maxWidth: TABLE_WIDTH,
    });
  };

  const startPage = () => {
    drawBrand();
    drawPeriodLabel();
    cursorTop = BLOCK_TOP;
  };

  const newPage = () => {
    doc.addPage(page);
    page = doc.newPage();
    startPage();
  };

  /** إطار الخلية + الخطوط العمودية للأعمدة */
  const drawRowFrame = (top: number, height: number, fill: string) => {
    page.rect(TABLE_LEFT, top, TABLE_WIDTH, height, { fill });
    // الخطوط العمودية بين الأعمدة
    let edge = TABLE_RIGHT;
    for (let index = 0; index < COLUMNS.length - 1; index += 1) {
      edge -= COLUMNS[index].width;
      page.line(edge, top, edge, top + height, COLORS.border, 0.5);
    }
    // إطار الصف
    page.rect(TABLE_LEFT, top, TABLE_WIDTH, height, { stroke: COLORS.border, lineWidth: 0.5 });
  };

  startPage();

  for (const block of input.blocks) {
    const buildRow = (values: Record<string, string>) => {
      const lines = COLUMNS.map((column) =>
        wrapText(values[column.key] ?? '', column.size, column.width - column.padX * 2, metrics),
      );
      const tallest = Math.max(
        ...lines.map((item, index) => item.length * LINE_HEIGHT * (COLUMNS[index].size / CELL_FONT)),
      );
      return { values, lines, height: Math.max(DATA_ROW_HEIGHT, tallest + PAD_Y * 2) };
    };

    const rows = block.visits.map((visit, index) =>
      buildRow({
        serial: String(index + 1),
        branch: visit.branch || '—',
        visits: index === 0 ? String(block.visitCount) : '',
        client: visit.clientName || '—',
        date: visit.date || '—',
        duration: visit.duration || '—',
        minutes: index === 0 ? String(block.minuteCount) : '',
      }),
    );

    const dataRows = rows.length
      ? rows
      : [
          buildRow({
            serial: '—',
            branch: '—',
            visits: '0',
            client: 'لا توجد زيارات مسجلة في هذه الفترة',
            date: '—',
            duration: '—',
            minutes: String(block.minuteCount),
          }),
        ];

    // نبدأ الموظف في صفحة جديدة فقط إذا لم يتبقَّ متسع لرأسه وصفّين من بياناته
    const firstRows = dataRows.slice(0, 2).reduce((sum, row) => sum + row.height, 0);
    const minimumChunk = EMPLOYEE_HEADER_HEIGHT + headerHeight + firstRows;
    if (cursorTop + minimumChunk > PAGE_BOTTOM && cursorTop > BLOCK_TOP) newPage();

    let rowIndex = 0;
    let continued = false;

    while (rowIndex < dataRows.length) {
      // رأس الموظف
      const headerTop = cursorTop;
      page.rect(TABLE_LEFT, headerTop, TABLE_WIDTH, EMPLOYEE_HEADER_HEIGHT, { fill: COLORS.header });
      page.line(TABLE_RIGHT - EMPLOYEE_NAME_CELL, headerTop, TABLE_RIGHT - EMPLOYEE_NAME_CELL, headerTop + EMPLOYEE_HEADER_HEIGHT, COLORS.border, 1.5);
      page.rect(TABLE_LEFT, headerTop, TABLE_WIDTH, EMPLOYEE_HEADER_HEIGHT, { stroke: COLORS.border, lineWidth: 0.5 });
      cellText(['اسم الموظف'], TABLE_RIGHT - EMPLOYEE_NAME_CELL, headerTop, EMPLOYEE_NAME_CELL, EMPLOYEE_HEADER_HEIGHT, {
        font: 'bold',
        size: HEADER_FONT,
      });
      cellText(
        wrapText(continued ? `${block.name} (تابع)` : block.name, HEADER_FONT, TABLE_WIDTH - EMPLOYEE_NAME_CELL - PAD_X * 2, metrics),
        TABLE_LEFT,
        headerTop,
        TABLE_WIDTH - EMPLOYEE_NAME_CELL,
        EMPLOYEE_HEADER_HEIGHT,
        { font: 'bold', size: HEADER_FONT },
      );
      cursorTop += EMPLOYEE_HEADER_HEIGHT;

      // صف رؤوس الأعمدة
      const headTop = cursorTop;
      drawRowFrame(headTop, headerHeight, COLORS.header);
      COLUMNS.forEach((column, index) => {
        cellText(headerLines[index], lefts[index], headTop, column.width, headerHeight, {
          font: 'bold',
          size: column.key === 'serial' ? SERIAL_HEADER_FONT : HEADER_FONT,
          padX: column.padX,
        });
      });
      cursorTop += headerHeight;

      // صفوف البيانات
      while (rowIndex < dataRows.length) {
        const row = dataRows[rowIndex];
        if (cursorTop + row.height > PAGE_BOTTOM) break;
        const top = cursorTop;
        drawRowFrame(top, row.height, rowIndex % 2 === 1 ? COLORS.altRow : COLORS.white);
        COLUMNS.forEach((column, index) => {
          cellText(row.lines[index], lefts[index], top, column.width, row.height, {
            font: 'regular',
            size: column.size,
            padX: column.padX,
          });
        });
        cursorTop += row.height;
        rowIndex += 1;
      }

      if (rowIndex < dataRows.length) {
        newPage();
        continued = true;
      }
    }

    if (block.footnote) {
      const notes = wrapText(block.footnote, 8, TABLE_WIDTH - PAD_X * 2, metrics);
      if (cursorTop + notes.length * 10 + 6 > PAGE_BOTTOM) newPage();
      notes.forEach((line, index) => {
        page.text(line, {
          x: TABLE_LEFT + PAD_X,
          top: cursorTop + 4 + index * 10,
          font: 'regular',
          size: 8,
          color: COLORS.muted,
          align: 'right',
          maxWidth: TABLE_WIDTH - PAD_X * 2,
        });
      });
      cursorTop += 4 + notes.length * 10;
    }

    cursorTop += BLOCK_GAP;
  }

  if (input.excludedNote) {
    const lines = wrapText(input.excludedNote, 8, TABLE_WIDTH - PAD_X * 2, metrics);
    if (cursorTop + lines.length * 10 > PAGE_BOTTOM) newPage();
    lines.forEach((line, index) => {
      page.text(line, {
        x: TABLE_LEFT + PAD_X,
        top: cursorTop + index * 10,
        font: 'regular',
        size: 8,
        color: COLORS.muted,
        align: 'right',
        maxWidth: TABLE_WIDTH - PAD_X * 2,
      });
    });
  }

  doc.addPage(page);
  return doc.build();
}

/** أسماء الملفات */
export function reportFileName(periodKind: 'month' | 'year', label: string, scope: string): string {
  const safe = `${scope}-${label}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^\w.-]+/g, '');
  return `cash-${periodKind === 'month' ? 'monthly' : 'annual'}-${safe}.pdf`;
}

export { measureText };
