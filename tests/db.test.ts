import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countRecords,
  getById,
  readSettings,
  useDatabase,
  wipeAllData,
  writeSettings,
  getDb,
} from '../src/db/database';
import {
  addObservationFollowUp,
  addReviewCycle,
  findEmployeeDuplicates,
  findMinuteDuplicates,
  findObservationDuplicates,
  listBranches,
  listEmployees,
  listEvaluations,
  listMinutes,

  listVisits,
  relatedCountsForEmployee,
  resolveObservation,
  restoreEmployee,
  saveBranch,
  saveEmployee,
  saveEvaluation,
  saveMinute,
  saveObservation,
  saveVisit,
  softDeleteBranch,
  softDeleteEmployee,
  softDeleteMinute,
  unlockEvaluation,
  approveEvaluation,
} from '../src/db/repo';
import { DEFAULT_SETTINGS } from '../src/db/schema';

const branch = { code: 'BR-T1', name: 'فرع الاختبار', governorate: 'القاهرة' };

beforeAll(async () => {
  await useDatabase('roms-test-db');
});

beforeEach(async () => {
  await wipeAllData();
});

async function seedEmployee(code = 'E-100', name = 'محمد اختبار') {
  const existing = await listBranches();
  const savedBranch = existing.length ? existing[0] : await saveBranch(branch);
  return saveEmployee({
    employeeCode: code,
    fullName: name,
    jobTitle: 'ضابط مخاطر',
    branchId: savedBranch.id,
    governorate: 'القاهرة',
    hireDate: '2024-01-01',
    status: 'active',
  });
}

describe('قاعدة البيانات المحلية (IndexedDB)', () => {
  it('تُنشئ المتاجر والمؤشرات المطلوبة عند الترقية', async () => {
    const db = await getDb();
    const names = Array.from(db.objectStoreNames);
    expect(names).toEqual(
      expect.arrayContaining([
        'employees',
        'branches',
        'minutes',
        'visits',
        'observations',
        'evaluations',
        'audit',
        'settings',
        'meta',
      ]),
    );
    const tx = db.transaction('employees', 'readonly');
    expect(Array.from(tx.objectStore('employees').indexNames)).toEqual(expect.arrayContaining(['employeeCode', 'branchId', 'deletedAt']));
  });

  it('تحفظ الإعدادات الافتراضية عند أول تشغيل', async () => {
    const settings = await readSettings();
    expect(settings.minutesDeadlineMinutes).toBe(60);
    expect(settings.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(settings.evaluationCriteria).toHaveLength(8);
  });

  it('تحفظ الإعدادات المعدّلة وتقرأها بعد إعادة الفتح', async () => {
    const current = await readSettings();
    await writeSettings({ ...current, organizationName: 'مؤسسة اختبار', minutesDeadlineMinutes: 90 });
    const reread = await readSettings();
    expect(reread.organizationName).toBe('مؤسسة اختبار');
    expect(reread.minutesDeadlineMinutes).toBe(90);
  });

  it('تنشئ موظفًا وتقرأه (CRUD أساسي)', async () => {
    const employee = await seedEmployee();
    const rows = await listEmployees();
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe('محمد اختبار');
    expect(rows[0].status).toBe('active');
    const stored = await getById<typeof employee>('employees', employee.id);
    expect(stored?.employeeCode).toBe('E-100');
  });

  it('ترفض الرقم الوظيفي المكرر وتكشف التكرار', async () => {
    await seedEmployee();
    await expect(seedEmployee('E-100', 'اسم آخر')).rejects.toMatchObject({ errors: { employeeCode: expect.any(String) } });
    const duplicates = await findEmployeeDuplicates({ employeeCode: 'E-100', fullName: 'اسم آخر' });
    expect(duplicates.code?.employeeCode).toBe('E-100');
  });

  it('تحفظ التواريخ وتظل البيانات بعد إعادة تهيئة الاتصال (محاكاة إعادة التحميل)', async () => {
    const employee = await seedEmployee();
    await useDatabase('roms-test-db'); // إعادة فتح القاعدة
    const rows = await listEmployees();
    expect(rows.some((row) => row.id === employee.id)).toBe(true);
  });

  it('تحذف حذفًا ناعمًا وتستعيد', async () => {
    const employee = await seedEmployee();
    await softDeleteEmployee(employee.id);
    expect(await listEmployees()).toHaveLength(0);
    expect(await listEmployees({ includeDeleted: true })).toHaveLength(1);
    await restoreEmployee(employee.id);
    expect(await listEmployees()).toHaveLength(1);
  });

  it('تمنع أرشفة فرع مرتبط بموظفين', async () => {
    const employee = await seedEmployee();
    await expect(softDeleteBranch(employee.branchId as string)).rejects.toThrow();
    expect(await listBranches()).toHaveLength(1);
  });

  it('تحسب السجلات المرتبطة بالموظف قبل الحذف النهائي', async () => {
    const employee = await seedEmployee();
    await saveMinute({
      employeeId: employee.id,
      branchId: employee.branchId,
      clientRef: 'CL-1',
      financingType: 'تمويل قائمة',
      receivedAt: new Date().toISOString(),
      status: 'completed',
    });
    const counts = await relatedCountsForEmployee(employee.id);
    expect(counts.minutes).toBe(1);
  });

  it('يكشف تكرار دقائق الصرف بنفس مرجع العميل', async () => {
    const employee = await seedEmployee();
    await saveMinute({
      employeeId: employee.id,
      branchId: employee.branchId,
      clientRef: 'CL-77',
      financingType: 'تمويل قائمة',
      receivedAt: new Date('2026-02-01T09:00:00').toISOString(),
    });
    const duplicates = await findMinuteDuplicates({
      employeeId: employee.id,
      clientRef: 'CL-77',
      receivedAt: new Date('2026-02-01T12:00:00').toISOString(),
    });
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reason).toContain('مرجع العميل');
  });

  it('تحفظ دورات مراجعة متعددة دون استبدال السابقة', async () => {
    const employee = await seedEmployee();
    const visit = await saveVisit({
      employeeId: employee.id,
      branchId: employee.branchId,
      clientRef: 'CL-V1',
      visitDate: '2026-02-02',
      status: 'under_review',
      qualityScore: 3,
    });
    await addReviewCycle(visit.id, {
      submittedAt: new Date('2026-02-02T10:00:00').toISOString(),
      reviewedAt: null,
      correctionsRequestedAt: new Date('2026-02-03T09:00:00').toISOString(),
      correctionsNotes: 'نقص صور',
      resubmittedAt: null,
      qualityScore: 3,
      feedback: 'تحسين مطلوب',
      finalEmailAt: null,
    });
    await addReviewCycle(visit.id, {
      submittedAt: new Date('2026-02-03T12:00:00').toISOString(),
      reviewedAt: new Date('2026-02-03T14:00:00').toISOString(),
      correctionsRequestedAt: null,
      correctionsNotes: '',
      resubmittedAt: new Date('2026-02-03T13:00:00').toISOString(),
      qualityScore: 5,
      feedback: 'مكتمل',
      finalEmailAt: new Date('2026-02-03T15:00:00').toISOString(),
    });
    const rows = await listVisits();
    expect(rows[0].reviewCycles).toHaveLength(3); // الدورة الافتراضية + دورتان
    expect(rows[0].reviewCycles[1].correctionsNotes).toBe('نقص صور');
    expect(rows[0].reviewCycles[2].cycleNo).toBe(3);
  });

  it('تضيف متابعات للملاحظة وتسجل المعالجة', async () => {
    const employee = await seedEmployee();
    const observation = await saveObservation({
      employeeId: employee.id,
      date: '2026-02-05',
      categoryId: 'cat1',
      severity: 'high',
      source: 'review',
      description: 'وصف ملاحظة اختبارية كافٍ للتحقق',
      status: 'open',
    });
    await addObservationFollowUp(observation.id, { date: '2026-02-06', note: 'تم التواصل مع الفرع' });
    const resolved = await resolveObservation(observation.id, '2026-02-07', 'تم استكمال المستندات');
    expect(resolved.status).toBe('resolved');
    expect(resolved.followUps).toHaveLength(2);
  });

  it('يكشف تكرار الملاحظات لنفس اليوم والتصنيف', async () => {
    const employee = await seedEmployee();
    await saveObservation({
      employeeId: employee.id,
      date: '2026-02-05',
      categoryId: 'cat1',
      severity: 'low',
      source: 'review',
      description: 'وصف ملاحظة أولى للاختبار',
      status: 'open',
    });
    const duplicates = await findObservationDuplicates({
      employeeId: employee.id,
      categoryId: 'cat1',
      date: '2026-02-05',
    });
    expect(duplicates).toHaveLength(1);
  });

  it('يمنع تعديل تقييم معتمد دون سبب فتح', async () => {
    const employee = await seedEmployee();
    const evaluation = await saveEvaluation({
      employeeId: employee.id,
      periodType: 'monthly',
      year: 2026,
      month: 2,
      scores: { c1: 4, c2: 3 },
      status: 'approved',
    });
    expect(evaluation.status).toBe('approved');
    await expect(
      saveEvaluation({
        id: evaluation.id,
        employeeId: employee.id,
        periodType: 'monthly',
        year: 2026,
        month: 2,
        scores: { c1: 5, c2: 4 },
        status: 'approved',
      }),
    ).rejects.toMatchObject({ errors: { approved: expect.any(String) } });

    const unlocked = await unlockEvaluation(evaluation.id, 'تصحيح درجة');
    expect(unlocked.status).toBe('draft');
    expect(unlocked.unlockReason).toBe('تصحيح درجة');
    await approveEvaluation(evaluation.id);
    const rows = await listEvaluations();
    expect(rows[0].status).toBe('approved');
  });

  it('يسجل سجل التغييرات لكل عملية', async () => {
    await seedEmployee();
    expect(await countRecords('audit')).toBeGreaterThan(0);
  });

  it('يحتفظ بالإعدادات الافتراضية بعد المسح الكامل', async () => {
    await wipeAllData();
    const settings = await readSettings();
    expect(settings).toEqual(expect.objectContaining({ minutesDeadlineMinutes: DEFAULT_SETTINGS.minutesDeadlineMinutes }));
  });

  it('يحذف السجلات المؤرشفة من القوائم الافتراضية فقط', async () => {
    const employee = await seedEmployee();
    const minute = await saveMinute({
      employeeId: employee.id,
      branchId: employee.branchId,
      clientRef: 'CL-9',
      financingType: 'تمويل قائمة',
      receivedAt: new Date().toISOString(),
    });
    await softDeleteMinute(minute.id);
    expect(await listMinutes()).toHaveLength(0);
    expect(await listMinutes({ includeDeleted: true })).toHaveLength(1);
  });
});
