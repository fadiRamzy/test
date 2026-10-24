import { fmtNumber } from '../lib/format';

export interface Datum {
  label: string;
  value: number;
  hint?: string;
  tone?: string;
}

const PALETTE = ['#1d4ed8', '#3b82f6', '#60a5fa', '#94a3b8', '#0ea5e9', '#6366f1', '#64748b', '#0284c7'];

/** رسم أعمدة رأسية (SVG) — بسيط وخفيف ويدعم RTL */
export function BarChart({
  data,
  height = 190,
  valueSuffix = '',
  emptyMessage = 'لا توجد بيانات كافية للرسم',
}: {
  data: Datum[];
  height?: number;
  valueSuffix?: string;
  emptyMessage?: string;
}) {
  if (!data.length || data.every((d) => d.value === 0)) {
    return <div className="chart-empty">{emptyMessage}</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;
  return (
    <div className="chart" style={{ ['--chart-h' as string]: `${height}px` }}>
      <div className="chart__plot">
        {data.map((datum, index) => {
          const pct = (datum.value / max) * 100;
          return (
            <div className="chart__col" key={`${datum.label}-${index}`} style={{ width: `${barWidth}%` }} title={`${datum.label}: ${fmtNumber(datum.value)}${valueSuffix}`}>
              <span className="chart__value">{fmtNumber(datum.value)}{valueSuffix}</span>
              <span
                className="chart__bar"
                style={{ height: `${Math.max(pct, datum.value > 0 ? 3 : 0)}%`, background: datum.tone ?? PALETTE[index % PALETTE.length] }}
              />
            </div>
          );
        })}
      </div>
      <div className="chart__labels">
        {data.map((datum, index) => (
          <span key={`${datum.label}-label-${index}`} className="chart__label" style={{ width: `${barWidth}%` }} title={datum.hint ?? datum.label}>
            {datum.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** رسم اتجاه زمني (خط) */
export function LineChart({
  points,
  height = 200,
  min,
  max,
  valueSuffix = '',
}: {
  points: Array<{ label: string; value: number | null }>;
  height?: number;
  min?: number;
  max?: number;
  valueSuffix?: string;
}) {
  const valid = points.filter((p) => p.value !== null) as Array<{ label: string; value: number }>;
  if (valid.length < 2) {
    return <div className="chart-empty">تحتاج نقطتين على الأقل لعرض الاتجاه</div>;
  }
  const lo = min ?? Math.min(...valid.map((p) => p.value));
  const hi = max ?? Math.max(...valid.map((p) => p.value));
  const span = hi - lo || 1;
  const width = 600;
  const padding = { top: 14, right: 12, bottom: 24, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const coords = points.map((point, index) => {
    const x = padding.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
    const y =
      point.value === null
        ? null
        : padding.top + innerH - ((point.value - lo) / span) * innerH;
    return { ...point, x, y };
  });

  const segments: string[] = [];
  let current: string[] = [];
  coords.forEach((point) => {
    if (point.y === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else {
      current.push(`${current.length ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    }
  });
  if (current.length) segments.push(current.join(' '));

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="اتجاه زمني">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerH * ratio}
            y2={padding.top + innerH * ratio}
            className="line-chart__grid"
          />
        ))}
        {segments.map((d, index) => (
          <path key={index} d={d} className="line-chart__line" />
        ))}
        {coords.map((point, index) =>
          point.y !== null ? (
            <g key={index}>
              <circle cx={point.x} cy={point.y} r={3.6} className="line-chart__dot" />
              <title>{`${point.label}: ${point.value}${valueSuffix}`}</title>
            </g>
          ) : null,
        )}
      </svg>
      <div className="line-chart__labels">
        {points.map((point, index) => (
          <span key={index}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

/** رسم دائري بسيط (Donut) */
export function DonutChart({
  value,
  total,
  label,
  tone = '#1d4ed8',
  size = 132,
}: {
  value: number;
  total: number;
  label: string;
  tone?: string;
  size?: number;
}) {
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="donut" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={radius} className="donut__track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="donut__value"
          style={{
            stroke: tone,
            strokeDasharray: `${circumference * ratio} ${circumference}`,
          }}
        />
      </svg>
      <div className="donut__center">
        <strong>{total > 0 ? `${Math.round(ratio * 100)}%` : '—'}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, tone = '#1d4ed8' }: { values: number[]; tone?: string }) {
  if (values.length < 2) return <span className="sparkline-empty">—</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const width = 90;
  const height = 26;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke={tone} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
