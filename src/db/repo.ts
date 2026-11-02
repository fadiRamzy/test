import { deleteRecord, getAll, getById, putRecord } from './database';
import { nowIso, uid } from '../lib/utils';
import {
  EVALUATION_CRITERIA,
  normalizeEmployeeStatus,
  SCORE_MAX,
  SCORE_MIN,
  type AnnualNote,
  type AttendanceRecord,
  type DailyMinute,
  type Employee,
  type EmployeeNote,
  type FieldVisit,
  type Leave,
  type LeavePermissionRecord,
  type MonthlyEvaluation,
  type Observation,
  type VisitTiming,
} from './schema';
import { isScoreValid } from '../lib/calc';

export class ValidationError extends Error {
  errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? 'بيانات غير صحيحة');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function fail(errors: Record<string, string>): never {
  throw new ValidationError(errors);
}

const trim = (value: string | null | undefined) => (value ?? '').trim();
const isDate = (value?: string | null) => Boolean(value) && !Number.isNaN(new Date(value as string).getTime());

/* ------------------------------- الموظفون ------------------------------- */

export async function listEmployees(includeArchived = false): Promise<Employee[]> {
  const rows = await getAll<Employee>('employees');
  return rows
    .map((row) => ({ ...row, status: normalizeEmployeeStatus(row.status) }))
    .filter((row) => (includeArchived ? true : !row.archived))
    .sort((a, b) => a.employeeNo - b.employeeNo || a.name.localeCompare(b.name, 'ar'));
}

export async function listEmployeeNotes(): Promise<EmployeeNote[]> {
  return (await getAll<EmployeeNote>('employeeNotes')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Preserve existing employee.notes values by converting each into a note record once. */
export async function migrateLegacyEmployeeNotes(): Promise<void> {
  const [employees, notes] = await Promise.all([getAll<Employee>('employees'), getAll<EmployeeNote>('employeeNotes')]);
  const known = new Set(notes.map((row) => row.id));
  for (const employee of employees) {
    if (!trim(employee.notes)) continue;
    const legacyId = `legacy-employee-note-${employee.id}`;
    if (!known.has(legacyId)) {
      await putRecord('employeeNotes', {
        id: legacyId,
        createdAt: employee.updatedAt || nowIso(),
        updatedAt: nowIso(),
        employeeId: employee.id,
        note: employee.notes,
      });
      known.add(legacyId);
    }
    await putRecord('employees', { ...employee, notes: '', updatedAt: nowIso() });
  }
}

export async function saveEmployeeNote(input: { id?: string; employeeId: string; note: string }): Promise<EmployeeNote> {
  const note = input.note.trim();
  if (!input.employeeId) fail({ employeeId: 'الموظف مطلوب' });
  if (!note) fail({ note: 'الملاحظة مطلوبة' });
  const [employees, existing] = await Promise.all([getAll<Employee>('employees'), getAll<EmployeeNote>('employeeNotes')]);
  if (!employees.some((row) => row.id === input.employeeId)) fail({ employeeId: 'الموظف المحدد غير موجود' });
  const current = input.id ? existing.find((row) => row.id === input.id) : undefined;
  if (input.id && !current) fail({ note: 'الملاحظة غير موجودة' });
  const record: EmployeeNote = {
    id: current?.id ?? uid('enote'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: input.employeeId,
    note,
  };
  await putRecord('employeeNotes', record);
  return record;
}

export async function deleteEmployeeNote(id: string): Promise<void> {
  await deleteRecord('employeeNotes', id);
}

export async function nextEmployeeNo(): Promise<number> {
  const rows = await getAll<Employee>('employees');
  return rows.reduce((max, row) => Math.max(max, Number(row.employeeNo) || 0), 0) + 1;
}

export function validateEmployee(input: Partial<Employee>, existing: Employee[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!trim(input.name)) errors.name = 'اسم الموظف مطلوب';
  if (!trim(input.code)) errors.code = 'كود الموظف مطلوب';
  else if (existing.some((row) => row.id !== input.id && trim(row.code).toLowerCase() === trim(input.code).toLowerCase()))
    errors.code = 'كود الموظف مستخدم بالفعل';
  if (!trim(input.sector)) errors.sector = 'القطاع مطلوب';
  if (!trim(input.governorate)) errors.governorate = 'المحافظة مطلوبة';
  if (!trim(input.jobTitle)) errors.jobTitle = 'المسمى الوظيفي مطلوب';
  if (!isDate(input.employmentDate)) errors.employmentDate = 'تاريخ التعيين مطلوب';
  if (input.employeeNo === undefined || input.employeeNo === null || Number(input.employeeNo) < 1)
    errors.employeeNo = 'رقم الموظف مطلوب';
  else if (existing.some((row) => row.id !== input.id && Number(row.employeeNo) === Number(input.employeeNo)))
    errors.employeeNo = 'رقم الموظف مستخدم بالفعل';
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
    employeeNo: Number(input.employeeNo),
    name: trim(input.name),
    code: trim(input.code),
    sector: trim(input.sector),
    governorate: trim(input.governorate),
    jobTitle: trim(input.jobTitle),
    employmentDate: input.employmentDate ?? '',
    branches: input.branches ?? '',
    status: normalizeEmployeeStatus(input.status),
    archived: input.archived ?? current?.archived ?? false,
    notes: input.notes ?? '',
  };
  await putRecord('employees', record);
  return record;
}

export async function setEmployeeArchived(id: string, archived: boolean): Promise<void> {
  const employee = await getById<Employee>('employees', id);
  if (!employee) return;
  await putRecord('employees', { ...employee, archived, updatedAt: nowIso() });
}

/** حذف نهائي — يُسمح فقط إذا لم يكن للموظف أي سجلات */
export async function deleteEmployee(id: string): Promise<void> {
  const [evaluations, visits, minutes, visitTimings, observations, leaves, requests, attendance, employeeNotes] = await Promise.all([
    getAll<MonthlyEvaluation>('monthlyEvaluations'),
    getAll<FieldVisit>('fieldVisits'),
    getAll<DailyMinute>('minutes'),
    getAll<VisitTiming>('visitTimings'),
    getAll<Observation>('observations'),
    getAll<Leave>('leaves'),
    getAll<LeavePermissionRecord>('leavePermissions'),
    getAll<AttendanceRecord>('attendanceRecords'),
    getAll<EmployeeNote>('employeeNotes'),
  ]);
  const linked =
    evaluations.filter((row) => row.employeeId === id).length +
    visits.filter((row) => row.employeeId === id).length +
    minutes.filter((row) => row.employeeId === id).length +
    visitTimings.filter((row) => row.employeeId === id).length +
    observations.filter((row) => row.employeeId === id).length +
    leaves.filter((row) => row.employeeId === id).length +
    requests.filter((row) => row.employeeId === id).length +
    attendance.filter((row) => row.employeeId === id).length +
    employeeNotes.filter((row) => row.employeeId === id).length;

  if (linked > 0) {
    fail({ form: `لا يمكن الحذف: للموظف ${linked} سجلًا مرتبطًا. استخدم «أرشفة» بدلًا من الحذف.` });
  }
  await deleteRecord('employees', id);
}

/* --------------------------- التقييم الشهري ---------------------------- */

export async function listMonthlyEvaluations(): Promise<MonthlyEvaluation[]> {
  return getAll<MonthlyEvaluation>('monthlyEvaluations');
}

export function validateMonthly(input: Partial<MonthlyEvaluation>, others: MonthlyEvaluation[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!input.year || input.year < 2000 || input.year > 2100) errors.year = 'السنة غير صحيحة';
  if (!input.month || input.month < 1 || input.month > 12) errors.month = 'الشهر غير صحيح';
  for (const criterion of EVALUATION_CRITERIA) {
    const value = input.scores?.[criterion.id];
    if (value === null || value === undefined) continue;
    if (!isScoreValid(value)) errors[criterion.id] = `درجة «${criterion.name}» يجب أن تكون من ${SCORE_MIN} إلى ${SCORE_MAX}`;
  }
  if (input.visits !== null && input.visits !== undefined) {
    if (!Number.isFinite(Number(input.visits)) || Number(input.visits) < 0) errors.visits = 'عدد الزيارات يجب أن يكون صفرًا أو أكثر';
  }
  const duplicate = others.find(
    (row) =>
      row.id !== input.id && row.employeeId === input.employeeId && row.year === input.year && row.month === input.month,
  );
  if (duplicate) errors.period = 'يوجد تقييم مسجل لنفس الموظف في نفس الشهر — عدّل السجل الموجود.';
  return errors;
}

/** إنشاء أو تحديث تقييم شهر واحد لموظف */
export async function saveMonthlyEvaluation(input: Partial<MonthlyEvaluation>): Promise<MonthlyEvaluation> {
  const others = await getAll<MonthlyEvaluation>('monthlyEvaluations');
  const errors = validateMonthly(input, others);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? others.find((row) => row.id === input.id) : undefined;
  const record: MonthlyEvaluation = {
    id: input.id ?? uid('mev'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: input.employeeId as string,
    year: Number(input.year),
    month: Number(input.month),
    visits: input.visits === null || input.visits === undefined ? null : Number(input.visits),
    scores: input.scores ?? {},
    notes: input.notes ?? '',
  };
  await putRecord('monthlyEvaluations', record);
  return record;
}

/** حفظ جماعي لصفوف جدول الشهر (إنشاء/تحديث لكل موظف) */
export async function saveMonthlyBatch(
  year: number,
  month: number,
  rows: Array<{ employeeId: string; visits: number | null; scores: MonthlyEvaluation['scores']; notes: string }>,
): Promise<number> {
  const existing = await getAll<MonthlyEvaluation>('monthlyEvaluations');
  const byEmployee = new Map(
    existing.filter((row) => row.year === year && row.month === month).map((row) => [row.employeeId, row]),
  );
  const records: MonthlyEvaluation[] = [];

  for (const row of rows) {
    const current = byEmployee.get(row.employeeId);
    records.push({
      id: current?.id ?? uid('mev'),
      createdAt: current?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      employeeId: row.employeeId,
      year,
      month,
      visits: row.visits,
      scores: row.scores,
      notes: row.notes,
    });
  }

  const { putMany } = await import('./database');
  await putMany('monthlyEvaluations', records);
  return records.length;
}

export async function deleteMonthlyEvaluation(id: string): Promise<void> {
  await deleteRecord('monthlyEvaluations', id);
}

/* --------------------------- ملاحظات سنوية ----------------------------- */

export async function listAnnualNotes(): Promise<AnnualNote[]> {
  return getAll<AnnualNote>('annualNotes');
}

export async function saveAnnualNote(employeeId: string, year: number, notes: string): Promise<AnnualNote> {
  const rows = await getAll<AnnualNote>('annualNotes');
  const current = rows.find((row) => row.employeeId === employeeId && row.year === year);
  const record: AnnualNote = {
    id: current?.id ?? uid('anl'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId,
    year,
    notes,
  };
  await putRecord('annualNotes', record);
  return record;
}

/* --------------------------- الزيارات الميدانية ------------------------- */

export async function listFieldVisits(): Promise<FieldVisit[]> {
  const rows = await getAll<FieldVisit>('fieldVisits');
  return rows.sort((a, b) => (a.visitDate < b.visitDate ? 1 : -1));
}

export function validateVisit(input: Partial<FieldVisit>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!trim(input.branch)) errors.branch = 'الفرع مطلوب';
  if (!isDate(input.visitDate)) errors.visitDate = 'تاريخ الزيارة مطلوب';
  if (!trim(input.visitType)) errors.visitType = 'نوع الزيارة مطلوب';
  return errors;
}

export async function saveFieldVisit(input: Partial<FieldVisit>): Promise<FieldVisit> {
  const errors = validateVisit(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<FieldVisit>('fieldVisits', input.id) : undefined;
  const record: FieldVisit = {
    id: input.id ?? uid('vis'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: input.employeeId as string,
    region: input.region ?? '',
    branch: trim(input.branch),
    visitDate: input.visitDate as string,
    visitType: trim(input.visitType),
    reference: input.reference ?? '',
    status: input.status ?? 'completed',
    reportSubmittedAt: input.reportSubmittedAt || null,
    reportReviewedAt: input.reportReviewedAt || null,
    revisions: input.revisions === null || input.revisions === undefined ? null : Number(input.revisions),
    finalAssessment: input.finalAssessment ?? '',
    notes: input.notes ?? '',
  };
  await putRecord('fieldVisits', record);
  return record;
}

export async function deleteFieldVisit(id: string): Promise<void> {
  await deleteRecord('fieldVisits', id);
}

/* ----------------------------- محاضر يومية ------------------------------ */

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const isTime = (value?: string | null) => Boolean(value) && TIME_RE.test(String(value).trim());

function normalizeMinute(row: DailyMinute): DailyMinute {
  const responseTime = row.responseTime || row.finalResponseTime || '';
  const inspectionResult = row.inspectionResult === 'has_notes' || row.inspectionResult === 'no_notes' ? row.inspectionResult : '';
  return {
    ...row,
    fileRequestTime: row.fileRequestTime ?? '',
    fileReceivedTime: row.fileReceivedTime ?? '',
    responseTime,
    inspectionResult,
  };
}

/** كل المحاضر مرتبة من الأحدث إلى الأقدم (تاريخ المحضر إن وُجد، وإلا تاريخ الإنشاء) */
export async function listMinutes(): Promise<DailyMinute[]> {
  const rows = await getAll<DailyMinute>('minutes');
  return rows.map(normalizeMinute).sort((a, b) => {
    const dateA = a.date ?? a.createdAt.slice(0, 10);
    const dateB = b.date ?? b.createdAt.slice(0, 10);
    if (dateA === dateB) return a.createdAt < b.createdAt ? 1 : -1;
    return dateA < dateB ? 1 : -1;
  });
}

export function validateMinute(input: Partial<DailyMinute>): Record<string, string> {
  // كل الحقول اختيارية — يُسمح بحفظ محضر ناقص، ولا تُفرض أي قيمة افتراضية
  const errors: Record<string, string> = {};

  for (const [field, label] of [
    ['fileRequestTime', 'توقيت طلب الملف'],
    ['fileReceivedTime', 'توقيت استلام الملف'],
    ['responseTime', 'توقيت الرد على الملف'],
  ] as const) {
    const value = input[field];
    if (value && !isTime(value)) errors[field] = `${label}: صيغة الوقت غير صحيحة (HH:MM)`;
  }

  const received = input.fileReceivedTime ? parseInputTime(input.fileReceivedTime) : null;
  const response = input.responseTime ? parseInputTime(input.responseTime) : null;
  if (received !== null && response !== null && response < received)
    errors.responseTime = 'توقيت الرد على الملف يسبق توقيت استلام الملف — تحقق من الأوقات';

  return errors;
}

function parseInputTime(value: string): number | null {
  if (!isTime(value)) return null;
  const match = TIME_RE.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export async function saveMinute(input: Partial<DailyMinute>): Promise<DailyMinute> {
  const errors = validateMinute(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<DailyMinute>('minutes', input.id) : undefined;
  const record: DailyMinute = {
    ...(current ?? {}),
    id: input.id ?? uid('min'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: (input.employeeId ?? '') as string,
    fileRequestTime: (input.fileRequestTime ?? '').trim(),
    fileReceivedTime: (input.fileReceivedTime ?? '').trim(),
    responseTime: (input.responseTime ?? '').trim(),
    inspectionResult: (input.inspectionResult ?? current?.inspectionResult ?? '') as DailyMinute['inspectionResult'],
  };
  await putRecord('minutes', record);
  return record;
}

export async function deleteMinute(id: string): Promise<void> {
  await deleteRecord('minutes', id);
}

/* --------------------------- توقيت الزيارات ---------------------------- */

export async function listVisitTimings(): Promise<VisitTiming[]> {
  const rows = await getAll<VisitTiming>('visitTimings');
  return rows.sort((a, b) => {
    const dateA = a.visitDate ?? '';
    const dateB = b.visitDate ?? '';
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    const depA = a.departureTime ?? '';
    const depB = b.departureTime ?? '';
    if (depA !== depB) return depA < depB ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function validateVisitTiming(input: Partial<VisitTiming>): Record<string, string> {
  // كل الحقول اختيارية — يُسمح بحفظ زيارة ناقصة، وتُفحص الصيغ فقط عند وجود قيمة
  const errors: Record<string, string> = {};
  if (trim(input.visitDate) && Number.isNaN(new Date(`${input.visitDate}T00:00:00`).getTime()))
    errors.visitDate = 'تاريخ الزيارة غير صالح';
  if (trim(input.departureTime) && !isTime(input.departureTime))
    errors.departureTime = 'توقيت التحرك: صيغة الوقت غير صحيحة (HH:MM)';
  if (trim(input.returnTime) && !isTime(input.returnTime))
    errors.returnTime = 'توقيت الرجوع: صيغة الوقت غير صحيحة (HH:MM)';
  return errors;
}

export async function saveVisitTiming(input: Partial<VisitTiming>): Promise<VisitTiming> {
  const errors = validateVisitTiming(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<VisitTiming>('visitTimings', input.id) : undefined;
  const record: VisitTiming = {
    id: input.id ?? uid('vt'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: (input.employeeId ?? '') as string,
    visitDate: trim(input.visitDate).slice(0, 10),
    branch: trim(input.branch),
    clientName: trim(input.clientName),
    location: trim(input.location),
    departureTime: trim(input.departureTime),
    returnTime: trim(input.returnTime),
    notes: trim(input.notes),
  };
  await putRecord('visitTimings', record);
  return record;
}

export async function deleteVisitTiming(id: string): Promise<void> {
  await deleteRecord('visitTimings', id);
}

/* ------------------------------ الملاحظات ------------------------------ */

export async function listObservations(): Promise<Observation[]> {
  const rows = await getAll<Observation>('observations');
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function validateObservation(input: Partial<Observation>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!isDate(input.date)) errors.date = 'تاريخ الملاحظة مطلوب';
  if (!trim(input.details)) errors.details = 'تفاصيل الملاحظة مطلوبة';
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
    employeeId: input.employeeId as string,
    date: input.date as string,
    source: input.source ?? 'ملاحظة مباشرة',
    branch: input.branch ?? '',
    reference: input.reference ?? '',
    category: input.category ?? '',
    severity: input.severity ?? 'medium',
    details: trim(input.details),
    correctiveAction: input.correctiveAction ?? '',
    notificationDate: input.notificationDate || null,
    status: input.status ?? 'open',
    resolutionDate: input.resolutionDate || null,
    recurrence: Boolean(input.recurrence),
    followUpNotes: input.followUpNotes ?? '',
  };
  await putRecord('observations', record);
  return record;
}

export async function deleteObservation(id: string): Promise<void> {
  await deleteRecord('observations', id);
}

/* --------------------------- الإجازات والأذونات ------------------------- */

export async function listLeaves(): Promise<Leave[]> {
  const rows = await getAll<Leave>('leaves');
  return rows.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

export function validateLeave(input: Partial<Leave>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'الموظف مطلوب';
  if (!trim(input.type)) errors.type = 'نوع الإجازة أو الإذن مطلوب';
  if (!isDate(input.startDate)) errors.startDate = 'تاريخ البداية مطلوب';
  if (!isDate(input.endDate)) errors.endDate = 'تاريخ النهاية مطلوب';
  else if (isDate(input.startDate) && new Date(input.endDate as string) < new Date(input.startDate as string))
    errors.endDate = 'تاريخ النهاية لا يسبق تاريخ البداية';
  const unit = input.unit ?? 'days';
  const value = unit === 'days' ? input.days : input.hours;
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    errors[unit === 'days' ? 'days' : 'hours'] = unit === 'days' ? 'عدد الأيام مطلوب' : 'عدد الساعات مطلوب';
  }
  return errors;
}

export async function saveLeave(input: Partial<Leave>): Promise<Leave> {
  const errors = validateLeave(input);
  if (Object.keys(errors).length) fail(errors);
  const current = input.id ? await getById<Leave>('leaves', input.id) : undefined;
  const unit = input.unit ?? 'days';
  const record: Leave = {
    id: input.id ?? uid('lev'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: input.employeeId as string,
    type: trim(input.type),
    startDate: input.startDate as string,
    endDate: input.endDate as string,
    unit,
    days: unit === 'days' ? Number(input.days) : null,
    hours: unit === 'hours' ? Number(input.hours) : null,
    notes: input.notes ?? '',
  };
  await putRecord('leaves', record);
  return record;
}

export async function deleteLeave(id: string): Promise<void> {
  await deleteRecord('leaves', id);
}

/* --------------------- الإجازات والأذونات الجديدة ---------------------- */

export async function listLeavePermissions(): Promise<LeavePermissionRecord[]> {
  const rows = await getAll<LeavePermissionRecord>('leavePermissions');
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function permissionMonthUsage(
  rows: LeavePermissionRecord[],
  employeeId: string,
  date: string,
  excludeId?: string,
): { entries: number; hours: number } {
  const month = date.slice(0, 7);
  return rows.reduce(
    (usage, row) => {
      if (
        row.id !== excludeId &&
        row.employeeId === employeeId &&
        row.requestType === 'permission' &&
        row.date.startsWith(month)
      ) {
        usage.entries += 1;
        usage.hours += row.durationHours === 2 ? 2 : row.durationHours === 1 ? 1 : 0;
      }
      return usage;
    },
    { entries: 0, hours: 0 },
  );
}

export async function saveLeavePermission(input: Partial<LeavePermissionRecord>): Promise<LeavePermissionRecord> {
  const errors: Record<string, string> = {};
  if (!input.employeeId) errors.employeeId = 'اختر الموظف لحساب ملخصه الشهري.';
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date ?? '');
  const validDate = dateParts ? new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))) : null;
  if (!dateParts || !validDate || validDate.getUTCFullYear() !== Number(dateParts[1]) || validDate.getUTCMonth() + 1 !== Number(dateParts[2]) || validDate.getUTCDate() !== Number(dateParts[3])) errors.date = 'اختر تاريخًا صحيحًا لحساب الشهر.';
  const validCategory =
    (input.requestType === 'leave' && ['إجازة اعتيادي', 'إجازة عارضة', 'إجازة بخصم'].includes(input.category ?? '')) ||
    (input.requestType === 'permission' && ['إذن انصرف', 'إذن حضور'].includes(input.category ?? ''));
  if (!validCategory) errors.category = 'اختر نوع الطلب الصحيح.';
  if (input.requestType === 'permission' && input.durationHours !== 1 && input.durationHours !== 2)
    errors.durationHours = 'اختر مدة الإذن.';
  if (Object.keys(errors).length) fail(errors);

  const rows = await getAll<LeavePermissionRecord>('leavePermissions');
  const current = input.id ? rows.find((row) => row.id === input.id) : undefined;
  const employeeId = input.employeeId as string;
  const date = input.date as string;
  if (input.requestType === 'permission') {
    const usage = permissionMonthUsage(rows, employeeId, date, input.id);
    const hours = input.durationHours as 1 | 2;
    const remainingEntries = Math.max(0, 4 - usage.entries);
    const remainingHours = Math.max(0, 4 - usage.hours);
    if (usage.entries + 1 > 4 || usage.hours + hours > 4) {
      const month = date.slice(5, 7);
      const year = date.slice(0, 4);
      fail({
        permissionLimit: `لا يمكن حفظ الإذن: المتبقي لهذا الموظف في ${month}/${year} هو ${remainingEntries} أذونات و${remainingHours} ساعات، والطلب يتجاوز الحد الشهري (4 أذونات و4 ساعات).`,
      });
    }
  }

  const record: LeavePermissionRecord = {
    id: input.id ?? uid('lp'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId,
    requestType: input.requestType as 'leave' | 'permission',
    category: input.category as LeavePermissionRecord['category'],
    date,
    durationHours: input.requestType === 'permission' ? (input.durationHours as 1 | 2) : null,
    notes: trim(input.notes),
  };
  await putRecord('leavePermissions', record);
  return record;
}

export async function deleteLeavePermission(id: string): Promise<void> {
  await deleteRecord('leavePermissions', id);
}

/* -------------------- تأخيرات الحضور والانصراف ------------------------- */

export async function listAttendanceRecords(): Promise<AttendanceRecord[]> {
  const rows = await getAll<AttendanceRecord>('attendanceRecords');
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function saveAttendanceRecord(input: Partial<AttendanceRecord>): Promise<AttendanceRecord> {
  const current = input.id ? await getById<AttendanceRecord>('attendanceRecords', input.id) : undefined;
  const normalizeTime = (value?: string) => (value && TIME_RE.test(value) ? value : '');
  const record: AttendanceRecord = {
    id: input.id ?? uid('att'),
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    employeeId: trim(input.employeeId),
    date: trim(input.date),
    arrivalTime: normalizeTime(input.arrivalTime),
    departureTime: normalizeTime(input.departureTime),
    notes: trim(input.notes),
  };
  await putRecord('attendanceRecords', record);
  return record;
}

export async function deleteAttendanceRecord(id: string): Promise<void> {
  await deleteRecord('attendanceRecords', id);
}
