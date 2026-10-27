import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AnnualNote,
  type AttendanceRecord,
  type DailyMinute,
  type Employee,
  type FieldVisit,
  type Leave,
  type LeavePermissionRecord,
  type MonthlyEvaluation,
  type Observation,
  type VisitTiming,
} from '../src/db/schema';
import { FONT_TIMES_BOLD, FONT_TIMES_REGULAR } from '../src/lib/pdf-times-fonts';
import { buildCompleteEmployeePdf, type CompleteEmployeeData } from '../src/lib/pdf/completeEmployee';

const stamp = '2026-01-01T10:00:00.000Z';
const base = (id: string) => ({ id, createdAt: stamp, updatedAt: stamp });
const employee: Employee = {
  ...base('employee-pdf-1'), employeeNo: 17, name: 'أحمد محمد علي', code: 'RO-17', sector: 'قطاع الصعيد',
  governorate: 'بني سويف', jobTitle: 'ضابط مخاطر', employmentDate: '2020-03-12', branches: 'بني سويف، ناصر',
  status: 'active', archived: false, notes: 'ملاحظة الموظف تظهر في الملف والتقرير.',
};

const testData: CompleteEmployeeData = {
  employee,
  visits: [
    { ...base('v1'), employeeId: employee.id, visitDate: '2026-02-04', branch: 'بني سويف', clientName: 'عميل أول', location: 'الواسطى', departureTime: '09:20', returnTime: '11:40', notes: 'متابعة ملف التمويل.' },
    { ...base('v2'), employeeId: employee.id, visitDate: '2026-03-10', branch: 'ناصر', clientName: 'عميل ثانٍ', location: 'ناصر', departureTime: '12:15', returnTime: '14:30', notes: 'زيارة متابعة ثانية.' },
    { ...base('v-other'), employeeId: 'different-employee', visitDate: '2026-03-10', branch: 'فرع آخر', clientName: 'لا يظهر', location: '', departureTime: '', returnTime: '', notes: '' },
  ] as VisitTiming[],
  minutes: [
    { ...base('m1'), employeeId: employee.id, fileRequestTime: '09:05', fileReceivedTime: '09:20', responseTime: '10:00', inspectionResult: 'has_notes', date: '2026-02-04', notes: 'تفصيل المحضر الأول.' },
    { ...base('m2'), employeeId: employee.id, fileRequestTime: '10:00', fileReceivedTime: '10:05', responseTime: '10:35', inspectionResult: 'no_notes', date: '2026-03-10', notes: '' },
  ] as DailyMinute[],
  legacyLeaves: [
    { ...base('l1'), employeeId: employee.id, type: 'إجازة اعتيادي', startDate: '2026-01-12', endDate: '2026-01-13', unit: 'days', days: 2, hours: null, notes: 'راحة.' },
    { ...base('l2'), employeeId: employee.id, type: 'إذن انصراف', startDate: '2026-01-14', endDate: '2026-01-14', unit: 'hours', days: null, hours: 1, notes: 'سجل إذن قديم.' },
  ] as Leave[],
  leavePermissions: [
    { ...base('lp1'), employeeId: employee.id, requestType: 'leave', category: 'إجازة عارضة', date: '2026-04-01', durationHours: null, notes: 'ظرف عائلي.' },
    { ...base('lp2'), employeeId: employee.id, requestType: 'permission', category: 'إذن انصرف', date: '2026-04-02', durationHours: 1, notes: 'موعد.' },
    { ...base('lp3'), employeeId: employee.id, requestType: 'permission', category: 'إذن حضور', date: '2026-04-03', durationHours: 2, notes: 'مراجعة.' },
  ] as LeavePermissionRecord[],
  attendance: [
    { ...base('a1'), employeeId: employee.id, date: '2026-02-04', arrivalTime: '09:16', departureTime: '16:30', notes: 'تأخير وانصراف مبكر.' },
    { ...base('a2'), employeeId: employee.id, date: '2026-03-10', arrivalTime: '09:15', departureTime: '17:00', notes: '' },
  ] as AttendanceRecord[],
  fieldVisits: [
    { ...base('fv1'), employeeId: employee.id, region: 'بني سويف', branch: 'ناصر', visitDate: '2026-03-10', visitType: 'متابعة', reference: 'REF-1', status: 'completed', reportSubmittedAt: null, reportReviewedAt: null, revisions: 1, finalAssessment: 'ملتزم', notes: 'مراجعة ميدانية.' },
  ] as FieldVisit[],
  evaluations: [
    { ...base('ev1'), employeeId: employee.id, year: 2026, month: 2, visits: 3, scores: { c1: 4 }, notes: 'تقييم مختصر.' },
  ] as MonthlyEvaluation[],
  annualNotes: [
    { ...base('an1'), employeeId: employee.id, year: 2025, notes: 'ملاحظة سنوية.' },
  ] as AnnualNote[],
  observations: [
    { ...base('o1'), employeeId: employee.id, date: '2026-03-15', source: 'زيارة ميدانية', branch: 'ناصر', reference: 'OBS-1', category: 'مستندات', severity: 'medium', details: 'تفاصيل الملاحظة.', correctiveAction: 'استكمال مستند.', notificationDate: null, status: 'open', resolutionDate: null, recurrence: false, followUpNotes: '' },
  ] as Observation[],
};

describe('تقرير PDF الكامل للموظف', () => {
  it('ينشئ صفحة واحدة بخط Times New Roman مضمّن، ويحتوي سجلات متنوعة للموظف المحدد', async () => {
    const fontRoot = resolve(process.cwd(), 'public/fonts');
    const fonts = {
      regular: { metrics: FONT_TIMES_REGULAR, bytes: new Uint8Array(readFileSync(resolve(fontRoot, 'times-new-roman-regular.ttf'))) },
      bold: { metrics: FONT_TIMES_BOLD, bytes: new Uint8Array(readFileSync(resolve(fontRoot, 'times-new-roman-bold.ttf'))) },
    };
    const pdf = await buildCompleteEmployeePdf(testData, fonts);
    const raw = Buffer.from(pdf).toString('latin1');
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    expect(raw).toContain('/TimesNewRomanPSMT');
    expect(raw).toContain('/TimesNewRomanPS-BoldMT');
    expect(raw).toContain('/ToUnicode');
    expect(pdf.length).toBeGreaterThan(20_000);
    writeFileSync('/tmp/employee-complete-preview.pdf', pdf);
  });
});
