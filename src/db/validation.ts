import type { Evaluation, Observation, Employee, DisbursementMinute, FieldVisit } from './schema';

export type ValidationErrors = Record<string, string>;

export class ValidationError extends Error {
  errors: ValidationErrors;
  constructor(errors: ValidationErrors) {
    super('بيانات غير صحيحة');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function required(value: unknown, message = 'هذا الحقل مطلوب'): string | null {
  if (value === null || value === undefined) return message;
  if (typeof value === 'string' && !value.trim()) return message;
  return null;
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function isPlainDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(new Date(value).getTime());
}

export function validateEmployee(employee: Partial<Employee>, existingCodes: string[] = []): ValidationErrors {
  const errors: ValidationErrors = {};
  if (required(employee.fullName)) errors.fullName = 'اسم الموظف مطلوب';
  else if ((employee.fullName ?? '').trim().length < 3) errors.fullName = 'الاسم قصير جدًا';

  if (required(employee.employeeCode)) errors.employeeCode = 'الرقم الوظيفي مطلوب';
  else if (!/^[A-Za-z0-9\u0600-\u06FF._-]{2,20}$/.test((employee.employeeCode ?? '').trim()))
    errors.employeeCode = 'الرقم الوظيفي يجب أن يكون بين 2 و20 حرفًا/رقمًا';
  else if (existingCodes.includes((employee.employeeCode ?? '').trim().toLowerCase()))
    errors.employeeCode = 'الرقم الوظيفي مُستخدم بالفعل لموظف آخر';

  if (required(employee.jobTitle)) errors.jobTitle = 'المسمى الوظيفي مطلوب';
  if (employee.hireDate && !isPlainDate(employee.hireDate)) errors.hireDate = 'تاريخ التعيين غير صحيح';
  if (employee.endDate && employee.hireDate && employee.endDate < employee.hireDate)
    errors.endDate = 'تاريخ الانتهاء يجب أن يكون بعد تاريخ التعيين';
  if (employee.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) errors.email = 'البريد الإلكتروني غير صحيح';
  if (!employee.status) errors.status = 'الحالة مطلوبة';
  return errors;
}

export function validateMinute(minute: Partial<DisbursementMinute>): ValidationErrors {
  const errors: ValidationErrors = {};
  if (required(minute.clientRef)) errors.clientRef = 'مرجع العميل/الملف مطلوب';
  if (required(minute.financingType)) errors.financingType = 'نوع التمويل مطلوب';
  if (!minute.employeeId) errors.employeeId = 'ضابط المخاطر المسؤول مطلوب';
  if (!minute.receivedAt || !isIsoDate(minute.receivedAt)) errors.receivedAt = 'وقت استلام الدقيقة مطلوب';
  if (minute.amount !== null && minute.amount !== undefined && (Number.isNaN(minute.amount) || minute.amount < 0))
    errors.amount = 'المبلغ يجب أن يكون رقمًا غير سالب';

  const orderedFields: Array<[keyof DisbursementMinute, string]> = [
    ['receivedAt', 'الاستلام'],
    ['fileRequestedAt', 'طلب الملف'],
    ['fileReceivedAt', 'استلام الملف'],
    ['reviewStartedAt', 'بدء المراجعة'],
    ['clarificationRequestedAt', 'طلب الاستيضاح'],
    ['clarificationRespondedAt', 'الرد على الاستيضاح'],
    ['finalResponseAt', 'الرد النهائي'],
  ];

  let previous: { key: string; at: number } | null = null;
  for (const [field, label] of orderedFields) {
    const value = minute[field] as unknown;
    if (!value) continue;
    if (!isIsoDate(value)) {
      errors[field] = `توقيت ${label} غير صحيح`;
      continue;
    }
    const time = new Date(value as string).getTime();
    if (previous && time < previous.at) {
      errors[field] = `توقيت ${label} يجب ألا يسبق ${previous.key}`;
    }
    previous = { key: label, at: time };
  }
  return errors;
}

export function validateVisit(visit: Partial<FieldVisit>): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!visit.employeeId) errors.employeeId = 'ضابط المخاطر المسؤول مطلوب';
  if (required(visit.clientRef)) errors.clientRef = 'مرجع العميل مطلوب';
  if (!visit.visitDate || !isPlainDate(visit.visitDate)) errors.visitDate = 'تاريخ الزيارة مطلوب';
  if (visit.qualityScore !== null && visit.qualityScore !== undefined) {
    if (!Number.isInteger(visit.qualityScore) || visit.qualityScore < 1 || visit.qualityScore > 5)
      errors.qualityScore = 'جودة التقرير يجب أن تكون بين 1 و5';
  }

  const check = (a?: string | null, b?: string | null, message?: string) => {
    if (!a || !b) return;
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb < ta) {
      if (message) errors.chronology = message;
    }
  };
  check(visit.departureAt, visit.arrivalAt, 'وقت الوصول لا يسبق وقت التحرك');
  check(visit.arrivalAt, visit.returnAt, 'وقت العودة لا يسبق وقت الوصول');
  check(visit.reportSubmittedAt, visit.finalEmailAt, 'إرسال التقرير النهائي لا يسبق تسليم التقرير');
  return errors;
}

export function validateObservation(observation: Partial<Observation>): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!observation.employeeId) errors.employeeId = 'الموظف المرتبط بالملاحظة مطلوب';
  if (!observation.date || !isPlainDate(observation.date)) errors.date = 'تاريخ الملاحظة مطلوب';
  if (!observation.categoryId) errors.categoryId = 'تصنيف الملاحظة مطلوب';
  if (!observation.severity) errors.severity = 'درجة الخطورة مطلوبة';
  if (!observation.source) errors.source = 'مصدر الملاحظة مطلوب';
  if (!observation.description || observation.description.trim().length < 10)
    errors.description = 'الوصف مطلوب (10 أحرف على الأقل)';
  if (!observation.status) errors.status = 'حالة الملاحظة مطلوبة';
  if (observation.status === 'resolved' && !observation.resolvedAt)
    errors.resolvedAt = 'تاريخ المعالجة مطلوب عند تحويل الحالة إلى «تمت المعالجة»';
  return errors;
}

export function validateEvaluation(
  evaluation: Partial<Evaluation>,
  criteriaIds: string[],
  scale: { min: number; max: number },
): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!evaluation.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!evaluation.year || evaluation.year < 2000 || evaluation.year > 2100) errors.year = 'السنة غير صحيحة';
  if (evaluation.periodType === 'monthly') {
    if (!evaluation.month || evaluation.month < 1 || evaluation.month > 12) errors.month = 'الشهر مطلوب';
  }
  const scores = evaluation.scores ?? {};
  for (const id of criteriaIds) {
    const value = scores[id];
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value) || value < scale.min || value > scale.max) {
      errors[`score_${id}`] = `الدرجة يجب أن تكون بين ${scale.min} و${scale.max}`;
    }
  }
  if (evaluation.status === 'approved') {
    const missing = criteriaIds.filter((id) => scores[id] === null || scores[id] === undefined);
    if (missing.length === criteriaIds.length) errors.scores = 'لا يمكن اعتماد تقييم دون أي درجة مسجلة';
  }
  return errors;
}

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function countErrors(errors: ValidationErrors): number {
  return Object.keys(errors).length;
}
