import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useDatabase, wipeAllData, readSettings, countRecords } from '../src/db/database';
import { createBackup, restoreBackup, validateBackup } from '../src/db/backup';
import { listEmployees, saveBranch, saveEmployee, saveMinute, listMinutes } from '../src/db/repo';

beforeAll(async () => {
  await useDatabase('roms-test-backup');
});

beforeEach(async () => {
  await wipeAllData();
});

async function seed() {
  const branch = await saveBranch({ code: 'BR-B1', name: 'فرع النسخ', governorate: 'الجيزة' });
  const employee = await saveEmployee({
    employeeCode: 'B-1',
    fullName: 'موظف النسخ',
    jobTitle: 'ضابط مخاطر',
    branchId: branch.id,
    governorate: 'الجيزة',
    hireDate: '2024-05-01',
    status: 'active',
  });
  await saveMinute({
    employeeId: employee.id,
    branchId: branch.id,
    clientRef: 'CL-B1',
    financingType: 'تمويل قائمة',
    receivedAt: new Date().toISOString(),
    status: 'completed',
  });
  return { branch, employee };
}

describe('النسخ الاحتياطي والاستعادة', () => {
  it('يصدّر كل الكيانات مع الإعدادات والبصمة', async () => {
    await seed();
    const backup = await createBackup();
    expect(backup.app).toBe('risk-officer-management-system');
    expect(backup.data.employees).toHaveLength(1);
    expect(backup.data.branches).toHaveLength(1);
    expect(backup.data.minutes).toHaveLength(1);
    expect(backup.counts.employees).toBe(1);
    expect(backup.settings.minutesDeadlineMinutes).toBe(60);
    expect(backup.checksum).toBeTruthy();
  });

  it('يرفض ملفًا ليس من النظام', async () => {
    const result = await validateBackup({ app: 'something-else', data: {} });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('ليس نسخة احتياطية');
  });

  it('يرفض نسخة ناقصة الأقسام أو بمعرّفات مكررة', async () => {
    const missing = await validateBackup({ app: 'risk-officer-management-system', formatVersion: 1, data: { employees: [] } });
    expect(missing.ok).toBe(false);

    const duplicate = await validateBackup({
      app: 'risk-officer-management-system',
      formatVersion: 1,
      data: {
        employees: [{ id: 'x' }, { id: 'x' }],
        branches: [],
        minutes: [],
        visits: [],
        observations: [],
        evaluations: [],
      },
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.join(' ')).toContain('مكرر');
  });

  it('يرفض ملفًا معدّلًا (بصمة غير مطابقة)', async () => {
    await seed();
    const backup = await createBackup();
    const tampered = JSON.parse(JSON.stringify(backup));
    tampered.data.employees[0].fullName = 'اسم معدّل';
    const result = await validateBackup(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('بصمة');
  });

  it('يستعيد بنمط الاستبدال ويعيد البيانات والإعدادات', async () => {
    await seed();
    const backup = await createBackup();
    await wipeAllData();
    expect(await listEmployees()).toHaveLength(0);

    const result = await restoreBackup(backup, 'replace');
    expect(result.imported.employees).toBe(1);
    expect(await listEmployees()).toHaveLength(1);
    expect((await readSettings()).organizationName).toBe(backup.settings.organizationName);
    expect(result.safetyBackup).not.toBeNull();
  });

  it('يدمج النسخ دون حذف السجلات الحالية', async () => {
    await seed();
    const backup = await createBackup();
    await saveEmployee({
      employeeCode: 'B-2',
      fullName: 'موظف إضافي',
      jobTitle: 'ضابط مخاطر',
      hireDate: '2024-06-01',
      status: 'active',
    });
    expect(await listEmployees()).toHaveLength(2);

    const result = await restoreBackup(backup, 'merge');
    expect(result.imported.employees).toBe(0); // لا تغييرات (نفس التحديث)
    expect(await listEmployees()).toHaveLength(2);
  });

  it('ينشئ نسخة أمان قبل الحذف الكامل', async () => {
    await seed();
    expect(await countRecords('employees')).toBe(1);
    const backup = await createBackup();
    await wipeAllData();
    expect(await countRecords('employees')).toBe(0);
    await restoreBackup(backup, 'replace');
    expect(await listMinutes()).toHaveLength(1);
  });
});
