import { describe, expect, it } from 'vitest';
import { monthlyAveragePerCriterion, summarizeScores } from '../src/lib/evaluation';
import { EVALUATION_CRITERIA, type Evaluation } from '../src/db/schema';

const base = { createdAt: '', updatedAt: '' };

function evaluation(patch: Partial<Evaluation>): Evaluation {
  return {
    ...base,
    id: Math.random().toString(36).slice(2),
    employeeId: 'e1',
    periodType: 'monthly',
    year: 2026,
    month: 1,
    scores: {},
    comments: {},
    overallComment: '',
    ...patch,
  };
}

describe('summarizeScores', () => {
  it('يجمع الدرجات المسجلة فقط ويحسب المتوسط بدون أوزان', () => {
    const summary = summarizeScores({ k1: 5, k2: 3, k3: 4 });
    expect(summary.sum).toBe(12);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(4);
    expect(summary.missing).toHaveLength(EVALUATION_CRITERIA.length - 3);
  });

  it('يعيد null عند عدم تسجيل أي درجة', () => {
    const summary = summarizeScores({});
    expect(summary.average).toBeNull();
    expect(summary.sum).toBe(0);
  });

  it('يتجاهل القيم الفارغة', () => {
    const summary = summarizeScores({ k1: 4, k2: null, k3: undefined });
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(4);
  });
});

describe('monthlyAveragePerCriterion', () => {
  it('يحسب متوسط كل معيار من التقييمات الشهرية للسنة', () => {
    const result = monthlyAveragePerCriterion(
      [
        evaluation({ month: 1, scores: { k1: 4, k2: 2 } }),
        evaluation({ month: 2, scores: { k1: 5, k2: 2 } }),
        evaluation({ periodType: 'annual', month: null, scores: { k1: 1 } }),
        evaluation({ year: 2025, month: 5, scores: { k1: 1 } }),
      ],
      2026,
    );
    expect(result.scores.k1).toBe(4.5);
    expect(result.scores.k2).toBe(2);
    expect(result.months).toEqual([1, 2]);
  });
});
