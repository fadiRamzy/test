import {
  appendAudit,
  getAll,
  getById,
  hardDelete,
  putRecord,
  readSettings,
} from './database';
import { nowIso, uid } from '../lib/utils';
import type {
  Branch,
  DisbursementMinute,
  Employee,
  EntityName,
  Evaluation,
  FieldVisit,
  Observation,
  ObservationFollowUp,
  ReviewCycle,
  ID,
} from './schema';
import { ENTITY_LABELS } from './schema';
import { validateEmployee, validateEvaluation, validateMinute, validateObservation, validateVisit } from './validation';

export interface ListOptions {
  includeDeleted?: boolean;
  includeDemo?: boolean;
  demoOnly?: boolean;
}

function visible<T extends { deletedAt?: string | null; isDemo?: boolean }>(record: T, options: ListOptions): boolean {
  if (record.deletedAt && !options.includeDeleted) return false;
  if (options.demoOnly) return record.isDemo === true;
  if (record.isDemo && !options.includeDemo) return false;
  return true;
}

async function auditWrite(
  action: 'create' | 'update' | 'delete' | 'restore' | 'approve' | 'unlock' | 'import' | 'system',
  entity: EntityName | 'settings' | 'backup',
  id: string,
  label: string,
  summary: string,
  isDemo = false,
): Promise<void> {
  const actionLabels: Record<string, string> = {
    create: 'إنشاء',
    update: 'تعديل',
    delete: 'حذف',
    restore: 'استعادة',
    approve: 'اعتماد',
    unlock: 'فتح للتعديل',
    import: 'استيراد',
    system: 'نظام',
  };
  const entityLabel = entity in ENTITY_LABELS ? ENTITY_LABELS[entity as EntityName] : entity === 'settings' ? 'إعدادات' : 'نسخة احتياطية';
  await appendAudit({
    action,
    entity,
    entityId: id,
    entityLabel: label,
    summary: `${actionLabels[action] ?? action} ${entityLabel}: ${summary}`,
    isDemo,
  });
}

function stamp<T extends { createdAt?: string; updatedAt?: string }>(record: T): T & { createdAt: string; updatedAt: string } {
  const now = nowIso();
  const result = { ...record, createdAt: record.createdAt ?? now, updatedAt: now };
  return result as T & { createdAt: string; updatedAt: string };
}

export function normalizeCode(value: string): string {
  return value.trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* الفروع                                                             */
/* ------------------------------------------------------------------ */

export async function listBranches(options: ListOptions = {}): Promise<Branch[]> {
  const rows = await getAll<Branch>('branches');
  return rows.filter((b) => visible(b, options)).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export async function saveBranch(input: Partial<Branch>): Promise<Branch> {
  const errors: Record<string, string> = {};
  if (!input.name?.trim()) errors.name = 'اسم الفرع مطلوب';
  if (!input.code?.trim()) errors.code = 'كود الفرع مطلوب';
  const existing = await listBranches({ includeDeleted: true, includeDemo: true });
  const duplicate = existing.find(
    (b) => b.id !== input.id && b.code && normalizeCode(b.code) === normalizeCode(input.code ?? ''),
  );
  if (duplicate) errors.code = 'كود الفرع مُستخدم بالفعل';
  if (Object.keys(errors).length) throw Object.assign(new Error('بيانات غير صحيحة'), { errors });

  const record: Branch = stamp({
    id: input.id ?? uid('br'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    code: (input.code ?? '').trim(),
    name: (input.name ?? '').trim(),
    governorate: (input.governorate ?? '').trim(),
    isDemo: input.isDemo ?? false,
    deletedAt: input.deletedAt ?? null,
  });
  await putRecord('branches', record);
  await auditWrite(input.id ? 'update' : 'create', 'branches', record.id, record.name, record.name, record.isDemo);
  return record;
}

export async function softDeleteBranch(id: ID): Promise<void> {
  const employees = await listEmployees({ includeDeleted: false, includeDemo: true });
  const linked = employees.filter((e) => e.branchId === id);
  if (linked.length) {
    throw new Error(`لا يمكن أرشفة الفرع لوجود ${linked.length} موظف مرتبط به. انقل الموظفين أولًا.`);
  }
  const branch = await getById<Branch>('branches', id);
  if (!branch) return;
  await putRecord('branches', { ...branch, deletedAt: nowIso(), updatedAt: nowIso() });
  await auditWrite('delete', 'branches', id, branch.name, `أرشفة ${branch.name}`, branch.isDemo);
}

export async function restoreBranch(id: ID): Promise<void> {
  const branch = await getById<Branch>('branches', id);
  if (!branch) return;
  await putRecord('branches', { ...branch, deletedAt: null, updatedAt: nowIso() });
  await auditWrite('restore', 'branches', id, branch.name, `استعادة ${branch.name}`, branch.isDemo);
}

/* ------------------------------------------------------------------ */
/* الموظفون                                                           */
/* ------------------------------------------------------------------ */

export async function listEmployees(options: ListOptions = {}): Promise<Employee[]> {
  const rows = await getAll<Employee>('employees');
  return rows
    .filter((e) => visible(e, options))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
}

export async function findEmployeeDuplicates(input: Partial<Employee>): Promise<{ code?: Employee; name?: Employee }> {
  const rows = await listEmployees({ includeDeleted: false, includeDemo: true });
  const code = input.employeeCode
    ? rows.find(
        (e) => e.id !== input.id && normalizeCode(e.employeeCode) === normalizeCode(input.employeeCode ?? ''),
      )
    : undefined;
  const name = input.fullName
    ? rows.find(
        (e) =>
          e.id !== input.id &&
          e.fullName.trim() === input.fullName?.trim() &&
          (e.branchId ?? null) === (input.branchId ?? null),
      )
    : undefined;
  return { code, name };
}

export async function saveEmployee(input: Partial<Employee>): Promise<Employee> {
  const rows = await listEmployees({ includeDeleted: true, includeDemo: true });
  const existingCodes = rows.filter((e) => e.id !== input.id).map((e) => normalizeCode(e.employeeCode));
  const errors = validateEmployee(input, existingCodes);
  if (Object.keys(errors).length) throw Object.assign(new Error('بيانات غير صحيحة'), { errors });

  const record: Employee = stamp({
    id: input.id ?? uid('emp'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt ?? null,
    employeeCode: (input.employeeCode ?? '').trim(),
    fullName: (input.fullName ?? '').trim(),
    jobTitle: (input.jobTitle ?? '').trim(),
    branchId: input.branchId ?? null,
    governorate: (input.governorate ?? '').trim(),
    hireDate: input.hireDate ?? '',
    endDate: input.endDate ?? null,
    status: input.status ?? 'active',
    phone: input.phone ?? '',
    email: input.email ?? '',
    notes: input.notes ?? '',
    isDemo: input.isDemo ?? false,
  });
  await putRecord('employees', record);
  await auditWrite(
    input.id ? 'update' : 'create',
    'employees',
    record.id,
    `${record.fullName} (${record.employeeCode})`,
    record.fullName,
    record.isDemo,
  );
  return record;
}

export async function relatedCountsForEmployee(id: ID): Promise<{ minutes: number; visits: number; observations: number; evaluations: number }> {
  const [minutes, visits, observations, evaluations] = await Promise.all([
    getAll<DisbursementMinute>('minutes'),
    getAll<FieldVisit>('visits'),
    getAll<Observation>('observations'),
    getAll<Evaluation>('evaluations'),
  ]);
  return {
    minutes: minutes.filter((m) => m.employeeId === id && !m.deletedAt).length,
    visits: visits.filter((v) => v.employeeId === id && !v.deletedAt).length,
    observations: observations.filter((o) => o.employeeId === id && !o.deletedAt).length,
    evaluations: evaluations.filter((e) => e.employeeId === id && !e.deletedAt).length,
  };
}

export async function softDeleteEmployee(id: ID): Promise<void> {
  const employee = await getById<Employee>('employees', id);
  if (!employee) return;
  await putRecord('employees', { ...employee, deletedAt: nowIso(), updatedAt: nowIso() });
  await auditWrite('delete', 'employees', id, employee.fullName, `أرشفة ${employee.fullName}`, employee.isDemo);
}

export async function restoreEmployee(id: ID): Promise<void> {
  const employee = await getById<Employee>('employees', id);
  if (!employee) return;
  await putRecord('employees', { ...employee, deletedAt: null, updatedAt: nowIso() });
  await auditWrite('restore', 'employees', id, employee.fullName, `استعادة ${employee.fullName}`, employee.isDemo);
}

export async function setEmployeeStatus(id: ID, status: Employee['status']): Promise<void> {
  const employee = await getById<Employee>('employees', id);
  if (!employee) return;
  await putRecord('employees', { ...employee, status, updatedAt: nowIso() });
  await auditWrite('update', 'employees', id, employee.fullName, `تغيير الحالة إلى ${status}`, employee.isDemo);
}

export async function purgeEmployee(id: ID): Promise<void> {
  const counts = await relatedCountsForEmployee(id);
  const total = counts.minutes + counts.visits + counts.observations + counts.evaluations;
  if (total > 0) throw new Error('لا يمكن الحذف النهائي لوجود سجلات مرتبطة. احذف السجلات المرتبطة أولًا.');
  await hardDelete('employees', id);
  await auditWrite('delete', 'employees', id, id, 'حذف نهائي', false);
}

/* ------------------------------------------------------------------ */
/* دقائق الصرف                                                        */
/* ------------------------------------------------------------------ */

export async function listMinutes(options: ListOptions = {}): Promise<DisbursementMinute[]> {
  const rows = await getAll<DisbursementMinute>('minutes');
  return rows
    .filter((m) => visible(m, options))
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export interface DuplicateCandidate {
  reason: string;
  record: DisbursementMinute | FieldVisit | Observation | Employee;
}

export async function findMinuteDuplicates(input: Partial<DisbursementMinute>): Promise<DuplicateCandidate[]> {
  const rows = await listMinutes({ includeDemo: true });
  const out: DuplicateCandidate[] = [];
  for (const m of rows) {
    if (m.id === input.id) continue;
    if (input.refNo && m.refNo && normalizeCode(m.refNo) === normalizeCode(input.refNo)) {
      out.push({ reason: 'نفس رقم مرجع الدقيقة', record: m });
      continue;
    }
    if (
      input.clientRef &&
      m.clientRef &&
      normalizeCode(m.clientRef) === normalizeCode(input.clientRef) &&
      (m.employeeId ?? null) === (input.employeeId ?? null)
    ) {
      const a = input.receivedAt ? new Date(input.receivedAt).getTime() : null;
      const b = m.receivedAt ? new Date(m.receivedAt).getTime() : null;
      if (a && b && Math.abs(a - b) < 36 * 60 * 60 * 1000) {
        out.push({ reason: 'نفس مرجع العميل لنفس الضابط خلال 36 ساعة', record: m });
      }
    }
  }
  return out;
}

export async function saveMinute(input: Partial<DisbursementMinute>): Promise<DisbursementMinute> {
  const errors = validateMinute(input);
  if (Object.keys(errors).length) throw Object.assign(new Error('بيانات غير صحيحة'), { errors });
  const record: DisbursementMinute = stamp({
    id: input.id ?? uid('min'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt ?? null,
    refNo: input.refNo?.trim() || `MIN-${Date.now().toString().slice(-8)}`,
    branchId: input.branchId ?? null,
    employeeId: input.employeeId ?? null,
    clientRef: input.clientRef?.trim() ?? '',
    financingType: input.financingType ?? '',
    amount: input.amount ?? null,
    outcome: input.outcome ?? 'pending',
    status: input.status ?? 'pending',
    receivedAt: input.receivedAt ?? nowIso(),
    fileRequestedAt: input.fileRequestedAt ?? null,
    fileReceivedAt: input.fileReceivedAt ?? null,
    reviewStartedAt: input.reviewStartedAt ?? null,
    clarificationRequestedAt: input.clarificationRequestedAt ?? null,
    clarificationRespondedAt: input.clarificationRespondedAt ?? null,
    finalResponseAt: input.finalResponseAt ?? null,
    notes: input.notes ?? '',
    isDemo: input.isDemo ?? false,
  });
  await putRecord('minutes', record);
  await auditWrite(
    input.id ? 'update' : 'create',
    'minutes',
    record.id,
    record.refNo,
    `${record.refNo} — ${record.clientRef}`,
    record.isDemo,
  );
  return record;
}

export async function softDeleteMinute(id: ID): Promise<void> {
  const minute = await getById<DisbursementMinute>('minutes', id);
  if (!minute) return;
  await putRecord('minutes', { ...minute, deletedAt: nowIso(), updatedAt: nowIso() });
  await auditWrite('delete', 'minutes', id, minute.refNo, `أرشفة ${minute.refNo}`, minute.isDemo);
}

export async function restoreMinute(id: ID): Promise<void> {
  const minute = await getById<DisbursementMinute>('minutes', id);
  if (!minute) return;
  await putRecord('minutes', { ...minute, deletedAt: null, updatedAt: nowIso() });
  await auditWrite('restore', 'minutes', id, minute.refNo, `استعادة ${minute.refNo}`, minute.isDemo);
}

/* ------------------------------------------------------------------ */
/* الزيارات الميدانية                                                 */
/* ------------------------------------------------------------------ */

export async function listVisits(options: ListOptions = {}): Promise<FieldVisit[]> {
  const rows = await getAll<FieldVisit>('visits');
  return rows
    .filter((v) => visible(v, options))
    .map((v) => ({ ...v, reviewCycles: Array.isArray(v.reviewCycles) ? v.reviewCycles : [] }))
    .sort((a, b) => (a.visitDate < b.visitDate ? 1 : -1));
}

export async function findVisitDuplicates(input: Partial<FieldVisit>): Promise<DuplicateCandidate[]> {
  const rows = await listVisits({ includeDemo: true });
  return rows
    .filter(
      (v) =>
        v.id !== input.id &&
        (v.employeeId ?? null) === (input.employeeId ?? null) &&
        normalizeCode(v.clientRef) === normalizeCode(input.clientRef ?? '') &&
        v.visitDate === input.visitDate,
    )
    .map((v) => ({ reason: 'زيارة لنفس العميل في نفس اليوم لنفس الضابط', record: v }));
}

export function newReviewCycle(cycleNo: number): ReviewCycle {
  return {
    id: uid('cyc'),
    cycleNo,
    submittedAt: null,
    reviewedAt: null,
    correctionsRequestedAt: null,
    correctionsNotes: '',
    resubmittedAt: null,
    qualityScore: null,
    feedback: '',
    finalEmailAt: null,
  };
}

export async function saveVisit(input: Partial<FieldVisit>): Promise<FieldVisit> {
  const errors = validateVisit(input);
  if (Object.keys(errors).length) throw Object.assign(new Error('بيانات غير صحيحة'), { errors });
  const record: FieldVisit = stamp({
    id: input.id ?? uid('vis'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt ?? null,
    refNo: input.refNo?.trim() || `VIS-${Date.now().toString().slice(-8)}`,
    employeeId: input.employeeId ?? null,
    branchId: input.branchId ?? null,
    clientRef: input.clientRef?.trim() ?? '',
    visitDate: input.visitDate ?? '',
    departureAt: input.departureAt ?? null,
    arrivalAt: input.arrivalAt ?? null,
    inspectionAt: input.inspectionAt ?? null,
    returnAt: input.returnAt ?? null,
    reportSubmittedAt: input.reportSubmittedAt ?? null,
    supervisorReviewAt: input.supervisorReviewAt ?? null,
    correctionsAt: input.correctionsAt ?? null,
    resubmittedAt: input.resubmittedAt ?? null,
    finalEmailAt: input.finalEmailAt ?? null,
    status: input.status ?? 'planned',
    qualityScore: input.qualityScore ?? null,
    feedback: input.feedback ?? '',
    pendingActions: input.pendingActions ?? '',
    reviewCycles: Array.isArray(input.reviewCycles) ? input.reviewCycles : [newReviewCycle(1)],
    notes: input.notes ?? '',
    isDemo: input.isDemo ?? false,
  });
  await putRecord('visits', record);
  await auditWrite(
    input.id ? 'update' : 'create',
    'visits',
    record.id,
    record.refNo,
    `${record.refNo} — ${record.clientRef}`,
    record.isDemo,
  );
  return record;
}

/** إضافة دورة مراجعة جديدة دون المساس بالدورات السابقة */
export async function addReviewCycle(
  visitId: ID,
  cycle: Omit<ReviewCycle, 'id' | 'cycleNo'>,
): Promise<FieldVisit> {
  const visit = await getById<FieldVisit>('visits', visitId);
  if (!visit) throw new Error('الزيارة غير موجودة');
  const cycles = Array.isArray(visit.reviewCycles) ? visit.reviewCycles : [];
  const next: ReviewCycle = {
    ...cycle,
    id: uid('cyc'),
    cycleNo: cycles.reduce((max, c) => Math.max(max, c.cycleNo), 0) + 1,
  };
  const updated: FieldVisit = {
    ...visit,
    reviewCycles: [...cycles, next],
    updatedAt: nowIso(),
  };
  await putRecord('visits', updated);
  await auditWrite('update', 'visits', visitId, visit.refNo, `إضافة دورة مراجعة #${next.cycleNo}`, visit.isDemo);
  return updated;
}

export async function updateReviewCycle(
  visitId: ID,
  cycleId: string,
  patch: Partial<ReviewCycle>,
): Promise<FieldVisit> {
  const visit = await getById<FieldVisit>('visits', visitId);
  if (!visit) throw new Error('الزيارة غير موجودة');
  const cycles = (visit.reviewCycles ?? []).map((c) => (c.id === cycleId ? { ...c, ...patch } : c));
  const updated: FieldVisit = { ...visit, reviewCycles: cycles, updatedAt: nowIso() };
  await putRecord('visits', updated);
  await auditWrite('update', 'visits', visitId, visit.refNo, 'تعديل دورة مراجعة', visit.isDemo);
  return updated;
}

export async function softDeleteVisit(id: ID): Promise<void> {
  const visit = await getById<FieldVisit>('visits', id);
  if (!visit) return;
  await putRecord('visits', { ...visit, deletedAt: nowIso(), updatedAt: nowIso() });
  await auditWrite('delete', 'visits', id, visit.refNo, `أرشفة ${visit.refNo}`, visit.isDemo);
}

export async function restoreVisit(id: ID): Promise<void> {
  const visit = await getById<FieldVisit>('visits', id);
  if (!visit) return;
  await putRecord('visits', { ...visit, deletedAt: null, updatedAt: nowIso() });
  await auditWrite('restore', 'visits', id, visit.refNo, `استعادة ${visit.refNo}`, visit.isDemo);
}

/* ------------------------------------------------------------------ */
/* سجل الملاحظات                                                      */
/* ------------------------------------------------------------------ */

export async function listObservations(options: ListOptions = {}): Promise<Observation[]> {
  const rows = await getAll<Observation>('observations');
  return rows
    .filter((o) => visible(o, options))
    .map((o) => ({ ...o, followUps: Array.isArray(o.followUps) ? o.followUps : [] }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function findObservationDuplicates(input: Partial<Observation>): Promise<DuplicateCandidate[]> {
  const rows = await listObservations({ includeDemo: true });
  return rows
    .filter(
      (o) =>
        o.id !== input.id &&
        o.employeeId === input.employeeId &&
        o.categoryId === input.categoryId &&
        o.date === input.date,
    )
    .map((o) => ({ reason: 'ملاحظة بنفس التصنيف لنفس الموظف في نفس اليوم', record: o }));
}

export async function saveObservation(input: Partial<Observation>): Promise<Observation> {
  const errors = validateObservation(input);
  if (Object.keys(errors).length) throw Object.assign(new Error('بيانات غير صحيحة'), { errors });
  const record: Observation = stamp({
    id: input.id ?? uid('obs'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt ?? null,
    refNo: input.refNo?.trim() || `OBS-${Date.now().toString().slice(-8)}`,
    employeeId: input.employeeId ?? null,
    branchId: input.branchId ?? null,
    minuteId: input.minuteId ?? null,
    visitId: input.visitId ?? null,
    date: input.date ?? '',
    categoryId: input.categoryId ?? '',
    severity: input.severity ?? 'medium',
    source: input.source ?? 'review',
    description: input.description ?? '',
    correctiveAction: input.correctiveAction ?? '',
    notifiedAt: input.notifiedAt ?? null,
    isRecurring: input.isRecurring ?? false,
    recurrenceOfId: input.recurrenceOfId ?? null,
    status: input.status ?? 'open',
    resolvedAt: input.resolvedAt ?? null,
    followUps: Array.isArray(input.followUps) ? input.followUps : [],
    isDemo: input.isDemo ?? false,
  });
  await putRecord('observations', record);
  await auditWrite(
    input.id ? 'update' : 'create',
    'observations',
    record.id,
    record.refNo,
    `${record.refNo} — ${record.description.slice(0, 40)}`,
    record.isDemo,
  );
  return record;
}

export async function addObservationFollowUp(
  observationId: ID,
  followUp: Omit<ObservationFollowUp, 'id' | 'createdAt'>,
): Promise<Observation> {
  const observation = await getById<Observation>('observations', observationId);
  if (!observation) throw new Error('الملاحظة غير موجودة');
  const entry: ObservationFollowUp = { ...followUp, id: uid('fu'), createdAt: nowIso() };
  const updated: Observation = {
    ...observation,
    followUps: [...(observation.followUps ?? []), entry],
    updatedAt: nowIso(),
  };
  await putRecord('observations', updated);
  await auditWrite('update', 'observations', observationId, observation.refNo, 'إضافة متابعة', observation.isDemo);
  return updated;
}

export async function resolveObservation(observationId: ID, resolvedAt: string, note?: string): Promise<Observation> {
  const observation = await getById<Observation>('observations', observationId);
  if (!observation) throw new Error('الملاحظة غير موجودة');
  const followUps = [...(observation.followUps ?? [])];
  if (note?.trim()) {
    followUps.push({ id: uid('fu'), date: resolvedAt.slice(0, 10), note: note.trim(), createdAt: nowIso() });
  }
  const updated: Observation = {
    ...observation,
    status: 'resolved',
    resolvedAt,
    followUps,
    updatedAt: nowIso(),
  };
  await putRecord('observations', updated);
  await auditWrite('update', 'observations', observationId, observation.refNo, 'تسجيل معالجة', observation.isDemo);
  return updated;
}

export async function softDeleteObservation(id: ID): Promise<void> {
  const observation = await getById<Observation>('observations', id);
  if (!observation) return;
  await putRecord('observations', { ...observation, deletedAt: nowIso(), updatedAt: nowIso() });
  await auditWrite('delete', 'observations', id, observation.refNo, `أرشفة ${observation.refNo}`, observation.isDemo);
}

export async function restoreObservation(id: ID): Promise<void> {
  const observation = await getById<Observation>('observations', id);
  if (!observation) return;
  await putRecord('observations', { ...observation, deletedAt: null, updatedAt: nowIso() });
  await auditWrite('restore', 'observations', id, observation.refNo, `استعادة ${observation.refNo}`, observation.isDemo);
}

/* ------------------------------------------------------------------ */
/* التقييمات                                                          */
/* ------------------------------------------------------------------ */

export function evaluationPeriodKey(evaluation: Pick<Evaluation, 'periodType' | 'year' | 'month'>): string {
  return `${evaluation.periodType}-${evaluation.year}-${evaluation.month ?? 0}`;
}

export async function listEvaluations(options: ListOptions = {}): Promise<Evaluation[]> {
  const rows = await getAll<Evaluation>('evaluations');
  return rows
    .filter((e) => visible(e, options))
    .map((e) => ({ ...e, scores: e.scores ?? {}, comments: e.comments ?? {} }))
    .sort((a, b) => (a.year === b.year ? (b.month ?? 0) - (a.month ?? 0) : b.year - a.year));
}

export async function findEvaluationConflict(input: Partial<Evaluation>): Promise<Evaluation | undefined> {
  const rows = await listEvaluations({ includeDemo: true });
  const key = evaluationPeriodKey({
    periodType: input.periodType ?? 'monthly',
    year: input.year ?? 0,
    month: input.month ?? null,
  });
  return rows.find((e) => e.employeeId === input.employeeId && evaluationPeriodKey(e) === key && e.id !== input.id);
}

export async function saveEvaluation(input: Partial<Evaluation>): Promise<Evaluation> {
  const settings = await readSettings();
  const criteriaIds = settings.evaluationCriteria.filter((c) => c.active).map((c) => c.id);
  const errors = validateEvaluation(input, criteriaIds, settings.ratingScale);
  if (Object.keys(errors).length) throw Object.assign(new Error('بيانات غير صحيحة'), { errors });

  const existing = input.id ? await getById<Evaluation>('evaluations', input.id) : undefined;
  if (existing?.status === 'approved' && input.status === 'approved' && !input.unlockReason) {
    // التعديل على تقييم معتمد يتطلب سببًا موثقًا
    const changed = JSON.stringify(existing.scores) !== JSON.stringify(input.scores);
    if (changed && !existing.unlockReason) {
      throw Object.assign(new Error('التقييم معتمد — يلزم فتحه للتعديل بسبب موثق أولًا'), {
        errors: { approved: 'التقييم معتمد. استخدم «فتح للتعديل» مع ذكر السبب.' },
      });
    }
  }

  const record: Evaluation = stamp({
    id: input.id ?? uid('evl'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt ?? null,
    employeeId: input.employeeId ?? null,
    periodType: input.periodType ?? 'monthly',
    year: input.year ?? new Date().getFullYear(),
    month: input.periodType === 'annual' ? null : (input.month ?? null),
    scores: input.scores ?? {},
    comments: input.comments ?? {},
    overallComment: input.overallComment ?? '',
    status: input.status ?? 'draft',
    approvedAt: input.status === 'approved' ? (input.approvedAt ?? nowIso()) : null,
    unlockReason: input.unlockReason ?? null,
    unlockedAt: input.unlockedAt ?? null,
    derivedFromMonthly: input.derivedFromMonthly ?? false,
    isDemo: input.isDemo ?? false,
  });
  await putRecord('evaluations', record);
  await auditWrite(
    input.id ? 'update' : 'create',
    'evaluations',
    record.id,
    `${record.periodType}-${record.year}-${record.month ?? ''}`,
    `تقييم ${record.periodType === 'annual' ? 'سنوي' : 'شهري'} ${record.year}${record.month ? `/${record.month}` : ''}`,
    record.isDemo,
  );
  return record;
}

export async function approveEvaluation(id: ID): Promise<Evaluation> {
  const evaluation = await getById<Evaluation>('evaluations', id);
  if (!evaluation) throw new Error('التقييم غير موجود');
  const updated: Evaluation = { ...evaluation, status: 'approved', approvedAt: nowIso(), updatedAt: nowIso() };
  await putRecord('evaluations', updated);
  await auditWrite('approve', 'evaluations', id, id, 'اعتماد التقييم', evaluation.isDemo);
  return updated;
}

export async function unlockEvaluation(id: ID, reason: string): Promise<Evaluation> {
  if (!reason.trim()) throw Object.assign(new Error('السبب مطلوب'), { errors: { reason: 'سبب فتح التقييم مطلوب' } });
  const evaluation = await getById<Evaluation>('evaluations', id);
  if (!evaluation) throw new Error('التقييم غير موجود');
  const updated: Evaluation = {
    ...evaluation,
    status: 'draft',
    approvedAt: null,
    unlockReason: reason.trim(),
    unlockedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await putRecord('evaluations', updated);
  await auditWrite('unlock', 'evaluations', id, id, `فتح للتعديل: ${reason.trim()}`, evaluation.isDemo);
  return updated;
}

export async function softDeleteEvaluation(id: ID): Promise<void> {
  const evaluation = await getById<Evaluation>('evaluations', id);
  if (!evaluation) return;
  await putRecord('evaluations', { ...evaluation, deletedAt: nowIso(), updatedAt: nowIso() });
  await auditWrite('delete', 'evaluations', id, id, 'أرشفة تقييم', evaluation.isDemo);
}

export async function restoreEvaluation(id: ID): Promise<void> {
  const evaluation = await getById<Evaluation>('evaluations', id);
  if (!evaluation) return;
  await putRecord('evaluations', { ...evaluation, deletedAt: null, updatedAt: nowIso() });
  await auditWrite('restore', 'evaluations', id, id, 'استعادة تقييم', evaluation.isDemo);
}
