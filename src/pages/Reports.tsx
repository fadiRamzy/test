import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { useRoute } from '../state/router';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, PageHeader, Select, Table, TableWrap } from '../components/ui';
import { EVALUATION_CRITERIA, OBSERVATION_STATUS_LABELS, REVIEW_OUTCOME_LABELS, VISIT_STATUS_LABELS } from '../db/schema';
import { countNoun, fmtAvg, fmtDate, fmtDateTime, fmtDurationShort, fmtNumber, monthLabel, NOUNS, toDateInputValue } from '../lib/format';
import { minuteState, visitState } from '../lib/tracking';
import { summarizeScores } from '../lib/evaluation';

export function ReportsPage() {
  const route = useRoute();
  const { data, settings } = useApp();
  const [selectedId, setSelectedId] = useState(route.query.get('employee') ?? '');
  // البيانات تُحمَّل بعد أول رسم، لذا نستنتج الاختيار الافتراضي بدل تثبيته في الحالة
  const employeeId = selectedId || data.employees[0]?.id || '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const employee = data.employees.find((row) => row.id === employeeId);

  const inRange = (value?: string | null) => {
    if (!value) return false;
    const day = value.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };

  const minutes = useMemo(
    () => data.minutes.filter((row) => row.employeeId === employeeId && inRange(row.receivedAt)).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.minutes, employeeId, from, to],
  );
  const visits = useMemo(
    () => data.visits.filter((row) => row.employeeId === employeeId && inRange(row.departureAt ?? row.createdAt)).sort((a, b) => ((a.departureAt ?? '') < (b.departureAt ?? '') ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.visits, employeeId, from, to],
  );
  const observations = useMemo(
    () => data.observations.filter((row) => row.employeeId === employeeId && inRange(row.date)).sort((a, b) => (a.date < b.date ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.observations, employeeId, from, to],
  );
  const evaluations = useMemo(
    () =>
      data.evaluations
        .filter((row) => row.employeeId === employeeId)
        .filter((row) => (from || to ? (row.month ? inRange(`${row.year}-${String(row.month).padStart(2, '0')}-01`) : row.year.toString() >= (from ? from.slice(0, 4) : '0000')) : true))
        .sort((a, b) => (a.year === b.year ? (b.month ?? 13) - (a.month ?? 13) : b.year - a.year)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.evaluations, employeeId, from, to],
  );

  const periodLabel = `${from ? fmtDate(from) : 'البداية'} — ${to ? fmtDate(to) : 'اليوم'}`;

  const summary = useMemo(() => {
    const minuteStates = minutes.map((row) => minuteState(row, settings.deadlineMinutes));
    const visitStates = visits.map((row) => visitState(row, settings.deadlineMinutes));
    return {
      minutes: minutes.length,
      completedMinutes: minuteStates.filter((row) => !row.isOpen).length,
      overdueMinutes: minuteStates.filter((row) => row.overdue).length,
      visits: visits.length,
      completedVisits: visits.filter((row) => row.status === 'completed').length,
      reportCycles: visits.reduce((total, row) => total + (row.reviewCycles?.length ?? 0), 0),
      pendingReviews: visitStates.filter((row) => row.reportAwaitingReview).length,
      observations: observations.length,
      openObservations: observations.filter((row) => row.status === 'open').length,
      evaluations: evaluations.length,
    };
  }, [minutes, visits, observations, evaluations, settings.deadlineMinutes]);

  if (!data.employees.length) {
    return (
      <Card>
        <EmptyState icon="employees" title="لا يوجد موظفون" description="أضف موظفًا أولًا لتتمكن من توليد تقريره." />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="تقرير الموظف"
        description="تقرير عربي جاهز للطباعة أو الحفظ PDF لفترة محددة، يشمل الدقائق والزيارات ودورات المراجعة والملاحظات والتقييمات."
        actions={
          <Button variant="primary" icon="print" onClick={() => window.print()} disabled={!employee}>
            طباعة / حفظ PDF
          </Button>
        }
      />

      <Card className="print-hide" title="نطاق التقرير">
        <div className="form-grid">
          <Field label="الموظف" htmlFor="rep-employee">
            <Select id="rep-employee" value={employeeId} onChange={(e) => setSelectedId(e.target.value)}>
              {data.employees.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.serial} — {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="من تاريخ" htmlFor="rep-from">
            <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="إلى تاريخ" htmlFor="rep-to">
            <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="form-actions">
            <Button
              onClick={() => {
                const year = new Date().getFullYear();
                setFrom(`${year}-01-01`);
                setTo(`${year}-12-31`);
              }}
            >
              السنة الحالية
            </Button>
            <Button
              onClick={() => {
                const now = new Date();
                setFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
                setTo(toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
              }}
            >
              الشهر الحالي
            </Button>
            <Button
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              كل الفترات
            </Button>
          </div>
        </div>
      </Card>

      {employee ? (
        <article className="report-page" dir="rtl">
          <header className="report-page__head">
            <div>
              <h1>{settings.organizationName}</h1>
              <p>إدارة المخاطر — تقرير أداء ضابط مخاطر</p>
            </div>
            <div className="report-page__meta">
              <span>تاريخ الإصدار: {fmtDate(new Date())}</span>
              <span>قائد الفريق: {settings.teamLeaderName || '—'}</span>
            </div>
          </header>

          <section className="report-page__section">
            <h2>بيانات الموظف</h2>
            <div className="report-page__grid">
              <div>
                <span>الاسم</span>
                <strong>{employee.name}</strong>
              </div>
              <div>
                <span>كود الموظف</span>
                <strong>{employee.code}</strong>
              </div>
              <div>
                <span>الرقم التسلسلي</span>
                <strong>{fmtNumber(employee.serial)}</strong>
              </div>
              <div>
                <span>المسمى الوظيفي</span>
                <strong>{employee.jobTitle}</strong>
              </div>
              <div>
                <span>القطاع</span>
                <strong>{employee.sector}</strong>
              </div>
              <div>
                <span>المحافظة</span>
                <strong>{employee.governorate}</strong>
              </div>
              <div>
                <span>تاريخ الالتحاق</span>
                <strong>{fmtDate(employee.joiningDate)}</strong>
              </div>
              <div>
                <span>فترة التقرير</span>
                <strong>{periodLabel}</strong>
              </div>
            </div>
          </section>

          <section className="report-page__section">
            <h2>ملخص الفترة</h2>
            <div className="report-page__stats">
              <div>
                <span>دقائق الصرف</span>
                <strong>{summary.minutes}</strong>
                <em>مكتملة {summary.completedMinutes} · متأخرة {summary.overdueMinutes}</em>
              </div>
              <div>
                <span>الزيارات</span>
                <strong>{summary.visits}</strong>
                <em>مكتملة {summary.completedVisits}</em>
              </div>
              <div>
                <span>دورات مراجعة التقارير</span>
                <strong>{summary.reportCycles}</strong>
                <em>بانتظار المراجعة {summary.pendingReviews}</em>
              </div>
              <div>
                <span>الملاحظات</span>
                <strong>{summary.observations}</strong>
                <em>مفتوحة {summary.openObservations}</em>
              </div>
              <div>
                <span>التقييمات</span>
                <strong>{summary.evaluations}</strong>
              </div>
            </div>
          </section>

          <section className="report-page__section">
            <h2>دقائق الصرف ({countNoun(minutes.length, NOUNS.minute)})</h2>
            {minutes.length ? (
              <TableWrap>
                <Table className="report-table">
                  <thead>
                    <tr>
                      <th>المرجع</th>
                      <th>الفرع / العميل</th>
                      <th>الورود</th>
                      <th>طلب الملف</th>
                      <th>استلام الملف</th>
                      <th>بدء المراجعة</th>
                      <th>الرد النهائي</th>
                      <th>انتظار الملف</th>
                      <th>زمن المراجعة</th>
                      <th>الحالة / التأخير</th>
                    </tr>
                  </thead>
                  <tbody>
                    {minutes.map((row) => {
                      const state = minuteState(row, settings.deadlineMinutes);
                      return (
                        <tr key={row.id}>
                          <td className="mono">{row.refNo}</td>
                          <td>{row.branchRef}</td>
                          <td>{fmtDateTime(row.receivedAt)}</td>
                          <td>{fmtDateTime(row.fileRequestedAt)}</td>
                          <td>{fmtDateTime(row.fileReceivedAt)}</td>
                          <td>{fmtDateTime(row.reviewStartedAt)}</td>
                          <td>{fmtDateTime(row.finalResponseAt)}</td>
                          <td>{fmtDurationShort(state.waitingMinutes)}</td>
                          <td>{fmtDurationShort(state.reviewMinutes)}</td>
                          <td>
                            {row.status === 'completed' ? 'مكتملة' : row.status === 'cancelled' ? 'ملغاة' : 'قيد المتابعة'}
                            {state.overdue ? ` — تجاوز ${fmtDurationShort(state.overdueBy)}` : ''}
                            {row.delayReason ? ` — سبب: ${row.delayReason}` : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            ) : (
              <p className="report-page__none">لا دقائق مسجلة في هذه الفترة.</p>
            )}
          </section>

          <section className="report-page__section">
            <h2>الزيارات ودورات مراجعة التقارير ({countNoun(visits.length, NOUNS.visit)})</h2>
            {visits.length ? (
              visits.map((visit) => {
                const state = visitState(visit, settings.deadlineMinutes);
                return (
                  <div key={visit.id} className="report-visit">
                    <div className="report-visit__head">
                      <strong>
                        {visit.refNo} — {visit.branchRef}
                      </strong>
                      <Badge tone={visit.status === 'completed' ? 'success' : 'info'}>{VISIT_STATUS_LABELS[visit.status]}</Badge>
                    </div>
                    <div className="report-visit__times">
                      <span>التحرك: {fmtDateTime(visit.departureAt)}</span>
                      <span>الوصول: {fmtDateTime(visit.arrivalAt)}</span>
                      <span>الإتمام: {fmtDateTime(visit.completedAt)}</span>
                      <span>العودة: {fmtDateTime(visit.returnAt)}</span>
                      <span>تسليم التقرير: {fmtDateTime(visit.reportSubmittedAt)}</span>
                      <span>مراجعة التقرير: {fmtDateTime(visit.reportReviewedAt)}</span>
                      <span>البريد النهائي: {fmtDateTime(visit.finalEmailAt)}</span>
                      <span>زمن التقرير: {fmtDurationShort(state.reportDelayMinutes)}</span>
                    </div>
                    {visit.reviewCycles?.length ? (
                      <TableWrap>
                        <Table className="report-table">
                          <thead>
                            <tr>
                              <th>الدورة</th>
                              <th>وقت المراجعة</th>
                              <th>الملاحظات</th>
                              <th>التصحيحات</th>
                              <th>النتيجة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visit.reviewCycles.map((cycle) => (
                              <tr key={cycle.id}>
                                <td className="num">{cycle.seq}</td>
                                <td>{fmtDateTime(cycle.reviewedAt)}</td>
                                <td className="wrap">{cycle.observations || '—'}</td>
                                <td className="wrap">{cycle.corrections || '—'}</td>
                                <td>{REVIEW_OUTCOME_LABELS[cycle.outcome]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </TableWrap>
                    ) : (
                      <p className="report-page__none">لا دورات مراجعة مسجلة لهذه الزيارة.</p>
                    )}
                    {visit.observations ? <p className="report-page__note">ملاحظات الزيارة: {visit.observations}</p> : null}
                  </div>
                );
              })
            ) : (
              <p className="report-page__none">لا زيارات مسجلة في هذه الفترة.</p>
            )}
          </section>

          <section className="report-page__section">
            <h2>الملاحظات ({countNoun(observations.length, NOUNS.observation)})</h2>
            {observations.length ? (
              <TableWrap>
                <Table className="report-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>النوع</th>
                      <th>الملاحظة</th>
                      <th>الحالة</th>
                      <th>المعالجة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observations.map((row) => (
                      <tr key={row.id}>
                        <td>{fmtDate(row.date)}</td>
                        <td>{row.type}</td>
                        <td className="wrap">{row.text}</td>
                        <td>{OBSERVATION_STATUS_LABELS[row.status]}</td>
                        <td className="wrap">{row.resolution || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            ) : (
              <p className="report-page__none">لا ملاحظات في هذه الفترة.</p>
            )}
          </section>

          <section className="report-page__section">
            <h2>التقييمات</h2>
            {evaluations.length ? (
              <TableWrap>
                <Table className="report-table">
                  <thead>
                    <tr>
                      <th>الفترة</th>
                      <th>النوع</th>
                      {EVALUATION_CRITERIA.map((criterion, index) => (
                        <th key={criterion.id} title={criterion.name}>
                          {index + 1}
                        </th>
                      ))}
                      <th>المجموع</th>
                      <th>المتوسط</th>
                      <th>تعليق عام</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluations.map((row) => {
                      const rowSummary = summarizeScores(row.scores);
                      return (
                        <tr key={row.id}>
                          <td>{monthLabel(row.year, row.month)}</td>
                          <td>{row.periodType === 'monthly' ? 'شهري' : 'سنوي'}</td>
                          {EVALUATION_CRITERIA.map((criterion) => (
                            <td key={criterion.id} className="num">
                              {row.scores?.[criterion.id] ?? '—'}
                            </td>
                          ))}
                          <td className="num">
                            {rowSummary.sum} / {rowSummary.count}
                          </td>
                          <td className="num">{fmtAvg(rowSummary.average)}</td>
                          <td className="wrap small">{row.overallComment || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            ) : (
              <p className="report-page__none">لا تقييمات مسجلة.</p>
            )}
            <p className="report-page__note">
              المجموع محسوب من الدرجات المسجلة فقط، والمتوسط = المجموع ÷ عدد المعايير المسجلة. لا تُستخدم أوزان ولا
              تصنيفات تقديرية. المعايير بالترتيب: {EVALUATION_CRITERIA.map((criterion, index) => `${index + 1}) ${criterion.name}`).join(' — ')}.
            </p>
          </section>

          <footer className="report-page__foot">
            <div>
              <span>توقيع قائد الفريق</span>
              <strong>{settings.teamLeaderName || '—'}</strong>
            </div>
            <div>
              <span>توقيع الموظف</span>
              <strong>{employee.name}</strong>
            </div>
            <div className="report-page__stamp">
              <span>عدد سجلات الفترة</span>
              <strong>{summary.minutes + summary.visits + summary.observations + summary.evaluations}</strong>
            </div>
          </footer>
        </article>
      ) : null}

      <div className="print-hide">
      <Callout tone="info" title="حفظ PDF">
        اضغط «طباعة / حفظ PDF» ثم اختر «الوجهة: حفظ كملف PDF». التقرير مُهيأ لمقاس A4 مع اتجاه من اليمين لليسار.
      </Callout>
      </div>
    </>
  );
}
