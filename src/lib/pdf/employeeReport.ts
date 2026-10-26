/** تجميع بيانات تقرير PDF من السجلات المحفوظة فعليًا (بلا أي قيم ثابتة) */
import type { DailyMinute, Employee, VisitTiming } from '../../db/schema';
import { visitTiming } from '../calc';
import { fmtDurationWords } from '../format';
import type { ReportEmployeeBlock } from './report';

export interface ReportSource {
  employees: Employee[];
  visitTimings: VisitTiming[];
  minutes: DailyMinute[];
}

export interface ReportOptions {
  /** معرّفات الموظفين المطلوبين — فارغة تعني الكل */
  employeeIds: string[];
  periodKind: 'month' | 'year';
  year: number;
  /** 1..12 — يُستخدم في التقرير الشهري فقط */
  month?: number;
}

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** تاريخ المحضر: التاريخ المسجّل إن وُجد وإلا تاريخ الإنشاء المحفوظ */
export const minuteDate = (row: DailyMinute): string => row.date || row.createdAt?.slice(0, 10) || '';

/** YYYY-MM-DD → YYYY/MM/DD */
export const pdfDate = (value?: string | null): string =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(0, 4)}/${value.slice(5, 7)}/${value.slice(8, 10)}` : '';

const inPeriod = (date: string, options: ReportOptions) => {
  if (!date || date.length < 7) return false;
  if (date.slice(0, 4) !== String(options.year)) return false;
  if (options.periodKind === 'month') {
    if (!options.month) return false;
    return Number(date.slice(5, 7)) === options.month;
  }
  return true;
};

export interface BuiltReport {
  blocks: ReportEmployeeBlock[];
  periodLabel: string;
  periodKind: 'month' | 'year';
  excludedNote: string | null;
}

export function buildEmployeeReport(source: ReportSource, options: ReportOptions): BuiltReport {
  const selected = source.employees.filter(
    (employee) => !options.employeeIds.length || options.employeeIds.includes(employee.id),
  );

  let undatedVisits = 0;
  let undatedMinutes = 0;

  const blocks: ReportEmployeeBlock[] = selected.map((employee) => {
    const allVisits = source.visitTimings.filter((row) => row.employeeId === employee.id);
    const allMinutes = source.minutes.filter((row) => row.employeeId === employee.id);
    undatedVisits += allVisits.filter((row) => !row.visitDate).length;
    undatedMinutes += allMinutes.filter((row) => !minuteDate(row)).length;

    const visits = allVisits
      .filter((row) => inPeriod(row.visitDate || '', options))
      .sort((a, b) => {
        if (a.visitDate !== b.visitDate) return a.visitDate < b.visitDate ? -1 : 1;
        return (a.departureTime || '') < (b.departureTime || '') ? -1 : 1;
      });
    const minuteRows = allMinutes.filter((row) => inPeriod(minuteDate(row), options));

    return {
      name: employee.name,
      visitCount: visits.length,
      minuteCount: minuteRows.length,
      visits: visits.map((row) => {
        const timing = visitTiming(row);
        return {
          branch: row.branch || '',
          clientName: row.clientName || '',
          date: pdfDate(row.visitDate),
          duration: timing.minutes === null ? '' : fmtDurationWords(timing.minutes),
        };
      }),
    };
  });

  const label =
    options.periodKind === 'month'
      ? `${monthNames[(options.month ?? 1) - 1]} ${options.year}`
      : `سنة ${options.year}`;

  const notes: string[] = [];
  if (undatedVisits) notes.push(`${undatedVisits} زيارة بلا تاريخ مسجّل — مستثناة من حساب الفترة.`);
  if (undatedMinutes) notes.push(`${undatedMinutes} محضر بلا تاريخ مسجّل — مستثنى من حساب الفترة.`);

  return {
    blocks,
    periodLabel: `${options.periodKind === 'month' ? 'تقرير شهري' : 'تقرير سنوي'} — ${label}`,
    periodKind: options.periodKind,
    excludedNote: notes.length ? notes.join(' ') : null,
  };
}
