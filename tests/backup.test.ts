import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, useDatabase } from '../src/db/database';
import { createBackup, restoreBackup, validateBackup } from '../src/db/backup';
import { listEmployees, listMinutes, nextSerial, saveEmployee, saveMinute } from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';

beforeEach(async () => {
  await useDatabase(`test-backup-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
});

async function seed() {
  const employee = await saveEmployee({
    serial: await nextSerial(),
    sector: 'قطاع الدلتا',
    governorate: 'الغربية',
    name: 'سارة علي',
    code: 'RO-B1',
    jobTitle: 'ضابط مخاطر',
    joiningDate: '2025-02-01T00:00:00.000Z',
    visitCount: 2,
    notes: '',
  });
  await saveMinute({ employeeId: employee.id, branchRef: 'فرع ب', receivedAt: '2026-10-01T08:00:00.000Z' });
  return employee;
}

describe('النسخ الاحتياطي', () => {
  it('يصدّر كل الجداول مع عدد السجلات وبصمة تحقق', async () => {
    await seed();
    const backup = await createBackup();
    expect(backup.counts.employees).toBe(1);
    expect(backup.counts.minutes).toBe(1);
    expect(backup.counts.visits).toBe(0);
    expect(backup.checksum).toBeTruthy();
  });

  it('يرفض ملفًا من تطبيق آخر', async () => {
    const result = await validateBackup({ app: 'other', formatVersion: 1, data: {} });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ليس نسخة احتياطية');
  });

  it('يرفض نسخة معدّلة (بصمة غير مطابقة)', async () => {
    await seed();
    const backup = await createBackup();
    backup.data.employees[0].name = 'اسم معدّل';
    const result = await validateBackup(backup);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('بصمة');
  });

  it('يستعيد بالاستبدال الكامل', async () => {
    await seed();
    const backup = await createBackup();
    for (const store of STORE_NAMES) await clearStore(store);
    expect(await listEmployees()).toHaveLength(0);
    const result = await restoreBackup(backup, 'replace');
    expect(result.imported.employees).toBe(1);
    expect(await listEmployees()).toHaveLength(1);
    expect(await listMinutes()).toHaveLength(1);
  });

  it('يدمج دون تكرار السجلات', async () => {
    await seed();
    const backup = await createBackup();
    const result = await restoreBackup(backup, 'merge');
    expect(await listEmployees()).toHaveLength(1);
    expect(result.safetyBackup.counts.employees).toBe(1);
  });
});
