/**
 * الملخص التنفيذي وأبرز ملاحظات المخاطر — يُولَّد من نتائج المقارنة فقط.
 * كل عبارة هنا مبنية على أرقام محسوبة؛ لا تُذكر تحصيلات أو حركة عملاء إلا إذا وُجدت بياناتها.
 */

import {
  bucketLabel,
  fmtInt,
  fmtMoney,
  fmtPct,
  periodLabel,
  type Comparison,
} from './delinquency';
import type { MigrationResult } from './delinquencyMigration';
import { countNoun } from './format';

const CLIENT_NOUN = { one: 'عميل واحد', two: 'عميلان', few: 'عملاء', many: 'عميلًا' };

/** صياغة عربية سليمة لعدد العملاء: «عميل واحد» · «3 عملاء» · «21 عميلًا» */
export const clientsNoun = (count: number): string => countNoun(count, CLIENT_NOUN);

export type ObservationTone = 'danger' | 'warning' | 'success' | 'info';

export interface Observation {
  id: string;
  tone: ObservationTone;
  title: string;
  text: string;
}

export interface ExecutiveSummary {
  /** الحالة العامة */
  status: 'deteriorated' | 'improved' | 'stable';
  tone: ObservationTone;
  headline: string;
  observations: Observation[];
  /** تنبيهات منهجية ثابتة تُعرض وتُصدَّر مع كل تقرير */
  caveats: string[];
}

export const TONE_LABELS: Record<ObservationTone, string> = {
  danger: 'خطر مرتفع',
  warning: 'تنبيه',
  success: 'إيجابي',
  info: 'معلومة',
};

export const CAVEAT_NET_CHANGE =
  'الأرقام المعروضة «صافي تغير» بين رصيدَي الشهرين لكل شريحة، وليست حركة عملاء فعلية بين الشرائح.';
export const CAVEAT_COLLECTIONS =
  'صافي انخفاض المتأخرات لا يُعد تحصيلًا مؤكدًا؛ قد ينتج عن سداد أو تسوية أو إعادة جدولة أو إعدام أو انتقال لشريحة أخرى. تأكيد التحصيل يتطلب سجلات تحصيل فعلية.';
export const CAVEAT_MIGRATION =
  'الترحيل الفعلي بين الشرائح يتطلب أرقام تعريف العملاء في الشهرين؛ لا تُستنتج أرقام ترحيل من البيانات الإجمالية.';
export const CAVEAT_SHARES =
  'الحصص محسوبة من إجمالي المتأخرات المدخلة وليست من إجمالي المحفظة القائمة.';

const pctText = (value: number | null): string => (value === null ? '' : ` (${fmtPct(Math.abs(value))})`);

const points = (value: number): string => `${Math.abs(value).toFixed(1)} نقطة مئوية`;

const POINT_EPSILON = 0.05;

const clientsChangeText = (delta: number): string =>
  delta === 0
    ? 'دون تغير صافٍ في عدد العملاء'
    : `مع ${delta > 0 ? 'زيادة' : 'انخفاض'} صافٍ في العملاء بمقدار ${clientsNoun(delta)}`;

export function buildExecutiveSummary(comparison: Comparison, migration?: MigrationResult | null): ExecutiveSummary {
  const { totals, performance, indicators, rows } = comparison;
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const observations: Observation[] = [];

  /* ------------------------------- الحالة العامة ------------------------- */
  let status: ExecutiveSummary['status'] = 'stable';
  let tone: ObservationTone = 'info';
  let headline = `استقرار: لم يتغير إجمالي المتأخرات بين ${labelA} و${labelB}.`;

  if (performance.status === 'net_increase') {
    status = 'deteriorated';
    tone = 'danger';
    headline = `تدهور: زيادة صافية في المتأخرات بمقدار ${fmtMoney(totals.amountDelta)}${pctText(totals.amountPct)} بين ${labelA} و${labelB}.`;
    observations.push({
      id: 'total-amount',
      tone: 'danger',
      title: 'ارتفاع إجمالي المتأخرات',
      text: `ارتفع إجمالي مبلغ المتأخرات من ${fmtMoney(totals.amountA)} إلى ${fmtMoney(totals.amountB)} بزيادة صافية قدرها ${fmtMoney(totals.amountDelta)}${pctText(totals.amountPct)}.`,
    });
  } else if (performance.status === 'net_reduction') {
    status = 'improved';
    tone = 'success';
    headline = `تحسن صافٍ: انخفاض صافٍ في المتأخرات بمقدار ${fmtMoney(Math.abs(totals.amountDelta))}${pctText(totals.amountPct)} بين ${labelA} و${labelB}.`;
    observations.push({
      id: 'total-amount',
      tone: 'success',
      title: 'انخفاض صافٍ في إجمالي المتأخرات',
      text: `انخفض إجمالي مبلغ المتأخرات من ${fmtMoney(totals.amountA)} إلى ${fmtMoney(totals.amountB)} بانخفاض صافٍ قدره ${fmtMoney(Math.abs(totals.amountDelta))}${pctText(totals.amountPct)}. هذا انخفاض صافٍ في الأرصدة ولا يُعد تحصيلًا مؤكدًا دون سجلات تحصيل.`,
    });
  } else {
    observations.push({
      id: 'total-amount',
      tone: 'info',
      title: 'ثبات إجمالي المتأخرات',
      text: `إجمالي مبلغ المتأخرات ثابت عند ${fmtMoney(totals.amountB)} في الشهرين.`,
    });
  }

  /* --------------------------------- العملاء ----------------------------- */
  if (totals.clientsDelta !== 0) {
    const up = totals.clientsDelta > 0;
    observations.push({
      id: 'total-clients',
      tone: up ? 'warning' : 'success',
      title: up ? 'ارتفاع عدد العملاء المتأخرين' : 'انخفاض عدد العملاء المتأخرين',
      text: `${up ? 'ارتفع' : 'انخفض'} عدد العملاء المتأخرين من ${fmtInt(totals.clientsA)} إلى ${fmtInt(totals.clientsB)}، ${up ? 'بزيادة' : 'بانخفاض'} ${clientsNoun(totals.clientsDelta)}${pctText(totals.clientsPct)}.`,
    });
  }

  /* --------------------------- تباين المبلغ والعدد ------------------------ */
  if (totals.amountDelta > 0 && totals.clientsDelta < 0) {
    observations.push({
      id: 'divergence',
      tone: 'warning',
      title: 'تركّز المتأخرات في عدد أقل من العملاء',
      text: `ارتفعت المبالغ رغم انخفاض عدد العملاء؛ متوسط المتأخرات للعميل تغيّر من ${fmtMoney(totals.averageA)} إلى ${fmtMoney(totals.averageB)}.`,
    });
  } else if (totals.amountDelta < 0 && totals.clientsDelta > 0) {
    observations.push({
      id: 'divergence',
      tone: 'warning',
      title: 'عملاء متأخرون أكثر بمبالغ أقل',
      text: `ارتفع عدد العملاء المتأخرين رغم انخفاض المبالغ؛ متوسط المتأخرات للعميل تغيّر من ${fmtMoney(totals.averageA)} إلى ${fmtMoney(totals.averageB)}. يستحق متابعة اتساع قاعدة التأخر.`,
    });
  }

  /* ----------------------------------- NPL ------------------------------- */
  const npl = rows[rows.length - 1];
  const nplShareDelta = indicators.nplShareDelta;
  if (npl.amountDelta > 0 || (nplShareDelta !== null && nplShareDelta > POINT_EPSILON)) {
    const parts: string[] = [];
    if (npl.amountDelta > 0)
      parts.push(`ارتفع رصيد الشريحة المتعثرة (أكثر من 120 يوم) بمقدار ${fmtMoney(npl.amountDelta)}${pctText(npl.amountPct)} ليصل إلى ${fmtMoney(npl.amountB)}`);
    if (nplShareDelta !== null && nplShareDelta > POINT_EPSILON)
      parts.push(`ارتفعت حصتها من إجمالي المتأخرات من ${fmtPct(indicators.nplShareA)} إلى ${fmtPct(indicators.nplShareB)} (${points(nplShareDelta)})`);
    if (npl.clientsDelta > 0) parts.push(`وزاد عدد عملائها بمقدار ${clientsNoun(npl.clientsDelta)}`);
    observations.push({ id: 'npl', tone: 'danger', title: 'تفاقم الشريحة المتعثرة (NPL)', text: `${parts.join('، ')}.` });
  } else if (npl.amountDelta < 0) {
    observations.push({
      id: 'npl',
      tone: 'success',
      title: 'انخفاض صافٍ في الشريحة المتعثرة (NPL)',
      text: `انخفض رصيد الشريحة المتعثرة بمقدار ${fmtMoney(Math.abs(npl.amountDelta))}${pctText(npl.amountPct)} ليصل إلى ${fmtMoney(npl.amountB)}${indicators.nplShareB !== null ? `، وحصتها الآن ${fmtPct(indicators.nplShareB)} من إجمالي المتأخرات` : ''}. سبب الانخفاض غير محدد من البيانات الإجمالية (سداد، تسوية، إعدام…).`,
    });
  } else if (indicators.nplShareB !== null && npl.amountB > 0) {
    observations.push({
      id: 'npl',
      tone: 'info',
      title: 'الشريحة المتعثرة (NPL)',
      text: `رصيد الشريحة المتعثرة ثابت عند ${fmtMoney(npl.amountB)} ويمثل ${fmtPct(indicators.nplShareB)} من إجمالي المتأخرات.`,
    });
  }

  /* --------------------------- دخول حالات تأخر جديدة ---------------------- */
  const early = rows[0];
  if (early.clientsDelta > 0 || early.amountDelta > 0) {
    const parts: string[] = [];
    if (early.clientsDelta > 0) parts.push(`${clientsNoun(early.clientsDelta)}${pctText(early.clientsPct)}`);
    if (early.amountDelta > 0) parts.push(`${fmtMoney(early.amountDelta)} مبلغًا${pctText(early.amountPct)}`);
    observations.push({
      id: 'early',
      tone: 'warning',
      title: 'ضغط على شريحة التأخر المبكر (1–30 يوم)',
      text: `زادت شريحة 1–30 يوم صافيًا بمقدار ${parts.join(' و')}؛ مؤشر محتمل على دخول حالات تأخر جديدة (مؤشر صافٍ وليس حركة عملاء مؤكدة).`,
    });
  }

  /* --------------------------- انزياح نحو الشرائح الأقدم ------------------ */
  const lateDelta = indicators.lateShareDelta;
  if (lateDelta !== null && lateDelta > POINT_EPSILON) {
    observations.push({
      id: 'late-shift',
      tone: 'warning',
      title: 'انزياح المتأخرات نحو الشرائح الأقدم',
      text: `حصة المتأخرات 91 يومًا فأكثر ارتفعت من ${fmtPct(indicators.lateShareA)} إلى ${fmtPct(indicators.lateShareB)} من إجمالي المتأخرات (${points(lateDelta)}).`,
    });
  } else if (lateDelta !== null && lateDelta < -POINT_EPSILON) {
    observations.push({
      id: 'late-shift',
      tone: 'success',
      title: 'تراجع حصة الشرائح الأقدم',
      text: `حصة المتأخرات 91 يومًا فأكثر انخفضت من ${fmtPct(indicators.lateShareA)} إلى ${fmtPct(indicators.lateShareB)} من إجمالي المتأخرات (${points(lateDelta)}).`,
    });
  }

  /* ---------------------------- أفضل وأسوأ الشرائح ------------------------ */
  if (comparison.worst) {
    const row = rows.find((item) => item.bucket === comparison.worst)!;
    observations.push(
      comparison.worstDeteriorated
        ? {
            id: 'worst',
            tone: 'danger',
            title: `أسوأ شريحة أداءً: ${bucketLabel(row.bucket)}`,
            text: `أكبر زيادة صافية بالمبلغ: ${fmtMoney(row.amountDelta)}${pctText(row.amountPct)}، ${clientsChangeText(row.clientsDelta)}.`,
          }
        : {
            id: 'worst',
            tone: 'info',
            title: `أقل الشرائح تحسنًا: ${bucketLabel(row.bucket)}`,
            text: 'لم تسجل أي شريحة زيادة صافية في المبلغ؛ هذه الشريحة الأقل انخفاضًا.',
          },
    );
  }
  if (comparison.best) {
    const row = rows.find((item) => item.bucket === comparison.best)!;
    observations.push(
      comparison.bestImproved
        ? {
            id: 'best',
            tone: 'success',
            title: `أفضل شريحة أداءً: ${bucketLabel(row.bucket)}`,
            text: `أكبر انخفاض صافٍ بالمبلغ: ${fmtMoney(Math.abs(row.amountDelta))}${pctText(row.amountPct)}، ${clientsChangeText(row.clientsDelta)}.`,
          }
        : {
            id: 'best',
            tone: 'warning',
            title: `لا توجد شريحة منخفضة — الأقل زيادة: ${bucketLabel(row.bucket)}`,
            text: 'لم تسجل أي شريحة انخفاضًا صافيًا في المبلغ خلال الفترة.',
          },
    );
  }

  /* ---------------------------------- التركّز ---------------------------- */
  if (indicators.largestBucketB) {
    const row = rows.find((item) => item.bucket === indicators.largestBucketB)!;
    observations.push({
      id: 'concentration',
      tone: row.bucket === 'npl' || row.bucket === 'd91_120' ? 'warning' : 'info',
      title: 'أكبر تركّز للمتأخرات',
      text: `شريحة ${bucketLabel(row.bucket)} تمثل ${fmtPct(row.amountShareB)} من إجمالي المتأخرات في ${labelB} (${fmtMoney(row.amountB)}).`,
    });
  }

  /* ------------------------------ الترحيل الفعلي -------------------------- */
  if (migration) {
    const worsening = migration.forward > migration.backward;
    observations.push({
      id: 'migration',
      tone: worsening ? 'danger' : migration.forward === 0 ? 'success' : 'warning',
      title: 'الترحيل الفعلي بين الشرائح (بحسب أرقام العملاء)',
      text:
        `عدد العملاء المتأخرين في ${labelA}: ${fmtInt(migration.clientsA)}. ` +
        `منهم ${fmtInt(migration.forward)} انتقلوا إلى شريحة أسوأ${migration.forwardRate !== null ? ` (${fmtPct(migration.forwardRate)})` : ''}، ` +
        `و${fmtInt(migration.stayed)} بقوا في شريحتهم، و${fmtInt(migration.backward)} تحسنوا إلى شريحة أحدث، ` +
        `و${fmtInt(migration.exited)} خرجوا من قائمة المتأخرات (سبب الخروج غير محدد). ` +
        `عدد الداخلين الجدد إلى القائمة: ${fmtInt(migration.entered)}، وعدد المنتقلين إلى NPL: ${fmtInt(migration.intoNpl)}.`,
    });
  } else {
    observations.push({
      id: 'migration',
      tone: 'info',
      title: 'حركة العملاء الفعلية غير متاحة',
      text: 'البيانات المدخلة إجمالية؛ ما سبق صافي تغير لكل شريحة. لحساب الترحيل الفعلي أضف قائمة العملاء (رقم العميل وأيام التأخير) للشهرين.',
    });
  }

  /* ------------------------------- جودة البيانات -------------------------- */
  if (comparison.warnings.length) {
    observations.push({
      id: 'data-quality',
      tone: 'warning',
      title: 'ملاحظات على جودة البيانات',
      text: comparison.warnings.join(' '),
    });
  }
  if (!comparison.chronological && !comparison.samePeriod) {
    observations.push({
      id: 'order',
      tone: 'info',
      title: 'ترتيب الشهرين',
      text: `شهر الأساس (${labelA}) أحدث من شهر المقارنة (${labelB})؛ التغير محسوب كـ «المقارنة − الأساس».`,
    });
  }

  const rank: Record<ObservationTone, number> = { danger: 0, warning: 1, success: 2, info: 3 };
  const [first, ...rest] = observations;
  const sorted = [first, ...rest.map((item, index) => ({ item, index })).sort((x, y) => rank[x.item.tone] - rank[y.item.tone] || x.index - y.index).map((entry) => entry.item)];

  return {
    status,
    tone,
    headline,
    observations: sorted,
    caveats: migration
      ? [CAVEAT_COLLECTIONS, CAVEAT_SHARES]
      : [CAVEAT_NET_CHANGE, CAVEAT_COLLECTIONS, CAVEAT_MIGRATION, CAVEAT_SHARES],
  };
}
