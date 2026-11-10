import type { AttendanceRecord, Employee } from '../db/schema';
import { fmtDurationWords } from './format';

/** بعد 9:15 تحتسب مدة التأخير من 9:00، وما قبل ذلك 0. */
export function attendanceDelayMinutes(time?: string | null): number {
  const minute = timeToMinute(time);
  if (minute === null || minute <= 9 * 60 + 15) return 0;
  return minute - 9 * 60;
}

/** الانصراف قبل 5:00م فقط يُحسب مبكرًا. */
export function earlyDepartureMinutes(time?: string | null): number {
  const minute = timeToMinute(time);
  if (minute === null || minute >= 17 * 60) return 0;
  return 17 * 60 - minute;
}

export function timeToMinute(time?: string | null): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((time ?? '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export interface AttendanceEmployeeSummary {
  employee: Employee;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  lateRecords: AttendanceRecord[];
  earlyRecords: AttendanceRecord[];
}

export function summarizeAttendance(
  employees: Employee[],
  records: AttendanceRecord[],
  options: { employeeId: string; year: string; month: string },
): AttendanceEmployeeSummary[] {
  const filtered = records.filter((record) => {
    if (options.employeeId !== 'all' && record.employeeId !== options.employeeId) return false;
    if (!record.date) return false;
    if (options.year !== 'all' && !record.date.startsWith(options.year)) return false;
    if (options.month !== 'all' && record.date.slice(5, 7) !== options.month.padStart(2, '0')) return false;
    return true;
  });
  return employees
    .filter((employee) => options.employeeId === 'all' || employee.id === options.employeeId)
    .map((employee) => {
      const own = filtered.filter((record) => record.employeeId === employee.id);
      const lateRecords = own.filter((record) => attendanceDelayMinutes(record.arrivalTime) > 0);
      const earlyRecords = own.filter((record) => earlyDepartureMinutes(record.departureTime) > 0);
      return {
        employee,
        lateCount: lateRecords.length,
        lateMinutes: lateRecords.reduce((sum, record) => sum + attendanceDelayMinutes(record.arrivalTime), 0),
        earlyCount: earlyRecords.length,
        earlyMinutes: earlyRecords.reduce((sum, record) => sum + earlyDepartureMinutes(record.departureTime), 0),
        lateRecords,
        earlyRecords,
      };
    });
}

export function attendanceDurationLabel(minutes: number, noun: 'تأخير' | 'انصراف مبكر'): string {
  return `${fmtDurationWords(minutes)} ${noun}`;
}
