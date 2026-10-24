/**
 * تعريف أنواع البيانات والثوابت الافتراضية للنظام.
 * كل السجلات تُحفظ محليًا في IndexedDB داخل متصفح المستخدم.
 */

export type ID = string;

export type EmployeeStatus = 'active' | 'inactive' | 'archived';

export type MinuteStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type MinuteOutcome = 'approved' | 'rejected' | 'returned' | 'pending';

export type VisitStatus = 'planned' | 'in_progress' | 'report_pending' | 'under_review' | 'completed' | 'cancelled';

export type ObservationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ObservationStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';
export type ObservationSource = 'review' | 'visit' | 'supervisor' | 'audit' | 'self' | 'other';

export type EvaluationStatus = 'draft' | 'approved';

export interface BaseRecord {
  id: ID;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  /** سجلات البيانات التجريبية معزولة تمامًا عن السجلات الفعلية */
  isDemo?: boolean;
}

export interface Branch extends BaseRecord {
  code: string;
  name: string;
  governorate: string;
}

export interface Employee extends BaseRecord {
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  branchId: ID | null;
  governorate: string;
  hireDate: string;
  endDate?: string | null;
  status: EmployeeStatus;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface DisbursementMinute extends BaseRecord {
  refNo: string;
  branchId: ID | null;
  employeeId: ID | null;
  clientRef: string;
  financingType: string;
  amount: number | null;
  outcome: MinuteOutcome;
  status: MinuteStatus;
  receivedAt: string;
  fileRequestedAt?: string | null;
  fileReceivedAt?: string | null;
  reviewStartedAt?: string | null;
  clarificationRequestedAt?: string | null;
  clarificationRespondedAt?: string | null;
  finalResponseAt?: string | null;
  notes?: string;
}

export interface ReviewCycle {
  id: ID;
  cycleNo: number;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  correctionsRequestedAt?: string | null;
  correctionsNotes?: string;
  resubmittedAt?: string | null;
  qualityScore: number | null;
  feedback?: string;
  finalEmailAt?: string | null;
}

export interface FieldVisit extends BaseRecord {
  refNo: string;
  employeeId: ID | null;
  branchId: ID | null;
  clientRef: string;
  visitDate: string;
  departureAt?: string | null;
  arrivalAt?: string | null;
  inspectionAt?: string | null;
  returnAt?: string | null;
  reportSubmittedAt?: string | null;
  supervisorReviewAt?: string | null;
  correctionsAt?: string | null;
  resubmittedAt?: string | null;
  finalEmailAt?: string | null;
  status: VisitStatus;
  qualityScore: number | null;
  feedback?: string;
  pendingActions?: string;
  reviewCycles: ReviewCycle[];
  notes?: string;
}

export interface ObservationFollowUp {
  id: ID;
  date: string;
  note: string;
  by?: string;
  createdAt: string;
}

export interface Observation extends BaseRecord {
  refNo: string;
  employeeId: ID | null;
  branchId: ID | null;
  minuteId?: ID | null;
  visitId?: ID | null;
  date: string;
  categoryId: string;
  severity: ObservationSeverity;
  source: ObservationSource;
  description: string;
  correctiveAction?: string;
  notifiedAt?: string | null;
  isRecurring: boolean;
  recurrenceOfId?: ID | null;
  status: ObservationStatus;
  resolvedAt?: string | null;
  followUps: ObservationFollowUp[];
}

export interface EvaluationScores {
  [criterionId: string]: number | null;
}

export interface Evaluation extends BaseRecord {
  employeeId: ID | null;
  periodType: 'monthly' | 'annual';
  year: number;
  month: number | null;
  scores: EvaluationScores;
  comments: { [criterionId: string]: string };
  overallComment?: string;
  status: EvaluationStatus;
  approvedAt?: string | null;
  unlockReason?: string | null;
  unlockedAt?: string | null;
  derivedFromMonthly?: boolean;
}

export interface AuditEntry {
  id?: number;
  at: string;
  action: string;
  entity: string;
  entityId: string;
  entityLabel?: string;
  summary: string;
  isDemo?: boolean;
}

export interface ObservationCategory {
  id: string;
  name: string;
  active: boolean;
}

export interface EvaluationCriterion {
  id: string;
  name: string;
  active: boolean;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface AppSettings {
  organizationName: string;
  departmentName: string;
  minutesDeadlineMinutes: number;
  deadlineWarnPercent: number;
  workingHours: { start: string; end: string };
  /** 0 = الأحد … 6 = السبت */
  workingDays: number[];
  holidays: Holiday[];
  observationCategories: ObservationCategory[];
  evaluationCriteria: EvaluationCriterion[];
  ratingScale: { min: number; max: number };
  thresholds: {
    complianceTargetPercent: number;
    visitTargetPerMonth: number;
    reportDelayWarnHours: number;
    repeatedObservationWindowDays: number;
    lowQualityWarnBelow: number;
  };
  updatedAt: string;
}

export const FINANCING_TYPES = [
  'تمويل مشروع صغير',
  'تمويل مشروع متوسط',
  'تمويل قائمة',
  'تمويل موسمي',
  'تمويل توسعي',
  'إعادة تمويل',
] as const;

export const MINUTE_OUTCOME_LABELS: Record<MinuteOutcome, string> = {
  approved: 'موافقة',
  rejected: 'رفض',
  returned: 'إعادة للفرع',
  pending: 'قيد المراجعة',
};

export const MINUTE_STATUS_LABELS: Record<MinuteStatus, string> = {
  pending: 'بانتظار المراجعة',
  in_progress: 'قيد المراجعة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  planned: 'مخططة',
  in_progress: 'جارية',
  report_pending: 'بانتظار التقرير',
  under_review: 'قيد المراجعة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const SEVERITY_LABELS: Record<ObservationSeverity, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  resolved: 'تمت المعالجة',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
};

export const OBSERVATION_SOURCE_LABELS: Record<ObservationSource, string> = {
  review: 'مراجعة دقيقة',
  visit: 'زيارة ميدانية',
  supervisor: 'ملاحظة مشرف',
  audit: 'مراجعة داخلية',
  self: 'تقييم ذاتي',
  other: 'أخرى',
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'على رأس العمل',
  inactive: 'غير نشط',
  archived: 'مؤرشف',
};

export const DEFAULT_CRITERIA: EvaluationCriterion[] = [
  { id: 'c1', name: 'دقة واستيفاء المراجعات والزيارات', active: true },
  { id: 'c2', name: 'جودة التقارير وسرعة الاستجابة', active: true },
  { id: 'c3', name: 'متابعة الفروع والدقائق اليومية', active: true },
  { id: 'c4', name: 'الزيارات الميدانية والالتزام بالمواعيد', active: true },
  { id: 'c5', name: 'الالتزام بالسياسات والإجراءات الإدارية', active: true },
  { id: 'c6', name: 'الانتظام والحضور', active: true },
  { id: 'c7', name: 'التطوير الذاتي', active: true },
  { id: 'c8', name: 'العمل الجماعي', active: true },
];

export const DEFAULT_CATEGORIES: ObservationCategory[] = [
  { id: 'cat1', name: 'نقص مستندات', active: true },
  { id: 'cat2', name: 'مخالفة إجراء', active: true },
  { id: 'cat3', name: 'تأخر في التنفيذ', active: true },
  { id: 'cat4', name: 'جودة تقرير', active: true },
  { id: 'cat5', name: 'تعامل مع العميل', active: true },
  { id: 'cat6', name: 'التزام ميداني', active: true },
  { id: 'cat7', name: 'أخرى', active: true },
];

export const DEFAULT_SETTINGS: AppSettings = {
  organizationName: 'شركة التمويل الأصغر',
  departmentName: 'إدارة المخاطر',
  minutesDeadlineMinutes: 60,
  deadlineWarnPercent: 80,
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4], // الأحد إلى الخميس
  holidays: [],
  observationCategories: DEFAULT_CATEGORIES,
  evaluationCriteria: DEFAULT_CRITERIA,
  ratingScale: { min: 1, max: 5 },
  thresholds: {
    complianceTargetPercent: 0,
    visitTargetPerMonth: 0,
    reportDelayWarnHours: 48,
    repeatedObservationWindowDays: 30,
    lowQualityWarnBelow: 3,
  },
  updatedAt: new Date().toISOString(),
};

export const DB_NAME = 'risk-officer-management';
export const DB_VERSION = 3;

export const STORE_NAMES = [
  'employees',
  'branches',
  'minutes',
  'visits',
  'observations',
  'evaluations',
  'audit',
  'settings',
  'meta',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export type EntityName =
  | 'employees'
  | 'branches'
  | 'minutes'
  | 'visits'
  | 'observations'
  | 'evaluations';

export const ENTITY_LABELS: Record<EntityName, string> = {
  employees: 'موظف',
  branches: 'فرع',
  minutes: 'دقيقة صرف',
  visits: 'زيارة ميدانية',
  observations: 'ملاحظة',
  evaluations: 'تقييم',
};
