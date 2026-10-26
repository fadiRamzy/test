/**
 * تقرير PDF لبيانات الموظفين (توقيت الزيارات + محاضر اليومية) — مقاس Letter طولي.
 * كل القيم تُمرَّر من السجلات المحفوظة؛ لا بيانات ثابتة داخل هذا الملف.
 */
import { PdfDocument, type PdfFontSource } from './writer';
import { measureText, wrapText } from './shape';

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

const MARGIN_RIGHT = 28;
const TABLE_WIDTH = 387;
const TABLE_RIGHT = PAGE_WIDTH - MARGIN_RIGHT;
const TABLE_LEFT = TABLE_RIGHT - TABLE_WIDTH;
const BLOCK_TOP = 35;
const PAGE_BOTTOM = PAGE_HEIGHT - 34;
const BLOCK_GAP = 26;

/** ألوان القالب المرجعي */
const COLORS = {
  header: '0.741 0.741 0.741',
  border: '0.616 0.616 0.616',
  altRow: '0.945 0.945 0.945',
  white: '1 1 1',
  text: '0.1 0.1 0.1',
  navy: '0.043 0.165 0.29',
  orange: '0.961 0.510 0.125',
  muted: '0.42 0.42 0.42',
};

/** عرض الأعمدة من اليمين إلى اليسار */
const COLUMNS = [
  { key: 'serial', label: 'م', width: 19, monthly: false },
  { key: 'branch', label: 'فرع الزيارة', width: 44, monthly: false },
  { key: 'visits', label: 'زيارت الشهر', width: 47, monthly: true, annual: 'زيارات السنة' },
  { key: 'client', label: 'اسم العميل', width: 86, monthly: false },
  { key: 'date', label: 'تاريخ الزيارة', width: 58, monthly: false },
  { key: 'duration', label: 'مدة الزيارة', width: 64, monthly: false },
  { key: 'minutes', label: 'عدد محاضر الشهر', width: 68, monthly: true, annual: 'عدد محاضر السنة' },
] as const;

const CELL_FONT = 8.5;
const HEADER_FONT = 8.5;
const LINE_HEIGHT = 10.5;
const ROW_HEIGHT = 18;

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

const LEAF: Array<string> = [];

export async function buildCashReportPdf(input: ReportInput): Promise<Uint8Array> {
  const doc = new PdfDocument(PAGE_WIDTH, PAGE_HEIGHT);
  doc.addFont('CASHArabic-Regular', 'F1', input.regular);
  doc.addFont('CASHArabic-Bold', 'F2', input.bold);
  const metrics = input.regular.metrics;

  const lefts = columnLefts();
  const monthHeaders = input.periodKind === 'month';

  /** ارتفاع صف الرأس (الرؤوس قد تحتاج سطرين) */
  const headerLines = COLUMNS.map((column) => {
    const label = monthHeaders ? column.label : ((column as { annual?: string }).annual ?? column.label);
    return wrapText(label, HEADER_FONT, column.width - 4, metrics);
  });
  const headerHeight = Math.max(
    22,
    Math.max(...headerLines.map((lines) => lines.length)) * LINE_HEIGHT + 8,
  );
  const EMPLOYEE_HEADER_HEIGHT = 20;

  let page = doc.newPage();

  const drawBrand = () => {
    // شكل كحلي مائل أعلى يسار الصفحة (إحداثيات من أعلى الصفحة)
    const bottom = PAGE_HEIGHT - 2;
    const top = PAGE_HEIGHT - 78;
    page.path(`-2 ${bottom} m 190 ${bottom} l 152 ${top} l -2 ${top} l h`, COLORS.navy);
    page.path(`152 ${top} m 190 ${bottom} l 203 ${bottom} l 165 ${top} l h`, COLORS.orange);
    page.text('CASH', { x: 20, top: 20, font: 'bold', size: 24, color: COLORS.orange, align: 'left', maxWidth: 120 });
    page.text('إدارة المخاطر', { x: 20, top: 48, font: 'regular', size: 8.5, color: '1 1 1', align: 'left', maxWidth: 120 });
  };

  const drawPeriodLabel = () => {
    page.text(input.periodLabel, {
      x: TABLE_LEFT,
      top: 14,
      font: 'bold',
      size: 9.5,
      color: COLORS.navy,
      align: 'right',
      maxWidth: TABLE_WIDTH,
    });
  };

  let cursorTop = 0;
  let firstPage = true;

  const startPage = () => {
    drawBrand();
    drawPeriodLabel();
    cursorTop = BLOCK_TOP;
    firstPage = false;
  };

  startPage();

  for (const block of input.blocks) {
    // تجهيز صفوف البيانات مع حساب الارتفاعات
    const rows = block.visits.map((visit, index) => {
      const values: Record<string, string> = {
        serial: String(index + 1),
        branch: visit.branch || '—',
        visits: index === 0 ? String(block.visitCount) : '',
        client: visit.clientName || '—',
        date: visit.date || '—',
        duration: visit.duration || '—',
        minutes: index === 0 ? String(block.minuteCount) : '',
      };
      const lines = COLUMNS.map((column) =>
        wrapText(values[column.key] ?? '', CELL_FONT, column.width - 5, metrics),
      );
      return { values, lines, height: Math.max(ROW_HEIGHT, Math.max(...lines.map((item) => item.length)) * LINE_HEIGHT + 6) };
    });

    const emptyRow =
      rows.length === 0
        ? (() => {
            const values: Record<string, string> = {
              serial: '—',
              branch: '—',
              visits: '0',
              client: 'لا توجد زيارات مسجلة في هذه الفترة',
              date: '—',
              duration: '—',
              minutes: String(block.minuteCount),
            };
            const lines = COLUMNS.map((column) => wrapText(values[column.key] ?? '', CELL_FONT, column.width - 5, metrics));
            return { values, lines, height: Math.max(ROW_HEIGHT, Math.max(...lines.map((item) => item.length)) * LINE_HEIGHT + 6) };
          })()
        : null;

    const dataRows = emptyRow ? [emptyRow] : rows;
    const totalHeight = EMPLOYEE_HEADER_HEIGHT + headerHeight + dataRows.reduce((sum, row) => sum + row.height, 0);

    if (!firstPage && cursorTop + totalHeight > PAGE_BOTTOM) {
      doc.addPage(page);
      page = doc.newPage();
      startPage();
    } else if (firstPage && cursorTop + totalHeight > PAGE_BOTTOM) {
      // لا شيء — سيُقسَّم أدناه
    }

    const drawEmployeeHeader = (continued = false) => {
      const labelWidth = 92;
      const top = cursorTop;
      page.rect(TABLE_LEFT, top, TABLE_WIDTH, EMPLOYEE_HEADER_HEIGHT, { fill: COLORS.header, stroke: COLORS.border });
      page.line(TABLE_RIGHT - labelWidth, top, TABLE_RIGHT - labelWidth, top + EMPLOYEE_HEADER_HEIGHT);
      page.text('اسم الموظف', {
        x: TABLE_RIGHT - labelWidth,
        top: top + 6,
        font: 'bold',
        size: 9,
        color: COLORS.text,
        align: 'center',
        maxWidth: labelWidth,
      });
      page.text(continued ? `${block.name} (تابع)` : block.name, {
        x: TABLE_LEFT,
        top: top + 6,
        font: 'bold',
        size: 9.5,
        color: COLORS.text,
        align: 'center',
        maxWidth: TABLE_WIDTH - labelWidth,
      });
      cursorTop += EMPLOYEE_HEADER_HEIGHT;
    };

    const drawHeaderRow = () => {
      const top = cursorTop;
      page.rect(TABLE_LEFT, top, TABLE_WIDTH, headerHeight, { fill: COLORS.header, stroke: COLORS.border });
      COLUMNS.forEach((column, index) => {
        const left = lefts[index];
        if (index > 0) page.line(TABLE_RIGHT - COLUMNS.slice(0, index).reduce((sum, item) => sum + item.width, 0), top, TABLE_RIGHT - COLUMNS.slice(0, index).reduce((sum, item) => sum + item.width, 0), top + headerHeight);
        const lines = headerLines[index];
        const startTop = top + (headerHeight - lines.length * LINE_HEIGHT) / 2 + 1;
        lines.forEach((line, lineIndex) => {
          page.text(line, {
            x: left,
            top: startTop + lineIndex * LINE_HEIGHT,
            font: 'bold',
            size: HEADER_FONT,
            color: COLORS.text,
            align: 'center',
            maxWidth: column.width,
          });
        });
      });
      cursorTop += headerHeight;
    };

    // تقسيم الصفوف على الصفحات دون قصّ أي بيانات
    let rowIndex = 0;
    let continued = false;
    while (rowIndex < dataRows.length) {
      drawEmployeeHeader(continued);
      drawHeaderRow();

      while (rowIndex < dataRows.length) {
        const row = dataRows[rowIndex];
        if (cursorTop + row.height > PAGE_BOTTOM) break;
        const top = cursorTop;
        const shade = rowIndex % 2 === 1 ? COLORS.altRow : COLORS.white;
        page.rect(TABLE_LEFT, top, TABLE_WIDTH, row.height, { fill: shade, stroke: COLORS.border });
        COLUMNS.forEach((column, index) => {
          if (index > 0) {
            const x = TABLE_RIGHT - COLUMNS.slice(0, index).reduce((sum, item) => sum + item.width, 0);
            page.line(x, top, x, top + row.height);
          }
          const lines = row.lines[index];
          const startTop = top + (row.height - lines.length * LINE_HEIGHT) / 2 + 0.5;
          lines.forEach((line, lineIndex) => {
            page.text(line, {
              x: lefts[index] + 1,
              top: startTop + lineIndex * LINE_HEIGHT,
              font: 'regular',
              size: CELL_FONT,
              color: COLORS.text,
              align: index === 0 ? 'center' : 'center',
              maxWidth: column.width - 2,
            });
          });
        });
        cursorTop += row.height;
        rowIndex += 1;
      }

      if (rowIndex < dataRows.length) {
        doc.addPage(page);
        page = doc.newPage();
        startPage();
        continued = true;
      }
    }

    if (block.footnote) {
      const notes = wrapText(block.footnote, 7.5, TABLE_WIDTH, metrics);
      notes.forEach((line, index) => {
        page.text(line, {
          x: TABLE_LEFT,
          top: cursorTop + 4 + index * 9,
          font: 'regular',
          size: 7.5,
          color: COLORS.muted,
          align: 'right',
          maxWidth: TABLE_WIDTH,
        });
      });
      cursorTop += 4 + notes.length * 9;
    }

    cursorTop += BLOCK_GAP;
  }

  if (input.excludedNote) {
    const lines = wrapText(input.excludedNote, 7.5, TABLE_WIDTH, metrics);
    if (cursorTop + lines.length * 9 > PAGE_BOTTOM) {
      doc.addPage(page);
      page = doc.newPage();
      startPage();
    }
    lines.forEach((line, index) => {
      page.text(line, {
        x: TABLE_LEFT,
        top: cursorTop + index * 9,
        font: 'regular',
        size: 7.5,
        color: COLORS.muted,
        align: 'right',
        maxWidth: TABLE_WIDTH,
      });
    });
  }

  doc.addPage(page);
  void LEAF;
  return doc.build();
}

/** أسماء الملفات */
export function reportFileName(periodKind: 'month' | 'year', label: string, scope: string): string {
  const safe = `${scope}-${label}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^\w.-]+/g, '');
  return `cash-${periodKind === 'month' ? 'monthly' : 'annual'}-${safe}.pdf`;
}

export { measureText };
