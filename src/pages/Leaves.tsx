import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import {
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
import { ValidationError, deleteLeave, saveLeave } from '../db/repo';
import { LEAVE_UNIT_LABELS, type Leave, type LeaveUnit } from '../db/schema';
import { leaveTotals } from '../lib/calc';
import { fmtDate, fmtNumber, todayInputValue, toDateInputValue } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  unit: LeaveUnit;
  days: string;
  hours: string;
  notes: string;
}

const emptyDraft = (employeeId = ''): Draft => ({
  employeeId,
  type: 'إجازة سنوية',
  startDate: todayInputValue(),
  endDate: todayInputValue(),
  unit: 'days',
  days: '1',
  hours: '',
  notes: '',
});

export function LeavesPage() {
  const { data, settings, runAction } = useApp();
  const [employee, setEmployee] = useState('all');
  const [type, setType] = useState('all');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Leave | null>(null);

  const nameOf = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.leaves
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) => (type === 'all' ? true : row.type === type))
      .filter((row) => (year === 'all' ? true : row.startDate.startsWith(year)))
      .filter((row) => (!text ? true : `${row.type} ${row.notes} ${nameOf(row.employeeId)}`.toLowerCase().includes(text)))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.leaves, data.employees, employee, type, year, query]);

  const totals = leaveTotals(rows);
  const perEmployee = useMemo(
    () =>
      data.employees
        .map((row) => ({ employee: row, totals: leaveTotals(rows, row.id) }))
        .filter((row) => row.totals.records > 0),
    [data.employees, rows],
  );

  const types = Array.from(new Set([...settings.leaveTypes, ...data.leaves.map((row) => row.type)].filter(Boolean)));
  const years = Array.from(new Set([String(new Date().getFullYear()), ...data.leaves.map((row) => row.startDate.slice(0, 4))])).sort().reverse();

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () =>
          saveLeave({
            id: draft.id,
            employeeId: draft.employeeId,
            type: draft.type,
            startDate: draft.startDate,
            endDate: draft.endDate,
            unit: draft.unit,
            days: draft.unit === 'days' ? Number(draft.days) : null,
            hours: draft.unit === 'hours' ? Number(draft.hours) : null,
            notes: draft.notes,
          }),
        draft.id ? 'تم حفظ تعديلات السجل.' : 'تمت إضافة السجل.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const exportCsv = () => {
    downloadCsv(
      csvFileName('leaves'),
      ['الموظف', 'النوع', 'من', 'إلى', 'النوع الزمني', 'القيمة', 'ملاحظات'],
      rows.map((row) => [
        nameOf(row.employeeId),
        row.type,
        row.startDate,
        row.endDate,
        LEAVE_UNIT_LABELS[row.unit],
        row.unit === 'days' ? row.days : row.hours,
        row.notes,
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="الإجازات والأذونات"
        description="سجل يدوي بسيط: النوع والتواريخ وعدد الأيام أو الساعات. الأذونات تُسجَّل بالساعات ولا تُحسب إجازة يوم كامل."
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
                setErrors({});
                setDraft(emptyDraft(data.employees.find((row) => !row.archived)?.id ?? ''));
              }}
            >
              إضافة سجل
            </Button>
          </>
        }
      />

      <ListCard id="leaves-totals" title="إجماليات السجلات المعروضة" subtitle={`${totals.records} سجل · ${fmtNumber(totals.days)} يوم · ${fmtNumber(totals.hours)} ساعة`} note="إجماليات الإجازات مخفية — اضغط «إظهار البيانات» لعرضها.">
        {perEmployee.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th className="num">الرقم</th>
                  <th>الموظف</th>
                  <th className="num">أيام الإجازات</th>
                  <th className="num">ساعات الأذونات</th>
                  <th className="num">عدد السجلات</th>
                </tr>
              </thead>
              <tbody>
                {perEmployee.map(({ employee: row, totals: employeeTotals }) => (
                  <tr key={row.id}>
                    <td className="num">{row.employeeNo}</td>
                    <td>
                      <a href={`#/employees/${row.id}`}>{row.name}</a>
                    </td>
                    <td className="num">{fmtNumber(employeeTotals.days)}</td>
                    <td className="num">{fmtNumber(employeeTotals.hours)}</td>
                    <td className="num">{employeeTotals.records}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="لا سجلات" description="أضف إجازة أو إذنًا جديدًا." />
        )}
      </ListCard>

      <ListCard
        id="leaves-records"
        title="سجلات الإجازات والأذونات"
        subtitle={`${rows.length} سجل`}
        note={`قائمة السجلات مخفية (${rows.length} سجل) — اضغط «إظهار البيانات» لعرضها.`}
      
          controls={
            <Toolbar>
          <Select value={year} onChange={(e) => setYear(e.target.value)} aria-label="السنة">
            <option value="all">كل السنوات</option>
            {years.map((item) => (
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
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="النوع">
            <option value="all">كل الأنواع</option>
            {types.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث…" />
          <span className="toolbar__spacer">{rows.length} سجل</span>
        </Toolbar>
          }>
        

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>النوع</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th className="num">المدة</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{nameOf(row.employeeId)}</td>
                    <td>{row.type}</td>
                    <td className="nowrap">{fmtDate(row.startDate)}</td>
                    <td className="nowrap">{fmtDate(row.endDate)}</td>
                    <td className="num">{row.unit === 'days' ? `${fmtNumber(row.days)} يوم` : `${fmtNumber(row.hours)} ساعة`}</td>
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
                              type: row.type,
                              startDate: toDateInputValue(row.startDate),
                              endDate: toDateInputValue(row.endDate),
                              unit: row.unit,
                              days: row.days === null ? '' : String(row.days),
                              hours: row.hours === null ? '' : String(row.hours),
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
          <EmptyState title="لا سجلات إجازات" description="أضف أول سجل من الزر أعلى الصفحة." />
        )}
      </ListCard>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل سجل' : 'إضافة إجازة أو إذن'}
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
            <Field label="الموظف" required error={errors.employeeId} htmlFor="lev-employee">
              <Select id="lev-employee" value={draft.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">— اختر —</option>
                {data.employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.employeeNo} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="النوع" required error={errors.type} htmlFor="lev-type">
              <Input id="lev-type" list="leave-types" value={draft.type} onChange={(e) => set('type', e.target.value)} />
              <datalist id="leave-types">
                {settings.leaveTypes.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="من تاريخ" required error={errors.startDate} htmlFor="lev-start">
              <Input id="lev-start" type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="إلى تاريخ" required error={errors.endDate} htmlFor="lev-end">
              <Input id="lev-end" type="date" value={draft.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
            <Field label="وحدة القياس" htmlFor="lev-unit">
              <Select id="lev-unit" value={draft.unit} onChange={(e) => set('unit', e.target.value as LeaveUnit)}>
                <option value="days">أيام</option>
                <option value="hours">ساعات (إذن)</option>
              </Select>
            </Field>
            {draft.unit === 'days' ? (
              <Field label="عدد الأيام" required error={errors.days} htmlFor="lev-days">
                <Input id="lev-days" type="number" min={0.5} step="0.5" value={draft.days} onChange={(e) => set('days', e.target.value)} />
              </Field>
            ) : (
              <Field label="عدد الساعات" required error={errors.hours} htmlFor="lev-hours">
                <Input id="lev-hours" type="number" min={0.5} step="0.5" value={draft.hours} onChange={(e) => set('hours', e.target.value)} />
              </Field>
            )}
            <Field label="ملاحظات" htmlFor="lev-notes" className="span2">
              <Textarea id="lev-notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف سجل"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteLeave(confirmDelete.id), 'تم حذف السجل.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="small">
          سيتم حذف «{confirmDelete?.type}» المؤرخ {confirmDelete ? fmtDate(confirmDelete.startDate) : ''}.
        </p>
      </Modal>
    </>
  );
}
