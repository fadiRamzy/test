import { EVALUATION_CRITERIA, RATING_MAX, type Evaluation, type EvaluationScores } from '../db/schema';

export interface ScoreSummary {
  /** مجموع الدرجات المسجلة */
  sum: number;
  /** عدد المعايير المسجلة */
  count: number;
  /** المتوسط = المجموع ÷ عدد المعايير المسجلة (بلا أوزان ولا عتبات) */
  average: number | null;
  totalCriteria: number;
  missing: string[];
  recorded: string[];
}

export function summarizeScores(scores: EvaluationScores | undefined): ScoreSummary {
  const recorded: string[] = [];
  const missing: string[] = [];
  let sum = 0;

  for (const criterion of EVALUATION_CRITERIA) {
    const raw = scores?.[criterion.id];
    const value = typeof raw === 'number' && !Number.isNaN(raw) ? raw : null;
    if (value === null) {
      missing.push(criterion.id);
    } else {
      recorded.push(criterion.id);
      sum += value;
    }
  }

  return {
    sum,
    count: recorded.length,
    average: recorded.length ? sum / recorded.length : null,
    totalCriteria: EVALUATION_CRITERIA.length,
    missing,
    recorded,
  };
}

export const MAX_SCORE_TOTAL = EVALUATION_CRITERIA.length * RATING_MAX;

/** متوسط كل معيار عبر التقييمات الشهرية لسنة معينة (للاستخدام كمرجع في التقييم السنوي) */
export function monthlyAveragePerCriterion(evaluations: Evaluation[], year: number) {
  const monthly = evaluations.filter(
    (row) => row.periodType === 'monthly' && row.year === year && row.month !== null,
  );
  const scores: EvaluationScores = {};
  const monthsUsed = new Set<number>();
  for (const criterion of EVALUATION_CRITERIA) {
    const values: number[] = [];
    for (const evaluation of monthly) {
      const value = evaluation.scores?.[criterion.id];
      if (typeof value === 'number' && !Number.isNaN(value)) {
        values.push(value);
        if (evaluation.month) monthsUsed.add(evaluation.month);
      }
    }
    scores[criterion.id] = values.length
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
      : null;
  }
  return { scores, months: Array.from(monthsUsed).sort((a, b) => a - b) };
}
