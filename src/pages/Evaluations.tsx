import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Tabs,
  Textarea,
} from '../components/ui';
import { ValidationError, deleteEvaluation, saveEvaluation } from '../db/repo';
import { EVALUATION_CRITERIA, RATING_MAX, RATING_MIN, type Evaluation, type EvaluationComments, type EvaluationScores } from '../db/schema';
import { fmtAvg, monthName, monthLabel } from '../lib/format';
import { monthlyAveragePerCriterion, summarizeScores } from '../lib/evaluation';

interface Draft {
  id?: string;
  employeeId: string;
  periodType: 'monthly' | 'annual';
  year: number;
  month: number;
  scores: EvaluationScores;
  comments: EvaluationComments;
  overallComment: string;
}

const emptyDraft = (employeeId = ''): Draft => ({
  employeeId,
  periodType: 'monthly',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  scores: {},
  comments: {},
  overallComment: '',
});

export function EvaluationsPage() {
  const { data, runAction } = useApp();
  const [tab, setTab] = useState<'monthly' | 'annual' | 'history'>('monthly');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Evaluation | null>(null);

  const nameOf = (id: string | null) => data.employees.find((row) => row.id === id)?.name ?? '—';
  const employees = data.employees;

  const rows = useMemo(
    () =>
      data.evaluations
        .filter((row) => (employeeFilter === 'all' ? true : row.employeeId === employeeFilter))
        .filter((row) => (tab === 'history' ? true : row.periodType === tab))
        .sort((a, b) => (a.year === b.year ? (b.month ?? 13) - (a.month ?? 13) : b.year - a.year)),
    [data.evaluations, employeeFilter, tab],
  );

  const startNew = () => {
    setErrors({});
    setDraft(emptyDraft(employeeFilter === 'all' ? employees[0]?.id ?? '' : employeeFilter));
  };

  const startEdit = (row: Evaluation) => {
    setErrors({});
    setDraft({
      id: row.id,
      employeeId: row.employeeId ?? '',
      periodType: row.periodType,
      year: row.year,
      month: row.month ?? new Date().getMonth() + 1,
      scores: { ...row.scores },
      comments: { ...row.comments },
      overallComment: row.overallComment,
    });
  };

  const submit = async () => {
    if (!draft) return;
    try {
      await runAction(
        () =>
          saveEvaluation({
            id: draft.id,
            employeeId: draft.employeeId,
            periodType: draft.periodType,
            year: draft.year,
            month: draft.periodType === 'monthly' ? draft.month : null,
            scores: draft.scores,
            comments: draft.comments,
            overallComment: draft.overallComment,
          }),
        draft.id ? 'تم تحديث التقييم.' : 'تم حفظ التقييم.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const summary = draft ? summarizeScores(draft.scores) : null;
  const monthlyReference = draft
    ? monthlyAveragePerCriterion(
        data.evaluations.filter((row) => row.employeeId === draft.employeeId),
        draft.year,
      )
    : null;

  return (
    <>
      <PageHeader
        title="تقييمات الموظفين"
        description={`تقييم يدوي على ${EVALUATION_CRITERIA.length} معايير، كل معيار من ${RATING_MIN} إلى ${RATING_MAX}. المجموع والمتوسط محسوبان فقط من الدرجات المسجلة — بلا أوزان أو تصنيفات.`}
        actions={
          <Button variant="primary" icon="plus" onClick={startNew} disabled={!employees.length}>
            تقييم جديد
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: 'monthly', label: 'التقييم الشهري', count: data.evaluations.filter((row) => row.periodType === 'monthly').length },
          { id: 'annual', label: 'التقييم السنوي', count: data.evaluations.filter((row) => row.periodType === 'annual').length },
          { id: 'history', label: 'السجل الكامل', count: data.evaluations.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Card padded={false}>
        <div className="toolbar">
          <Select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} aria-label="تصفية بالموظف">
            <option value="all">كل الموظفين</option>
            {employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <span className="toolbar__count">{rows.length} تقييم</span>
        </div>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الفترة</th>
                  <th>النوع</th>
                  {EVALUATION_CRITERIA.map((criterion, index) => (
                    <th key={criterion.id} title={criterion.name}>
                      {index + 1}
                    </th>
                  ))}
                  <th>المجموع</th>
                  <th>المتوسط</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowSummary = summarizeScores(row.scores);
                  return (
                    <tr key={row.id}>
                      <td>{nameOf(row.employeeId)}</td>
                      <td>{monthLabel(row.year, row.month)}</td>
                      <td>{row.periodType === 'monthly' ? <Badge tone="info">شهري</Badge> : <Badge tone="primary">سنوي</Badge>}</td>
                      {EVALUATION_CRITERIA.map((criterion) => (
                        <td key={criterion.id} className="num">
                          {row.scores?.[criterion.id] ?? '—'}
                        </td>
                      ))}
                      <td className="num">
                        {rowSummary.sum} / {rowSummary.count}
                      </td>
                      <td className="num">{fmtAvg(rowSummary.average)}</td>
                      <td className="cell-actions">
                        <IconButton icon="edit" label="تعديل" onClick={() => startEdit(row)} />
                        <IconButton icon="trash" label="حذف" variant="danger" onClick={() => setConfirmDelete(row)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="evaluations"
            title="لا تقييمات"
            description="أضف تقييمًا شهريًا لكل موظف في نهاية الشهر."
            action={
              <Button variant="primary" icon="plus" onClick={startNew} disabled={!employees.length}>
                تقييم جديد
              </Button>
            }
          />
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل تقييم' : 'تقييم جديد'}
        subtitle="الدرجات تُدخل يدويًا. لا يُفرض أي وزن أو تصنيف على النتيجة."
        size="lg"
        footer={
          <>
            <Button onClick={() => setDraft(null)}>إلغاء</Button>
            <Button variant="primary" icon="save" onClick={submit}>
              حفظ
            </Button>
          </>
        }
      >
        {draft ? (
          <>
            <div className="form-grid">
              <Field label="الموظف" required error={errors.employeeId} htmlFor="eval-employee">
                <Select
                  id="eval-employee"
                  value={draft.employeeId}
                  onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}
                >
                  <option value="">— اختر —</option>
                  {employees.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.serial} — {row.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="نوع التقييم" htmlFor="eval-type">
                <Select
                  id="eval-type"
                  value={draft.periodType}
                  onChange={(e) => setDraft({ ...draft, periodType: e.target.value as 'monthly' | 'annual' })}
                >
                  <option value="monthly">شهري</option>
                  <option value="annual">سنوي</option>
                </Select>
              </Field>
              <Field label="السنة" required error={errors.year} htmlFor="eval-year">
                <Input
                  id="eval-year"
                  type="number"
                  min={2000}
                  max={2100}
                  value={draft.year}
                  onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })}
                />
              </Field>
              {draft.periodType === 'monthly' ? (
                <Field label="الشهر" required error={errors.month} htmlFor="eval-month">
                  <Select id="eval-month" value={draft.month} onChange={(e) => setDraft({ ...draft, month: Number(e.target.value) })}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                      <option key={month} value={month}>
                        {monthName(month)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>

            {errors.period ? <Callout tone="danger">{errors.period}</Callout> : null}

            <h3 className="section-title">المعايير</h3>
            <div className="criteria-list">
              {EVALUATION_CRITERIA.map((criterion, index) => {
                const reference = draft.periodType === 'annual' ? monthlyReference?.scores[criterion.id] ?? null : null;
                return (
                  <div key={criterion.id} className="criterion">
                    <div className="criterion__head">
                      <span className="criterion__num">{index + 1}</span>
                      <strong>{criterion.name}</strong>
                      {reference !== null ? <span className="small muted">متوسط الشهور: {reference}</span> : null}
                    </div>
                    <div className="criterion__body">
                      <div className="rating" role="group" aria-label={criterion.name}>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={`rating__btn ${draft.scores[criterion.id] === value ? 'is-active' : ''}`}
                            aria-pressed={draft.scores[criterion.id] === value}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                scores: {
                                  ...draft.scores,
                                  [criterion.id]: draft.scores[criterion.id] === value ? null : value,
                                },
                              })
                            }
                          >
                            {value}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="rating__clear"
                          onClick={() => setDraft({ ...draft, scores: { ...draft.scores, [criterion.id]: null } })}
                        >
                          مسح
                        </button>
                      </div>
                      <Textarea
                        rows={1}
                        placeholder="تعليق على هذا المعيار (اختياري)"
                        value={draft.comments[criterion.id] ?? ''}
                        onChange={(e) =>
                          setDraft({ ...draft, comments: { ...draft.comments, [criterion.id]: e.target.value } })
                        }
                      />
                    </div>
                    {errors[`score_${criterion.id}`] ? <span className="field__error">{errors[`score_${criterion.id}`]}</span> : null}
                  </div>
                );
              })}
            </div>

            <Callout tone={summary && summary.count < EVALUATION_CRITERIA.length ? 'warning' : 'info'} title="النتيجة">
              المجموع: {summary?.sum ?? 0} من {summary?.count ?? 0} معيارًا مسجلًا · المتوسط:{' '}
              {fmtAvg(summary?.average ?? null)}
              {summary && summary.count < EVALUATION_CRITERIA.length
                ? ` — لم تُسجَّل درجات لـ ${summary.missing.length} معيارًا بعد، والمتوسط محسوب على المسجل فقط.`
                : ''}
            </Callout>

            <Field label="تعليق عام" htmlFor="eval-overall" className="span-2">
              <Textarea
                id="eval-overall"
                rows={3}
                value={draft.overallComment}
                onChange={(e) => setDraft({ ...draft, overallComment: e.target.value })}
              />
            </Field>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف تقييم"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteEvaluation(confirmDelete.id), 'تم حذف التقييم.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="confirm-text">
          سيتم حذف تقييم {confirmDelete ? `${nameOf(confirmDelete.employeeId)} — ${monthLabel(confirmDelete.year, confirmDelete.month)}` : ''}.
        </p>
      </Modal>
    </>
  );
}
