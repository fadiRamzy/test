/**
 * لوحة مقارنة شهرين: مؤشرات، ملخص تنفيذي، رسوم، جدول مقارنة، أداء الفرع، ومصفوفة الترحيل.
 * مكوّن عرض خالص — يستقبل بيانات الشهرين ويحسب كل شيء عبر المحرك الحسابي.
 */

import { useMemo, type ReactNode } from 'react';
import { Badge, Callout, Icon, type IconName, type Tone } from '../ui/kit';
import {
  BUCKETS,
  BUCKET_IDS,
  MONTH_NAMES_AR,
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
  snapshotPeriod,
  snapshotTotals,
  type BranchComparisonRow,
  type BucketId,
  type Comparison,
  type MonthlySnapshot,
  type Trend,
} from '../lib/delinquency';
import { TONE_LABELS, type ExecutiveSummary, type ObservationTone } from '../lib/delinquencySummary';
import {
  EXIT_STATE_LABEL,
  FROM_STATES,
  NEW_STATE_LABEL,
  TO_STATES,
  buildNetChangeFrame,
  type MigrationResult,
  type Reconciliation,
} from '../lib/delinquencyMigration';
import {
  BUCKET_COLORS,
  ChangeBars,
  CompositionBars,
  GroupedBarChart,
  SERIES_A_COLOR,
  SERIES_B_COLOR,
  TrendChart,
} from './charts';

/* -------------------------------- عناصر صغيرة ----------------------------- */

const trendTone = (trend: Trend): 'up' | 'down' | 'flat' => trend;

const toneOfDelta = (value: number | null | undefined): 'up' | 'down' | 'flat' =>
  !value ? 'flat' : value > 0 ? 'up' : 'down';

/** قيمة تغير ملوّنة: الزيادة في المتأخرات حمراء والانخفاض أخضر */
export function Delta({ value, format, strong }: { value: number | null; format: (value: number | null) => string; strong?: boolean }) {
  const tone = toneOfDelta(value);
  return (
    <span className={`dq-delta dq-tone--${tone}${strong ? ' dq-delta--strong' : ''}`} dir="ltr">
      {value !== null && tone !== 'flat' ? <span className="dq-delta__arrow" aria-hidden="true">{tone === 'up' ? '▲' : '▼'}</span> : null}
      {format(value)}
    </span>
  );
}

/** نسبة تغير؛ عند غياب الأساس (القيمة السابقة صفر) تُعرض «جديد» بدل نسبة مضللة */
function PctDelta({ value, hasChange }: { value: number | null; hasChange: boolean }) {
  if (value === null) {
    return hasChange ? (
      <span className="dq-newtag" title="لا يوجد أساس للمقارنة: القيمة في شهر الأساس صفر">جديد</span>
    ) : (
      <span className="dq-muted">—</span>
    );
  }
  return <Delta value={value} format={fmtSignedPct} />;
}

const Num = ({ children }: { children: ReactNode }) => (
  <span className="dq-num" dir="ltr">
    {children}
  </span>
);

export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`dq-panel${className ? ` ${className}` : ''}`} id={id} aria-label={title}>
      <header className="dq-panel__head">
        <div className="dq-panel__title">
          {icon ? (
            <span className="dq-panel__icon" aria-hidden="true">
              <Icon name={icon} size={16} />
            </span>
          ) : null}
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="dq-panel__actions dq-print-hide">{actions}</div> : null}
      </header>
      <div className="dq-panel__body">{children}</div>
    </section>
  );
}

const TONE_TO_BADGE: Record<ObservationTone, Tone> = { danger: 'danger', warning: 'warning', success: 'success', info: 'info' };

/* --------------------------------- المؤشرات ------------------------------- */

function Kpi({
  label,
  value,
  tone,
  children,
  testId,
}: {
  label: string;
  value: ReactNode;
  tone: 'up' | 'down' | 'flat';
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={`dq-kpi dq-kpi--${tone}`} data-testid={testId}>
      <span className="dq-kpi__label">{label}</span>
      <strong className="dq-kpi__value">{value}</strong>
      <div className="dq-kpi__meta">{children}</div>
    </div>
  );
}

function KpiRow({ comparison }: { comparison: Comparison }) {
  const { totals, indicators, performance } = comparison;
  const labelA = periodLabel(comparison.a);
  const statusLabel =
    performance.status === 'net_increase' ? 'زيادة صافية' : performance.status === 'net_reduction' ? 'انخفاض صافٍ' : 'لا تغير';
  return (
    <div className="dq-kpis">
      <Kpi label="إجمالي مبلغ المتأخرات" value={<Num>{fmtMoney(totals.amountB)}</Num>} tone={trendTone(totals.amountTrend)} testId="dq-kpi-amount">
        <Delta value={totals.amountDelta} format={fmtSignedMoney} strong />
        <PctDelta value={totals.amountPct} hasChange={totals.amountDelta !== 0} />
        <span className="dq-kpi__base">
          {labelA}: <Num>{fmtMoney(totals.amountA)}</Num>
        </span>
      </Kpi>
      <Kpi label="عدد العملاء المتأخرين" value={<Num>{fmtInt(totals.clientsB)}</Num>} tone={trendTone(totals.clientsTrend)} testId="dq-kpi-clients">
        <Delta value={totals.clientsDelta} format={fmtSignedInt} strong />
        <PctDelta value={totals.clientsPct} hasChange={totals.clientsDelta !== 0} />
        <span className="dq-kpi__base">
          {labelA}: <Num>{fmtInt(totals.clientsA)}</Num>
        </span>
      </Kpi>
      <Kpi
        label="حصة NPL من إجمالي المتأخرات"
        value={<Num>{fmtPct(indicators.nplShareB)}</Num>}
        tone={toneOfDelta(indicators.nplShareDelta !== null && Math.abs(indicators.nplShareDelta) < 0.05 ? 0 : indicators.nplShareDelta)}
        testId="dq-kpi-npl"
      >
        <Delta value={indicators.nplShareDelta} format={fmtSignedPoints} strong />
        <span className="dq-kpi__base">
          {labelA}: <Num>{fmtPct(indicators.nplShareA)}</Num>
        </span>
      </Kpi>
      <Kpi label="صافي أداء الفرع" value={statusLabel} tone={trendTone(totals.amountTrend)} testId="dq-kpi-status">
        <span className="dq-kpi__pair">
          <span className="dq-tone--down">
            نقص الشرائح: <Num>{fmtMoney(performance.amountReduction)}</Num>
          </span>
          <span className="dq-tone--up">
            زيادة الشرائح: <Num>{fmtMoney(performance.amountIncrease)}</Num>
          </span>
        </span>
      </Kpi>
    </div>
  );
}

/* ------------------------------ الملخص التنفيذي --------------------------- */

function SummaryPanel({ summary }: { summary: ExecutiveSummary }) {
  return (
    <Panel title="الملخص التنفيذي" subtitle="أبرز ملاحظات المخاطر المستخلصة من الأرقام المدخلة" icon="flag" id="dq-summary">
      <div className={`dq-headline dq-headline--${summary.tone}`} data-testid="dq-headline">
        <Icon name={summary.tone === 'success' ? 'check' : summary.tone === 'danger' ? 'alert' : 'info'} size={18} />
        <strong>{summary.headline}</strong>
      </div>
      <ul className="dq-observations">
        {summary.observations.map((observation) => (
          <li key={observation.id} className={`dq-observation dq-observation--${observation.tone}`}>
            <Badge tone={TONE_TO_BADGE[observation.tone]}>{TONE_LABELS[observation.tone]}</Badge>
            <div>
              <strong>{observation.title}</strong>
              <p>{observation.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="dq-caveats">
        <strong>تنبيهات منهجية</strong>
        <ul>
          {summary.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* -------------------------------- جدول المقارنة --------------------------- */

function ComparisonTable({ comparison }: { comparison: Comparison }) {
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const { totals } = comparison;
  return (
    <Panel
      title="جدول مقارنة الشرائح"
      subtitle={`التغير = ${labelB} − ${labelA} · الأحمر زيادة في المتأخرات والأخضر انخفاض`}
      icon="list"
      id="dq-comparison"
    >
      <div className="dq-tablewrap">
        <table className="dq-table" data-testid="dq-comparison-table">
          <thead>
            <tr>
              <th rowSpan={2} className="dq-table__bucket">الشريحة</th>
              <th colSpan={4} className="dq-table__group">عدد العملاء المتأخرين</th>
              <th colSpan={4} className="dq-table__group">مبلغ المتأخرات</th>
              <th colSpan={2} className="dq-table__group">الحصة من المبلغ</th>
            </tr>
            <tr>
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>التغير</th>
              <th>النسبة</th>
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>التغير</th>
              <th>النسبة</th>
              <th>{labelA}</th>
              <th>{labelB}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.bucket} data-bucket={row.bucket}>
                <th scope="row" className="dq-table__bucket">
                  <span className="dq-bucket">
                    <span className="dq-bucket__dot" style={{ background: BUCKET_COLORS[row.bucket] }} />
                    {bucketLabel(row.bucket)}
                  </span>
                  {row.bucket === comparison.best && comparison.bestImproved ? <span className="dq-flag dq-flag--best">الأفضل</span> : null}
                  {row.bucket === comparison.worst && comparison.worstDeteriorated ? <span className="dq-flag dq-flag--worst">الأسوأ</span> : null}
                </th>
                <td><Num>{fmtInt(row.clientsA)}</Num></td>
                <td><Num>{fmtInt(row.clientsB)}</Num></td>
                <td><Delta value={row.clientsDelta} format={fmtSignedInt} /></td>
                <td><PctDelta value={row.clientsPct} hasChange={row.clientsDelta !== 0} /></td>
                <td><Num>{fmtMoney(row.amountA)}</Num></td>
                <td><Num>{fmtMoney(row.amountB)}</Num></td>
                <td><Delta value={row.amountDelta} format={fmtSignedMoney} /></td>
                <td><PctDelta value={row.amountPct} hasChange={row.amountDelta !== 0} /></td>
                <td><Num>{fmtPct(row.amountShareA)}</Num></td>
                <td><Num>{fmtPct(row.amountShareB)}</Num></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="dq-total-row">
              <th scope="row" className="dq-table__bucket">الإجمالي</th>
              <td><Num>{fmtInt(totals.clientsA)}</Num></td>
              <td><Num>{fmtInt(totals.clientsB)}</Num></td>
              <td><Delta value={totals.clientsDelta} format={fmtSignedInt} strong /></td>
              <td><PctDelta value={totals.clientsPct} hasChange={totals.clientsDelta !== 0} /></td>
              <td><Num>{fmtMoney(totals.amountA)}</Num></td>
              <td><Num>{fmtMoney(totals.amountB)}</Num></td>
              <td><Delta value={totals.amountDelta} format={fmtSignedMoney} strong /></td>
              <td><PctDelta value={totals.amountPct} hasChange={totals.amountDelta !== 0} /></td>
              <td><Num>{totals.amountA === 0 ? '—' : fmtPct(100)}</Num></td>
              <td><Num>{totals.amountB === 0 ? '—' : fmtPct(100)}</Num></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

/* ---------------------------------- الرسوم -------------------------------- */

function ChartsGrid({ comparison, history }: { comparison: Comparison; history: MonthlySnapshot[] }) {
  const labelA = periodLabel(comparison.a);
  const labelB = periodLabel(comparison.b);
  const categories = BUCKETS.map((bucket) => bucket.short);
  const periodA = snapshotPeriod(comparison.a);
  const periodB = snapshotPeriod(comparison.b);

  const trend = useMemo(() => history.slice(-12), [history]);

  return (
    <div className="dq-grid dq-grid--2">
      <Panel title="مبلغ المتأخرات حسب الشريحة" subtitle={`${labelA} مقابل ${labelB}`} icon="chart">
        <GroupedBarChart
          ariaLabel={`مبلغ المتأخرات حسب الشريحة: ${labelA} مقابل ${labelB}`}
          categories={categories}
          formatFull={fmtMoney}
          series={[
            { label: labelA, color: SERIES_A_COLOR, values: comparison.rows.map((row) => row.amountA) },
            { label: labelB, color: SERIES_B_COLOR, values: comparison.rows.map((row) => row.amountB) },
          ]}
        />
      </Panel>
      <Panel title="عدد العملاء المتأخرين حسب الشريحة" subtitle={`${labelA} مقابل ${labelB}`} icon="employees">
        <GroupedBarChart
          ariaLabel={`عدد العملاء المتأخرين حسب الشريحة: ${labelA} مقابل ${labelB}`}
          categories={categories}
          formatFull={fmtInt}
          integers
          series={[
            { label: labelA, color: SERIES_A_COLOR, values: comparison.rows.map((row) => row.clientsA) },
            { label: labelB, color: SERIES_B_COLOR, values: comparison.rows.map((row) => row.clientsB) },
          ]}
        />
      </Panel>
      <Panel title="صافي التغير في المبلغ لكل شريحة" subtitle="صافي تغير الأرصدة — ليس حركة عملاء ولا تحصيلًا مؤكدًا" icon="evaluations">
        <ChangeBars
          ariaLabel="صافي التغير في مبلغ المتأخرات لكل شريحة"
          items={comparison.rows.map((row) => ({
            label: bucketLabel(row.bucket),
            value: row.amountDelta,
            display: fmtSignedMoney(row.amountDelta),
            hint: row.amountPct === null ? undefined : fmtSignedPct(row.amountPct),
          }))}
        />
      </Panel>
      <Panel title="تركيب المتأخرات حسب الشريحة" subtitle="حصة كل شريحة من إجمالي مبلغ المتأخرات" icon="dashboard">
        <CompositionBars
          ariaLabel="تركيب المتأخرات حسب الشريحة في الشهرين"
          rows={[
            { label: labelA, shares: comparison.rows.map((row) => row.amountShareA) },
            { label: labelB, shares: comparison.rows.map((row) => row.amountShareB) },
          ]}
        />
      </Panel>
      {trend.length >= 3 ? (
        <Panel title="اتجاه المتأخرات عبر الشهور" subtitle="إجمالي المتأخرات ورصيد NPL لكل شهر مُدخل (حتى آخر 12 شهرًا)" icon="history" className="dq-span-2">
          <TrendChart
            ariaLabel="اتجاه إجمالي المتأخرات ورصيد NPL عبر الشهور"
            formatFull={fmtMoney}
            series={[
              { label: 'إجمالي المتأخرات', color: SERIES_B_COLOR },
              { label: 'رصيد NPL (أكثر من 120 يوم)', color: BUCKET_COLORS.npl },
            ]}
            points={trend.map((snapshot) => ({
              label: MONTH_NAMES_AR[snapshot.month - 1],
              sublabel: String(snapshot.year),
              values: [snapshotTotals(snapshot.buckets).amount, snapshot.buckets.npl.amount],
              highlight: snapshotPeriod(snapshot) === periodA || snapshotPeriod(snapshot) === periodB,
            }))}
          />
        </Panel>
      ) : null}
    </div>
  );
}

/* -------------------------------- أداء الفرع ------------------------------ */

function PerformancePanel({ comparison }: { comparison: Comparison }) {
  const { performance, rows } = comparison;
  const best = comparison.best ? rows.find((row) => row.bucket === comparison.best) : null;
  const worst = comparison.worst ? rows.find((row) => row.bucket === comparison.worst) : null;

  return (
    <Panel
      title={`أداء الفرع — ${branchLabel(comparison.a.branch)}`}
      subtitle="إجمالي النقص والزيادة الصافية في المتأخرات بين الشهرين"
      icon="building"
      id="dq-performance"
    >
      <div className="dq-perf">
        <div className="dq-perf__col">
          <h3>مبالغ المتأخرات</h3>
          <dl className="dq-deflist">
            <div>
              <dt>إجمالي النقص الصافي في الشرائح المنخفضة</dt>
              <dd className="dq-tone--down" data-testid="dq-perf-reduction"><Num>{fmtMoney(performance.amountReduction)}</Num></dd>
            </div>
            <div>
              <dt>إجمالي الزيادة الصافية في الشرائح المرتفعة</dt>
              <dd className="dq-tone--up" data-testid="dq-perf-increase"><Num>{fmtMoney(performance.amountIncrease)}</Num></dd>
            </div>
            <div className="dq-deflist__total">
              <dt>صافي التغير في إجمالي المتأخرات</dt>
              <dd data-testid="dq-perf-net">
                <Delta value={performance.amountNet} format={fmtSignedMoney} strong />
                <PctDelta value={performance.amountPct} hasChange={performance.amountNet !== 0} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="dq-perf__col">
          <h3>أعداد العملاء المتأخرين</h3>
          <dl className="dq-deflist">
            <div>
              <dt>إجمالي النقص الصافي في الشرائح المنخفضة</dt>
              <dd className="dq-tone--down"><Num>{fmtInt(performance.clientsReduction)}</Num></dd>
            </div>
            <div>
              <dt>إجمالي الزيادة الصافية في الشرائح المرتفعة</dt>
              <dd className="dq-tone--up"><Num>{fmtInt(performance.clientsIncrease)}</Num></dd>
            </div>
            <div className="dq-deflist__total">
              <dt>صافي التغير في عدد العملاء</dt>
              <dd>
                <Delta value={performance.clientsNet} format={fmtSignedInt} strong />
                <PctDelta value={performance.clientsPct} hasChange={performance.clientsNet !== 0} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="dq-perf__col">
          <h3>أفضل وأسوأ الشرائح</h3>
          {best && worst ? (
            <div className="dq-bestworst">
              <div className={`dq-bw dq-bw--${comparison.bestImproved ? 'best' : 'neutral'}`} data-testid="dq-best">
                <span className="dq-bw__tag">{comparison.bestImproved ? 'أفضل شريحة أداءً' : 'الأقل زيادة (لم تنخفض أي شريحة)'}</span>
                <strong>{bucketLabel(best.bucket)}</strong>
                <span className="dq-bw__meta">
                  <Delta value={best.amountDelta} format={fmtSignedMoney} />
                  <PctDelta value={best.amountPct} hasChange={best.amountDelta !== 0} />
                </span>
              </div>
              <div className={`dq-bw dq-bw--${comparison.worstDeteriorated ? 'worst' : 'neutral'}`} data-testid="dq-worst">
                <span className="dq-bw__tag">{comparison.worstDeteriorated ? 'أسوأ شريحة أداءً' : 'الأقل تحسنًا (لم ترتفع أي شريحة)'}</span>
                <strong>{bucketLabel(worst.bucket)}</strong>
                <span className="dq-bw__meta">
                  <Delta value={worst.amountDelta} format={fmtSignedMoney} />
                  <PctDelta value={worst.amountPct} hasChange={worst.amountDelta !== 0} />
                </span>
              </div>
            </div>
          ) : (
            <p className="dq-muted">لا يوجد تغير بين الشهرين في أي شريحة.</p>
          )}
          <p className="dq-hint">المعيار: صافي التغير في مبلغ المتأخرات (الأكبر انخفاضًا = الأفضل).</p>
        </div>
      </div>
      <Callout tone="warning">
        <strong>تنبيه: </strong>
        صافي انخفاض المتأخرات لا يُصنَّف «تحصيلًا مؤكدًا». قد ينتج الانخفاض عن سداد أو تسوية أو إعادة جدولة أو إعدام أو انتقال العميل لشريحة أخرى؛ تأكيد التحصيل يتطلب سجلات تحصيل فعلية.
      </Callout>
    </Panel>
  );
}

/* ------------------------------ مصفوفة الترحيل ---------------------------- */

const fromLabel = (state: (typeof FROM_STATES)[number]): string => (state === 'new' ? NEW_STATE_LABEL : bucketLabel(state));
const toLabel = (state: (typeof TO_STATES)[number]): string => (state === 'exit' ? EXIT_STATE_LABEL : bucketLabel(state));

function cellKind(from: (typeof FROM_STATES)[number], to: (typeof TO_STATES)[number]): string {
  if (from === 'new') return 'new';
  if (to === 'exit') return 'exit';
  const diff = BUCKET_IDS.indexOf(to as BucketId) - BUCKET_IDS.indexOf(from as BucketId);
  return diff === 0 ? 'stay' : diff > 0 ? 'forward' : 'backward';
}

function ActualMatrix({ migration }: { migration: MigrationResult }) {
  return (
    <>
      <div className="dq-flowstats" data-testid="dq-flowstats">
        <div className="dq-flowstat dq-flowstat--forward">
          <span>انتقلوا لشريحة أسوأ</span>
          <strong><Num>{fmtInt(migration.forward)}</Num></strong>
          <small><Num>{fmtPct(migration.forwardRate)}</Num> من عملاء شهر الأساس</small>
        </div>
        <div className="dq-flowstat dq-flowstat--stay">
          <span>بقوا في نفس الشريحة</span>
          <strong><Num>{fmtInt(migration.stayed)}</Num></strong>
          <small><Num>{fmtPct(migration.stayedRate)}</Num></small>
        </div>
        <div className="dq-flowstat dq-flowstat--backward">
          <span>تحسنوا لشريحة أحدث</span>
          <strong><Num>{fmtInt(migration.backward)}</Num></strong>
          <small><Num>{fmtPct(migration.backwardRate)}</Num></small>
        </div>
        <div className="dq-flowstat dq-flowstat--exit">
          <span>خرجوا من قائمة المتأخرات</span>
          <strong><Num>{fmtInt(migration.exited)}</Num></strong>
          <small>السبب غير محدد · <Num>{fmtPct(migration.exitRate)}</Num></small>
        </div>
        <div className="dq-flowstat dq-flowstat--new">
          <span>دخول جديد للقائمة</span>
          <strong><Num>{fmtInt(migration.entered)}</Num></strong>
          <small>انتقل إلى NPL: <Num>{fmtInt(migration.intoNpl)}</Num></small>
        </div>
      </div>
      <div className="dq-tablewrap">
        <table className="dq-table dq-matrix" data-testid="dq-matrix-actual">
          <thead>
            <tr>
              <th className="dq-matrix__corner">من (شهر الأساس) ↓ / إلى (شهر المقارنة) ←</th>
              {TO_STATES.map((to) => (
                <th key={to}>{toLabel(to)}</th>
              ))}
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {FROM_STATES.map((from) => (
              <tr key={from}>
                <th scope="row" className="dq-table__bucket">{fromLabel(from)}</th>
                {TO_STATES.map((to) => {
                  if (from === 'new' && to === 'exit') return <td key={to} className="dq-matrix__na">—</td>;
                  const cell = migration.matrix[from][to];
                  return (
                    <td key={to} className={`dq-matrix__cell dq-matrix__cell--${cell.clients ? cellKind(from, to) : 'zero'}`} data-cell={`${from}>${to}`}>
                      <Num>{fmtInt(cell.clients)}</Num>
                      {migration.hasAmounts && cell.clients ? <small dir="ltr">{fmtMoney(cell.amount)}</small> : null}
                    </td>
                  );
                })}
                <td className="dq-matrix__total">
                  <Num>{fmtInt(migration.rowTotals[from].clients)}</Num>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="dq-table__bucket">الإجمالي</th>
              {TO_STATES.map((to) => (
                <td key={to}>
                  <Num>{fmtInt(migration.columnTotals[to].clients)}</Num>
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <ul className="dq-legend dq-legend--matrix">
        <li><span className="dq-legend__dot dq-legend__dot--stay" />بقاء في الشريحة</li>
        <li><span className="dq-legend__dot dq-legend__dot--forward" />انتقال لشريحة أسوأ</li>
        <li><span className="dq-legend__dot dq-legend__dot--backward" />تحسن لشريحة أحدث</li>
        <li><span className="dq-legend__dot dq-legend__dot--exit" />خروج من القائمة (السبب غير محدد)</li>
        <li><span className="dq-legend__dot dq-legend__dot--new" />دخول جديد</li>
      </ul>
    </>
  );
}

function AggregateFrame({ comparison }: { comparison: Comparison }) {
  const frame = buildNetChangeFrame(comparison.a.buckets, comparison.b.buckets);
  return (
    <div className="dq-tablewrap">
      <table className="dq-table dq-matrix" data-testid="dq-matrix-aggregate">
        <thead>
          <tr>
            <th className="dq-matrix__corner">من (شهر الأساس) ↓ / إلى (شهر المقارنة) ←</th>
            {BUCKETS.map((bucket) => (
              <th key={bucket.id}>{bucket.label}</th>
            ))}
            <th>إجمالي {periodLabel(comparison.a)}</th>
          </tr>
        </thead>
        <tbody>
          {BUCKET_IDS.map((from) => (
            <tr key={from}>
              <th scope="row" className="dq-table__bucket">{bucketLabel(from)}</th>
              {BUCKET_IDS.map((to) => (
                <td key={to} className="dq-matrix__na" title="غير متاح: يتطلب أرقام العملاء">؟</td>
              ))}
              <td className="dq-matrix__total">
                <Num>{fmtInt(frame.rowTotals[from].clients)}</Num>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="dq-table__bucket">إجمالي {periodLabel(comparison.b)}</th>
            {BUCKET_IDS.map((id) => (
              <td key={id}>
                <Num>{fmtInt(frame.columnTotals[id].clients)}</Num>
              </td>
            ))}
            <td />
          </tr>
          <tr className="dq-matrix__net">
            <th scope="row" className="dq-table__bucket">صافي التغير في العملاء</th>
            {BUCKET_IDS.map((id) => (
              <td key={id}>
                <Delta value={frame.netClients[id]} format={fmtSignedInt} />
              </td>
            ))}
            <td />
          </tr>
          <tr className="dq-matrix__net">
            <th scope="row" className="dq-table__bucket">صافي التغير في المبلغ</th>
            {BUCKET_IDS.map((id) => (
              <td key={id}>
                <Delta value={frame.netAmount[id]} format={fmtSignedMoney} />
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MigrationPanel({
  comparison,
  migration,
  reconciliation,
  frozen,
  actions,
}: {
  comparison: Comparison;
  migration: MigrationResult | null;
  reconciliation?: { a: Reconciliation | null; b: Reconciliation | null };
  frozen?: boolean;
  actions?: ReactNode;
}) {
  const mismatched = [
    reconciliation?.a && !reconciliation.a.matches ? periodLabel(comparison.a) : null,
    reconciliation?.b && !reconciliation.b.matches ? periodLabel(comparison.b) : null,
  ].filter(Boolean) as string[];

  return (
    <Panel
      title="مصفوفة الترحيل بين الشرائح"
      subtitle={
        migration
          ? 'ترحيل فعلي محسوب بمطابقة أرقام العملاء بين قائمتي الشهرين'
          : 'إطار من البيانات الإجمالية: المجاميع وصافي التغير فقط — دون حركة عملاء'
      }
      icon="restore"
      id="dq-migration"
      actions={actions}
    >
      <div className="dq-modebar">
        <Badge tone={migration ? 'success' : 'neutral'}>{migration ? 'ترحيل فعلي (بأرقام العملاء)' : 'صافي تغير فقط (بيانات إجمالية)'}</Badge>
        {migration ? (
          <span className="dq-muted">
            عملاء القائمتين: <Num>{fmtInt(migration.clientsA)}</Num> في {periodLabel(comparison.a)} · <Num>{fmtInt(migration.clientsB)}</Num> في {periodLabel(comparison.b)}
          </span>
        ) : null}
      </div>

      {migration ? <ActualMatrix migration={migration} /> : <AggregateFrame comparison={comparison} />}

      {migration ? (
        <>
          {mismatched.length ? (
            <Callout tone="warning">
              أعداد أو مبالغ قائمة العملاء لا تطابق الإجماليات المدخلة يدويًا في: {mismatched.join('، ')}. المصفوفة مبنية على قائمة العملاء، وجدول المقارنة على الإجماليات المدخلة — راجع البيانات.
            </Callout>
          ) : null}
          <Callout tone="info">
            «خرج من قائمة المتأخرات» يعني أن العميل لم يعد ضمن المتأخرين في شهر المقارنة، دون تحديد السبب (سداد، تسوية، إعادة جدولة، إعدام…). لا يُحتسب ذلك تحصيلًا مؤكدًا دون سجلات تحصيل.
          </Callout>
        </>
      ) : (
        <Callout tone="info">
          <strong>لماذا الخلايا «؟»: </strong>
          الأرقام الإجمالية تعطي مجاميع الصفوف (أعداد شهر الأساس) ومجاميع الأعمدة (أعداد شهر المقارنة) وصافي التغير فقط. حركة العملاء الفعلية من شريحة إلى أخرى لا يمكن استنتاجها من الإجماليات، ولذلك لا تُعرض أي أرقام ترحيل مُقدَّرة.
          {frozen ? ' هذه المقارنة حُفظت دون قوائم عملاء.' : ' لحساب الترحيل الفعلي أضف قائمة العملاء (رقم العميل وأيام التأخير) لكل من الشهرين من تبويب «إدخال البيانات».'}
        </Callout>
      )}
    </Panel>
  );
}

/* -------------------------------- مقارنة الفروع --------------------------- */

function BranchesPanel({ comparison, branches }: { comparison: Comparison; branches: BranchComparisonRow[] }) {
  return (
    <Panel
      title="أداء الفروع لنفس الشهرين"
      subtitle={`${periodLabel(comparison.a)} مقابل ${periodLabel(comparison.b)} — مرتبة من الأفضل (أكبر انخفاض صافٍ) إلى الأسوأ`}
      icon="building"
      id="dq-branches"
    >
      <div className="dq-tablewrap">
        <table className="dq-table" data-testid="dq-branches-table">
          <thead>
            <tr>
              <th className="dq-table__bucket">الفرع</th>
              <th>العملاء (الأساس)</th>
              <th>العملاء (المقارنة)</th>
              <th>تغير العملاء</th>
              <th>المبلغ (الأساس)</th>
              <th>المبلغ (المقارنة)</th>
              <th>صافي تغير المبلغ</th>
              <th>النسبة</th>
              <th>نقص الشرائح</th>
              <th>زيادة الشرائح</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((row) => {
              const { totals, performance } = row.comparison;
              return (
                <tr key={row.branch} className={row.branch === comparison.a.branch ? 'dq-row--current' : undefined}>
                  <th scope="row" className="dq-table__bucket">{branchLabel(row.branch)}</th>
                  <td><Num>{fmtInt(totals.clientsA)}</Num></td>
                  <td><Num>{fmtInt(totals.clientsB)}</Num></td>
                  <td><Delta value={totals.clientsDelta} format={fmtSignedInt} /></td>
                  <td><Num>{fmtMoney(totals.amountA)}</Num></td>
                  <td><Num>{fmtMoney(totals.amountB)}</Num></td>
                  <td><Delta value={totals.amountDelta} format={fmtSignedMoney} strong /></td>
                  <td><PctDelta value={totals.amountPct} hasChange={totals.amountDelta !== 0} /></td>
                  <td className="dq-tone--down"><Num>{fmtMoney(performance.amountReduction)}</Num></td>
                  <td className="dq-tone--up"><Num>{fmtMoney(performance.amountIncrease)}</Num></td>
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
  summary: ExecutiveSummary;
  migration: MigrationResult | null;
  /** كل شهور الفرع (للاتجاه الزمني) */
  history: MonthlySnapshot[];
  /** مقارنة الفروع لنفس الشهرين — تُعرض إذا وُجد أكثر من فرع */
  branches?: BranchComparisonRow[];
  reconciliation?: { a: Reconciliation | null; b: Reconciliation | null };
  /** عرض مقارنة محفوظة (بيانات مجمّدة) */
  frozen?: boolean;
  migrationActions?: ReactNode;
}

export function ComparisonDashboard({
  comparison,
  summary,
  migration,
  history,
  branches,
  reconciliation,
  frozen,
  migrationActions,
}: DashboardProps) {
  return (
    <div className="dq-dashboard" data-testid="dq-dashboard">
      <KpiRow comparison={comparison} />
      <SummaryPanel summary={summary} />
      <ChartsGrid comparison={comparison} history={history} />
      <ComparisonTable comparison={comparison} />
      <PerformancePanel comparison={comparison} />
      <MigrationPanel comparison={comparison} migration={migration} reconciliation={reconciliation} frozen={frozen} actions={migrationActions} />
      {branches && branches.length > 1 ? <BranchesPanel comparison={comparison} branches={branches} /> : null}
    </div>
  );
}
