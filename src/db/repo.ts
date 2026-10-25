import { deleteRecord, getAll, getById, putRecord } from './database';
import { nowIso, uid } from '../lib/utils';
import {
  EVALUATION_CRITERIA,
  RATING_MAX,
  RATING_MIN,
  type Employee,
  type Evaluation,
  type Minute,
  type Observation,
  type ReviewCycle,
  type Visit,
} from './schema';

export class ValidationError extends Error {
  errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super('بيانات غير صحيحة');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function fail(errors: Record<string, string>): never {
  throw new ValidationError(errors);
}

const isIso = (value: unknown) => typeof value === 'string' && value !== '' && !Number.isNaN(new Date(value).getTime());
const trim = (value: string | undefined | null) => (value ?? '').trim();

/* ------------------------------- الموظفون ------------------------------- */

export async function listEmployees(includeArchived = false): Promise<Employee[]> {
  const rows = await getAll<Employee>('employees');
  return rows
    .filter((row) => (includeArchived ? true : !row.archived))
    .sort((a, b) => a.serial - b.serial);
}

export async function nextSerial(): Promise<number> {
  const rows = await getAll<Employee>('employees');
  return rows.reduce((max, row) => Math.max(max, Number(row.serial) || 0), 0) + 1;
}

export function validateEmployee(input: Partial<Employee>, existing: Employee[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!trim(input.name)) errors.name = 'اسم الموظف مطلوب';
  if (!trim(input.code)) errors.code = 'كود الموظف مطلوب';
  else if (
    existing.some((row) => row.id !== input.id && trim(row.code).toLowerCase() === trim(input.code).toLowerCase())
  ) {
    errors.code = 'كود الموظف مستخدم بالفعل';
  }
  if (!trim(input.jobTitle)) errors.jobTitle = 'المسمى الوظيفي مطلوب';
  if (!trim(input.sector)) errors.sector = 'القطاع مطلوب';
  if (!trim(input.governorate)) errors.governorate = 'المحافظة مطلوبة';
  if (!input.joiningDate) errors.joiningDate = 'تاريخ الالتحاق مطلوب';
  else if (Number.isNaN(new Date(input.joiningDate).getTime())) errors.joiningDate = 'تاريخ الالتحاق غير صحيح';
  if (input.serial === undefined || input.serial === null || Number(input.serial) < 1) errors.serial = 'الرقم التسلسلي مطلوب';
  else if (existing.some((row) => row.id !== input.id && Number(row.serial) === Number(input.serial)))
    errors.serial = 'الرقم التسلسلي مستخدم بالفعل';
  if (input.visitCount !== null && input.visitCount !== undefined) {
    if (!Number.isFinite(Number(input.visitCount)) || Number(input.visitCount) < 0) errors.visitCount = 'عدد الزيارات يجب أن يكون صفرًا أو أكثر';
  }
  return errors;
}

export async function saveEmployee(input: Partial<Employee>): Promise<Employee> {
  const existing = await getAll<Employee>('employees');
  const errors = validateEmployee(input, existing);
  if (Object.keys(errors).length) fail(errors);

  const current = input.id ? existing.find((row) => row.id === input.id) : undefined;
  const record: Employee = {
    id: input.id ?? uid('emp'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    serial: Number(input.serial ?? existing.length + 1),
    sector: trim(input.sector),
    governorate: trim(input.governorate),
    name: trim(input.name),
    code: trim(input.code),
    jobTitle: trim(input.jobTitle),
    joiningDate: input.joiningDate ?? '',
    visitCount: input.visitCount === null || input.visitCount === undefined ? null : Number(input.visitCount),
    notes: input.notes ?? '',
    archived: input.archived ?? current?.archived ?? false,
  };
  await putRecord('employees', record);
  return record;
}

/** حذف نهائي مسموح فقط عند عدم وجود سجلات مرتبطة */
export async function deleteEmployee(id: string): Promise<void> {
  const [minutes, visits, observations, evaluations] = await Promise.all([
    getAll<Minute>('minutes'),
    getAll<Visit>('visits'),
    getAll<Observation>('observations'),
    getAll<Evaluation>('evaluations'),
  ]);
  const linked =
    minutes.filter((row) => row.employeeId === id).length +
    visits.filter((row) => row.employeeId === id).length +
    observations.filter((row) => row.employeeId === id).length +
    evaluations.filter((row) => row.employeeId === id).length;
  if (linked > 0) {
    fail({ form: `لا يمكن الحذف النهائي: يوجد ${linked} سجلًا مرتبطًا. استخدم الأرشفة بدلًا من ذلك.` });
  }
  await deleteRecord('employees', id);
}

export async function setEmployeeArchived(id: string, archived: boolean): Promise<void> {
  const employee = await getById<Employee>('employees', id);
  if (!employee) return;
  await putRecord('employees', { ...employee, archived, updatedAt: nowIso() });
}

/* ----------------------------- دقائق الصرف ----------------------------- */

export async function listMinutes(): Promise<Minute[]> {
  const rows = await getAll<Minute>('minutes');
  return rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export function validateMinute(input: Partial<Minute>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف المسؤول مطلوب';
  if (!trim(input.branchRef)) errors.branchRef = 'الفرع / مرجع العميل مطلوب';
  if (!isIso(input.receivedAt)) errors.receivedAt = 'وقت ورود الدقيقة مطلوب';

  const chain: Array<[keyof Minute, string]> = [
    ['receivedAt', 'ورود الدقيقة'],
    ['fileRequestedAt', 'طلب الملف'],
    ['fileReceivedAt', 'استلام الملف'],
    ['reviewStartedAt', 'بدء المراجعة'],
    ['finalResponseAt', 'الرد النهائي'],
  ];
  let previous: { label: string; at: number } | null = null;
  for (const [field, label] of chain) {
    const value = input[field] as string | null | undefined;
    if (!value) continue;
    if (!isIso(value)) {
      errors[field] = `وقت ${label} غير صحيح`;
      continue;
    }
    const at = new Date(value).getTime();
    if (previous && at < previous.at) errors[field] = `وقت ${label} لا يسبق وقت ${previous.label}`;
    previous = { label, at };
  }
  return errors;
}

export async function saveMinute(input: Partial<Minute>): Promise<Minute> {
  const errors = validateMinute(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<Minute>('minutes', input.id) : undefined;
  const record: Minute = {
    id: input.id ?? uid('min'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    refNo: trim(input.refNo) || `M-${Date.now().toString().slice(-7)}`,
    employeeId: input.employeeId ?? null,
    branchRef: trim(input.branchRef),
    receivedAt: input.receivedAt as string,
    fileRequestedAt: input.fileRequestedAt || null,
    fileReceivedAt: input.fileReceivedAt || null,
    reviewStartedAt: input.reviewStartedAt || null,
    finalResponseAt: input.finalResponseAt || null,
    status: input.status ?? 'open',
    observations: input.observations ?? '',
    delayReason: input.delayReason ?? '',
  };
  await putRecord('minutes', record);
  return record;
}

export async function deleteMinute(id: string): Promise<void> {
  const observations = await getAll<Observation>('observations');
  const linked = observations.filter((row) => row.minuteId === id);
  for (const row of linked) {
    await putRecord('observations', { ...row, minuteId: null, updatedAt: nowIso() });
  }
  await deleteRecord('minutes', id);
}

/* ------------------------------- الزيارات ------------------------------- */

export async function listVisits(): Promise<Visit[]> {
  const rows = await getAll<Visit>('visits');
  return rows
    .map((row) => ({ ...row, reviewCycles: Array.isArray(row.reviewCycles) ? row.reviewCycles : [] }))
    .sort((a, b) => ((a.departureAt ?? a.createdAt) < (b.departureAt ?? b.createdAt) ? 1 : -1));
}

export function validateVisit(input: Partial<Visit>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف المسؤول مطلوب';
  if (!trim(input.branchRef)) errors.branchRef = 'الفرع / مرجع العميل مطلوب';

  const chain: Array<[keyof Visit, string]> = [
    ['departureAt', 'التحرك'],
    ['arrivalAt', 'الوصول'],
    ['completedAt', 'إتمام الزيارة'],
    ['returnAt', 'العودة'],
    ['reportSubmittedAt', 'تسليم التقرير'],
    ['reportReviewedAt', 'مراجعة التقرير'],
    ['finalEmailAt', 'البريد النهائي'],
  ];
  let previous: { label: string; at: number } | null = null;
  for (const [field, label] of chain) {
    const value = input[field] as string | null | undefined;
    if (!value) continue;
    if (!isIso(value)) {
      errors[field] = `وقت ${label} غير صحيح`;
      continue;
    }
    const at = new Date(value).getTime();
    if (previous && at < previous.at) errors[field] = `وقت ${label} لا يسبق وقت ${previous.label}`;
    previous = { label, at };
  }
  return errors;
}

export function newReviewCycle(seq: number): ReviewCycle {
  return { id: uid('cyc'), seq, reviewedAt: '', observations: '', corrections: '', outcome: 'pending' };
}

export async function saveVisit(input: Partial<Visit>): Promise<Visit> {
  const errors = validateVisit(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<Visit>('visits', input.id) : undefined;
  const record: Visit = {
    id: input.id ?? uid('vis'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    refNo: trim(input.refNo) || `V-${Date.now().toString().slice(-7)}`,
    employeeId: input.employeeId ?? null,
    branchRef: trim(input.branchRef),
    departureAt: input.departureAt || null,
    arrivalAt: input.arrivalAt || null,
    completedAt: input.completedAt || null,
    returnAt: input.returnAt || null,
    reportSubmittedAt: input.reportSubmittedAt || null,
    reportReviewedAt: input.reportReviewedAt || null,
    finalEmailAt: input.finalEmailAt || null,
    status: input.status ?? 'in_progress',
    reviewCycles: Array.isArray(input.reviewCycles) ? input.reviewCycles : current?.reviewCycles ?? [],
    observations: input.observations ?? '',
  };
  await putRecord('visits', record);
  return record;
}

export async function deleteVisit(id: string): Promise<void> {
  const observations = await getAll<Observation>('observations');
  for (const row of observations.filter((item) => item.visitId === id)) {
    await putRecord('observations', { ...row, visitId: null, cycleId: null, updatedAt: nowIso() });
  }
  await deleteRecord('visits', id);
}

/** إضافة دورة مراجعة جديدة — الدورات السابقة لا تُعدَّل ولا تُحذف */
export async function addReviewCycle(
  visitId: string,
  cycle: { reviewedAt: string; observations: string; corrections: string; outcome: ReviewCycle['outcome'] },
): Promise<Visit> {
  const visit = await getById<Visit>('visits', visitId);
  if (!visit) fail({ form: 'الزيارة غير موجودة' });
  const cycles = Array.isArray(visit.reviewCycles) ? visit.reviewCycles : [];
  const next: ReviewCycle = {
    id: uid('cyc'),
    seq: cycles.reduce((max, item) => Math.max(max, item.seq), 0) + 1,
    reviewedAt: cycle.reviewedAt,
    observations: cycle.observations,
    corrections: cycle.corrections,
    outcome: cycle.outcome,
  };
  const updated: Visit = {
    ...visit,
    reviewCycles: [...cycles, next],
    reportReviewedAt: visit.reportReviewedAt ?? cycle.reviewedAt,
    updatedAt: nowIso(),
  };
  await putRecord('visits', updated);
  return updated;
}

export async function updateReviewCycle(
  visitId: string,
  cycleId: string,
  patch: Partial<Omit<ReviewCycle, 'id' | 'seq'>>,
): Promise<Visit> {
  const visit = await getById<Visit>('visits', visitId);
  if (!visit) fail({ form: 'الزيارة غير موجودة' });
  const updated: Visit = {
    ...visit,
    reviewCycles: (visit.reviewCycles ?? []).map((cycle) => (cycle.id === cycleId ? { ...cycle, ...patch } : cycle)),
    updatedAt: nowIso(),
  };
  await putRecord('visits', updated);
  return updated;
}

/* ------------------------------- الملاحظات ------------------------------ */

export async function listObservations(): Promise<Observation[]> {
  const rows = await getAll<Observation>('observations');
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function validateObservation(input: Partial<Observation>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!input.date) errors.date = 'تاريخ الملاحظة مطلوب';
  else if (Number.isNaN(new Date(input.date).getTime())) errors.date = 'تاريخ الملاحظة غير صحيح';
  if (!trim(input.type)) errors.type = 'نوع الملاحظة مطلوب';
  if (!trim(input.text)) errors.text = 'نص الملاحظة مطلوب';
  return errors;
}

export async function saveObservation(input: Partial<Observation>): Promise<Observation> {
  const errors = validateObservation(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<Observation>('observations', input.id) : undefined;
  const record: Observation = {
    id: input.id ?? uid('obs'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: input.employeeId ?? null,
    minuteId: input.minuteId || null,
    visitId: input.visitId || null,
    cycleId: input.cycleId || null,
    date: (input.date ?? '').slice(0, 10),
    type: trim(input.type),
    text: trim(input.text),
    status: input.status ?? 'open',
    resolution: input.resolution ?? '',
  };
  await putRecord('observations', record);
  return record;
}

export async function deleteObservation(id: string): Promise<void> {
  await deleteRecord('observations', id);
}

/* ------------------------------- التقييمات ------------------------------ */

export async function listEvaluations(): Promise<Evaluation[]> {
  const rows = await getAll<Evaluation>('evaluations');
  return rows.sort((a, b) => (a.year === b.year ? (b.month ?? 13) - (a.month ?? 13) : b.year - a.year));
}

export function periodKey(evaluation: Pick<Evaluation, 'periodType' | 'year' | 'month'>): string {
  return `${evaluation.periodType}|${evaluation.year}|${evaluation.periodType === 'monthly' ? evaluation.month : 0}`;
}

export function validateEvaluation(input: Partial<Evaluation>, others: Evaluation[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!input.year || input.year < 2000 || input.year > 2100) errors.year = 'السنة غير صحيحة';
  if (input.periodType === 'monthly' && (!input.month || input.month < 1 || input.month > 12)) errors.month = 'الشهر مطلوب';
  for (const criterion of EVALUATION_CRITERIA) {
    const value = input.scores?.[criterion.id];
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value) || value < RATING_MIN || value > RATING_MAX) {
      errors[`score_${criterion.id}`] = `الدرجة يجب أن تكون بين ${RATING_MIN} و${RATING_MAX}`;
    }
  }
  const duplicate = others.find(
    (row) =>
      row.id !== input.id &&
      row.employeeId === input.employeeId &&
      periodKey(row) ===
        periodKey({
          periodType: input.periodType ?? 'monthly',
          year: input.year ?? 0,
          month: input.month ?? null,
        }),
  );
  if (duplicate) errors.period = 'يوجد تقييم مسجل لنفس الموظف ونفس الفترة — عدّل التقييم الموجود.';
  return errors;
}

export async function saveEvaluation(input: Partial<Evaluation>): Promise<Evaluation> {
  const others = await getAll<Evaluation>('evaluations');
  const errors = validateEvaluation(input, others);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? others.find((row) => row.id === input.id) : undefined;
  const record: Evaluation = {
    id: input.id ?? uid('evl'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: input.employeeId ?? null,
    periodType: input.periodType ?? 'monthly',
    year: Number(input.year),
    month: input.periodType === 'annual' ? null : Number(input.month ?? 0) || null,
    scores: input.scores ?? {},
    comments: input.comments ?? {},
    overallComment: input.overallComment ?? '',
  };
  await putRecord('evaluations', record);
  return record;
}

export async function deleteEvaluation(id: string): Promise<void> {
  await deleteRecord('evaluations', id);
}
