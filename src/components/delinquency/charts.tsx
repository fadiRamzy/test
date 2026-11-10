/**
 * رسوم بيانية خفيفة (SVG/HTML) بلا مكتبات خارجية — مصممة للواجهة العربية RTL:
 * الفئة الأولى على اليمين والمحور الرقمي على اليمين.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { BUCKETS, fmtCompact, fmtPct, type BucketId } from '../../lib/delinquency';

/**
 * عرض الحاوية الفعلي بالبكسل: يُرسم المخطط بمقاسه الحقيقي فتبقى الخطوط مقروءة
 * على الهاتف وسطح المكتب. عند تعذر القياس (بيئة الاختبار) يُستخدم العرض الافتراضي.
 */
function useMeasuredWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export const BUCKET_COLORS: Record<BucketId, string> = {
  d1_30: '#3b82b6',
  d31_60: '#2a9d8f',
  d61_90: '#e0a630',
  d91_120: '#dd7a2c',
  npl: '#b3261e',
};

export const SERIES_A_COLOR = '#9db7d1';
export const SERIES_B_COLOR = '#0f3357';

/** أعلى قيمة «مرتبة» للمحور */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * علامات محور مستديرة (4 أو 5 أقسام) حتى لا تظهر قيم مثل 1.875 مليون.
 * مع integers=true (أعداد العملاء) لا تظهر علامات كسرية مثل 1.5 عميل.
 */
export function niceTicks(max: number, integers = false): number[] {
  const exponent = Math.floor(Math.log10(max));
  const fraction = Math.round((max / 10 ** exponent) * 100) / 100;
  let divisions = fraction === 2.5 || fraction === 5 ? 5 : 4;
  if (integers && !Number.isInteger(max / divisions)) {
    divisions = [5, 4, 2, 1].find((candidate) => Number.isInteger(max / candidate)) ?? 1;
  }
  return Array.from({ length: divisions + 1 }, (_, index) => (max * index) / divisions);
}

/* ------------------------------ أعمدة مجمّعة ------------------------------ */

export interface BarSeries {
  label: string;
  color: string;
  values: number[];
}

export function GroupedBarChart({
  categories,
  series,
  formatValue = fmtCompact,
  formatFull,
  ariaLabel,
  integers = false,
}: {
  categories: string[];
  series: BarSeries[];
  formatValue?: (value: number) => string;
  formatFull?: (value: number) => string;
  ariaLabel: string;
  /** القيم أعداد صحيحة (عملاء): علامات المحور تبقى صحيحة. */
  integers?: boolean;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>(640);
  const W = Math.max(280, measured);
  const compact = W < 480;
  const H = compact ? 240 : 300;
  const margin = { top: 22, right: compact ? 46 : 58, bottom: 34, left: compact ? 4 : 10 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((item) => item.values)));
  const ticks = niceTicks(max, integers);
  const band = plotW / Math.max(1, categories.length);
  const gap = compact ? 3 : 6;
  const barW = Math.max(4, Math.min(46, (band * 0.78 - gap * (series.length - 1)) / Math.max(1, series.length)));
  // تُخفى القيم فوق الأعمدة الضيقة حتى لا تتراكب؛ الأرقام كاملة في جدول المقارنة
  const showValues = barW >= 30;
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (value: number) => margin.top + plotH - (value / max) * plotH;
  const plotRight = margin.left + plotW;
  const full = formatFull ?? formatValue;

  return (
    <div className="dq-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel} className="dq-chart__svg">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={plotRight} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'dq-chart__axis' : 'dq-chart__grid'} />
            <text x={plotRight + margin.right / 2} y={y(tick) + 3.5} textAnchor="middle" className="dq-chart__tick">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {categories.map((category, index) => {
          const center = plotRight - (index + 0.5) * band;
          return (
            <g key={category}>
              {series.map((item, seriesIndex) => {
                const value = item.values[index] ?? 0;
                // السلسلة الأولى على اليمين (اتجاه القراءة العربي)
                const x = center + groupW / 2 - (seriesIndex + 1) * barW - seriesIndex * gap;
                const top = y(value);
                const height = Math.max(0, margin.top + plotH - top);
                return (
                  <g key={item.label}>
                    <rect x={x} y={top} width={barW} height={height} rx={3} fill={item.color}>
                      <title>{`${category} — ${item.label}: ${full(value)}`}</title>
                    </rect>
                    {showValues ? (
                      <text x={x + barW / 2} y={top - 5} textAnchor="middle" className="dq-chart__value">
                        {formatValue(value)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <text x={center} y={H - 11} textAnchor="middle" className={`dq-chart__label${compact ? ' dq-chart__label--sm' : ''}`}>
                {category}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="dq-legend" aria-hidden="true">
        {series.map((item) => (
          <li key={item.label}>
            <span className="dq-legend__dot" style={{ background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------- أعمدة التغير (زيادة/نقص) ------------------------ */

export interface ChangeItem {
  label: string;
  value: number;
  display: string;
  hint?: string;
}

/** أشرطة أفقية حول محور الصفر: الزيادة (أحمر) إلى اليسار والانخفاض (أخضر) إلى اليمين */
export function ChangeBars({ items, ariaLabel }: { items: ChangeItem[]; ariaLabel: string }) {
  const max = Math.max(0, ...items.map((item) => Math.abs(item.value)));
  return (
    <div className="dq-change" role="img" aria-label={ariaLabel}>
      {items.map((item) => {
        const width = max === 0 ? 0 : Math.max(item.value === 0 ? 0 : 2, (Math.abs(item.value) / max) * 100);
        const tone = item.value > 0 ? 'up' : item.value < 0 ? 'down' : 'flat';
        return (
          <div className="dq-change__row" key={item.label} title={item.hint}>
            <span className="dq-change__label">{item.label}</span>
            <span className="dq-change__track">
              <span className="dq-change__half dq-change__half--down">
                {tone === 'down' ? <span className="dq-change__bar dq-change__bar--down" style={{ width: `${width}%` }} /> : null}
              </span>
              <span className="dq-change__half dq-change__half--up">
                {tone === 'up' ? <span className="dq-change__bar dq-change__bar--up" style={{ width: `${width}%` }} /> : null}
              </span>
            </span>
            <span className={`dq-change__value dq-tone--${tone}`} dir="ltr">
              {item.display}
            </span>
          </div>
        );
      })}
      <div className="dq-change__axis" aria-hidden="true">
        <span>انخفاض صافٍ</span>
        <span>زيادة صافية</span>
      </div>
    </div>
  );
}

/* ------------------------------ تركيب المحفظة ----------------------------- */

export interface CompositionRow {
  label: string;
  /** حصص الشرائح بالترتيب (٪) — null إذا كان الإجمالي صفرًا */
  shares: Array<number | null>;
}

export function CompositionBars({ rows, ariaLabel }: { rows: CompositionRow[]; ariaLabel: string }) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>(560);
  // عرض الشريط التقريبي: تُكتب النسبة داخل القطعة فقط إن اتسعت لها
  const barWidth = measured < 420 ? measured : measured - 130;
  return (
    <div className="dq-composition" role="img" aria-label={ariaLabel} ref={ref}>
      {rows.map((row) => {
        const empty = row.shares.every((share) => share === null || share === 0);
        return (
          <div className="dq-composition__row" key={row.label}>
            <span className="dq-composition__label">{row.label}</span>
            <div className="dq-composition__bar">
              {empty ? (
                <span className="dq-composition__empty">لا توجد متأخرات</span>
              ) : (
                BUCKETS.map((bucket, index) => {
                  const share = row.shares[index] ?? 0;
                  if (share <= 0) return null;
                  return (
                    <span
                      key={bucket.id}
                      className="dq-composition__seg"
                      style={{ flexBasis: `${share}%`, background: BUCKET_COLORS[bucket.id] }}
                      title={`${bucket.label}: ${fmtPct(share)}`}
                    >
                      {(share / 100) * barWidth >= 44 ? <span dir="ltr">{fmtPct(share)}</span> : null}
                    </span>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
      <ul className="dq-legend" aria-hidden="true">
        {BUCKETS.map((bucket) => (
          <li key={bucket.id}>
            <span className="dq-legend__dot" style={{ background: BUCKET_COLORS[bucket.id] }} />
            {bucket.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------- اتجاه الشهور ----------------------------- */

export interface TrendPoint {
  label: string;
  sublabel?: string;
  values: number[];
  highlight?: boolean;
}

export function TrendChart({
  points,
  series,
  formatValue = fmtCompact,
  formatFull,
  ariaLabel,
}: {
  points: TrendPoint[];
  series: Array<{ label: string; color: string }>;
  formatValue?: (value: number) => string;
  formatFull?: (value: number) => string;
  ariaLabel: string;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>(1120);
  const W = Math.max(280, measured);
  const compact = W < 560;
  const H = compact ? 220 : 250;
  const margin = { top: 18, right: compact ? 50 : 64, bottom: 44, left: compact ? 24 : 40 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const max = niceMax(Math.max(0, ...points.flatMap((point) => point.values)));
  const ticks = niceTicks(max);
  const plotRight = margin.left + plotW;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  // الأقدم على اليمين، والأحدث على اليسار
  const x = (index: number) => (points.length > 1 ? plotRight - index * step : margin.left + plotW / 2);
  const y = (value: number) => margin.top + plotH - (value / max) * plotH;
  const full = formatFull ?? formatValue;
  // عند ضيق المساحة تُعرض تسمية كل n شهر (بدءًا من الأحدث) حتى لا تتراكب
  const labelEvery = step > 0 ? Math.max(1, Math.ceil(58 / step)) : 1;
  const showLabel = (index: number) => (points.length - 1 - index) % labelEvery === 0;

  return (
    <div className="dq-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel} className="dq-chart__svg">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={plotRight} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'dq-chart__axis' : 'dq-chart__grid'} />
            <text x={plotRight + margin.right / 2} y={y(tick) + 3.5} textAnchor="middle" className="dq-chart__tick">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {points.map((point, index) =>
          point.highlight ? (
            <line key={`h-${point.label}-${point.sublabel}`} x1={x(index)} x2={x(index)} y1={margin.top} y2={margin.top + plotH} className="dq-chart__marker" />
          ) : null,
        )}
        {series.map((item, seriesIndex) => (
          <g key={item.label}>
            {points.length > 1 ? (
              <polyline
                fill="none"
                stroke={item.color}
                strokeWidth={2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points.map((point, index) => `${x(index)},${y(point.values[seriesIndex] ?? 0)}`).join(' ')}
              />
            ) : null}
            {points.map((point, index) => (
              <circle key={`${point.label}-${point.sublabel}`} cx={x(index)} cy={y(point.values[seriesIndex] ?? 0)} r={3.6} fill="#fff" stroke={item.color} strokeWidth={2}>
                <title>{`${point.label} ${point.sublabel ?? ''} — ${item.label}: ${full(point.values[seriesIndex] ?? 0)}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {points.map((point, index) => !showLabel(index) ? null : (
          <g key={`l-${point.label}-${point.sublabel}`}>
            <text x={x(index)} y={H - 24} textAnchor="middle" className={`dq-chart__label${point.highlight ? ' dq-chart__label--strong' : ''}`}>
              {point.label}
            </text>
            {point.sublabel ? (
              <text x={x(index)} y={H - 10} textAnchor="middle" className="dq-chart__tick">
                {point.sublabel}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="dq-legend" aria-hidden="true">
        {series.map((item) => (
          <li key={item.label}>
            <span className="dq-legend__dot" style={{ background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
