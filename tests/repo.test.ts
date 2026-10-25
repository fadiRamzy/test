import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, useDatabase } from '../src/db/database';
import {
  ValidationError,
  deleteEmployee,
  listFieldVisits,
  listLeaves,
  listMinutes,
  listMonthlyEvaluations,
  listObservations,
  nextEmployeeNo,
  saveAnnualNote,
  saveEmployee,
  saveFieldVisit,
  saveLeave,
  saveMinute,
  saveMonthlyBatch,
  saveMonthlyEvaluation,
  saveObservation,
  setEmployeeArchived,
} from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';

beforeEach(async () => {
  await useDatabase(`test-repo-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
});

async function makeEmployee(overrides: Partial<Parameters<typeof saveEmployee>[0]> = {}) {
  return saveEmployee({
    employeeNo: await nextEmployeeNo(),
    name: 'أحمد محمد',
    code: `RO-${Math.random().toString(16).slice(2, 6)}`,
    sector: 'قطاع القاهرة',
    governorate: 'القاهرة',
    jobTitle: 'ضابط مخاطر',
    employmentDate: '2024-03-01',
    branches: 'فرع أ',
    status: 'active',
    notes: '',
    ...overrides,
  });
}

describe('الموظفون', () => {
  it('يحفظ موظفًا ويُرجع رقمًا تسلسليًا تصاعديًا', async () => {
    const first = await makeEmployee({ code: 'RO-1' });
    expect(first.employeeNo).toBe(1);
    expect((await makeEmployee({ code: 'RO-2' })).employeeNo).toBe(2);
  });

  it('يرفض الكود أو الرقم المكرر', async () => {
    await makeEmployee({ code: 'RO-9', employeeNo: 9 });
    await expect(makeEmployee({ code: 'RO-9' })).rejects.toBeInstanceOf(ValidationError);
    await expect(makeEmployee({ code: 'RO-10', employeeNo: 9 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('يرفض الحقول المطلوبة الناقصة', async () => {
    await expect(makeEmployee({ name: '  ', sector: '', employmentDate: '' })).rejects.toMatchObject({
      errors: {
        name: 'اسم الموظف مطلوب',
        sector: 'القطاع مطلوب',
        employmentDate: 'تاريخ التعيين مطلوب',
      },
    });
  });

  it('يمنع الحذف عند وجود سجلات ويسمح بالأرشفة', async () => {
    const employee = await makeEmployee({ code: 'RO-3' });
    await saveMonthlyEvaluation({ employeeId: employee.id, year: 2026, month: 3, visits: 2, scores: { c1: 4 } });
    await expect(deleteEmployee(employee.id)).rejects.toBeInstanceOf(ValidationError);
    await setEmployeeArchived(employee.id, true);
    const { listEmployees } = await import('../src/db/repo');
    expect(await listEmployees()).toHaveLength(0);
    expect(await listEmployees(true)).toHaveLength(1);
  });

  it('يدعم تعديل بيانات الموظف نفسه دون تغيير رقمه', async () => {
    const employee = await makeEmployee({ code: 'RO-11' });
    const updated = await saveEmployee({ ...employee, name: 'اسم محدّث', branches: 'فرع ب' });
    expect(updated.id).toBe(employee.id);
    expect(updated.name).toBe('اسم محدّث');
    expect(updated.branches).toBe('فرع ب');
    const { listEmployees } = await import('../src/db/repo');
    expect(await listEmployees()).toHaveLength(1);
  });
});

describe('التقييم الشهري', () => {
  it('يحفظ صفوف الشهر دفعة واحدة ثم يقرأها مرة أخرى', async () => {
    const first = await makeEmployee({ code: 'RO-20' });
    const second = await makeEmployee({ code: 'RO-21' });

    await saveMonthlyBatch(2026, 4, [
      { employeeId: first.id, visits: 5, scores: { c1: 5, c2: 4, c3: 3, c4: 4, c5: 5, c6: 4, c7: 3, c8: 5 }, notes: 'ملاحظة أولى' },
      { employeeId: second.id, visits: 2, scores: { c1: 3, c2: 3, c3: 3, c4: 3, c5: 3, c6: 3, c7: 3, c8: 3 }, notes: '' },
    ]);

    const rows = await listMonthlyEvaluations();
    expect(rows).toHaveLength(2);
    const saved = rows.find((row) => row.employeeId === first.id);
    expect(saved?.visits).toBe(5);
    expect(saved?.notes).toBe('ملاحظة أولى');
    expect(saved?.scores.c2).toBe(4);

    // الحفظ مرة ثانية يحدّث ولا يكرّر
    await saveMonthlyBatch(2026, 4, [
      { employeeId: first.id, visits: 6, scores: { c1: 5, c2: 4, c3: 3, c4: 4, c5: 5, c6: 4, c7: 3, c8: 5 }, notes: 'محدّث' },
    ]);
    const updated = await listMonthlyEvaluations();
    expect(updated).toHaveLength(2);
    expect(updated.find((row) => row.employeeId === first.id)?.notes).toBe('محدّث');
  });

  it('يرفض درجة خارج 1–5 أو تكرار نفس الشهر', async () => {
    const employee = await makeEmployee({ code: 'RO-22' });
    await expect(
      saveMonthlyEvaluation({ employeeId: employee.id, year: 2026, month: 5, visits: 1, scores: { c1: 7 } }),
    ).rejects.toMatchObject({ errors: { c1: expect.any(String) } });

    await saveMonthlyEvaluation({ employeeId: employee.id, year: 2026, month: 5, visits: 1, scores: {} });
    await expect(
      saveMonthlyEvaluation({ employeeId: employee.id, year: 2026, month: 5, visits: 2, scores: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('يقبل صفًا بملاحظات فقط ويحفظها', async () => {
    const employee = await makeEmployee({ code: 'RO-23' });
    const saved = await saveMonthlyEvaluation({ employeeId: employee.id, year: 2026, month: 6, visits: null, scores: {}, notes: 'ملاحظة طويلة' });
    expect(saved.notes).toBe('ملاحظة طويلة');
    expect(saved.visits).toBeNull();
  });
});

describe('الزيارات الميدانية', () => {
  it('يحفظ زيارة بحقول اختيارية فارغة', async () => {
    const employee = await makeEmployee({ code: 'RO-30' });
    const visit = await saveFieldVisit({
      employeeId: employee.id,
      region: 'القاهرة',
      branch: 'فرع المعادي',
      visitDate: '2026-03-04',
      visitType: 'زيارة ميدانية',
      status: 'completed',
      finalAssessment: 'ملتزم',
      notes: '',
    });
    expect(visit.id).toBeTruthy();
    expect((await listFieldVisits())[0].branch).toBe('فرع المعادي');
  });

  it('يرفض زيارة بلا فرع أو تاريخ', async () => {
    const employee = await makeEmployee({ code: 'RO-31' });
    await expect(
      saveFieldVisit({ employeeId: employee.id, branch: ' ', visitDate: '', visitType: 'زيارة' }),
    ).rejects.toMatchObject({ errors: { branch: 'الفرع مطلوب', visitDate: 'تاريخ الزيارة مطلوب' } });
  });
});

describe('دقائق الصرف', () => {
  it('يحفظ دقيقة بالحد الأدنى من الحقول', async () => {
    const employee = await makeEmployee({ code: 'RO-40' });
    const minute = await saveMinute({
      employeeId: employee.id,
      date: '2026-03-05',
      branch: 'فرع أ',
      minuteReceivedTime: '09:15',
      status: 'open',
      result: 'pending',
    });
    expect(minute.finalResponseTime).toBe('');
    expect((await listMinutes())).toHaveLength(1);
  });

  it('يرفض وقتًا بصيغة خاطئة', async () => {
    const employee = await makeEmployee({ code: 'RO-41' });
    await expect(
      saveMinute({ employeeId: employee.id, date: '2026-03-05', branch: 'أ', minuteReceivedTime: '9' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('الملاحظات والإجازات', () => {
  it('يحفظ ملاحظة كاملة ويعدّلها', async () => {
    const employee = await makeEmployee({ code: 'RO-50' });
    const observation = await saveObservation({
      employeeId: employee.id,
      date: '2026-03-06',
      source: 'زيارة ميدانية',
      severity: 'high',
      details: 'نقص مستندات',
      status: 'open',
      recurrence: true,
    });
    expect(observation.recurrence).toBe(true);
    expect((await listObservations())[0].details).toBe('نقص مستندات');
  });

  it('يفصل الأيام عن الساعات في الإجازات', async () => {
    const employee = await makeEmployee({ code: 'RO-51' });
    await saveLeave({ employeeId: employee.id, type: 'إجازة سنوية', startDate: '2026-03-01', endDate: '2026-03-03', unit: 'days', days: 3 });
    await saveLeave({ employeeId: employee.id, type: 'إذن تأخير', startDate: '2026-03-05', endDate: '2026-03-05', unit: 'hours', hours: 2 });
    const rows = await listLeaves();
    expect(rows.find((row) => row.unit === 'days')?.days).toBe(3);
    expect(rows.find((row) => row.unit === 'hours')?.hours).toBe(2);
  });

  it('يرفض إجازة بتاريخ نهاية يسبق البداية', async () => {
    const employee = await makeEmployee({ code: 'RO-52' });
    await expect(
      saveLeave({ employeeId: employee.id, type: 'إجازة', startDate: '2026-03-10', endDate: '2026-03-01', unit: 'days', days: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('يحفظ ملاحظات التقييم السنوي', async () => {
    const employee = await makeEmployee({ code: 'RO-53' });
    const note = await saveAnnualNote(employee.id, 2026, 'أداء مستقر');
    expect(note.notes).toBe('أداء مستقر');
    const updated = await saveAnnualNote(employee.id, 2026, 'محدّث');
    expect(updated.id).toBe(note.id);
  });
});
