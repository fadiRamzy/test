import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, useDatabase } from '../src/db/database';
import {
  ValidationError,
  addReviewCycle,
  deleteEmployee,
  deleteMinute,
  listEvaluations,
  listMinutes,
  listObservations,
  listVisits,
  nextSerial,
  saveEmployee,
  saveEvaluation,
  saveMinute,
  saveObservation,
  saveVisit,
  setEmployeeArchived,
} from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';

beforeEach(async () => {
  await useDatabase(`test-repo-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
});

async function makeEmployee(overrides: Partial<Parameters<typeof saveEmployee>[0]> = {}) {
  return saveEmployee({
    serial: await nextSerial(),
    sector: 'قطاع القاهرة',
    governorate: 'القاهرة',
    name: 'أحمد محمد',
    code: `RO-${Math.random().toString(16).slice(2, 6)}`,
    jobTitle: 'ضابط مخاطر',
    joiningDate: '2024-03-01T00:00:00.000Z',
    visitCount: 5,
    notes: '',
    ...overrides,
  });
}

describe('الموظفون', () => {
  it('يحفظ موظفًا ويولّد رقمًا تسلسليًا تصاعديًا', async () => {
    const first = await makeEmployee({ code: 'RO-1' });
    expect(first.serial).toBe(1);
    const second = await makeEmployee({ code: 'RO-2' });
    expect(second.serial).toBe(2);
  });

  it('يرفض الكود المكرر', async () => {
    await makeEmployee({ code: 'RO-9' });
    await expect(makeEmployee({ code: 'RO-9' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('يرفض الحقول المطلوبة الناقصة', async () => {
    await expect(makeEmployee({ name: '  ', sector: '' })).rejects.toMatchObject({
      errors: { name: 'اسم الموظف مطلوب', sector: 'القطاع مطلوب' },
    });
  });

  it('يمنع الحذف النهائي عند وجود سجلات مرتبطة ويسمح بالأرشفة', async () => {
    const employee = await makeEmployee({ code: 'RO-3' });
    await saveMinute({
      employeeId: employee.id,
      branchRef: 'فرع 1',
      receivedAt: '2026-10-01T08:00:00.000Z',
    });
    await expect(deleteEmployee(employee.id)).rejects.toBeInstanceOf(ValidationError);
    await setEmployeeArchived(employee.id, true);
    const { listEmployees } = await import('../src/db/repo');
    expect((await listEmployees()).length).toBe(0);
    expect((await listEmployees(true)).length).toBe(1);
  });
});

describe('دقائق الصرف', () => {
  it('يرفض ترتيبًا زمنيًا غير منطقي', async () => {
    const employee = await makeEmployee({ code: 'RO-4' });
    await expect(
      saveMinute({
        employeeId: employee.id,
        branchRef: 'فرع 1',
        receivedAt: '2026-10-01T09:00:00.000Z',
        fileRequestedAt: '2026-10-01T08:00:00.000Z',
      }),
    ).rejects.toMatchObject({ errors: { fileRequestedAt: expect.stringContaining('لا يسبق') } });
  });

  it('يخزّن سلسلة الأوقات ويحسب المدد لاحقًا', async () => {
    const employee = await makeEmployee({ code: 'RO-5' });
    const saved = await saveMinute({
      employeeId: employee.id,
      branchRef: 'فرع 2',
      receivedAt: '2026-10-01T08:00:00.000Z',
      fileRequestedAt: '2026-10-01T08:10:00.000Z',
      fileReceivedAt: '2026-10-01T08:40:00.000Z',
      reviewStartedAt: '2026-10-01T08:45:00.000Z',
      finalResponseAt: '2026-10-01T09:20:00.000Z',
      status: 'completed',
      delayReason: 'تأخر وصول الملف',
      observations: 'مطابقة سليمة',
    });
    expect(saved.refNo).toMatch(/^M-/);
    const rows = await listMinutes();
    expect(rows).toHaveLength(1);
    expect(rows[0].delayReason).toBe('تأخر وصول الملف');
  });

  it('يفصل الملاحظات عن الدقيقة عند الحذف بدل حذفها', async () => {
    const employee = await makeEmployee({ code: 'RO-6' });
    const minute = await saveMinute({ employeeId: employee.id, branchRef: 'فرع 3', receivedAt: '2026-10-01T08:00:00.000Z' });
    await saveObservation({ employeeId: employee.id, minuteId: minute.id, date: '2026-10-01', type: 'إجراء', text: 'ملاحظة' });
    await deleteMinute(minute.id);
    const observations = await listObservations();
    expect(observations).toHaveLength(1);
    expect(observations[0].minuteId).toBeNull();
  });
});

describe('الزيارات ودورات المراجعة', () => {
  it('يضيف دورات مراجعة متعددة بترتيب زمني دون فقدان السابقة', async () => {
    const employee = await makeEmployee({ code: 'RO-7' });
    const visit = await saveVisit({
      employeeId: employee.id,
      branchRef: 'فرع 4',
      departureAt: '2026-10-01T07:00:00.000Z',
      arrivalAt: '2026-10-01T08:00:00.000Z',
      completedAt: '2026-10-01T09:00:00.000Z',
      returnAt: '2026-10-01T10:00:00.000Z',
      reportSubmittedAt: '2026-10-01T12:00:00.000Z',
      status: 'report_pending',
    });

    await addReviewCycle(visit.id, {
      reviewedAt: '2026-10-01T13:00:00.000Z',
      observations: 'نقص مستند',
      corrections: 'إرفاق كشف الحساب',
      outcome: 'corrections',
    });
    await addReviewCycle(visit.id, {
      reviewedAt: '2026-10-01T15:00:00.000Z',
      observations: 'تم التصحيح',
      corrections: '',
      outcome: 'accepted',
    });

    const [stored] = await listVisits();
    expect(stored.reviewCycles).toHaveLength(2);
    expect(stored.reviewCycles.map((cycle) => cycle.seq)).toEqual([1, 2]);
    expect(stored.reviewCycles[0].outcome).toBe('corrections');
    expect(stored.reviewCycles[1].observations).toBe('تم التصحيح');
    expect(stored.reportReviewedAt).toBe('2026-10-01T13:00:00.000Z');
  });

  it('يرفض أوقاتًا غير متسلسلة', async () => {
    const employee = await makeEmployee({ code: 'RO-8' });
    await expect(
      saveVisit({
        employeeId: employee.id,
        branchRef: 'فرع 5',
        departureAt: '2026-10-01T10:00:00.000Z',
        arrivalAt: '2026-10-01T09:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('التقييمات', () => {
  it('يحفظ 8 درجات ولا يفرض أوزانًا', async () => {
    const employee = await makeEmployee({ code: 'RO-10' });
    const evaluation = await saveEvaluation({
      employeeId: employee.id,
      periodType: 'monthly',
      year: 2026,
      month: 9,
      scores: { k1: 4, k2: 3, k3: 5, k4: 4, k5: 5, k6: 4, k7: 3, k8: 5 },
      comments: { k1: 'دقيق' },
      overallComment: 'أداء جيد',
    });
    expect(Object.keys(evaluation.scores)).toHaveLength(8);
    expect((await listEvaluations())).toHaveLength(1);
  });

  it('يرفض درجة خارج النطاق 1-5', async () => {
    const employee = await makeEmployee({ code: 'RO-11' });
    await expect(
      saveEvaluation({ employeeId: employee.id, periodType: 'monthly', year: 2026, month: 9, scores: { k1: 6 } }),
    ).rejects.toMatchObject({ errors: { score_k1: expect.any(String) } });
  });

  it('يرفض تكرار نفس الموظف ونفس الشهر', async () => {
    const employee = await makeEmployee({ code: 'RO-12' });
    await saveEvaluation({ employeeId: employee.id, periodType: 'monthly', year: 2026, month: 8, scores: {} });
    await expect(
      saveEvaluation({ employeeId: employee.id, periodType: 'monthly', year: 2026, month: 8, scores: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
