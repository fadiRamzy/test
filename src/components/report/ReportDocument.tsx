import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EmployeeReportModel } from '../../lib/reportModel';
import { fmtDate, fmtDateTime, fmtDecimal, fmtMinutes, fmtNumber, fmtPercent, monthLabel } from '../../lib/format';
import { summarizeScores } from '../../lib/evaluation';
import {
  OBSERVATION_SOURCE_LABELS,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  MINUTE_OUTCOME_LABELS,
  VISIT_STATUS_LABELS,
} from '../../db/schema';

/** ارتفاع المحتوى المتاح داخل صفحة A4 (بكسل عند 96dpi) */
export const PAGE_CONTENT_HEIGHT = 968;
export const PAGE_BLOCK_GAP = 6;

export interface ReportBlock {
  id: string;
  node: ReactNode;
}

/** توزيع الكتل على صفحات بحيث لا تتجاوز أي صفحة الارتفاع المتاح */
export function paginateBlocks(heights: number[], maxHeight = PAGE_CONTENT_HEIGHT, gap = PAGE_BLOCK_GAP): number[][] {
  if (!heights.length) return [[]];
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  heights.forEach((height, index) => {
    const next = used + height + (current.length ? gap : 0);
    if (current.length && next > maxHeight) {
      pages.push(current);
      current = [index];
      used = height;
    } else {
      current.push(index);
      used = next;
    }
  });
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export function ReportDocument({ model }: { model: EmployeeReportModel }) {
  const blocks = useMemo(() => buildBlocks(model), [model]);
  const [heights, setHeights] = useState<number[]>([]);
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const measure = () => {
      const next = Array.from(element.children).map((child) => (child as HTMLElement).getBoundingClientRect().height);
      setHeights((prev) => (prev.length === next.length && prev.every((value, index) => Math.abs(value - next[index]) < 1) ? prev : next));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [blocks]);

  const pages = useMemo(() => {
    const usable = heights.length === blocks.length && heights.some((h) => h > 0) ? heights : blocks.map(() => 1);
    if (!heights.some((h) => h > 0)) {
      // بيئة بلا قياس (اختبارات/طباعة مبكرة): صفحة واحدة لكل مجموعة كتل كبيرة
      return [blocks.map((_, index) => index)];
    }
    return paginateBlocks(usable);
  }, [blocks, heights]);

  const totalPages = pages.length;

  return (
    <div className="report-doc">
      <div ref={measureRef} className="report-measure" aria-hidden="true">
        {blocks.map((block) => (
          <div key={block.id} style={{ marginBottom: PAGE_BLOCK_GAP }}>
            {block.node}
          </div>
        ))}
      </div>

      {pages.map((pageBlocks, pageIndex) => (
        <section className="report-page" key={pageIndex} aria-label={`صفحة ${pageIndex + 1}`}>
          <header className="report-page__head">
            <div className="report-page__brand">
              <span className="report-page__mark">RM</span>
              <div className="report-page__org">
                <strong>{model.organizationName}</strong>
                <span>{model.departmentName} — نظام إدارة ضباط المخاطر</span>
              </div>
            </div>
            <div className="report-page__meta">
              <div className="report-page__title">تقرير أداء ضابط مخاطر</div>
              <div>{model.employee.fullName} — {model.employee.employeeCode}</div>
              <div>الفترة: {model.periodLabel}</div>
            </div>
          </header>

          <div className="report-page__body">
            {pageBlocks.map((blockIndex) => (
              <Fragment key={blocks[blockIndex]?.id ?? blockIndex}>
                <div style={{ marginBottom: PAGE_BLOCK_GAP }}>{blocks[blockIndex]?.node}</div>
              </Fragment>
            ))}
          </div>

          <footer className="report-page__foot">
            <span>
              أُنشئ في {fmtDateTime(model.generatedAt)} — بيانات محلية داخل المتصفح
            </span>
            <span>
              صفحة {pageIndex + 1} من {totalPages}
            </span>
          </footer>
        </section>
      ))}
    </div>
  );
}

function buildBlocks(model: EmployeeReportModel): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const { employee, stats } = model;

  blocks.push({
    id: 'cover',
    node: (
      <div className="rp-cover">
        <div className="rp-cover__title">تقرير أداء ضابط المخاطر</div>
        <div className="rp-cover__sub">
          {model.organizationName} — {model.departmentName} · الفترة: {model.periodLabel}
        </div>
        <div className="rp-cover__grid">
          <div className="rp-field">
            <span>الاسم</span>
            <strong>{employee.fullName}</strong>
          </div>
          <div className="rp-field">
            <span>الرقم الوظيفي</span>
            <strong>{employee.employeeCode}</strong>
          </div>
          <div className="rp-field">
            <span>المسمى الوظيفي</span>
            <strong>{employee.jobTitle || '—'}</strong>
          </div>
          <div className="rp-field">
            <span>الفرع</span>
            <strong>{model.branchName}</strong>
          </div>
          <div className="rp-field">
            <span>المحافظة</span>
            <strong>{employee.governorate || '—'}</strong>
          </div>
          <div className="rp-field">
            <span>تاريخ التعيين</span>
            <strong>{fmtDate(employee.hireDate)}</strong>
          </div>
          <div className="rp-field">
            <span>الحالة</span>
            <strong>{employee.status === 'active' ? 'على رأس العمل' : employee.status === 'inactive' ? 'غير نشط' : 'مؤرشف'}</strong>
          </div>
          <div className="rp-field">
            <span>تاريخ التقرير</span>
            <strong>{fmtDate(model.generatedAt)}</strong>
          </div>
        </div>
      </div>
    ),
  });

  blocks.push({
    id: 'kpis',
    node: (
      <div className="rp-section">
        <div className="rp-section__title">المؤشرات التشغيلية للفترة</div>
        <div className="rp-kpis">
          <div className="rp-kpi">
            <span>نسبة الالتزام بالمهلة</span>
            <strong>{model.totals.compliancePercent === null ? '—' : fmtPercent(model.totals.compliancePercent)}</strong>
            <small>{model.totals.minutesMet} من {model.totals.minutesClosed} دقيقة مغلقة</small>
          </div>
          <div className="rp-kpi">
            <span>دقائق الصرف</span>
            <strong>{fmtNumber(model.totals.minutes)}</strong>
            <small>{model.totals.minutes - model.totals.minutesClosed} غير مغلقة</small>
          </div>
          <div className="rp-kpi">
            <span>متوسط زمن الضابط</span>
            <strong>{fmtMinutes(model.totals.minutesClosed ? Math.round(model.totals.officerMinutes / model.totals.minutesClosed) : null)}</strong>
            <small>انتظار الفرع: {fmtMinutes(model.totals.minutesClosed ? Math.round(model.totals.waitingMinutes / model.totals.minutesClosed) : null)}</small>
          </div>
          <div className="rp-kpi">
            <span>الزيارات الميدانية</span>
            <strong>{fmtNumber(model.totals.visits)}</strong>
            <small>{model.totals.visitsCompleted} مكتملة</small>
          </div>
          <div className="rp-kpi">
            <span>جودة التقارير</span>
            <strong>{model.totals.avgQuality === null ? '—' : `${fmtDecimal(model.totals.avgQuality)} / ${model.ratingScale.max}`}</strong>
            <small>{model.totals.returnedReports} أعيدت للتصحيح</small>
          </div>
          <div className="rp-kpi">
            <span>تقارير متأخرة</span>
            <strong>{fmtNumber(model.totals.delayedReports)}</strong>
            <small>حسب حد التأخير المعرّف</small>
          </div>
          <div className="rp-kpi">
            <span>الملاحظات</span>
            <strong>{fmtNumber(model.totals.observations)}</strong>
            <small>{model.totals.observationsOpen} مفتوحة · {model.totals.observationsRecurring} متكررة</small>
          </div>
          <div className="rp-kpi">
            <span>ملاحظات المعالجة</span>
            <strong>{fmtNumber(stats.observationsResolved)}</strong>
            <small>من إجمالي {model.totals.observations}</small>
          </div>
        </div>
      </div>
    ),
  });

  if (model.monthlyEvaluations.length || model.annualEvaluations.length) {
    blocks.push({
      id: 'evaluations-title',
      node: <div className="rp-section__title">التقييمات</div>,
    });

    if (model.monthlyEvaluations.length) {
      // عرض مُدوَّر: المعايير صفوفًا والشهور أعمدة — أوضح للقراءة والطباعة
      chunk(model.monthlyEvaluations, 5).forEach((monthGroup, groupIndex) => {
        blocks.push({
          id: `evaluations-monthly-${groupIndex}`,
          node: (
            <table className="rp-table">
              <thead>
                <tr>
                  <th style={{ width: '34%' }}>المعيار</th>
                  {monthGroup.map((evaluation) => (
                    <th key={evaluation.id} style={{ textAlign: 'center' }}>
                      {monthLabel(evaluation.year, evaluation.month)}
                      {evaluation.status === 'approved' ? ' ✓' : ' (مسودة)'}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center' }}>المتوسط</th>
                </tr>
              </thead>
              <tbody>
                {model.criteria.map((criterion) => {
                  const values = monthGroup
                    .map((evaluation) => evaluation.scores?.[criterion.id])
                    .filter((value): value is number => typeof value === 'number');
                  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
                  return (
                    <tr key={criterion.id}>
                      <td>{criterion.name}</td>
                      {monthGroup.map((evaluation) => (
                        <td key={evaluation.id} style={{ textAlign: 'center' }}>
                          {evaluation.scores?.[criterion.id] ?? '—'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>
                        {average === null ? '—' : average.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ fontWeight: 700 }}>مجموع الدرجات ÷ عدد المعايير المسجلة</td>
                  {monthGroup.map((evaluation) => {
                    const summary = summarizeScores(evaluation.scores, model.criteria, model.ratingScale.max);
                    return (
                      <td key={evaluation.id} style={{ textAlign: 'center', fontWeight: 700 }}>
                        {summary.sum} ÷ {summary.count}
                        {' = '}
                        {summary.average === null ? '—' : summary.average.toFixed(2)}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'center' }}>—</td>
                </tr>
              </tbody>
            </table>
          ),
        });
      });
    }

    for (const evaluation of model.annualEvaluations) {
      const summary = summarizeScores(evaluation.scores, model.criteria, model.ratingScale.max);
      blocks.push({
        id: `annual-${evaluation.id}`,
        node: (
          <div className="rp-section">
            <div className="rp-section__title">التقييم السنوي — {evaluation.year}</div>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>المعيار</th>
                  <th>الدرجة</th>
                  <th>تعليق</th>
                </tr>
              </thead>
              <tbody>
                {model.criteria.map((criterion) => (
                  <tr key={criterion.id}>
                    <td>{criterion.name}</td>
                    <td style={{ textAlign: 'center' }}>{evaluation.scores?.[criterion.id] ?? '—'}</td>
                    <td>{evaluation.comments?.[criterion.id] || '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>المتوسط (المجموع ÷ العدد المسجل)</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{summary.average === null ? '—' : summary.average.toFixed(2)}</td>
                  <td>
                    {summary.sum} ÷ {summary.count} · مقياس {model.ratingScale.min}–{model.ratingScale.max} ·{' '}
                    {evaluation.status === 'approved' ? 'معتمد' : 'مسودة'}
                  </td>
                </tr>
              </tbody>
            </table>
            {evaluation.overallComment ? <div className="rp-note">ملاحظة عامة: {evaluation.overallComment}</div> : null}
          </div>
        ),
      });
    }

    if (model.monthlyEvaluations.some((e) => e.status !== 'approved')) {
      blocks.push({
        id: 'evaluations-note',
        node: (
          <div className="rp-note">
            ملاحظة: بعض التقييمات الشهرية لا تزال مسودات غير معتمدة. المتوسط المعروض هو مجموع الدرجات المسجلة مقسومًا على
            عدد المعايير المسجلة فقط، دون أوزان أو معادلات رسمية.
          </div>
        ),
      });
    }
  } else {
    blocks.push({
      id: 'evaluations-empty',
      node: <div className="rp-note">لا توجد تقييمات مسجلة لهذه الفترة.</div>,
    });
  }

  blocks.push({ id: 'minutes-title', node: <div className="rp-section__title">دقائق الصرف ({model.minutes.length})</div> });
  if (model.minutes.length) {
    chunk(model.minutes, 11).forEach((rows, index) => {
      blocks.push({
        id: `minutes-${index}`,
        node: (
          <table className="rp-table">
            <thead>
              <tr>
                <th>رقم الدقيقة</th>
                <th>مرجع العميل</th>
                <th>النوع</th>
                <th>المبلغ</th>
                <th>الاستلام</th>
                <th>الرد النهائي</th>
                <th>زمن الضابط</th>
                <th>انتظار الفرع</th>
                <th>النتيجة</th>
                <th>المهلة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ minute, timings }) => (
                <tr key={minute.id}>
                  <td>{minute.refNo}</td>
                  <td>{minute.clientRef}</td>
                  <td>{minute.financingType || '—'}</td>
                  <td>{minute.amount === null ? '—' : fmtNumber(minute.amount)}</td>
                  <td>{fmtDateTime(minute.receivedAt)}</td>
                  <td>{minute.finalResponseAt ? fmtDateTime(minute.finalResponseAt) : '—'}</td>
                  <td>{timings.isClosed ? fmtMinutes(timings.officerMinutes) : '—'}</td>
                  <td>{timings.isClosed ? fmtMinutes(timings.waitingMinutes) : '—'}</td>
                  <td>{MINUTE_OUTCOME_LABELS[minute.outcome]}</td>
                  <td>
                    {timings.slaStatus === 'met'
                      ? 'داخل المهلة'
                      : timings.slaStatus === 'breached'
                        ? 'تجاوز المهلة'
                        : timings.slaStatus === 'overdue'
                          ? 'متأخر'
                          : timings.slaStatus === 'warning'
                            ? 'قارب المهلة'
                            : timings.slaStatus === 'pending'
                              ? 'جارٍ'
                              : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      });
    });
  } else {
    blocks.push({ id: 'minutes-empty', node: <div className="rp-note">لا توجد دقائق صرف مسجلة لهذه الفترة.</div> });
  }

  blocks.push({ id: 'visits-title', node: <div className="rp-section__title">الزيارات الميدانية والتقارير ({model.visits.length})</div> });
  if (model.visits.length) {
    chunk(model.visits, 10).forEach((rows, index) => {
      blocks.push({
        id: `visits-${index}`,
        node: (
          <table className="rp-table">
            <thead>
              <tr>
                <th>الزيارة</th>
                <th>العميل</th>
                <th>التاريخ</th>
                <th>تسليم التقرير</th>
                <th>زمن الإعداد</th>
                <th>دورات</th>
                <th>الجودة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ visit, metrics }) => (
                <tr key={visit.id}>
                  <td>{visit.refNo}</td>
                  <td>{visit.clientRef}</td>
                  <td>{fmtDate(visit.visitDate)}</td>
                  <td>{visit.reportSubmittedAt ? fmtDateTime(visit.reportSubmittedAt) : 'لم يُسلَّم'}</td>
                  <td>
                    {metrics.reportDelayHours === null ? '—' : `${metrics.reportDelayHours} ساعة`}
                    {metrics.reportDelayed ? ' (متأخر)' : ''}
                  </td>
                  <td style={{ textAlign: 'center' }}>{visit.reviewCycles?.length ?? 0}</td>
                  <td style={{ textAlign: 'center' }}>{visit.qualityScore ?? '—'}</td>
                  <td>{VISIT_STATUS_LABELS[visit.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
      });
    });

    for (const { visit } of model.visits.filter((row) => (row.visit.reviewCycles?.length ?? 0) > 1 || row.metrics.returnedForCorrections)) {
      blocks.push({
        id: `visit-cycles-${visit.id}`,
        node: (
          <div className="rp-observation">
            <div className="rp-observation__head">
              <span>دورات مراجعة الزيارة {visit.refNo} — {visit.clientRef}</span>
              <span className="rp-small">{fmtDate(visit.visitDate)}</span>
            </div>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>الدورة</th>
                  <th>التسليم</th>
                  <th>المراجعة</th>
                  <th>طلب التصحيح</th>
                  <th>إعادة التسليم</th>
                  <th>الجودة</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {(visit.reviewCycles ?? []).map((cycle) => (
                  <tr key={cycle.id}>
                    <td style={{ textAlign: 'center' }}>#{cycle.cycleNo}</td>
                    <td>{cycle.submittedAt ? fmtDate(cycle.submittedAt) : '—'}</td>
                    <td>{cycle.reviewedAt ? fmtDate(cycle.reviewedAt) : '—'}</td>
                    <td>{cycle.correctionsRequestedAt ? fmtDate(cycle.correctionsRequestedAt) : '—'}</td>
                    <td>{cycle.resubmittedAt ? fmtDate(cycle.resubmittedAt) : '—'}</td>
                    <td style={{ textAlign: 'center' }}>{cycle.qualityScore ?? '—'}</td>
                    <td>{[cycle.correctionsNotes, cycle.feedback].filter(Boolean).join(' — ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      });
    }
  } else {
    blocks.push({ id: 'visits-empty', node: <div className="rp-note">لا توجد زيارات مسجلة لهذه الفترة.</div> });
  }

  blocks.push({
    id: 'observations-title',
    node: (
      <div className="rp-section__title">
        الملاحظات وسجل المعالجة ({model.observations.length})
      </div>
    ),
  });

  if (model.observations.length) {
    for (const observation of model.observations) {
      blocks.push({
        id: `obs-${observation.id}`,
        node: (
          <div className="rp-observation">
            <div className="rp-observation__head">
              <span>
                {observation.refNo} — {fmtDate(observation.date)}
              </span>
              <span className="rp-badge-row">
                <span className={`rp-tag ${observation.severity === 'critical' ? 'rp-tag--danger' : observation.severity === 'high' ? 'rp-tag--warning' : 'rp-tag--info'}`}>
                  {SEVERITY_LABELS[observation.severity]}
                </span>
                <span className={`rp-tag ${observation.status === 'resolved' || observation.status === 'closed' ? 'rp-tag--success' : 'rp-tag--warning'}`}>
                  {OBSERVATION_STATUS_LABELS[observation.status]}
                </span>
                {observation.isRecurring ? <span className="rp-tag rp-tag--danger">متكررة</span> : null}
              </span>
            </div>
            <dl className="rp-dl">
              <dt>التصنيف</dt>
              <dd>{model.categories.find((c) => c.id === observation.categoryId)?.name ?? observation.categoryId}</dd>
              <dt>المصدر</dt>
              <dd>{OBSERVATION_SOURCE_LABELS[observation.source]}</dd>
              <dt>الوصف</dt>
              <dd>{observation.description}</dd>
              <dt>الإجراء التصحيحي</dt>
              <dd>{observation.correctiveAction || '—'}</dd>
              <dt>تاريخ الإخطار</dt>
              <dd>{observation.notifiedAt ? fmtDate(observation.notifiedAt) : '—'}</dd>
              <dt>المعالجة</dt>
              <dd>{observation.resolvedAt ? fmtDate(observation.resolvedAt) : 'لم تُعالج بعد'}</dd>
            </dl>
            {observation.followUps?.length ? (
              <>
                <div className="rp-divider" />
                <div className="rp-small" style={{ marginBottom: 3 }}>
                  سجل المتابعات:
                </div>
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المتابعة</th>
                      <th>بواسطة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observation.followUps.map((followUp) => (
                      <tr key={followUp.id}>
                        <td>{fmtDate(followUp.date)}</td>
                        <td>{followUp.note}</td>
                        <td>{followUp.by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        ),
      });
    }
  } else {
    blocks.push({ id: 'observations-empty', node: <div className="rp-note">لا توجد ملاحظات مسجلة لهذه الفترة.</div> });
  }

  blocks.push({
    id: 'signatures',
    node: (
      <div className="rp-section">
        <div className="rp-section__title">الاعتماد</div>
        <div className="rp-signatures">
          <div>ضابط المخاطر</div>
          <div>مدير إدارة المخاطر</div>
          <div>الموارد البشرية</div>
        </div>
        <div className="rp-note">
          هذا التقرير مُولَّد آليًا من بيانات محلية محفوظة في متصفح المستخدم ولم يُرسل إلى أي خادم. المتوسطات المعروضة
          تعتمد فقط على الدرجات المسجلة فعليًا لكل معيار.
        </div>
      </div>
    ),
  });

  return blocks;
}
