import { getAll, hardDelete, putMany, readMeta, writeMeta } from './database';
import { newReviewCycle } from './repo';
import { uid } from '../lib/utils';
import type { Branch, DisbursementMinute, Employee, Evaluation, FieldVisit, Observation } from './schema';

/**
 * بيانات تجريبية معزولة تمامًا: كل سجل يحمل isDemo=true ويُستبعد من كل الشاشات
 * والتقارير والتصدير ما لم يكن «وضع البيانات التجريبية» مفعّلًا.
 * يمكن حذفها بالكامل دون أي أثر على السجلات الفعلية.
 */

const DEMO_KEY = 'demoSeededAt';

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dateOnly(days: number): string {
  return daysAgo(days).slice(0, 10);
}

export async function isDemoSeeded(): Promise<boolean> {
  return Boolean(await readMeta<boolean>(DEMO_KEY));
}

export async function seedDemoData(organizationDemo = true): Promise<void> {
  const stamp = new Date().toISOString();
  const base = { createdAt: stamp, updatedAt: stamp, deletedAt: null, isDemo: true } as const;

  const branches: Branch[] = [
    { ...base, id: 'demo_br_1', code: 'DEMO-01', name: 'فرع تجريبي — المركزي', governorate: 'القاهرة' },
    { ...base, id: 'demo_br_2', code: 'DEMO-02', name: 'فرع تجريبي — الدلتا', governorate: 'الغربية' },
  ];

  const employees: Employee[] = [
    {
      ...base,
      id: 'demo_emp_1',
      employeeCode: 'D-1001',
      fullName: 'أحمد محمود (تجريبي)',
      jobTitle: 'ضابط مخاطر',
      branchId: 'demo_br_1',
      governorate: 'القاهرة',
      hireDate: '2022-03-01',
      endDate: null,
      status: 'active',
      phone: '01000000001',
      email: 'demo1@example.com',
      notes: 'سجل تجريبي — ليس بيانات حقيقية',
    },
    {
      ...base,
      id: 'demo_emp_2',
      employeeCode: 'D-1002',
      fullName: 'منى عبد الرحمن (تجريبي)',
      jobTitle: 'ضابط مخاطر أول',
      branchId: 'demo_br_2',
      governorate: 'الغربية',
      hireDate: '2021-08-15',
      endDate: null,
      status: 'active',
      phone: '01000000002',
      email: 'demo2@example.com',
      notes: 'سجل تجريبي — ليس بيانات حقيقية',
    },
    {
      ...base,
      id: 'demo_emp_3',
      employeeCode: 'D-1003',
      fullName: 'كريم سعيد (تجريبي)',
      jobTitle: 'ضابط مخاطر',
      branchId: 'demo_br_1',
      governorate: 'القاهرة',
      hireDate: '2023-01-10',
      endDate: null,
      status: 'inactive',
      phone: '01000000003',
      email: 'demo3@example.com',
      notes: 'سجل تجريبي — ليس بيانات حقيقية',
    },
  ];

  const minutes: DisbursementMinute[] = [
    {
      ...base,
      id: 'demo_min_1',
      refNo: 'DEMO-MIN-001',
      branchId: 'demo_br_1',
      employeeId: 'demo_emp_1',
      clientRef: 'CL-DEMO-001',
      financingType: 'تمويل مشروع صغير',
      amount: 45000,
      outcome: 'approved',
      status: 'completed',
      receivedAt: hoursAgo(30),
      fileRequestedAt: hoursAgo(29.6),
      fileReceivedAt: hoursAgo(28.4),
      reviewStartedAt: hoursAgo(28.3),
      clarificationRequestedAt: null,
      clarificationRespondedAt: null,
      finalResponseAt: hoursAgo(28),
      notes: 'دقيقة تجريبية',
    },
    {
      ...base,
      id: 'demo_min_2',
      refNo: 'DEMO-MIN-002',
      branchId: 'demo_br_2',
      employeeId: 'demo_emp_2',
      clientRef: 'CL-DEMO-002',
      financingType: 'تمويل قائمة',
      amount: 120000,
      outcome: 'returned',
      status: 'completed',
      receivedAt: hoursAgo(26),
      fileRequestedAt: hoursAgo(25.8),
      fileReceivedAt: hoursAgo(22),
      reviewStartedAt: hoursAgo(21.9),
      clarificationRequestedAt: hoursAgo(21.5),
      clarificationRespondedAt: hoursAgo(19),
      finalResponseAt: hoursAgo(18),
      notes: 'دقيقة تجريبية',
    },
    {
      ...base,
      id: 'demo_min_3',
      refNo: 'DEMO-MIN-003',
      branchId: 'demo_br_1',
      employeeId: 'demo_emp_1',
      clientRef: 'CL-DEMO-003',
      financingType: 'تمويل موسمي',
      amount: 30000,
      outcome: 'pending',
      status: 'in_progress',
      receivedAt: hoursAgo(3),
      fileRequestedAt: hoursAgo(2.8),
      fileReceivedAt: hoursAgo(2.2),
      reviewStartedAt: hoursAgo(2.1),
      clarificationRequestedAt: null,
      clarificationRespondedAt: null,
      finalResponseAt: null,
      notes: 'دقيقة تجريبية',
    },
    {
      ...base,
      id: 'demo_min_4',
      refNo: 'DEMO-MIN-004',
      branchId: 'demo_br_2',
      employeeId: 'demo_emp_2',
      clientRef: 'CL-DEMO-004',
      financingType: 'تمويل توسعي',
      amount: 80000,
      outcome: 'approved',
      status: 'completed',
      receivedAt: hoursAgo(52),
      fileRequestedAt: hoursAgo(51.7),
      fileReceivedAt: hoursAgo(51.2),
      reviewStartedAt: hoursAgo(51.1),
      clarificationRequestedAt: null,
      clarificationRespondedAt: null,
      finalResponseAt: hoursAgo(50.5),
      notes: 'دقيقة تجريبية',
    },
    {
      ...base,
      id: 'demo_min_5',
      refNo: 'DEMO-MIN-005',
      branchId: 'demo_br_1',
      employeeId: 'demo_emp_3',
      clientRef: 'CL-DEMO-005',
      financingType: 'إعادة تمويل',
      amount: 60000,
      outcome: 'rejected',
      status: 'completed',
      receivedAt: hoursAgo(80),
      fileRequestedAt: hoursAgo(79.5),
      fileReceivedAt: hoursAgo(78),
      reviewStartedAt: hoursAgo(77.8),
      clarificationRequestedAt: hoursAgo(77.2),
      clarificationRespondedAt: hoursAgo(75),
      finalResponseAt: hoursAgo(73),
      notes: 'دقيقة تجريبية',
    },
  ];

  const cycle = (n: number, score: number, feedback: string) => ({
    ...newReviewCycle(n),
    submittedAt: daysAgo(10 - n),
    reviewedAt: daysAgo(9 - n),
    qualityScore: score,
    feedback,
    finalEmailAt: daysAgo(8 - n),
  });

  const visits: FieldVisit[] = [
    {
      ...base,
      id: 'demo_vis_1',
      refNo: 'DEMO-VIS-001',
      employeeId: 'demo_emp_1',
      branchId: 'demo_br_1',
      clientRef: 'CL-DEMO-001',
      visitDate: dateOnly(12),
      departureAt: daysAgo(12),
      arrivalAt: hoursAgo(12 * 24 - 1),
      inspectionAt: hoursAgo(12 * 24 - 2),
      returnAt: hoursAgo(12 * 24 - 4),
      reportSubmittedAt: daysAgo(11),
      supervisorReviewAt: daysAgo(10),
      correctionsAt: daysAgo(10),
      resubmittedAt: daysAgo(9),
      finalEmailAt: daysAgo(8),
      status: 'completed',
      qualityScore: 4,
      feedback: 'تقرير جيد مع ملاحظات على الصور',
      pendingActions: '',
      reviewCycles: [cycle(1, 3, 'نقص صور'), { ...cycle(2, 4, 'تحسن ملحوظ'), correctionsNotes: 'أضيفت الصور الناقصة' }],
      notes: 'زيارة تجريبية',
    },
    {
      ...base,
      id: 'demo_vis_2',
      refNo: 'DEMO-VIS-002',
      employeeId: 'demo_emp_2',
      branchId: 'demo_br_2',
      clientRef: 'CL-DEMO-002',
      visitDate: dateOnly(7),
      departureAt: daysAgo(7),
      arrivalAt: daysAgo(7),
      inspectionAt: daysAgo(7),
      returnAt: daysAgo(7),
      reportSubmittedAt: daysAgo(5),
      supervisorReviewAt: daysAgo(4),
      correctionsAt: null,
      resubmittedAt: null,
      finalEmailAt: null,
      status: 'under_review',
      qualityScore: 5,
      feedback: 'تقرير مكتمل',
      pendingActions: 'إرسال البريد النهائي',
      reviewCycles: [cycle(1, 5, 'مكتمل')],
      notes: 'زيارة تجريبية',
    },
    {
      ...base,
      id: 'demo_vis_3',
      refNo: 'DEMO-VIS-003',
      employeeId: 'demo_emp_1',
      branchId: 'demo_br_1',
      clientRef: 'CL-DEMO-006',
      visitDate: dateOnly(2),
      departureAt: daysAgo(2),
      arrivalAt: daysAgo(2),
      inspectionAt: daysAgo(2),
      returnAt: daysAgo(2),
      reportSubmittedAt: null,
      supervisorReviewAt: null,
      correctionsAt: null,
      resubmittedAt: null,
      finalEmailAt: null,
      status: 'report_pending',
      qualityScore: null,
      feedback: '',
      pendingActions: 'تسليم التقرير',
      reviewCycles: [newReviewCycle(1)],
      notes: 'زيارة تجريبية',
    },
  ];

  const observations: Observation[] = [
    {
      ...base,
      id: 'demo_obs_1',
      refNo: 'DEMO-OBS-001',
      employeeId: 'demo_emp_1',
      branchId: 'demo_br_1',
      minuteId: 'demo_min_2',
      visitId: null,
      date: dateOnly(9),
      categoryId: 'cat1',
      severity: 'medium',
      source: 'review',
      description: 'مستندات ناقصة في ملف العميل أثناء مراجعة دقيقة الصرف (تجريبي).',
      correctiveAction: 'استكمال المستندات وإرفاقها بالملف.',
      notifiedAt: daysAgo(9),
      isRecurring: false,
      recurrenceOfId: null,
      status: 'resolved',
      resolvedAt: daysAgo(6),
      followUps: [
        { id: uid('fu'), date: dateOnly(7), note: 'تم التواصل مع الفرع لاستكمال المستندات.', createdAt: daysAgo(7) },
        { id: uid('fu'), date: dateOnly(6), note: 'تم استلام المستندات الناقصة.', createdAt: daysAgo(6) },
      ],
    },
    {
      ...base,
      id: 'demo_obs_2',
      refNo: 'DEMO-OBS-002',
      employeeId: 'demo_emp_2',
      branchId: 'demo_br_2',
      minuteId: null,
      visitId: 'demo_vis_2',
      date: dateOnly(5),
      categoryId: 'cat4',
      severity: 'high',
      source: 'visit',
      description: 'تقرير زيارة دون توثيق كافٍ لملاحظات العميل (تجريبي).',
      correctiveAction: 'إعادة كتابة قسم الملاحظات.',
      notifiedAt: daysAgo(5),
      isRecurring: true,
      recurrenceOfId: null,
      status: 'in_progress',
      resolvedAt: null,
      followUps: [{ id: uid('fu'), date: dateOnly(4), note: 'جارٍ التعديل.', createdAt: daysAgo(4) }],
    },
    {
      ...base,
      id: 'demo_obs_3',
      refNo: 'DEMO-OBS-003',
      employeeId: 'demo_emp_1',
      branchId: 'demo_br_1',
      minuteId: null,
      visitId: null,
      date: dateOnly(3),
      categoryId: 'cat3',
      severity: 'low',
      source: 'supervisor',
      description: 'تأخر بسيط في تسليم تقرير زيارة (تجريبي).',
      correctiveAction: 'الالتزام بموعد التسليم.',
      notifiedAt: daysAgo(3),
      isRecurring: false,
      recurrenceOfId: null,
      status: 'open',
      resolvedAt: null,
      followUps: [],
    },
  ];

  const evaluations: Evaluation[] = [
    {
      ...base,
      id: 'demo_evl_1',
      employeeId: 'demo_emp_1',
      periodType: 'monthly',
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      scores: { c1: 4, c2: 5, c3: 4, c4: 3, c5: 5, c6: 4, c7: 3, c8: 4 },
      comments: { c4: 'تحسن مطلوب في الالتزام بمواعيد الزيارات' },
      overallComment: 'أداء جيد بشكل عام (تجريبي)',
      status: 'approved',
      approvedAt: daysAgo(20),
      unlockReason: null,
      unlockedAt: null,
      derivedFromMonthly: false,
    },
    {
      ...base,
      id: 'demo_evl_2',
      employeeId: 'demo_emp_2',
      periodType: 'monthly',
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      scores: { c1: 5, c2: 4, c3: 5, c4: 4, c5: 4, c6: 5, c7: 4, c8: 5 },
      comments: {},
      overallComment: 'أداء متميز (تجريبي)',
      status: 'draft',
      approvedAt: null,
      unlockReason: null,
      unlockedAt: null,
      derivedFromMonthly: false,
    },
  ];

  await putMany('branches', branches);
  await putMany('employees', employees);
  await putMany('minutes', minutes);
  await putMany('visits', visits);
  await putMany('observations', observations);
  await putMany('evaluations', evaluations);
  await writeMeta(DEMO_KEY, new Date().toISOString());
  await writeMeta('demoOrganizationName', organizationDemo ? 'منظمة تجريبية' : null);
}

/** حذف البيانات التجريبية فقط */
export async function clearDemoData(): Promise<number> {
  let removed = 0;
  for (const store of ['branches', 'employees', 'minutes', 'visits', 'observations', 'evaluations'] as const) {
    const rows = await getAll<{ id: string; isDemo?: boolean }>(store);
    const demoRows = rows.filter((r) => r.isDemo);
    if (!demoRows.length) continue;
    for (const row of demoRows) {
      await hardDelete(store, row.id);
      removed += 1;
    }
  }
  await writeMeta(DEMO_KEY, null);
  return removed;
}

export async function demoStatus(): Promise<{ seeded: boolean; seededAt: string | null }> {
  const at = await readMeta<string>(DEMO_KEY);
  return { seeded: Boolean(at), seededAt: at ?? null };
}
