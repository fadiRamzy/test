import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportDocument, paginateBlocks, PAGE_CONTENT_HEIGHT } from '../src/components/report/ReportDocument';
import { buildEmployeeReport } from '../src/lib/reportModel';
import { DEFAULT_SETTINGS, type DisbursementMinute, type Employee, type Evaluation, type FieldVisit, type Observation } from '../src/db/schema';
import { newReviewCycle } from '../src/db/repo';

const employee: Employee = {
  id: 'emp-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  employeeCode: 'R-001',
  fullName: 'ياسمين عبد الله',
  jobTitle: 'ضابط مخاطر أول',
  branchId: 'br-1',
  governorate: 'القاهرة',
  hireDate: '2023-02-01',
  status: 'active',
  phone: '',
  email: '',
  notes: '',
};

const minutes: DisbursementMinute[] = [
  {
    id: 'min-1',
    createdAt: '',
    updatedAt: '',
    refNo: 'MIN-R-1',
    branchId: 'br-1',
    employeeId: 'emp-1',
    clientRef: 'CL-R-1',
    financingType: 'تمويل مشروع صغير',
    amount: 50000,
    outcome: 'approved',
    status: 'completed',
    receivedAt: new Date('2026-01-05T09:00:00').toISOString(),
    fileRequestedAt: new Date('2026-01-05T09:05:00').toISOString(),
    fileReceivedAt: new Date('2026-01-05T09:25:00').toISOString(),
    reviewStartedAt: new Date('2026-01-05T09:26:00').toISOString(),
    finalResponseAt: new Date('2026-01-05T09:55:00').toISOString(),
  },
];

const visits: FieldVisit[] = [
  {
    id: 'vis-1',
    createdAt: '',
    updatedAt: '',
    refNo: 'VIS-R-1',
    employeeId: 'emp-1',
    branchId: 'br-1',
    clientRef: 'CL-R-1',
    visitDate: '2026-01-08',
    departureAt: new Date('2026-01-08T09:00:00').toISOString(),
    arrivalAt: new Date('2026-01-08T10:00:00').toISOString(),
    returnAt: new Date('2026-01-08T13:00:00').toISOString(),
    reportSubmittedAt: new Date('2026-01-09T10:00:00').toISOString(),
    status: 'completed',
    qualityScore: 4,
    feedback: 'تقرير جيد',
    reviewCycles: [
      newReviewCycle(1),
      {
        ...newReviewCycle(2),
        correctionsRequestedAt: new Date('2026-01-10T09:00:00').toISOString(),
        correctionsNotes: 'إضافة صور الواجهة',
        resubmittedAt: new Date('2026-01-11T09:00:00').toISOString(),
        qualityScore: 4,
        feedback: 'تم التصحيح',
      },
    ],
  },
];

const observations: Observation[] = [
  {
    id: 'obs-1',
    createdAt: '',
    updatedAt: '',
    refNo: 'OBS-R-1',
    employeeId: 'emp-1',
    branchId: 'br-1',
    date: '2026-01-12',
    categoryId: 'cat1',
    severity: 'high',
    source: 'visit',
    description: 'تأخر في تسليم تقرير الزيارة مع نقص في المستندات المرفقة.',
    correctiveAction: 'استكمال المستندات والالتزام بموعد التسليم.',
    notifiedAt: new Date('2026-01-12T09:00:00').toISOString(),
    isRecurring: true,
    status: 'resolved',
    resolvedAt: new Date('2026-01-15T09:00:00').toISOString(),
    followUps: [
      { id: 'f1', date: '2026-01-13', note: 'تم إخطار الضابط كتابيًا', createdAt: '' },
      { id: 'f2', date: '2026-01-15', note: 'تم استلام المستندات الناقصة', createdAt: '' },
    ],
  },
];

const evaluations: Evaluation[] = [
  {
    id: 'ev-1',
    createdAt: '',
    updatedAt: '',
    employeeId: 'emp-1',
    periodType: 'monthly',
    year: 2026,
    month: 1,
    scores: { c1: 4, c2: 5, c3: 3, c4: 4 },
    comments: { c1: 'دقيق في المراجعة' },
    status: 'approved',
  },
];

const model = buildEmployeeReport({
  settings: DEFAULT_SETTINGS,
  employee,
  branches: [{ id: 'br-1', code: 'BR-1', name: 'فرع رمسيس', governorate: 'القاهرة', createdAt: '', updatedAt: '' }],
  minutes,
  visits,
  observations,
  evaluations,
  period: { type: 'all' },
  generatedAt: new Date('2026-02-01T10:00:00'),
});

describe('تقرير الموظف العربي', () => {
  it('يعرض بيانات الموظف والفترة بالعربية', () => {
    render(<ReportDocument model={model} />);
    expect(screen.getAllByText('ياسمين عبد الله').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R-001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/تقرير أداء ضابط مخاطر/).length).toBeGreaterThan(0);
  });

  it('يعرض ترقيم الصفحات', () => {
    render(<ReportDocument model={model} />);
    expect(screen.getAllByText(/صفحة 1 من 1/).length).toBeGreaterThan(0);
  });

  it('يتضمن دقائق الصرف وحساب الأزمنة', () => {
    render(<ReportDocument model={model} />);
    expect(screen.getAllByText('MIN-R-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/دقائق الصرف/).length).toBeGreaterThan(0);
  });

  it('يتضمن دورات المراجعة المتعددة', () => {
    render(<ReportDocument model={model} />);
    expect(screen.getAllByText(/دورات مراجعة الزيارة VIS-R-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/إضافة صور الواجهة/).length).toBeGreaterThan(0);
  });

  it('يتضمن تفاصيل الملاحظات وسجل المتابعات والمعالجة', () => {
    render(<ReportDocument model={model} />);
    expect(screen.getAllByText(/تأخر في تسليم تقرير الزيارة/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/تم إخطار الضابط كتابيًا/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/تم استلام المستندات الناقصة/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/نقص مستندات/).length).toBeGreaterThan(0);
  });

  it('يتضمن التقييمات والمتوسط محسوبًا من المعايير المسجلة فقط', () => {
    render(<ReportDocument model={model} />);
    expect(screen.getAllByText(/يناير 2026/).length).toBeGreaterThan(0);
    // متوسط المعيار = (4+4)/1 … وقيمة المتوسط تظهر في جدول التقييم
    expect(screen.getAllByText('4.0').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/مجموع الدرجات ÷ عدد المعايير المسجلة/).length).toBeGreaterThan(0);
  });
});

describe('توزيع الصفحات', () => {
  it('يضع الكتل في صفحة واحدة عند عدم تجاوز الارتفاع', () => {
    expect(paginateBlocks([100, 100, 100], PAGE_CONTENT_HEIGHT)).toEqual([[0, 1, 2]]);
  });

  it('يبدأ صفحة جديدة عند تجاوز الارتفاع المتاح', () => {
    const pages = paginateBlocks([600, 600, 100], PAGE_CONTENT_HEIGHT);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([0]);
    expect(pages[1]).toEqual([1, 2]);
  });

  it('يضع الكتلة الأكبر من الصفحة في صفحة مستقلة', () => {
    const pages = paginateBlocks([2000, 100], PAGE_CONTENT_HEIGHT);
    expect(pages).toEqual([[0], [1]]);
  });

  it('يعيد صفحة واحدة عند عدم وجود كتل', () => {
    expect(paginateBlocks([], PAGE_CONTENT_HEIGHT)).toEqual([[]]);
  });
});
