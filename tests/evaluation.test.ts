import { describe, expect, it } from 'vitest';
import { deriveAnnualScores, summarizeScores } from '../src/lib/evaluation';
import { DEFAULT_CRITERIA, type Evaluation } from '../src/db/schema';

const criteria = DEFAULT_CRITERIA;

function monthly(id: string, year: number, month: number, scores: Record<string, number | null>): Evaluation {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    employeeId: 'emp',
    periodType: 'monthly',
    year,
    month,
    scores,
    comments: {},
    status: 'draft',
  };
}

describe('حساب متوسط التقييم', () => {
  it('يحسب المتوسط = المجموع ÷ عدد المعايير المسجلة', () => {
    const summary = summarizeScores({ c1: 4, c2: 5, c3: 3 }, criteria, 5);
    expect(summary.sum).toBe(12);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(4);
    expect(summary.missingCriteria).toHaveLength(5);
    expect(summary.percentOfMax).toBe(80);
  });

  it('لا يحتسب المعايير غير المسجلة في المقام', () => {
    const summary = summarizeScores({ c1: 5 }, criteria, 5);
    expect(summary.average).toBe(5);
    expect(summary.count).toBe(1);
    expect(summary.missingCriteria).toHaveLength(7);
  });

  it('يعيد قيمة فارغة عند عدم وجود أي درجة', () => {
    const summary = summarizeScores({}, criteria, 5);
    expect(summary.average).toBeNull();
    expect(summary.count).toBe(0);
    expect(summary.missingCriteria).toHaveLength(8);
  });

  it('يتجاهل المعايير غير النشطة', () => {
    const withInactive = criteria.map((criterion) => (criterion.id === 'c8' ? { ...criterion, active: false } : criterion));
    const summary = summarizeScores({ c1: 4, c8: 1 }, withInactive, 5);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(4);
  });

  it('يحترم مقياس تقييم مخصص', () => {
    const summary = summarizeScores({ c1: 8, c2: 10 }, criteria, 10);
    expect(summary.average).toBe(9);
    expect(summary.percentOfMax).toBe(90);
  });
});

describe('اشتقاق التقييم السنوي من الشهري', () => {
  const evaluations: Evaluation[] = [
    monthly('m1', 2026, 1, { c1: 4, c2: 2 }),
    monthly('m2', 2026, 2, { c1: 5, c2: 4 }),
    monthly('m3', 2025, 12, { c1: 1, c2: 1 }),
  ];

  it('يحسب متوسط كل معيار من الشهور المسجلة فقط', () => {
    const { scores, monthsUsed } = deriveAnnualScores(evaluations, 2026, criteria);
    expect(scores.c1).toBe(4.5);
    expect(scores.c2).toBe(3);
    expect(scores.c3).toBeNull();
    expect(monthsUsed).toEqual([1, 2]);
  });

  it('لا يختلط بتقييمات سنة أخرى', () => {
    const { scores } = deriveAnnualScores(evaluations, 2025, criteria);
    expect(scores.c1).toBe(1);
  });
});
