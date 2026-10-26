import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import {
  Badge,
  Button,
  ListCard,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Table,
  TableWrap,
  Textarea,
  Toolbar,
} from '../components/ui';
import { ValidationError, deleteFieldVisit, saveFieldVisit } from '../db/repo';
import { FINAL_ASSESSMENT_OPTIONS, MONTHS_AR, VISIT_STATUS_LABELS, type FieldVisit, type VisitStatus } from '../db/schema';
import { visitsByMonth } from '../lib/calc';
import { fmtDate, todayInputValue, toDateInputValue } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeId: string;
  region: string;
  branch: string;
  visitDate: string;
  visitType: string;
  reference: string;
  status: VisitStatus;
  reportSubmittedAt: string;
  reportReviewedAt: string;
  revisions: string;
  finalAssessment: string;
  notes: string;
}

const emptyDraft = (employeeId = '', region = ''): Draft => ({
  employeeId,
  region,
  branch: '',
  visitDate: todayInputValue(),
  visitType: 'زيارة ميدانية',
  reference: '',
  status: 'completed',
  reportSubmittedAt: '',
  reportReviewedAt: '',
  revisions: '',
  finalAssessment: 'ملتزم',
  notes: '',
});

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => current + 1 - index);
})();

export function FieldVisitsPage() {
  const { data, settings, runAction } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [employee, setEmployee] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<FieldVisit | null>(null);

  const nameOf = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.visits
      .filter((row) => row.visitDate.startsWith(String(year)))
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) => (status === 'all' ? true : row.status === status))
      .filter((row) => (!text ? true : `${row.branch} ${row.reference} ${row.region} ${nameOf(row.employeeId)}`.toLowerCase().includes(text)))
      .sort((a, b) => (a.visitDate < b.visitDate ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.visits, data.employees, year, employee, status, query]);

  const summaryRows = useMemo(
    () =>
      data.employees
        .filter((row) => !row.archived)
        .map((row) => ({ employee: row, summary: visitsByMonth(data.visits, year, row.id) }))
        .filter((row) => row.summary.total > 0 || employee === row.employee.id),
    [data.employees, data.visits, year, employee],
  );

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () =>
          saveFieldVisit({
            id: draft.id,
            employeeId: draft.employeeId,
            region: draft.region,
            branch: draft.branch,
            visitDate: draft.visitDate,
            visitType: draft.visitType,
            reference: draft.reference,
            status: draft.status,
            reportSubmittedAt: draft.reportSubmittedAt || null,
            reportReviewedAt: draft.reportReviewedAt || null,
            revisions: draft.revisions === '' ? null : Number(draft.revisions),
            finalAssessment: draft.finalAssessment,
            notes: draft.notes,
          }),
        draft.id ? 'تم حفظ تعديلات الزيارة.' : 'تمت إضافة الزيارة.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const exportCsv = () => {
    downloadCsv(
      csvFileName(`visits-${year}`),
      ['الموظف', 'المنطقة', 'الفرع', 'التاريخ', 'النوع', 'المرجع', 'الحالة', 'تسليم التقرير', 'مراجعة التقرير', 'مرات التعديل', 'التقدير', 'ملاحظات'],
      rows.map((row) => [
        nameOf(row.employeeId),
        row.region,
        row.branch,
        row.visitDate,
        row.visitType,
        row.reference,
        VISIT_STATUS_LABELS[row.status],
        row.reportSubmittedAt ?? '',
        row.reportReviewedAt ?? '',
        row.revisions ?? '',
        row.finalAssessment,
        row.notes,
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="الزيارات الميدانية"
        description="سجل يدوي للزيارات، مع ملخص شهري لكل موظف مثل ورقة «الزيارات الميدانية»."
        actions={
          <>
            <Button icon="download" onClick={exportCsv}>
              تصدير CSV
            </Button>
            <Button
              variant="primary"
              icon="plus"
              disabled={!data.employees.length}
              onClick={() => {
                const first = data.employees.find((row) => !row.archived);
                setErrors({});
                setDraft(emptyDraft(first?.id ?? '', first?.governorate ?? ''));
              }}
            >
              إضافة زيارة
            </Button>
          </>
        }
      />

      <ListCard
        id="field-visits-summary"
        title={`ملخص الزيارات ${year}`}
        subtitle="عدد الزيارات لكل شهر ثم الإجمالي السنوي"
        note="ملخص الزيارات مخفي — اضغط «إظهار البيانات» لعرضه."
      >
          {summaryRows.length ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th className="num">الرقم</th>
                    <th>الموظف</th>
                    <th>المنطقة</th>
                    {MONTHS_AR.map((month) => (
                      <th key={month} className="num">
                        {month.slice(0, 4)}
                      </th>
                    ))}
                    <th className="num">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map(({ employee: row, summary }) => (
                    <tr key={row.id}>
                      <td className="num">{row.employeeNo}</td>
                      <td>
                        <a href={`#/employees/${row.id}`}>{row.name}</a>
                      </td>
                      <td>{row.governorate}</td>
                      {summary.byMonth.map((count, index) => (
                        <td key={index} className="num">
                          {count || '—'}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{summary.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState title="لا زيارات مسجلة هذه السنة" />
          )}
      </ListCard>

      <ListCard
        id="field-visits-records"
        title="الزيارات الميدانية المسجلة"
        subtitle={`${rows.length} زيارة`}
        note={`قائمة الزيارات مخفية (${rows.length} زيارة) — اضغط «إظهار البيانات» لعرضها.`}
      
          controls={
            <Toolbar>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
            {YEARS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="الموظف">
            <option value="all">كل الموظفين</option>
            {data.employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالفرع أو المرجع…" />
          <span className="toolbar__spacer">{rows.length} زيارة</span>
        </Toolbar>
          }>
        

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الموظف</th>
                  <th>المنطقة</th>
                  <th>الفرع</th>
                  <th>النوع</th>
                  <th>المرجع</th>
                  <th>الحالة</th>
                  <th>تسليم التقرير</th>
                  <th>مراجعة التقرير</th>
                  <th className="num">تعديلات</th>
                  <th>التقدير</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.visitDate)}</td>
                    <td>{nameOf(row.employeeId)}</td>
                    <td>{row.region || '—'}</td>
                    <td>{row.branch}</td>
                    <td>{row.visitType}</td>
                    <td>{row.reference || '—'}</td>
                    <td>
                      <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'warning'}>
                        {VISIT_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="nowrap small">{row.reportSubmittedAt ? row.reportSubmittedAt.replace('T', ' ') : '—'}</td>
                    <td className="nowrap small">{row.reportReviewedAt ? row.reportReviewedAt.replace('T', ' ') : '—'}</td>
                    <td className="num">{row.revisions ?? '—'}</td>
                    <td>{row.finalAssessment || '—'}</td>
                    <td className="wrap small">{row.notes || '—'}</td>
                    <td>
                      <div className="table__actions">
                        <IconButton
                          icon="edit"
                          label="تعديل"
                          onClick={() => {
                            setErrors({});
                            setDraft({
                              id: row.id,
                              employeeId: row.employeeId,
                              region: row.region,
                              branch: row.branch,
                              visitDate: toDateInputValue(row.visitDate),
                              visitType: row.visitType,
                              reference: row.reference,
                              status: row.status,
                              reportSubmittedAt: row.reportSubmittedAt ?? '',
                              reportReviewedAt: row.reportReviewedAt ?? '',
                              revisions: row.revisions === null ? '' : String(row.revisions),
                              finalAssessment: row.finalAssessment,
                              notes: row.notes,
                            });
                          }}
                        />
                        <IconButton icon="trash" tone="danger" label="حذف" onClick={() => setConfirmDelete(row)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            title="لا زيارات في هذه السنة"
            description="أضف زيارة جديدة من الزر أعلى الصفحة."
          />
        )}
      </ListCard>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل زيارة' : 'إضافة زيارة'}
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
          <div className="formgrid">
            <Field label="الموظف" required error={errors.employeeId} htmlFor="vis-employee">
              <Select
                id="vis-employee"
                value={draft.employeeId}
                onChange={(e) => {
                  const selected = data.employees.find((row) => row.id === e.target.value);
                  set('employeeId', e.target.value);
                  if (selected) set('region', selected.governorate);
                }}
              >
                <option value="">— اختر —</option>
                {data.employees.filter((row) => !row.archived).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.employeeNo} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المنطقة" htmlFor="vis-region" hint="تُستخدم في ملخص الزيارات">
              <Input id="vis-region" list="regions-list" value={draft.region} onChange={(e) => set('region', e.target.value)} />
              <datalist id="regions-list">
                {settings.governorates.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="الفرع" required error={errors.branch} htmlFor="vis-branch">
              <Input id="vis-branch" value={draft.branch} onChange={(e) => set('branch', e.target.value)} />
            </Field>
            <Field label="تاريخ الزيارة" required error={errors.visitDate} htmlFor="vis-date">
              <Input id="vis-date" type="date" value={draft.visitDate} onChange={(e) => set('visitDate', e.target.value)} />
            </Field>
            <Field label="نوع الزيارة" required error={errors.visitType} htmlFor="vis-type">
              <Input id="vis-type" list="visit-types" value={draft.visitType} onChange={(e) => set('visitType', e.target.value)} />
              <datalist id="visit-types">
                {settings.visitTypes.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="المرجع / رقم الملف" htmlFor="vis-ref">
              <Input id="vis-ref" value={draft.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            <Field label="الحالة" htmlFor="vis-status">
              <Select id="vis-status" value={draft.status} onChange={(e) => set('status', e.target.value as VisitStatus)}>
                {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التقدير النهائي" htmlFor="vis-assess">
              <Input
                id="vis-assess"
                list="assess-list"
                value={draft.finalAssessment}
                onChange={(e) => set('finalAssessment', e.target.value)}
              />
              <datalist id="assess-list">
                {FINAL_ASSESSMENT_OPTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="تسليم التقرير (اختياري)" htmlFor="vis-submitted">
              <Input
                id="vis-submitted"
                type="datetime-local"
                value={draft.reportSubmittedAt}
                onChange={(e) => set('reportSubmittedAt', e.target.value)}
              />
            </Field>
            <Field label="مراجعة التقرير (اختياري)" htmlFor="vis-reviewed">
              <Input
                id="vis-reviewed"
                type="datetime-local"
                value={draft.reportReviewedAt}
                onChange={(e) => set('reportReviewedAt', e.target.value)}
              />
            </Field>
            <Field label="عدد مرات تعديل التقرير" htmlFor="vis-revisions">
              <Input
                id="vis-revisions"
                type="number"
                min={0}
                value={draft.revisions}
                onChange={(e) => set('revisions', e.target.value)}
              />
            </Field>
            <Field label="ملاحظات" htmlFor="vis-notes" className="span2">
              <Textarea id="vis-notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف زيارة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteFieldVisit(confirmDelete.id), 'تم حذف الزيارة.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="small">
          سيتم حذف زيارة {confirmDelete ? `${fmtDate(confirmDelete.visitDate)} — ${confirmDelete.branch}` : ''} نهائيًا.
        </p>
      </Modal>
    </>
  );
}
