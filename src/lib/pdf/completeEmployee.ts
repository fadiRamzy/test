import type {
  AnnualNote,
  AttendanceRecord,
  DailyMinute,
  Employee,
  FieldVisit,
  Leave,
  LeavePermissionRecord,
  MonthlyEvaluation,
  Observation,
  VisitTiming,
} from '../../db/schema';
import { EMPLOYEE_STATUS_LABELS, EVALUATION_CRITERIA, INSPECTION_RESULT_LABELS, OBSERVATION_STATUS_LABELS, SEVERITY_LABELS, VISIT_STATUS_LABELS } from '../../db/schema';
import { attendanceDelayMinutes, earlyDepartureMinutes } from '../attendance';
import { minuteTiming, monthlyTotals, visitTiming } from '../calc';
import { fmtDate, fmtDurationWords, fmtTime, fmtNumber, monthName } from '../format';
import type { PdfFontSource } from './writer';
import { PdfDocument, type PdfPage } from './writer';
import { wrapText } from './shape';

export interface CompleteEmployeeData {
  employee: Employee;
  visits: VisitTiming[];
  minutes: DailyMinute[];
  legacyLeaves: Leave[];
  leavePermissions: LeavePermissionRecord[];
  attendance: AttendanceRecord[];
  fieldVisits: FieldVisit[];
  evaluations: MonthlyEvaluation[];
  annualNotes: AnnualNote[];
  observations: Observation[];
}

interface PdfRow { date: string; detail: string; }
interface PdfSection { title: string; rows: PdfRow[]; }

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 23;
const TABLE_W = PAGE_W - MARGIN * 2;
const DATE_W = 62;
const DETAIL_W = TABLE_W - DATE_W;
const COLORS = {
  header: '0.749 0.749 0.749',
  border: '0.60 0.60 0.60',
  alt: '0.949 0.949 0.949',
  white: '1 1 1',
  navy: '0.043 0.165 0.29',
  muted: '0.30 0.30 0.30',
};

const value = (text: string | number | null | undefined) => text === null || text === undefined || text === '' ? '—' : String(text);
const duration = (minutes: number | null) => minutes === null ? '—' : fmtDurationWords(minutes);
const time = (value?: string | null) => value ? fmtTime(value) : '—';
const date = (value?: string | null) => value ? fmtDate(value) : '—';
const sep = (...items: string[]) => items.filter(Boolean).join('  |  ');

function collectSections(input: CompleteEmployeeData): { sections: PdfSection[]; summary: string[] } {
  const { employee } = input;
  const visits = input.visits.filter((row) => row.employeeId === employee.id).sort((a, b) => (a.visitDate || '').localeCompare(b.visitDate || ''));
  const minutes = input.minutes.filter((row) => row.employeeId === employee.id).sort((a, b) => (a.date || a.createdAt || '').localeCompare(b.date || b.createdAt || ''));
  const legacyRecords = input.legacyLeaves.filter((row) => row.employeeId === employee.id);
  const legacyLeaves = legacyRecords.filter((row) => !row.type.includes('إذن'));
  const legacyPermissions = legacyRecords.filter((row) => row.type.includes('إذن'));
  const requests = input.leavePermissions.filter((row) => row.employeeId === employee.id);
  const leaves = requests.filter((row) => row.requestType === 'leave');
  const permissions = requests.filter((row) => row.requestType === 'permission');
  const attendance = input.attendance.filter((row) => row.employeeId === employee.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const fieldVisits = input.fieldVisits.filter((row) => row.employeeId === employee.id);
  const evaluations = input.evaluations.filter((row) => row.employeeId === employee.id).sort((a, b) => a.year - b.year || a.month - b.month);
  const annualNotes = input.annualNotes.filter((row) => row.employeeId === employee.id).sort((a, b) => a.year - b.year);
  const observations = input.observations.filter((row) => row.employeeId === employee.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const visitsByYear = new Map<string, Map<number, number>>();
  for (const row of visits) {
    if (!row.visitDate) continue;
    const year = row.visitDate.slice(0, 4);
    const month = Number(row.visitDate.slice(5, 7));
    if (!visitsByYear.has(year)) visitsByYear.set(year, new Map());
    const group = visitsByYear.get(year)!;
    group.set(month, (group.get(month) ?? 0) + 1);
  }
  const visitDistribution = Array.from(visitsByYear.entries()).map(([year, months]) => {
    const yearTotal = Array.from(months.values()).reduce((sum, count) => sum + count, 0);
    return `${year} (${yearTotal}): ${Array.from(months.entries()).sort(([a], [b]) => a - b).map(([month, count]) => `${monthName(month)} ${count}`).join('، ')}`;
  });
  const lateRows = attendance.filter((row) => attendanceDelayMinutes(row.arrivalTime) > 0);
  const earlyRows = attendance.filter((row) => earlyDepartureMinutes(row.departureTime) > 0);
  const lateTotal = lateRows.reduce((sum, row) => sum + attendanceDelayMinutes(row.arrivalTime), 0);
  const earlyTotal = earlyRows.reduce((sum, row) => sum + earlyDepartureMinutes(row.departureTime), 0);
  const legacyLeaveRows = legacyLeaves.map((row) => ({
    date: `${date(row.startDate)}${row.endDate && row.endDate !== row.startDate ? ` – ${date(row.endDate)}` : ''}`,
    detail: sep(`طلب: إجازة`, `النوع: ${value(row.type)}`, `المدة: ${row.unit === 'days' ? `${value(row.days)} يوم` : `${value(row.hours)} ساعة`}`, `ملاحظات: ${value(row.notes)}`),
  }));
  const newLeaveRows = leaves.map((row) => ({
    date: date(row.date),
    detail: sep('طلب: إجازة', `النوع: ${row.category}`, `ملاحظات: ${value(row.notes)}`),
  }));
  const legacyPermissionRows = legacyPermissions.map((row) => ({
    date: `${date(row.startDate)}${row.endDate && row.endDate !== row.startDate ? ` – ${date(row.endDate)}` : ''}`,
    detail: sep('طلب: إذن', `النوع: ${value(row.type)}`, `المدة: ${row.unit === 'days' ? `${value(row.days)} يوم` : `${value(row.hours)} ساعة`}`, `ملاحظات: ${value(row.notes)}`),
  }));
  const permissionRows = [
    ...legacyPermissionRows,
    ...permissions.map((row) => ({
      date: date(row.date),
      detail: sep('طلب: إذن', `النوع: ${row.category}`, `المدة: ${row.durationHours ? `${row.durationHours} ساعة` : '—'}`, `ملاحظات: ${value(row.notes)}`),
    })),
  ];
  const minuteRows = minutes.map((row) => {
    const timing = minuteTiming(row);
    const extras = [
      row.branch ? `الفرع: ${row.branch}` : '', row.clientRef ? `المرجع: ${row.clientRef}` : '',
      row.financingType ? `التمويل: ${row.financingType}` : '', row.amount !== null && row.amount !== undefined ? `المبلغ: ${fmtNumber(row.amount)}` : '',
      row.minuteReceivedTime ? `وقت الاستلام السابق: ${time(row.minuteReceivedTime)}` : '',
      row.finalResponseTime ? `الرد السابق: ${time(row.finalResponseTime)}` : '',
      row.result ? `النتيجة السابقة: ${row.result}` : '', row.status ? `الحالة السابقة: ${row.status}` : '',
      row.notes ? `ملاحظات: ${row.notes}` : '',
    ].filter(Boolean);
    return {
      date: date(row.date),
      detail: sep(
        row.createdAt ? `تاريخ التسجيل: ${date(row.createdAt.slice(0, 10))}` : '',
        `طلب الملف: ${time(row.fileRequestTime)}`, `استلام: ${time(row.fileReceivedTime)}`, `الرد: ${time(row.responseTime)}`,
        `الفحص: ${row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : value(row.result)}`,
        `المدة: ${duration(timing.minutes)}`, `التأخير: ${timing.invalid ? 'بيانات غير مكتملة' : timing.delayed ? 'متأخر' : 'لا يوجد'}`,
        ...extras,
      ),
    };
  });

  const sections: PdfSection[] = [
    { title: `الزيارات الموقوتة (${visits.length}) — تفاصيل كاملة`, rows: visits.map((row) => {
      const calc = visitTiming(row);
      return {
        date: date(row.visitDate),
        detail: sep(`الفرع: ${value(row.branch)}`, `العميل: ${value(row.clientName)}`, `المكان: ${value(row.location)}`, `تحرك: ${time(row.departureTime)}`, `رجوع: ${time(row.returnTime)}`, `المدة: ${duration(calc.minutes)}`, `ملاحظات: ${value(row.notes)}`),
      };
    }) },
    { title: `المحاضر اليومية (${minutes.length}) — جميع التوقيتات والنتائج`, rows: minuteRows },
    { title: `الإجازات (${legacyLeaves.length + leaves.length}) — سجلات النظام القديمة والجديدة`, rows: [...legacyLeaveRows, ...newLeaveRows] },
    { title: `الأذونات (${legacyPermissions.length + permissions.length}) — سجلات الإذن القديمة والجديدة`, rows: permissionRows },
    { title: `الحضور والانصراف — ${lateRows.length} تأخيرًا / ${fmtDurationWords(lateTotal)}، ${earlyRows.length} انصرافًا مبكرًا / ${fmtDurationWords(earlyTotal)}`, rows: attendance.map((row) => {
      const late = attendanceDelayMinutes(row.arrivalTime);
      const early = earlyDepartureMinutes(row.departureTime);
      return {
        date: date(row.date),
        detail: sep(`الحضور: ${time(row.arrivalTime)}`, `التأخير: ${late ? fmtDurationWords(late) : row.arrivalTime ? 'لا يوجد' : '—'}`, `الانصراف: ${time(row.departureTime)}`, `مبكر: ${early ? fmtDurationWords(early) : row.departureTime ? 'لا يوجد' : '—'}`, `ملاحظات: ${value(row.notes)}`),
      };
    }) },
    { title: `التقييمات الشهرية (${evaluations.length})`, rows: evaluations.map((row) => {
      const total = monthlyTotals(row.scores, row.visits);
      const scores = EVALUATION_CRITERIA.map((criterion) => `${criterion.name}: ${value(row.scores?.[criterion.id])}`).join('، ');
      return { date: `${monthName(row.month)} ${row.year}`, detail: sep(`زيارات: ${value(row.visits)}`, `المجموع: ${total.total}`, scores, `ملاحظات: ${value(row.notes)}`) };
    }) },
    { title: `الملاحظات السنوية (${annualNotes.length})`, rows: annualNotes.map((row) => ({ date: String(row.year), detail: `ملاحظات: ${value(row.notes)}` })) },
    { title: `الملاحظات والمتابعات (${observations.length})`, rows: observations.map((row) => ({
      date: date(row.date),
      detail: sep(`المصدر: ${value(row.source)}`, `الفرع: ${value(row.branch)}`, `المرجع: ${value(row.reference)}`, `التصنيف: ${value(row.category)}`, `الخطورة: ${SEVERITY_LABELS[row.severity] ?? value(row.severity)}`, `التفاصيل: ${value(row.details)}`, `الإجراء: ${value(row.correctiveAction)}`, `تاريخ الإخطار: ${date(row.notificationDate)}`, `الحالة: ${OBSERVATION_STATUS_LABELS[row.status] ?? value(row.status)}`, `تاريخ الإغلاق: ${date(row.resolutionDate)}`, `تكرار: ${row.recurrence ? 'نعم' : 'لا'}`, `متابعة: ${value(row.followUpNotes)}`),
    })) },
    { title: `الزيارات الميدانية السابقة (${fieldVisits.length})`, rows: fieldVisits.map((row) => ({
      date: date(row.visitDate),
      detail: sep(`المنطقة: ${value(row.region)}`, `الفرع: ${value(row.branch)}`, `النوع: ${value(row.visitType)}`, `المرجع: ${value(row.reference)}`, `الحالة: ${VISIT_STATUS_LABELS[row.status] ?? value(row.status)}`, `تسليم التقرير: ${date(row.reportSubmittedAt)}`, `مراجعة التقرير: ${date(row.reportReviewedAt)}`, `التعديلات: ${value(row.revisions)}`, `التقييم: ${value(row.finalAssessment)}`, `ملاحظات: ${value(row.notes)}`),
    })) },
  ];
  const monthlyBreakdown = visitDistribution.length ? visitDistribution.join('  |  ') : 'لا توجد زيارات مؤرخة';
  const summary = [
    `إجمالي الزيارات الموقوتة: ${fmtNumber(visits.length)}${visits.filter((row) => !row.visitDate).length ? ` (غير مؤرخة: ${visits.filter((row) => !row.visitDate).length})` : ''}`,
    `التوزيع الشهري: ${monthlyBreakdown}`,
    `محاضر يومية: ${fmtNumber(minutes.length)} · الإجازات: ${fmtNumber(legacyLeaves.length + leaves.length)} · الأذونات: ${fmtNumber(legacyPermissions.length + permissions.length)}`,
    `تأخيرات الحضور: ${fmtNumber(lateRows.length)} حدث / ${fmtDurationWords(lateTotal)} · الانصراف المبكر: ${fmtNumber(earlyRows.length)} حدث / ${fmtDurationWords(earlyTotal)}`,
    `زيارات ميدانية سابقة: ${fmtNumber(fieldVisits.length)} · تقييمات شهرية: ${fmtNumber(evaluations.length)} · ملاحظات: ${fmtNumber(observations.length + annualNotes.length)}`,
  ];
  return { sections, summary };
}

function measureLayout(data: CompleteEmployeeData, font: PdfFontSource, bodySize: number) {
  const { sections, summary } = collectSections(data);
  const lineHeight = bodySize * 1.19;
  const rows: Array<{ section?: string; date?: string; detail?: string; lines?: string[]; dateLines?: string[]; header?: boolean; height: number }> = [];
  const employee = data.employee;
  const facts = [
    `رقم الموظف: ${value(employee.employeeNo)}`, `الكود: ${value(employee.code)}`, `الحالة: ${EMPLOYEE_STATUS_LABELS[employee.status] ?? value(employee.status)}${employee.archived ? ' (مؤرشف)' : ''}`,
    `القطاع: ${value(employee.sector)}`, `المحافظة: ${value(employee.governorate)}`, `المسمى الوظيفي: ${value(employee.jobTitle)}`,
    `تاريخ التعيين: ${date(employee.employmentDate)}`, `الفروع: ${value(employee.branches)}`,
  ].join('  |  ');
  const note = value(employee.notes);
  const nameLines = wrapText(employee.name, 14, TABLE_W, font.metrics);
  const titleHeight = Math.max(17, nameLines.length * 16 + 2);
  const addIntroSection = (title: string, details: string[]) => {
    rows.push({ section: title, height: bodySize + 4.5 });
    for (const detail of details) {
      const lines = wrapText(detail, bodySize, TABLE_W - 10, font.metrics);
      rows.push({ detail, lines, height: Math.max(bodySize * 1.55, lines.length * lineHeight + 3.4) });
    }
  };
  addIntroSection('بيانات الموظف', [facts]);
  addIntroSection('ملاحظات على الموظف', [note]);
  addIntroSection('ملخص السجلات', summary);
  rows.push({ header: true, date: 'التاريخ', detail: 'التفاصيل', dateLines: ['التاريخ'], lines: ['التفاصيل'], height: bodySize * 1.75 });
  for (const section of sections) {
    rows.push({ section: section.title, height: bodySize + 4.5 });
    const details = section.rows.length ? section.rows : [{ date: '—', detail: 'لا توجد سجلات مسجلة' }];
    for (const row of details) {
      const lines = wrapText(row.detail, bodySize, DETAIL_W - 7, font.metrics);
      const dateLines = wrapText(row.date, bodySize * 0.92, DATE_W - 5, font.metrics);
      const lineCount = Math.max(lines.length, dateLines.length);
      rows.push({ date: row.date, detail: row.detail, lines, dateLines, height: Math.max(bodySize * 1.65, lineCount * lineHeight + 3.4) });
    }
  }
  const total = 12 + titleHeight + 2 + rows.reduce((sum, row) => sum + row.height, 0) + 10;
  return { rows, total, facts, note, summary, sections, nameLines, titleHeight };
}

export async function buildCompleteEmployeePdf(data: CompleteEmployeeData, fonts: { regular: PdfFontSource; bold: PdfFontSource }): Promise<Uint8Array> {
  const regularDoc = new PdfDocument(PAGE_W, PAGE_H);
  regularDoc.addFont('TimesNewRomanPSMT', 'F1', fonts.regular);
  regularDoc.addFont('TimesNewRomanPS-BoldMT', 'F2', fonts.bold);
  const candidates = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5];
  let layout = measureLayout(data, fonts.regular, candidates[candidates.length - 1]);
  let bodySize = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    const measured = measureLayout(data, fonts.regular, candidate);
    if (measured.total <= PAGE_H - 12) { layout = measured; bodySize = candidate; break; }
  }
  if (layout.total > PAGE_H - 12) {
    const recordCount = layout.sections.reduce((sum, section) => sum + section.rows.length, 0);
    throw new Error(`عدد السجلات (${recordCount}) أكبر من أن يُعرض كاملًا في صفحة واحدة مع الحفاظ على وضوح مقروء. لم يتم إنشاء تقرير ناقص.`);
  }

  const page: PdfPage = regularDoc.newPage();
  layout.nameLines.forEach((line, index) => page.text(line, { x: MARGIN, top: 12 + index * 16, font: 'bold', size: 14, color: COLORS.navy, align: 'right', maxWidth: TABLE_W }));
  let y = 12 + layout.titleHeight + 2;
  let alternate = false;
  const drawBand = (top: number, height: number, fill: string, label: string, size: number, bold = false) => {
    page.rect(MARGIN, top, TABLE_W, height, { fill });
    page.rect(MARGIN, top, TABLE_W, height, { stroke: COLORS.border, lineWidth: 0.45 });
    page.text(label, { x: MARGIN + 4, top: top + Math.max(1.2, (height - size) / 2), font: bold ? 'bold' : 'regular', size, color: COLORS.navy, align: 'right', maxWidth: TABLE_W - 8 });
  };
  const drawData = (row: { section?: string; date?: string; detail?: string; lines?: string[]; dateLines?: string[]; header?: boolean; height: number }) => {
    const height = row.height;
    const isSection = Boolean(row.section && !row.detail);
    if (row.header) {
      page.rect(MARGIN, y, TABLE_W, height, { fill: COLORS.header });
      page.rect(MARGIN, y, TABLE_W, height, { stroke: COLORS.border, lineWidth: 0.45 });
      page.line(MARGIN + TABLE_W - DATE_W, y, MARGIN + TABLE_W - DATE_W, y + height, COLORS.border, 0.42);
      page.text(row.lines?.[0] ?? '', { x: MARGIN + 3, top: y + 1.4, font: 'bold', size: bodySize, color: COLORS.navy, align: 'right', maxWidth: DETAIL_W - 6 });
      page.text(row.dateLines?.[0] ?? '', { x: MARGIN + DETAIL_W + 2, top: y + 1.4, font: 'bold', size: bodySize * 0.92, color: COLORS.navy, align: 'right', maxWidth: DATE_W - 4 });
      y += height;
      alternate = false;
      return;
    }
    if (isSection) {
      drawBand(y, height, COLORS.header, row.section!, bodySize + 0.7, true);
      y += height;
      alternate = false;
      return;
    }
    const fill = alternate ? COLORS.alt : COLORS.white;
    page.rect(MARGIN, y, TABLE_W, height, { fill });
    page.rect(MARGIN, y, TABLE_W, height, { stroke: COLORS.border, lineWidth: 0.42 });
    const dateWidth = row.date ? DATE_W : 0;
    if (dateWidth) page.line(MARGIN + TABLE_W - DATE_W, y, MARGIN + TABLE_W - DATE_W, y + height, COLORS.border, 0.42);
    const detailWidth = TABLE_W - dateWidth;
    (row.lines ?? []).forEach((line, index) => {
      page.text(line, { x: MARGIN + 3, top: y + 1.6 + index * bodySize * 1.19, font: 'regular', size: bodySize, color: COLORS.navy, align: 'right', maxWidth: detailWidth - 6 });
    });
    if (dateWidth) (row.dateLines ?? []).forEach((line, index) => {
      page.text(line, { x: MARGIN + detailWidth + 2, top: y + 1.6 + index * bodySize * 1.19, font: 'regular', size: bodySize * 0.92, color: COLORS.muted, align: 'right', maxWidth: DATE_W - 4 });
    });
    y += height;
    alternate = !alternate;
  };

  for (const row of layout.rows) drawData(row);
  regularDoc.addPage(page);
  return regularDoc.build();
}

export function employeePdfFileName(employee: Employee): string {
  const safe = `${employee.employeeNo}-${employee.name}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^\w\u0600-\u06FF.-]+/g, '');
  return `employee-${safe || employee.id}.pdf`;
}
