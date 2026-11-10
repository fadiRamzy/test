import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, useDatabase } from '../src/db/database';
import { saveAttendanceRecord, saveLeavePermission, saveEmployee, nextEmployeeNo, ValidationError, listAttendanceRecords, listLeavePermissions } from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';
import { attendanceDelayMinutes, earlyDepartureMinutes } from '../src/lib/attendance';
import { ENTITIES, validateBackup } from '../src/db/backup';

beforeEach(async () => {
  await useDatabase(`attendance-leaves-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
});

async function employee() {
  return saveEmployee({
    employeeNo: await nextEmployeeNo(), name: 'موظف اختبار', code: `T-${Math.random().toString(36).slice(2)}`,
    sector: 'قطاع', governorate: 'بني سويف', jobTitle: 'موظف', employmentDate: '2024-01-01',
    branches: '', status: 'active', notes: '',
  });
}

describe('حساب الحضور والانصراف', () => {
  it('يطبق مهلة 9:15 ويحسب التأخير من 9:00 بعد تجاوزها', () => {
    expect(attendanceDelayMinutes('09:00')).toBe(0);
    expect(attendanceDelayMinutes('09:15')).toBe(0);
    expect(attendanceDelayMinutes('09:16')).toBe(16);
    expect(attendanceDelayMinutes('09:30')).toBe(30);
    expect(attendanceDelayMinutes('')).toBe(0);
  });

  it('يحسب الانصراف المبكر حتى 5:00م فقط', () => {
    expect(earlyDepartureMinutes('16:59')).toBe(1);
    expect(earlyDepartureMinutes('16:30')).toBe(30);
    expect(earlyDepartureMinutes('17:00')).toBe(0);
    expect(earlyDepartureMinutes('17:10')).toBe(0);
    expect(earlyDepartureMinutes('')).toBe(0);
  });
});

describe('الإجازات والأذونات والحضور الجديدة', () => {
  it('يجمع حدود الأذونات عبر النوعين ويستثني السجل الجاري تعديله', async () => {
    const person = await employee();
    const first = await saveLeavePermission({ employeeId: person.id, requestType: 'permission', category: 'إذن انصرف', date: '2026-10-01', durationHours: 1 });
    await saveLeavePermission({ employeeId: person.id, requestType: 'permission', category: 'إذن حضور', date: '2026-10-03', durationHours: 1 });
    await saveLeavePermission({ employeeId: person.id, requestType: 'permission', category: 'إذن انصرف', date: '2026-10-05', durationHours: 1 });
    await saveLeavePermission({ employeeId: person.id, requestType: 'leave', category: 'إجازة اعتيادي', date: '2026-10-06', durationHours: null });
    await saveLeavePermission({ employeeId: person.id, requestType: 'permission', category: 'إذن حضور', date: '2026-10-07', durationHours: 1 });
    await expect(saveLeavePermission({ employeeId: person.id, requestType: 'permission', category: 'إذن انصرف', date: '2026-10-09', durationHours: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveLeavePermission({ ...first, durationHours: 2 })).rejects.toBeInstanceOf(ValidationError);
    const edited = await saveLeavePermission({ ...first, date: '2026-11-01', durationHours: 2 });
    expect(edited.id).toBe(first.id);
    expect((await listLeavePermissions()).length).toBe(5);
  });

  it('يحفظ سجل الحضور حتى مع ترك كل الحقول فارغة، ويعطيه معرّفًا فريدًا', async () => {
    const first = await saveAttendanceRecord({});
    const second = await saveAttendanceRecord({});
    expect(first.id).not.toBe(second.id);
    expect(first.employeeId).toBe('');
    expect(first.date).toBe('');
    expect(first.arrivalTime).toBe('');
    expect(first.departureTime).toBe('');
    expect(await listAttendanceRecords()).toHaveLength(2);
  });

  it('يقبل النسخ الاحتياطية الأقدم التي لا تتضمن الأقسام الجديدة', () => {
    const data: Record<string, unknown> = {};
    for (const entity of ENTITIES) if (entity !== 'leavePermissions' && entity !== 'attendanceRecords') data[entity] = [];
    const result = validateBackup({ app: 'risk-officer-suite', formatVersion: 1, data });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('الإجازات والأذونات'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('تأخيرات الحضور والانصراف'))).toBe(true);
  });
});
