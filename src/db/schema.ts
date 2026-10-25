/**
 * نموذج البيانات — نسخة مبسطة تشبه ملف الإكسل.
 * كل السجلات تُدخل يدويًا وتُخزَّن محليًا في IndexedDB داخل متصفح المستخدم.
 */

export type ID = string;

export interface BaseRecord {
  id: ID;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------- الموظفون ------------------------------- */

export type EmployeeStatus = 'active' | 'inactive';

export interface Employee extends BaseRecord {
  /** الرقم */
  employeeNo: number;
  name: string;
  code: string;
  sector: string;
  governorate: string;
  jobTitle: string;
  /** تاريخ التعيين YYYY-MM-DD */
  employmentDate: string;
  /** الفرع أو الفروع المكلف بها (نص حر، يُفصل بفاصلة) */
  branches: string;
  status: EmployeeStatus;
  archived: boolean;
  notes: string;
}

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'على رأس العمل',
  inactive: 'غير نشط',
};

/* --------------------------- معايير التقييم ---------------------------- */

/** المعايير الثمانية كما في ملف الإكسل — بنفس الأسماء والمعنى */
export const EVALUATION_CRITERIA = [
  { id: 'c1', name: 'دقة الفحص والمتابعة وإتمام الزيارات الميدانية' },
  { id: 'c2', name: 'دقة التقارير وجودتها وسرعة الاستجابة' },
  { id: 'c3', name: 'متابعة الفروع ودقائق الصرف اليومية' },
  { id: 'c4', name: 'الالتزام بالزيارات والفحص العشوائي ومواعيد الاستجابة' },
  { id: 'c5', name: 'الالتزام بالسياسات والإجراءات والقرارات الإدارية' },
  { id: 'c6', name: 'الحضور والانتظام' },
  { id: 'c7', name: 'التطوير الذاتي وتنمية المهارات' },
  { id: 'c8', name: 'التعاون والعمل الجماعي' },
] as const;

export type CriterionId = (typeof EVALUATION_CRITERIA)[number]['id'];
export type CriterionScores = Partial<Record<CriterionId, number | null>>;

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/* ------------------------- التقييم الشهري ----------------------------- */

export interface MonthlyEvaluation extends BaseRecord {
  employeeId: ID;
  year: number;
  /** 1..12 */
  month: number;
  /** عدد الزيارات الميدانية خلال الشهر (إدخال يدوي) */
  visits: number | null;
  scores: CriterionScores;
  /** ملاحظات حرة طويلة: أخطاء، ملاحظات متكررة، ملاحظات على الأداء */
  notes: string;
}

/* ------------------------- التقييم السنوي ----------------------------- */

export interface AnnualNote extends BaseRecord {
  employeeId: ID;
  year: number;
  notes: string;
}

/** عتبات التقييم السنوي كما هي في ملف الإكسل */
export interface RatingThreshold {
  /** الحد الأدنى للنقاط (شامل) */
  min: number;
  label: string;
}

export const DEFAULT_RATING_THRESHOLDS: RatingThreshold[] = [
  { min: 430, label: 'ممتاز' },
  { min: 330, label: 'جيد جدًا' },
  { min: 280, label: 'جيد' },
  { min: 240, label: 'مقبول' },
  { min: 0, label: 'ضعيف' },
];

/* --------------------------- الزيارات الميدانية ------------------------- */

export type VisitStatus = 'completed' | 'report_pending' | 'cancelled';

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  completed: 'مكتملة',
  report_pending: 'بانتظار التقرير',
  cancelled: 'ملغاة',
};

export interface FieldVisit extends BaseRecord {
  employeeId: ID;
  /** المنطقة/المحافظة كما في ملخص الزيارات في الإكسل */
  region: string;
  branch: string;
  /** تاريخ الزيارة YYYY-MM-DD */
  visitDate: string;
  visitType: string;
  reference: string;
  status: VisitStatus;
  /** وقت تسليم التقرير (اختياري) */
  reportSubmittedAt: string | null;
  /** وقت مراجعة التقرير (اختياري) */
  reportReviewedAt: string | null;
  /** عدد مرات تعديل التقرير */
  revisions: number | null;
  finalAssessment: string;
  notes: string;
}

export const FINAL_ASSESSMENT_OPTIONS = ['ملتزم', 'ملتزم مع ملاحظات', 'يحتاج متابعة', 'غير ملتزم'];

/* ------------------------- دقائق الصرف اليومية ------------------------- */

export type MinuteStatus = 'open' | 'closed';
export type MinuteResult = 'pending' | 'approved' | 'rejected' | 'need_more';

export const MINUTE_STATUS_LABELS: Record<MinuteStatus, string> = {
  open: 'قيد الإجراء',
  closed: 'منتهية',
};

export const MINUTE_RESULT_LABELS: Record<MinuteResult, string> = {
  pending: 'قيد الدراسة',
  approved: 'موافقة',
  rejected: 'رفض',
  need_more: 'يحتاج استكمال',
};

export interface DisbursementMinute extends BaseRecord {
  employeeId: ID;
  /** تاريخ الدقيقة YYYY-MM-DD */
  date: string;
  branch: string;
  clientRef: string;
  financingType: string;
  amount: number | null;
  /** أوقات بصيغة HH:MM — كلها اختيارية ما عدا وقت الاستلام */
  minuteReceivedTime: string;
  fileRequestTime: string;
  fileReceivedTime: string;
  finalResponseTime: string;
  result: MinuteResult;
  status: MinuteStatus;
  notes: string;
}

/* ------------------------------ الملاحظات ----------------------------- */

export const OBSERVATION_SOURCES = ['دقيقة صرف', 'زيارة ميدانية', 'مراجعة تقرير', 'ملاحظة مباشرة', 'الإدارة'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export type Severity = 'low' | 'medium' | 'high';

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
};

export type ObservationStatus = 'open' | 'closed';

export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
};

export interface Observation extends BaseRecord {
  employeeId: ID;
  /** تاريخ الملاحظة YYYY-MM-DD */
  date: string;
  source: string;
  branch: string;
  reference: string;
  category: string;
  severity: Severity;
  details: string;
  correctiveAction: string;
  notificationDate: string | null;
  status: ObservationStatus;
  resolutionDate: string | null;
  /** تكرار ملاحظة سابقة */
  recurrence: boolean;
  followUpNotes: string;
}

/* -------------------------- الإجازات والأذونات ------------------------- */

export type LeaveUnit = 'days' | 'hours';

export const LEAVE_UNIT_LABELS: Record<LeaveUnit, string> = {
  days: 'أيام',
  hours: 'ساعات',
};

export interface Leave extends BaseRecord {
  employeeId: ID;
  type: string;
  startDate: string;
  endDate: string;
  unit: LeaveUnit;
  /** عدد الأيام (عند unit = days) */
  days: number | null;
  /** عدد الساعات (عند unit = hours) */
  hours: number | null;
  notes: string;
}

/* -------------------------------- الإعدادات ---------------------------- */

export interface AppSettings {
  organizationName: string;
  sectors: string[];
  governorates: string[];
  branches: string[];
  jobTitles: string[];
  visitTypes: string[];
  financingTypes: string[];
  observationCategories: string[];
  leaveTypes: string[];
  ratingThresholds: RatingThreshold[];
  updatedAt: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  organizationName: 'إدارة المخاطر',
  sectors: ['قطاع القاهرة', 'قطاع الدلتا', 'قطاع الصعيد'],
  governorates: ['القاهرة', 'الجيزة', 'الغربية', 'المنوفية', 'أسيوط', 'سوهاج'],
  branches: [],
  jobTitles: ['ضابط مخاطر', 'ضابط مخاطر أول', 'مسؤول مخاطر'],
  visitTypes: ['زيارة ميدانية', 'فحص عشوائي', 'زيارة متابعة', 'زيارة شكوى'],
  financingTypes: ['تمويل فردي', 'تمويل جماعي', 'تمويل مشروعات صغيرة', 'إعادة تمويل'],
  observationCategories: ['مستندات', 'إجراء', 'تأخير', 'جودة تقرير', 'سلوك مهني', 'أخرى'],
  leaveTypes: ['إجازة سنوية', 'إجازة عارضة', 'إجازة مرضية', 'إجازة بدون راتب', 'إذن تأخير', 'إذن انصراف', 'مأمورية'],
  ratingThresholds: DEFAULT_RATING_THRESHOLDS,
  updatedAt: new Date().toISOString(),
};

/* ---------------------------------------------------------------------- */

export const DB_NAME = 'risk-officer-suite';
export const DB_VERSION = 1;

export const STORE_NAMES = [
  'employees',
  'monthlyEvaluations',
  'fieldVisits',
  'minutes',
  'observations',
  'leaves',
  'annualNotes',
  'settings',
  'meta',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];
export type EntityName = 'employees' | 'monthlyEvaluations' | 'fieldVisits' | 'minutes' | 'observations' | 'leaves' | 'annualNotes';

export const ENTITY_LABELS: Record<EntityName, string> = {
  employees: 'الموظفون',
  monthlyEvaluations: 'التقييمات الشهرية',
  fieldVisits: 'الزيارات الميدانية',
  minutes: 'دقائق الصرف',
  observations: 'الملاحظات',
  leaves: 'الإجازات والأذونات',
  annualNotes: 'ملاحظات التقييم السنوي',
};

export const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];
