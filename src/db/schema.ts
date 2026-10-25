/**
 * نموذج البيانات — كل السجلات تُدخل يدويًا وتُحفظ محليًا في IndexedDB داخل متصفح المستخدم.
 */

export type ID = string;

export interface BaseRecord {
  id: ID;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------- الموظفون ------------------------------- */

export interface Employee extends BaseRecord {
  /** الرقم التسلسلي (رقم صحيح متسلسل) */
  serial: number;
  sector: string;
  governorate: string;
  name: string;
  code: string;
  jobTitle: string;
  joiningDate: string;
  /** عدد الزيارات (إدخال يدوي — قد يختلف عن الزيارات المسجلة في النظام) */
  visitCount: number | null;
  notes: string;
  archived?: boolean;
}

/* ----------------------------- دقائق الصرف ----------------------------- */

export type MinuteStatus = 'open' | 'completed' | 'cancelled';

export interface Minute extends BaseRecord {
  refNo: string;
  employeeId: ID | null;
  /** الفرع / مرجع العميل */
  branchRef: string;
  /** وقت ورود الدقيقة */
  receivedAt: string;
  fileRequestedAt: string | null;
  fileReceivedAt: string | null;
  reviewStartedAt: string | null;
  finalResponseAt: string | null;
  status: MinuteStatus;
  observations: string;
  /** سبب التأخير (يُكتب يدويًا) */
  delayReason: string;
}

/* ------------------------ الزيارات ومراجعة التقارير ---------------------- */

export type VisitStatus = 'in_progress' | 'report_pending' | 'completed' | 'cancelled';
export type ReviewOutcome = 'pending' | 'accepted' | 'corrections' | 'rejected';

export interface ReviewCycle {
  id: ID;
  seq: number;
  /** وقت المراجعة لهذه الدورة */
  reviewedAt: string;
  observations: string;
  corrections: string;
  outcome: ReviewOutcome;
}

export interface Visit extends BaseRecord {
  refNo: string;
  employeeId: ID | null;
  /** الفرع / مرجع العميل */
  branchRef: string;
  departureAt: string | null;
  arrivalAt: string | null;
  /** وقت إتمام الزيارة */
  completedAt: string | null;
  returnAt: string | null;
  reportSubmittedAt: string | null;
  reportReviewedAt: string | null;
  finalEmailAt: string | null;
  status: VisitStatus;
  reviewCycles: ReviewCycle[];
  observations: string;
}

/* ------------------------------- الملاحظات ------------------------------ */

export type ObservationStatus = 'open' | 'closed';

export interface Observation extends BaseRecord {
  employeeId: ID | null;
  minuteId: ID | null;
  visitId: ID | null;
  /** دورة المراجعة المرتبطة (مراجعة تقرير) */
  cycleId: ID | null;
  /** YYYY-MM-DD */
  date: string;
  type: string;
  text: string;
  status: ObservationStatus;
  resolution: string;
}

/* ------------------------------- التقييمات ------------------------------ */

export const EVALUATION_CRITERIA = [
  { id: 'k1', name: 'دقة الفحص والمتابعة وإتمام الزيارات' },
  { id: 'k2', name: 'دقة التقارير وجودتها وسرعة الاستجابة' },
  { id: 'k3', name: 'متابعة الفروع ودقائق الصرف اليومية' },
  { id: 'k4', name: 'الالتزام بالزيارات والفحص العشوائي ومواعيد الاستجابة' },
  { id: 'k5', name: 'الالتزام بالسياسات والإجراءات' },
  { id: 'k6', name: 'الحضور والانتظام' },
  { id: 'k7', name: 'التطوير الذاتي' },
  { id: 'k8', name: 'التعاون والعمل الجماعي' },
] as const;

export type CriterionId = (typeof EVALUATION_CRITERIA)[number]['id'];

export type EvaluationScores = Partial<Record<CriterionId, number | null>>;
export type EvaluationComments = Partial<Record<CriterionId, string>>;

export interface Evaluation extends BaseRecord {
  employeeId: ID | null;
  periodType: 'monthly' | 'annual';
  year: number;
  month: number | null;
  scores: EvaluationScores;
  comments: EvaluationComments;
  overallComment: string;
}

/* -------------------------------- الإعدادات ----------------------------- */

export interface AppSettings {
  organizationName: string;
  teamLeaderName: string;
  /** مهلة مراجعة الدقيقة والتقرير بالدقائق */
  deadlineMinutes: number;
  sectors: string[];
  governorates: string[];
  observationTypes: string[];
  updatedAt: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  organizationName: 'شركة التمويل الأصغر',
  teamLeaderName: '',
  deadlineMinutes: 60,
  sectors: ['قطاع القاهرة', 'قطاع الدلتا', 'قطاع الصعيد'],
  governorates: ['القاهرة', 'الجيزة', 'الغربية', 'المنوفية', 'أسيوط', 'سوهاج'],
  observationTypes: ['مستندات', 'إجراء', 'تأخير', 'جودة تقرير', 'سلوك مهني', 'أخرى'],
  updatedAt: new Date().toISOString(),
};

export const MINUTE_STATUS_LABELS: Record<MinuteStatus, string> = {
  open: 'قيد المتابعة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  in_progress: 'جارية',
  report_pending: 'بانتظار التقرير',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const REVIEW_OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  pending: 'بانتظار النتيجة',
  accepted: 'مقبول',
  corrections: 'يحتاج تصحيح',
  rejected: 'مرفوض',
};

export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
};

export const DB_NAME = 'risk-officer-tracker';
export const DB_VERSION = 1;

export const STORE_NAMES = ['employees', 'minutes', 'visits', 'observations', 'evaluations', 'settings', 'meta'] as const;
export type StoreName = (typeof STORE_NAMES)[number];
export type EntityName = 'employees' | 'minutes' | 'visits' | 'observations' | 'evaluations';

export const ENTITY_LABELS: Record<EntityName, string> = {
  employees: 'الموظفون',
  minutes: 'دقائق الصرف',
  visits: 'الزيارات',
  observations: 'الملاحظات',
  evaluations: 'التقييمات',
};

export const RATING_MIN = 1;
export const RATING_MAX = 5;
