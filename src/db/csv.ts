import type {
  Branch,
  DisbursementMinute,
  Employee,
  EntityName,
  Evaluation,
  FieldVisit,
  Observation,
} from './schema';
import {
  EMPLOYEE_STATUS_LABELS,
  MINUTE_OUTCOME_LABELS,
  MINUTE_STATUS_LABELS,
  OBSERVATION_SOURCE_LABELS,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  VISIT_STATUS_LABELS,
} from './schema';

/* ------------------------------------------------------------------ */
/* أدوات CSV عامة                                                     */
/* ------------------------------------------------------------------ */

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  // BOM لضمان ظهور العربية بشكل صحيح في Excel
  return `\ufeff${lines.join('\r\n')}`;
}

/** محلل CSV يدعم علامات التنصيص والأسطر المتعددة و BOM */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char === '\r') {
      // تجاهل
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function csvToObjects(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const table = parseCsv(text);
  if (!table.length) return { headers: [], rows: [] };
  const headers = table[0].map((h) => h.trim());
  const rows = table.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = (cells[index] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

/* ------------------------------------------------------------------ */
/* تعريف أعمدة التصدير/الاستيراد                                       */
/* ------------------------------------------------------------------ */

export interface EntitySchema<T> {
  entity: EntityName;
  label: string;
  columns: Array<{
    header: string;
    get: (row: T, ctx: LookupContext) => string;
    set?: (raw: string, target: Record<string, unknown>, ctx: LookupContext) => void;
    required?: boolean;
    aliases?: string[];
  }>;
}

export interface LookupContext {
  employees: Employee[];
  branches: Branch[];
  categories?: Array<{ id: string; name: string }>;
}

const iso = (value?: string | null) => (value ? new Date(value).toISOString() : '');
const dateOnly = (value?: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : '');

function findByName<T extends { id: string; name: string }>(rows: T[], name: string): T | undefined {
  const normalized = name.trim();
  return rows.find((r) => r.name.trim() === normalized || r.id === normalized);
}

function toNumber(raw: string): number | null {
  if (!raw?.trim()) return null;
  const value = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isNaN(value) ? null : value;
}

export const EMPLOYEE_SCHEMA: EntitySchema<Employee> = {
  entity: 'employees',
  label: 'الموظفون',
  columns: [
    { header: 'الرقم الوظيفي', get: (e) => e.employeeCode, set: (v, t) => (t.employeeCode = v), required: true, aliases: ['employeeCode', 'code'] },
    { header: 'الاسم', get: (e) => e.fullName, set: (v, t) => (t.fullName = v), required: true, aliases: ['fullName', 'name'] },
    { header: 'المسمى الوظيفي', get: (e) => e.jobTitle, set: (v, t) => (t.jobTitle = v), aliases: ['jobTitle'] },
    {
      header: 'الفرع',
      get: (e, ctx) => ctx.branches.find((b) => b.id === e.branchId)?.name ?? '',
      set: (v, t, ctx) => {
        const branch = findByName(ctx.branches, v);
        t.branchId = branch?.id ?? null;
      },
      aliases: ['branch', 'branchName'],
    },
    { header: 'المحافظة', get: (e) => e.governorate, set: (v, t) => (t.governorate = v), aliases: ['governorate'] },
    { header: 'تاريخ التعيين', get: (e) => dateOnly(e.hireDate), set: (v, t) => (t.hireDate = v), aliases: ['hireDate'] },
    { header: 'الحالة', get: (e) => EMPLOYEE_STATUS_LABELS[e.status] ?? e.status, set: (v, t) => (t.status = reverseLabel(EMPLOYEE_STATUS_LABELS, v) ?? 'active'), aliases: ['status'] },
    { header: 'الهاتف', get: (e) => e.phone ?? '', set: (v, t) => (t.phone = v), aliases: ['phone'] },
    { header: 'البريد الإلكتروني', get: (e) => e.email ?? '', set: (v, t) => (t.email = v), aliases: ['email'] },
    { header: 'ملاحظات', get: (e) => e.notes ?? '', set: (v, t) => (t.notes = v), aliases: ['notes'] },
  ],
};

export const MINUTE_SCHEMA: EntitySchema<DisbursementMinute> = {
  entity: 'minutes',
  label: 'دقائق الصرف',
  columns: [
    { header: 'رقم الدقيقة', get: (m) => m.refNo, set: (v, t) => (t.refNo = v), aliases: ['refNo'] },
    { header: 'الفرع', get: (m, ctx) => ctx.branches.find((b) => b.id === m.branchId)?.name ?? '', set: (v, t, ctx) => (t.branchId = findByName(ctx.branches, v)?.id ?? null), aliases: ['branch'] },
    { header: 'ضابط المخاطر', get: (m, ctx) => ctx.employees.find((e) => e.id === m.employeeId)?.fullName ?? '', set: (v, t, ctx) => (t.employeeId = resolveEmployee(v, ctx)), required: true, aliases: ['officer', 'employee'] },
    { header: 'مرجع العميل', get: (m) => m.clientRef, set: (v, t) => (t.clientRef = v), required: true, aliases: ['clientRef'] },
    { header: 'نوع التمويل', get: (m) => m.financingType, set: (v, t) => (t.financingType = v), aliases: ['financingType'] },
    { header: 'المبلغ', get: (m) => (m.amount === null ? '' : String(m.amount)), set: (v, t) => (t.amount = toNumber(v)), aliases: ['amount'] },
    { header: 'النتيجة', get: (m) => MINUTE_OUTCOME_LABELS[m.outcome] ?? m.outcome, set: (v, t) => (t.outcome = reverseLabel(MINUTE_OUTCOME_LABELS, v) ?? 'pending'), aliases: ['outcome'] },
    { header: 'الحالة', get: (m) => MINUTE_STATUS_LABELS[m.status] ?? m.status, set: (v, t) => (t.status = reverseLabel(MINUTE_STATUS_LABELS, v) ?? 'pending'), aliases: ['status'] },
    { header: 'وقت الاستلام', get: (m) => iso(m.receivedAt), set: (v, t) => (t.receivedAt = v ? new Date(v).toISOString() : null), aliases: ['receivedAt'] },
    { header: 'طلب الملف', get: (m) => iso(m.fileRequestedAt), set: (v, t) => (t.fileRequestedAt = v ? new Date(v).toISOString() : null), aliases: ['fileRequestedAt'] },
    { header: 'استلام الملف', get: (m) => iso(m.fileReceivedAt), set: (v, t) => (t.fileReceivedAt = v ? new Date(v).toISOString() : null), aliases: ['fileReceivedAt'] },
    { header: 'بدء المراجعة', get: (m) => iso(m.reviewStartedAt), set: (v, t) => (t.reviewStartedAt = v ? new Date(v).toISOString() : null), aliases: ['reviewStartedAt'] },
    { header: 'طلب الاستيضاح', get: (m) => iso(m.clarificationRequestedAt), set: (v, t) => (t.clarificationRequestedAt = v ? new Date(v).toISOString() : null), aliases: ['clarificationRequestedAt'] },
    { header: 'الرد على الاستيضاح', get: (m) => iso(m.clarificationRespondedAt), set: (v, t) => (t.clarificationRespondedAt = v ? new Date(v).toISOString() : null), aliases: ['clarificationRespondedAt'] },
    { header: 'الرد النهائي', get: (m) => iso(m.finalResponseAt), set: (v, t) => (t.finalResponseAt = v ? new Date(v).toISOString() : null), aliases: ['finalResponseAt'] },
    { header: 'ملاحظات', get: (m) => m.notes ?? '', set: (v, t) => (t.notes = v), aliases: ['notes'] },
  ],
};

export const VISIT_SCHEMA: EntitySchema<FieldVisit> = {
  entity: 'visits',
  label: 'الزيارات الميدانية',
  columns: [
    { header: 'رقم الزيارة', get: (v) => v.refNo, set: (v, t) => (t.refNo = v), aliases: ['refNo'] },
    { header: 'ضابط المخاطر', get: (v, ctx) => ctx.employees.find((e) => e.id === v.employeeId)?.fullName ?? '', set: (v, t, ctx) => (t.employeeId = resolveEmployee(v, ctx)), required: true, aliases: ['officer'] },
    { header: 'الفرع', get: (v, ctx) => ctx.branches.find((b) => b.id === v.branchId)?.name ?? '', set: (v, t, ctx) => (t.branchId = findByName(ctx.branches, v)?.id ?? null), aliases: ['branch'] },
    { header: 'مرجع العميل', get: (v) => v.clientRef, set: (v, t) => (t.clientRef = v), required: true, aliases: ['clientRef'] },
    { header: 'تاريخ الزيارة', get: (v) => v.visitDate, set: (v, t) => (t.visitDate = v), required: true, aliases: ['visitDate'] },
    { header: 'الحالة', get: (v) => VISIT_STATUS_LABELS[v.status] ?? v.status, set: (v, t) => (t.status = reverseLabel(VISIT_STATUS_LABELS, v) ?? 'planned'), aliases: ['status'] },
    { header: 'جودة التقرير', get: (v) => (v.qualityScore === null ? '' : String(v.qualityScore)), set: (v, t) => (t.qualityScore = toNumber(v)), aliases: ['qualityScore'] },
    { header: 'وقت التحرك', get: (v) => iso(v.departureAt), set: (v, t) => (t.departureAt = v ? new Date(v).toISOString() : null), aliases: ['departureAt'] },
    { header: 'وقت الوصول', get: (v) => iso(v.arrivalAt), set: (v, t) => (t.arrivalAt = v ? new Date(v).toISOString() : null), aliases: ['arrivalAt'] },
    { header: 'وقت الفحص', get: (v) => iso(v.inspectionAt), set: (v, t) => (t.inspectionAt = v ? new Date(v).toISOString() : null), aliases: ['inspectionAt'] },
    { header: 'وقت العودة', get: (v) => iso(v.returnAt), set: (v, t) => (t.returnAt = v ? new Date(v).toISOString() : null), aliases: ['returnAt'] },
    { header: 'تسليم التقرير', get: (v) => iso(v.reportSubmittedAt), set: (v, t) => (t.reportSubmittedAt = v ? new Date(v).toISOString() : null), aliases: ['reportSubmittedAt'] },
    { header: 'مراجعة المشرف', get: (v) => iso(v.supervisorReviewAt), set: (v, t) => (t.supervisorReviewAt = v ? new Date(v).toISOString() : null), aliases: ['supervisorReviewAt'] },
    { header: 'التصحيحات', get: (v) => iso(v.correctionsAt), set: (v, t) => (t.correctionsAt = v ? new Date(v).toISOString() : null), aliases: ['correctionsAt'] },
    { header: 'إعادة التسليم', get: (v) => iso(v.resubmittedAt), set: (v, t) => (t.resubmittedAt = v ? new Date(v).toISOString() : null), aliases: ['resubmittedAt'] },
    { header: 'البريد النهائي', get: (v) => iso(v.finalEmailAt), set: (v, t) => (t.finalEmailAt = v ? new Date(v).toISOString() : null), aliases: ['finalEmailAt'] },
    { header: 'التغذية الراجعة', get: (v) => v.feedback ?? '', set: (v, t) => (t.feedback = v), aliases: ['feedback'] },
    { header: 'المهام المعلقة', get: (v) => v.pendingActions ?? '', set: (v, t) => (t.pendingActions = v), aliases: ['pendingActions'] },
  ],
};

export const OBSERVATION_SCHEMA: EntitySchema<Observation> = {
  entity: 'observations',
  label: 'الملاحظات',
  columns: [
    { header: 'رقم الملاحظة', get: (o) => o.refNo, set: (v, t) => (t.refNo = v), aliases: ['refNo'] },
    { header: 'الموظف', get: (o, ctx) => ctx.employees.find((e) => e.id === o.employeeId)?.fullName ?? '', set: (v, t, ctx) => (t.employeeId = resolveEmployee(v, ctx)), required: true, aliases: ['employee'] },
    { header: 'التاريخ', get: (o) => o.date, set: (v, t) => (t.date = v), required: true, aliases: ['date'] },
    { header: 'التصنيف', get: (o, ctx) => ctx.categories?.find((c) => c.id === o.categoryId)?.name ?? o.categoryId, set: (v, t, ctx) => (t.categoryId = ctx.categories?.find((c) => c.name === v)?.id ?? v), aliases: ['category'] },
    { header: 'الخطورة', get: (o) => SEVERITY_LABELS[o.severity] ?? o.severity, set: (v, t) => (t.severity = reverseLabel(SEVERITY_LABELS, v) ?? 'medium'), aliases: ['severity'] },
    { header: 'المصدر', get: (o) => OBSERVATION_SOURCE_LABELS[o.source] ?? o.source, set: (v, t) => (t.source = reverseLabel(OBSERVATION_SOURCE_LABELS, v) ?? 'review'), aliases: ['source'] },
    { header: 'الوصف', get: (o) => o.description, set: (v, t) => (t.description = v), required: true, aliases: ['description'] },
    { header: 'الإجراء التصحيحي', get: (o) => o.correctiveAction ?? '', set: (v, t) => (t.correctiveAction = v), aliases: ['correctiveAction'] },
    { header: 'تاريخ الإخطار', get: (o) => dateOnly(o.notifiedAt), set: (v, t) => (t.notifiedAt = v ? new Date(v).toISOString() : null), aliases: ['notifiedAt'] },
    { header: 'متكررة', get: (o) => (o.isRecurring ? 'نعم' : 'لا'), set: (v, t) => (t.isRecurring = v === 'نعم' || v.toLowerCase() === 'yes' || v === 'true'), aliases: ['isRecurring'] },
    { header: 'الحالة', get: (o) => OBSERVATION_STATUS_LABELS[o.status] ?? o.status, set: (v, t) => (t.status = reverseLabel(OBSERVATION_STATUS_LABELS, v) ?? 'open'), aliases: ['status'] },
    { header: 'تاريخ المعالجة', get: (o) => dateOnly(o.resolvedAt), set: (v, t) => (t.resolvedAt = v ? new Date(v).toISOString() : null), aliases: ['resolvedAt'] },
  ],
};

export const EVALUATION_SCHEMA: EntitySchema<Evaluation> = {
  entity: 'evaluations',
  label: 'التقييمات',
  columns: [
    { header: 'الموظف', get: (e, ctx) => ctx.employees.find((x) => x.id === e.employeeId)?.fullName ?? '', set: (v, t, ctx) => (t.employeeId = resolveEmployee(v, ctx)), required: true, aliases: ['employee'] },
    { header: 'نوع الفترة', get: (e) => (e.periodType === 'annual' ? 'سنوي' : 'شهري'), set: (v, t) => (t.periodType = v === 'سنوي' || v === 'annual' ? 'annual' : 'monthly'), aliases: ['periodType'] },
    { header: 'السنة', get: (e) => String(e.year), set: (v, t) => (t.year = Number(v)), required: true, aliases: ['year'] },
    { header: 'الشهر', get: (e) => (e.month ? String(e.month) : ''), set: (v, t) => (t.month = v ? Number(v) : null), aliases: ['month'] },
    { header: 'الحالة', get: (e) => (e.status === 'approved' ? 'معتمد' : 'مسودة'), set: (v, t) => (t.status = v === 'معتمد' || v === 'approved' ? 'approved' : 'draft'), aliases: ['status'] },
    { header: 'ملاحظة عامة', get: (e) => e.overallComment ?? '', set: (v, t) => (t.overallComment = v), aliases: ['overallComment'] },
  ],
};

function reverseLabel<K extends string>(labels: Record<K, string>, value: string): K | undefined {
  const entry = (Object.entries(labels) as Array<[K, string]>).find(([key, label]) => label === value || key === value);
  return entry?.[0];
}

function resolveEmployee(name: string, ctx: LookupContext): string | null {
  const normalized = name.trim();
  const byName = ctx.employees.find((e) => e.fullName.trim() === normalized);
  if (byName) return byName.id;
  const byCode = ctx.employees.find((e) => e.employeeCode.trim() === normalized);
  if (byCode) return byCode.id;
  return ctx.employees.find((e) => e.id === normalized)?.id ?? null;
}

export const SCHEMAS = {
  employees: EMPLOYEE_SCHEMA,
  minutes: MINUTE_SCHEMA,
  visits: VISIT_SCHEMA,
  observations: OBSERVATION_SCHEMA,
  evaluations: EVALUATION_SCHEMA,
} as const;

export type CsvEntity = keyof typeof SCHEMAS;

/** تصدير صفوف كيان إلى CSV */
export function exportEntityCsv<T extends { id: string; deletedAt?: string | null; isDemo?: boolean }>(
  entity: CsvEntity,
  rows: T[],
  ctx: LookupContext,
  options: { includeDemo?: boolean } = {},
): string {
  const schema = SCHEMAS[entity] as unknown as EntitySchema<T>;
  const filtered = rows.filter((row) => !row.deletedAt && (options.includeDemo || !row.isDemo));
  const headers = schema.columns.map((c) => c.header);
  const body = filtered.map((row) => schema.columns.map((c) => c.get(row, ctx)));
  return toCsv(headers, body);
}

export interface CsvImportResult {
  entity: CsvEntity;
  total: number;
  accepted: Array<Record<string, unknown>>;
  errors: Array<{ row: number; message: string }>;
  warnings: Array<{ row: number; message: string }>;
}

/** تحليل ملف CSV إلى كائنات جاهزة للحفظ (بدون حفظ) */
export function parseEntityCsv(entity: CsvEntity, text: string, ctx: LookupContext): CsvImportResult {
  const schema = SCHEMAS[entity] as unknown as EntitySchema<Record<string, unknown>>;
  const { headers, rows } = csvToObjects(text);
  const errors: Array<{ row: number; message: string }> = [];
  const warnings: Array<{ row: number; message: string }> = [];
  const accepted: Array<Record<string, unknown>> = [];

  if (!headers.length) {
    return { entity, total: 0, accepted, errors: [{ row: 0, message: 'الملف فارغ أو غير صالح.' }], warnings };
  }

  const headerMap = new Map<string, string>();
  for (const column of schema.columns) {
    const candidates = [column.header, ...(column.aliases ?? [])];
    const found = headers.find((h) => candidates.includes(h));
    if (found) headerMap.set(column.header, found);
    else if (column.required) errors.push({ row: 0, message: `العمود المطلوب «${column.header}» غير موجود في الملف.` });
  }

  if (errors.length) return { entity, total: rows.length, accepted, errors, warnings };

  rows.forEach((row, index) => {
    const target: Record<string, unknown> = {};
    for (const column of schema.columns) {
      const header = headerMap.get(column.header);
      if (!header || !column.set) continue;
      const raw = row[header] ?? '';
      if (column.required && !raw.trim()) {
        errors.push({ row: index + 2, message: `الحقل «${column.header}» مطلوب.` });
        return;
      }
      column.set(raw, target, ctx);
    }
    if (entity === 'minutes' && !target.employeeId) {
      errors.push({ row: index + 2, message: 'ضابط المخاطر غير موجود في النظام — أنشئ الموظف أولًا.' });
      return;
    }
    if ((entity === 'visits' || entity === 'observations' || entity === 'evaluations') && !target.employeeId) {
      errors.push({ row: index + 2, message: 'الموظف غير موجود في النظام — أنشئ الموظف أولًا.' });
      return;
    }
    if (entity === 'minutes' && !target.receivedAt) {
      warnings.push({ row: index + 2, message: 'وقت الاستلام غير موجود؛ سيُستخدم وقت الاستيراد.' });
    }
    accepted.push(target);
  });

  return { entity, total: rows.length, accepted, errors, warnings };
}
