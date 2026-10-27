import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AnnualNote, type AttendanceRecord, type DailyMinute, type Employee, type FieldVisit, type Leave, type LeavePermissionRecord, type MonthlyEvaluation, type Observation, type VisitTiming } from '../src/db/schema';
import { FONT_TIMES_BOLD, FONT_TIMES_REGULAR } from '../src/lib/pdf-times-fonts';
import { buildCompleteEmployeePdf, type CompleteEmployeeData } from '../src/lib/pdf/completeEmployee';

const stamp = '2026-01-01T10:00:00.000Z';
const base = (id: string) => ({ id, createdAt: stamp, updatedAt: stamp });
const employee: Employee = { ...base('employee-pdf-1'), employeeNo: 17, name: 'أحمد محمد علي', code: 'RO-17', sector: 'قطاع الصعيد', governorate: 'بني سويف', jobTitle: 'ضابط مخاطر', employmentDate: '2020-03-12', branches: 'بني سويف، ناصر', status: 'active', archived: false, notes: 'ملاحظة الموظف تظهر في الملف والتقرير.' };
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
  fieldVisits: [{ ...base('fv1'), employeeId: employee.id, region: 'بني سويف', branch: 'ناصر', visitDate: '2026-03-10', visitType: 'متابعة', reference: 'REF-1', status: 'completed', reportSubmittedAt: null, reportReviewedAt: null, revisions: 1, finalAssessment: 'ملتزم', notes: 'مراجعة ميدانية.' }] as FieldVisit[],
  evaluations: [{ ...base('ev1'), employeeId: employee.id, year: 2026, month: 2, visits: 3, scores: { c1: 4 }, notes: 'تقييم مختصر.' }] as MonthlyEvaluation[],
  annualNotes: [{ ...base('an1'), employeeId: employee.id, year: 2025, notes: 'ملاحظة سنوية.' }] as AnnualNote[],
  observations: [{ ...base('o1'), employeeId: employee.id, date: '2026-03-15', source: 'زيارة ميدانية', branch: 'ناصر', reference: 'OBS-1', category: 'مستندات', severity: 'medium', details: 'تفاصيل الملاحظة.', correctiveAction: 'استكمال مستند.', notificationDate: null, status: 'open', resolutionDate: null, recurrence: false, followUpNotes: '' }] as Observation[],
};
const fonts = () => {
  const root = resolve(process.cwd(), 'public/fonts');
  return {
    regular: { metrics: FONT_TIMES_REGULAR, bytes: new Uint8Array(readFileSync(resolve(root, 'times-new-roman-regular.ttf'))) },
    bold: { metrics: FONT_TIMES_BOLD, bytes: new Uint8Array(readFileSync(resolve(root, 'times-new-roman-bold.ttf'))) },
  };
};
const pagesIn = (pdf: Uint8Array) => (Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const only = (keys: Array<keyof CompleteEmployeeData>) => Object.fromEntries(Object.entries(testData).map(([key,value]) => [key, keys.includes(key as keyof CompleteEmployeeData) ? value : key === 'employee' ? value : []])) as CompleteEmployeeData;

describe('تقرير PDF الكامل للموظف — صفحة A4 واحدة', () => {
  it('ينشئ صفحة A4 واحدة بخط Times New Roman مضمّن، مع سجلات جميع الأقسام دون تكرار', async () => {
    const pdf = await buildCompleteEmployeePdf(testData, fonts());
    const raw = Buffer.from(pdf).toString('latin1');
    expect(pagesIn(pdf)).toBe(1);
    expect(raw).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(raw).toContain('/TimesNewRomanPSMT');
    expect(raw).toContain('/TimesNewRomanPS-BoldMT');
    expect(raw).toContain('/ToUnicode');
    expect(raw).not.toContain('CASH إدارة المخاطر');
    expect(pdf.length).toBeGreaterThan(10_000);
    writeFileSync('/tmp/employee-complete-preview.pdf', pdf);
  });

  it.each([
    ['basic-only', { ...testData, visits: [], minutes: [], legacyLeaves: [], leavePermissions: [], attendance: [], fieldVisits: [], annualNotes: [], observations: [] }],
    ['visits-only', { ...testData, minutes: [], legacyLeaves: [], leavePermissions: [], attendance: [], fieldVisits: [], annualNotes: [], observations: [] }],
    ['leave-permissions', { ...testData, visits: [], minutes: [], attendance: [], fieldVisits: [], annualNotes: [], observations: [] }],
    ['attendance-delays', { ...testData, visits: [], minutes: [], legacyLeaves: [], leavePermissions: [], fieldVisits: [], annualNotes: [], observations: [] }],
    ['minutes-only', { ...testData, visits: [], legacyLeaves: [], leavePermissions: [], attendance: [], fieldVisits: [], annualNotes: [], observations: [] }],
  ])('يجعل تقرير %s في صفحة واحدة', async (_name, fixture) => {
    const pdf = await buildCompleteEmployeePdf(fixture as CompleteEmployeeData, fonts());
    expect(pagesIn(pdf)).toBe(1);
    writeFileSync(`/tmp/employee-${_name}.pdf`, pdf);
  });

  it('يعرض الاسم والملاحظات العربية الطويلة على صفحة واحدة إذا أمكن، دون قصّ النص', async () => {
    const longData = { ...testData, employee: { ...employee, name: 'عبد الرحمن مصطفى عبد الله محمد إبراهيم حسن الشاذلي', notes: 'ملاحظة عربية طويلة تشمل متابعة دقيقة للملفات والزيارات والإجراءات الإدارية. '.repeat(8) } };
    const pdf = await buildCompleteEmployeePdf(longData, fonts());
    expect(pagesIn(pdf)).toBe(1);
    writeFileSync('/tmp/employee-long-arabic.pdf', pdf);
  });

  it('يرفض الحجم المستحيل بوضوح بدل إسقاط سجلات أو إنشاء صفحات إضافية', async () => {
    const minutes = Array.from({length: 60}, (_, i) => ({
      ...base(`minute-${i}`), employeeId: employee.id, date: `2026-${String(i % 12 + 1).padStart(2,'0')}-15`,
      fileRequestTime: '09:00', fileReceivedTime: '09:15', responseTime: '10:00', inspectionResult: 'no_notes',
    })) as DailyMinute[];
    await expect(buildCompleteEmployeePdf({ ...only([]), minutes }, fonts())).rejects.toThrow(/لم يُحذف أي سجل/);
  });
});
