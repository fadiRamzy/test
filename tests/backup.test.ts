import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, useDatabase } from '../src/db/database';
import { createBackup, restoreBackup, validateBackup } from '../src/db/backup';
import { listEmployees, listMonthlyEvaluations, nextEmployeeNo, saveEmployee, saveMonthlyEvaluation } from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';

beforeEach(async () => {
  await useDatabase(`test-backup-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
});

async function seed() {
  const employee = await saveEmployee({
    employeeNo: await nextEmployeeNo(),
    name: 'سارة علي',
    code: 'RO-B1',
    sector: 'قطاع الدلتا',
    governorate: 'الغربية',
    jobTitle: 'ضابط مخاطر',
    employmentDate: '2025-02-01',
    branches: '',
    status: 'active',
    notes: '',
  });
  await saveMonthlyEvaluation({ employeeId: employee.id, year: 2026, month: 2, visits: 4, scores: { c1: 4 } });
  return employee;
}

describe('النسخ الاحتياطي', () => {
  it('يصدّر كل الجداول مع الأعداد', async () => {
    await seed();
    const backup = await createBackup();
    expect(backup.counts.employees).toBe(1);
    expect(backup.counts.monthlyEvaluations).toBe(1);
    expect(backup.counts.fieldVisits).toBe(0);
    expect(backup.data.employees[0].name).toBe('سارة علي');
  });

  it('يرفض ملفًا من تطبيق آخر أو بنية ناقصة', async () => {
    const other = validateBackup({ app: 'other', formatVersion: 1, data: {} });
    expect(other.ok).toBe(false);
    expect(other.errors[0]).toContain('ليس نسخة احتياطية');
  });

  it('يستعيد بالاستبدال ويعيد البيانات', async () => {
    await seed();
    const backup = await createBackup();
    for (const store of STORE_NAMES) await clearStore(store);
    expect(await listEmployees()).toHaveLength(0);
    const result = await restoreBackup(backup, 'replace');
    expect(result.imported.employees).toBe(1);
    expect(await listEmployees()).toHaveLength(1);
    expect(await listMonthlyEvaluations()).toHaveLength(1);
  });

  it('يدمج دون تكرار', async () => {
    await seed();
    const backup = await createBackup();
    await restoreBackup(backup, 'merge');
    expect(await listEmployees()).toHaveLength(1);
    expect(await listMonthlyEvaluations()).toHaveLength(1);
  });
});
