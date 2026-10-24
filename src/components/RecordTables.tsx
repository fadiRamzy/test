import { Fragment, useMemo, useState } from 'react';
import { useApp } from '../state/store';
import type { DisbursementMinute, Evaluation, FieldVisit, Observation } from '../db/schema';
import { MINUTE_OUTCOME_LABELS, SEVERITY_LABELS, OBSERVATION_SOURCE_LABELS } from '../db/schema';
import { fmtDate, fmtDateTime, fmtDurationShort, fmtNumber } from '../lib/format';
import { computeMinuteTimings } from '../lib/minuteCalc';
import { calendarFromSettings, visitMetrics } from '../lib/analytics';
import { summarizeScores } from '../lib/evaluation';
import { Badge, Table, TableWrap } from './ui';
import { ObservationStatusBadge, QualityRating, SeverityBadge, SlaBadge, VisitStatusBadge, useLookups } from './domain';
import { Icon } from './Icon';

export function MinutesTable({
  minutes,
  showEmployee = true,
  onOpen,
}: {
  minutes: DisbursementMinute[];
  showEmployee?: boolean;
  onOpen?: (minute: DisbursementMinute) => void;
}) {
  const { settings } = useApp();
  const lookups = useLookups();
  const calendar = useMemo(() => calendarFromSettings(settings), [settings]);

  if (!minutes.length) return <div className="table-empty">لا توجد دقائق صرف مسجلة.</div>;

  return (
    <TableWrap>
      <Table className="table--compact">
        <thead>
          <tr>
            <th>رقم الدقيقة</th>
            {showEmployee ? <th>الضابط</th> : null}
            <th>الفرع</th>
            <th>مرجع العميل</th>
            <th>النوع</th>
            <th>المبلغ</th>
            <th>النتيجة</th>
            <th>الاستلام</th>
            <th>الرد النهائي</th>
            <th>زمن المعالجة</th>
            <th>زمن الانتظار</th>
            <th>الحالة</th>
            {onOpen ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {minutes.map((minute) => {
            const timings = computeMinuteTimings(
              minute,
              calendar,
              settings.minutesDeadlineMinutes,
              settings.deadlineWarnPercent,
            );
            return (
              <tr key={minute.id}>
                <td className="nowrap">
                  <span className="table__primary">{minute.refNo}</span>
                </td>
                {showEmployee ? <td>{lookups.employeeName(minute.employeeId)}</td> : null}
                <td>{lookups.branchName(minute.branchId)}</td>
                <td>{minute.clientRef}</td>
                <td>{minute.financingType || '—'}</td>
                <td className="num">{minute.amount === null ? '—' : fmtNumber(minute.amount)}</td>
                <td>{MINUTE_OUTCOME_LABELS[minute.outcome]}</td>
                <td className="num nowrap">{fmtDateTime(minute.receivedAt)}</td>
                <td className="num nowrap">{minute.finalResponseAt ? fmtDateTime(minute.finalResponseAt) : <span className="muted">—</span>}</td>
                <td className="num nowrap">{fmtDurationShort(timings.officerMinutes)}</td>
                <td className="num nowrap">{fmtDurationShort(timings.waitingMinutes)}</td>
                <td>
                  <SlaBadge status={timings.slaStatus} />
                </td>
                {onOpen ? (
                  <td className="actions">
                    <button type="button" className="icon-btn" title="تفاصيل" aria-label="تفاصيل" onClick={() => onOpen(minute)}>
                      <Icon name="list" size={15} />
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function VisitsTable({
  visits,
  showEmployee = true,
  onOpen,
}: {
  visits: FieldVisit[];
  showEmployee?: boolean;
  onOpen?: (visit: FieldVisit) => void;
}) {
  const { settings } = useApp();
  const lookups = useLookups();

  if (!visits.length) return <div className="table-empty">لا توجد زيارات ميدانية مسجلة.</div>;

  return (
    <TableWrap>
      <Table className="table--compact">
        <thead>
          <tr>
            <th>رقم الزيارة</th>
            {showEmployee ? <th>الضابط</th> : null}
            <th>الفرع</th>
            <th>العميل</th>
            <th>تاريخ الزيارة</th>
            <th>تسليم التقرير</th>
            <th>زمن إعداد التقرير</th>
            <th>دورات المراجعة</th>
            <th>الجودة</th>
            <th>الحالة</th>
            {onOpen ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => {
            const metrics = visitMetrics(visit, settings);
            return (
              <tr key={visit.id}>
                <td className="nowrap">
                  <span className="table__primary">{visit.refNo}</span>
                  {metrics.returnedForCorrections ? <span className="table__sub text-warning">أُعيد للتصحيح</span> : null}
                </td>
                {showEmployee ? <td>{lookups.employeeName(visit.employeeId)}</td> : null}
                <td>{lookups.branchName(visit.branchId)}</td>
                <td>{visit.clientRef}</td>
                <td className="num nowrap">{fmtDate(visit.visitDate)}</td>
                <td className="num nowrap">{visit.reportSubmittedAt ? fmtDateTime(visit.reportSubmittedAt) : <span className="muted">لم يُسلَّم</span>}</td>
                <td className="num nowrap">
                  {metrics.reportDelayHours === null ? '—' : `${metrics.reportDelayHours} س`}
                  {metrics.reportDelayed ? <Badge tone="warning">متأخر</Badge> : null}
                </td>
                <td className="num">{fmtNumber(visit.reviewCycles?.length ?? 0)}</td>
                <td>
                  <QualityRating score={visit.qualityScore} />
                </td>
                <td>
                  <VisitStatusBadge status={visit.status} />
                </td>
                {onOpen ? (
                  <td className="actions">
                    <button type="button" className="icon-btn" title="تفاصيل" aria-label="تفاصيل" onClick={() => onOpen(visit)}>
                      <Icon name="list" size={15} />
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function ObservationsTable({
  observations,
  showEmployee = true,
  onOpen,
}: {
  observations: Observation[];
  showEmployee?: boolean;
  onOpen?: (observation: Observation) => void;
}) {
  const { settings } = useApp();
  const lookups = useLookups();

  if (!observations.length) return <div className="table-empty">لا توجد ملاحظات مسجلة.</div>;

  return (
    <TableWrap>
      <Table className="table--compact">
        <thead>
          <tr>
            <th>الرقم</th>
            <th>التاريخ</th>
            {showEmployee ? <th>الموظف</th> : null}
            <th>التصنيف</th>
            <th>الخطورة</th>
            <th>المصدر</th>
            <th>الوصف</th>
            <th>الحالة</th>
            <th>متابعات</th>
            {onOpen ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {observations.map((observation) => (
            <tr key={observation.id}>
              <td className="nowrap">{observation.refNo}</td>
              <td className="num nowrap">{fmtDate(observation.date)}</td>
              {showEmployee ? <td>{lookups.employeeName(observation.employeeId)}</td> : null}
              <td>
                {settings.observationCategories.find((c) => c.id === observation.categoryId)?.name ?? observation.categoryId}
                {observation.isRecurring ? <Badge tone="warning">متكررة</Badge> : null}
              </td>
              <td>
                <SeverityBadge severity={observation.severity} />
              </td>
              <td>{OBSERVATION_SOURCE_LABELS[observation.source]}</td>
              <td>
                <span className="cell-clip" title={observation.description}>
                  {observation.description}
                </span>
              </td>
              <td>
                <ObservationStatusBadge status={observation.status} />
              </td>
              <td className="num">{fmtNumber(observation.followUps?.length ?? 0)}</td>
              {onOpen ? (
                <td className="actions">
                  <button type="button" className="icon-btn" title="تفاصيل" aria-label="تفاصيل" onClick={() => onOpen(observation)}>
                    <Icon name="list" size={15} />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function EvaluationsTable({ evaluations, showEmployee = false }: { evaluations: Evaluation[]; showEmployee?: boolean }) {
  const { settings } = useApp();
  const lookups = useLookups();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!evaluations.length) return <div className="table-empty">لا توجد تقييمات مسجلة.</div>;

  return (
    <TableWrap>
      <Table className="table--compact">
        <thead>
          <tr>
            <th>الفترة</th>
            {showEmployee ? <th>الموظف</th> : null}
            <th>النوع</th>
            <th>مجموع الدرجات</th>
            <th>عدد المعايير المسجلة</th>
            <th>المتوسط</th>
            <th>الحالة</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {evaluations.map((evaluation) => {
            const summary = summarizeScores(evaluation.scores, settings.evaluationCriteria, settings.ratingScale.max);
            const open = expanded === evaluation.id;
            return (
              <Fragment key={evaluation.id}>
                <tr>
                  <td className="nowrap">
                    <span className="table__primary">
                      {evaluation.periodType === 'annual' ? evaluation.year : `${evaluation.month}/${evaluation.year}`}
                    </span>
                  </td>
                  {showEmployee ? <td>{lookups.employeeName(evaluation.employeeId)}</td> : null}
                  <td>{evaluation.periodType === 'annual' ? 'سنوي' : 'شهري'}</td>
                  <td className="num">{fmtNumber(summary.sum)}</td>
                  <td className="num">
                    {summary.count} / {settings.evaluationCriteria.filter((c) => c.active).length}
                  </td>
                  <td className="num">
                    <strong>{summary.average === null ? '—' : summary.average.toFixed(2)}</strong>
                    <span className="table__sub">من {settings.ratingScale.max}</span>
                  </td>
                  <td>
                    {evaluation.status === 'approved' ? <Badge tone="success">معتمد</Badge> : <Badge tone="neutral">مسودة</Badge>}
                  </td>
                  <td className="actions">
                    <button type="button" className="icon-btn" aria-label="تفاصيل الدرجات" onClick={() => setExpanded(open ? null : evaluation.id)}>
                      <Icon name={open ? 'chevron-down' : 'chevron-left'} size={15} />
                    </button>
                  </td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={showEmployee ? 8 : 7} style={{ background: 'var(--slate-50)' }}>
                      <div className="grid grid--3" style={{ gap: 8 }}>
                        {settings.evaluationCriteria.filter((c) => c.active).map((criterion) => (
                          <div key={criterion.id} className="row" style={{ justifyContent: 'space-between' }}>
                            <span className="small">{criterion.name}</span>
                            <strong className="small">
                              {evaluation.scores?.[criterion.id] ?? <span className="muted">غير مسجل</span>}
                            </strong>
                          </div>
                        ))}
                      </div>
                      {evaluation.unlockReason ? (
                        <p className="small mt-8 text-warning">سبب الفتح للتعديل: {evaluation.unlockReason}</p>
                      ) : null}
                      {evaluation.overallComment ? <p className="small mt-8">ملاحظة عامة: {evaluation.overallComment}</p> : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function ObservationDetails({ observation }: { observation: Observation }) {
  const { settings } = useApp();
  const lookups = useLookups();
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone="primary">{observation.refNo}</Badge>
        <SeverityBadge severity={observation.severity} />
        <ObservationStatusBadge status={observation.status} />
        <span className="small muted">{SEVERITY_LABELS[observation.severity]}</span>
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.8 }}>{observation.description}</p>
      <dl className="def-list">
        <div className="def-list__row">
          <dt>الموظف</dt>
          <dd>{lookups.employeeName(observation.employeeId)}</dd>
        </div>
        <div className="def-list__row">
          <dt>الفرع</dt>
          <dd>{lookups.branchName(observation.branchId)}</dd>
        </div>
        <div className="def-list__row">
          <dt>التصنيف</dt>
          <dd>{settings.observationCategories.find((c) => c.id === observation.categoryId)?.name ?? '—'}</dd>
        </div>
        <div className="def-list__row">
          <dt>تاريخ الملاحظة</dt>
          <dd>{fmtDate(observation.date)}</dd>
        </div>
        <div className="def-list__row">
          <dt>الإجراء التصحيحي</dt>
          <dd>{observation.correctiveAction || '—'}</dd>
        </div>
        <div className="def-list__row">
          <dt>تاريخ الإخطار</dt>
          <dd>{observation.notifiedAt ? fmtDate(observation.notifiedAt) : '—'}</dd>
        </div>
        <div className="def-list__row">
          <dt>تاريخ المعالجة</dt>
          <dd>{observation.resolvedAt ? fmtDate(observation.resolvedAt) : '—'}</dd>
        </div>
        {observation.isRecurring ? (
          <div className="def-list__row">
            <dt>التكرار</dt>
            <dd>ملاحظة متكررة</dd>
          </div>
        ) : null}
      </dl>
      <div>
        <strong className="small">سجل المتابعات</strong>
        {observation.followUps?.length ? (
          <ul className="timeline mt-8">
            {observation.followUps.map((followUp) => (
              <li className="timeline__item" key={followUp.id}>
                <span className="timeline__marker timeline__marker--done" />
                <div>
                  <div className="timeline__title">{followUp.note}</div>
                  <div className="timeline__meta">
                    {fmtDate(followUp.date)}
                    {followUp.by ? ` — ${followUp.by}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted mt-8">لا توجد متابعات مسجلة.</p>
        )}
      </div>
    </div>
  );
}
