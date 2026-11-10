/**
 * لوحة مقارنة شهرين: ثلاثة مؤشرات، جدول مقارنة الشرائح، وجدول مقارنة الفروع.
 * مكوّن عرض خالص — يستقبل بيانات الشهرين ويحسب كل شيء عبر المحرك الحسابي.
 */

import type { ReactNode } from 'react';
import {
  branchLabel,
  bucketLabel,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSignedInt,
  fmtSignedMoney,
  fmtSignedPct,
  fmtSignedPoints,
  periodLabel,
  type BranchComparisonRow,
  type Comparison,
  type Trend,
} from '../lib/delinquency';

/* -------------------------------- عناصر صغيرة ----------------------------- */

const toneOfDelta = (value: number | null | undefined): Trend => (!value ? 'flat' : value > 0 ? 'up' : 'down');

/** قيمة تغير ملوّنة: الزيادة في المتأخرات حمراء والانخفاض أخضر */
export function Delta({ value, format, strong }: { value: number | null; format: (value: number | null) => string; strong?: boolean }) {
  const tone = toneOfDelta(value);
  return (
    <span className={`dq-delta dq-tone--${tone}${strong ? ' dq-delta--strong' : ''}`} dir="ltr">
      {format(value)}
    </span>
  );
}

/** نسبة تغير؛ عند غياب الأساس (القيمة السابقة صفر) تُعرض «—» بدل نسبة مضللة */
function PctDelta({ value }: { value: number | null }) {
  if (value === null) return <span className="dq-muted">—</span>;
  return <Delta value={value} format={fmtSignedPct} />;
}

const Num = ({ children }: { children: ReactNode }) => (
  <span className="dq-num" dir="ltr">
    {children}
  </span>
);

export function Panel({
  title,
  actions,
  children,
  className,
  id,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`dq-panel${className ? ` ${className}` : ''}`} id={id} aria-label={title}>
      <header className="dq-panel__head">
        <h2>{title}</h2>
        {actions ? <div className="dq-panel__actions dq-print-hide">{actions}</div> : null}
      </header>
      <div className="dq-panel__body">{children}</div>
    </section>
  );
}

/* --------------------------------- المؤشرات ------------------------------- */

function Kpi({ label, value, children, testId }: { label: string; value: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="dq-kpi" data-testid={testId}>
      <span className="dq-kpi__label">{label}</span>
      <strong className="dq-kpi__value">{value}</strong>
      <div className="dq-kpi__meta">{children}</div>
    </div>
  );
}

function KpiRow({ comparison }: { comparison: Comparison }) {
  const { totals, indicators } = comparison;
  return (
    <div className="dq-kpis">
      <Kpi label="إجمالي مبلغ المتأخرات" value={<Num>{fmtMoney(totals.amountB)}</Num>} testId="dq-kpi-amount">
        <Delta value={totals.amountDelta} format={fmtSignedMoney} strong />
        <PctDelta value={totals.amountPct} />
      </Kpi>
      <Kpi label="إجمالي عدد العملاء" value={<Num>{fmtInt(totals.clientsB)}</Num>} testId="dq-kpi-clients">
        <Delta value={totals.clientsDelta} format={fmtSignedInt} strong />
        <PctDelta value={totals.clientsPct} />
      </Kpi>
      <Kpi label="حصة NPL من المبلغ" value={<Num>{fmtPct(indicators.nplShareB)}</Num>} testId="dq-kpi-npl">
        <Delta value={indicators.nplShareDelta} format={fmtSignedPoints} strong />
      </Kpi>
    </div>
  );
}

/* -------------------------------- جدول المقارنة --------------------------- */

function ComparisonTable({ comparison }: { comparison: Comparison }) {
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const { totals } = comparison;
  return (
    <Panel title={`مقارنة الشرائح — ${branchLabel(comparison.a.branch)}`} id="dq-comparison">
      <div className="dq-tablewrap">
        <table className="dq-table" data-testid="dq-comparison-table">
          <thead>
            <tr>
              <th rowSpan={2} className="dq-table__bucket">الشريحة</th>
              <th colSpan={4} className="dq-table__group">عدد العملاء</th>
              <th colSpan={4} className="dq-table__group">مبلغ المتأخرات</th>
            </tr>
            <tr>
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>الفرق</th>
              <th>النسبة</th>
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>الفرق</th>
              <th>النسبة</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.bucket} data-bucket={row.bucket}>
                <th scope="row" className="dq-table__bucket">{bucketLabel(row.bucket)}</th>
                <td><Num>{fmtInt(row.clientsA)}</Num></td>
                <td><Num>{fmtInt(row.clientsB)}</Num></td>
                <td><Delta value={row.clientsDelta} format={fmtSignedInt} /></td>
                <td><PctDelta value={row.clientsPct} /></td>
                <td><Num>{fmtMoney(row.amountA)}</Num></td>
                <td><Num>{fmtMoney(row.amountB)}</Num></td>
                <td><Delta value={row.amountDelta} format={fmtSignedMoney} /></td>
                <td><PctDelta value={row.amountPct} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="dq-total-row">
              <th scope="row" className="dq-table__bucket">الإجمالي</th>
              <td><Num>{fmtInt(totals.clientsA)}</Num></td>
              <td><Num>{fmtInt(totals.clientsB)}</Num></td>
              <td><Delta value={totals.clientsDelta} format={fmtSignedInt} strong /></td>
              <td><PctDelta value={totals.clientsPct} /></td>
              <td><Num>{fmtMoney(totals.amountA)}</Num></td>
              <td><Num>{fmtMoney(totals.amountB)}</Num></td>
              <td><Delta value={totals.amountDelta} format={fmtSignedMoney} strong /></td>
              <td><PctDelta value={totals.amountPct} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

/* -------------------------------- مقارنة الفروع --------------------------- */

function BranchesPanel({ comparison, branches }: { comparison: Comparison; branches: BranchComparisonRow[] }) {
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  return (
    <Panel title="مقارنة الفروع" id="dq-branches">
      <div className="dq-tablewrap">
        <table className="dq-table" data-testid="dq-branches-table">
          <thead>
            <tr>
              <th rowSpan={2} className="dq-table__bucket">الفرع</th>
              <th colSpan={3} className="dq-table__group">عدد العملاء</th>
              <th colSpan={4} className="dq-table__group">مبلغ المتأخرات</th>
            </tr>
            <tr>
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>الفرق</th>
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>الفرق</th>
              <th>النسبة</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((row) => {
              const { totals } = row.comparison;
              return (
                <tr key={row.branch} className={row.branch === comparison.a.branch ? 'dq-row--current' : undefined}>
                  <th scope="row" className="dq-table__bucket">{branchLabel(row.branch)}</th>
                  <td><Num>{fmtInt(totals.clientsA)}</Num></td>
                  <td><Num>{fmtInt(totals.clientsB)}</Num></td>
                  <td><Delta value={totals.clientsDelta} format={fmtSignedInt} /></td>
                  <td><Num>{fmtMoney(totals.amountA)}</Num></td>
                  <td><Num>{fmtMoney(totals.amountB)}</Num></td>
                  <td><Delta value={totals.amountDelta} format={fmtSignedMoney} strong /></td>
                  <td><PctDelta value={totals.amountPct} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------------------------------- اللوحة -------------------------------- */

export interface DashboardProps {
  comparison: Comparison;
  /** مقارنة الفروع لنفس الشهرين — تُعرض إذا وُجد أكثر من فرع */
  branches?: BranchComparisonRow[];
}

export function ComparisonDashboard({ comparison, branches }: DashboardProps) {
  return (
    <div className="dq-dashboard" data-testid="dq-dashboard">
      <KpiRow comparison={comparison} />
      <ComparisonTable comparison={comparison} />
      {branches && branches.length > 1 ? <BranchesPanel comparison={comparison} branches={branches} /> : null}
    </div>
  );
}
