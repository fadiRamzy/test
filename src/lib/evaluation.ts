import type { Evaluation, EvaluationCriterion, EvaluationScores } from '../db/schema';

export interface EvaluationSummary {
  sum: number;
  count: number;
  /** المتوسط = مجموع الدرجات المسجلة ÷ عدد المعايير المسجلة (بلا أوزان مخترعة) */
  average: number | null;
  maxPossible: number;
  missingCriteria: string[];
  recordedCriteria: string[];
  percentOfMax: number | null;
}

/**
 * متوسط التقييم الافتراضي: مجموع الدرجات المسجلة ÷ عدد المعايير المسجلة.
 * لا تُستخدم أي أوزان أو معادلات رسمية.
 */
export function summarizeScores(
  scores: EvaluationScores | undefined,
  criteria: EvaluationCriterion[],
  scaleMax = 5,
): EvaluationSummary {
  const active = criteria.filter((c) => c.active);
  const recordedCriteria: string[] = [];
  const missingCriteria: string[] = [];
  let sum = 0;
  let count = 0;

  for (const criterion of active) {
    const raw = scores?.[criterion.id];
    const value = typeof raw === 'number' && !Number.isNaN(raw) ? raw : null;
    if (value === null) {
      missingCriteria.push(criterion.id);
    } else {
      recordedCriteria.push(criterion.id);
      sum += value;
      count += 1;
    }
  }

  return {
    sum,
    count,
    average: count ? sum / count : null,
    maxPossible: count * scaleMax,
    missingCriteria,
    recordedCriteria,
    percentOfMax: count ? (sum / (count * scaleMax)) * 100 : null,
  };
}

export function isScoreValid(value: number | null, min: number, max: number): boolean {
  if (value === null) return true;
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * اشتقاق تقييم سنوي من التقييمات الشهرية المعتمدة/المسجلة:
 * لكل معيار يُحسب متوسط الدرجات المسجلة في شهور السنة (إن وجدت).
 */
export function deriveAnnualScores(
  evaluations: Evaluation[],
  year: number,
  criteria: EvaluationCriterion[],
): { scores: EvaluationScores; monthsUsed: number[] } {
  const monthly = evaluations.filter(
    (e) => e.periodType === 'monthly' && e.year === year && !e.deletedAt && e.month,
  );
  const scores: EvaluationScores = {};
  const monthsUsed = new Set<number>();

  for (const criterion of criteria) {
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

  return { scores, monthsUsed: Array.from(monthsUsed).sort((a, b) => a - b) };
}

export function evaluationTone(average: number | null, scaleMax = 5): 'success' | 'warning' | 'danger' | 'neutral' {
  if (average === null) return 'neutral';
  const ratio = average / scaleMax;
  if (ratio >= 0.8) return 'success';
  if (ratio >= 0.6) return 'warning';
  return 'danger';
}
