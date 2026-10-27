import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListCard,
  Modal,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Textarea,
  TimeInput,
  Toolbar,
} from '../components/ui';
import { deleteAttendanceRecord, saveAttendanceRecord } from '../db/repo';
import type { AttendanceRecord } from '../db/schema';
import { MONTHS_AR } from '../db/schema';
import { fmtDate, fmtDurationWords, fmtTime, fmtNumber, todayInputValue } from '../lib/format';
import { attendanceDelayMinutes, earlyDepartureMinutes, summarizeAttendance } from '../lib/attendance';

const thisYear = () => String(new Date().getFullYear());
const thisMonth = () => String(new Date().getMonth() + 1).padStart(2, '0');
interface Draft { id?: string; employeeId: string; date: string; arrivalTime: string; departureTime: string; notes: string; }
const newDraft = (): Draft => ({ employeeId: '', date: todayInputValue(), arrivalTime: '', departureTime: '', notes: '' });

export function AttendanceDelaysPage() {
  const { data, runAction } = useApp();
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState(thisMonth());
  const [yearFilter, setYearFilter] = useState(thisYear());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  const filters = { employeeId: employeeFilter, month: monthFilter, year: yearFilter };
  const years = useMemo(() => Array.from(new Set([thisYear(), ...data.attendanceRecords.map((row) => row.date.slice(0, 4)).filter(Boolean)])).sort().reverse(), [data.attendanceRecords]);
  const summaries = useMemo(() => summarizeAttendance(data.employees, data.attendanceRecords, filters), [data.employees, data.attendanceRecords, employeeFilter, monthFilter, yearFilter]);
  const rows = useMemo(() => data.attendanceRecords
    .filter((row) => employeeFilter === 'all' || row.employeeId === employeeFilter)
    .filter((row) => !row.date || yearFilter === 'all' || row.date.startsWith(yearFilter))
    .filter((row) => !row.date || monthFilter === 'all' || row.date.slice(5, 7) === monthFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1)), [data.attendanceRecords, employeeFilter, monthFilter, yearFilter]);
  const employeeName = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const submit = async () => {
    if (!draft) return;
    await runAction(() => saveAttendanceRecord({ ...draft }), draft.id ? 'تم حفظ تعديلات سجل الحضور.' : 'تمت إضافة سجل الحضور والانصراف.');
    setDraft(null);
  };
  const edit = (row: AttendanceRecord) => setDraft({ id: row.id, employeeId: row.employeeId, date: row.date, arrivalTime: row.arrivalTime, departureTime: row.departureTime, notes: row.notes });

  return <>
    <PageHeader
      eyebrow="السجلات اليدوية"
      title="تأخيرات الحضور والانصراف"
      description="إدخال اختياري للأوقات ومتابعة التأخير والانصراف المبكر حسب الدوام الرسمي."
      actions={<Button variant="primary" icon="plus" onClick={() => setDraft(newDraft())}>إضافة سجل</Button>}
    />

    <Card title="ملخص الشهر والفلاتر" subtitle="بداية الدوام 9:00 ص، والسماح حتى 9:15 ص؛ الانصراف الرسمي 5:00 م">
      <Toolbar>
        <Select aria-label="الموظف" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="all">كل الموظفين</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select>
        <Select aria-label="الشهر" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}><option value="all">كل الشهور</option>{MONTHS_AR.map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}</Select>
        <Select aria-label="السنة" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}><option value="all">كل السنوات</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</Select>
      </Toolbar>
      {summaries.length ? <TableWrap><Table>
        <thead><tr><th>الموظف</th><th className="num">مرات التأخير</th><th className="num">إجمالي التأخير</th><th>تفاصيل التأخير</th><th className="num">مرات الانصراف المبكر</th><th className="num">إجمالي الانصراف المبكر</th><th>تفاصيل الانصراف المبكر</th></tr></thead>
        <tbody>{summaries.map((summary) => <tr key={summary.employee.id}>
          <td>{summary.employee.name}</td>
          <td className="num"><Badge tone={summary.lateCount ? 'danger' : 'neutral'}>{fmtNumber(summary.lateCount)}</Badge></td>
          <td className="num">{fmtDurationWords(summary.lateMinutes)}</td>
          <td className="wrap small">{summary.lateRecords.length ? summary.lateRecords.map((row) => `${fmtDate(row.date)} — ${fmtTime(row.arrivalTime)} (${fmtDurationWords(attendanceDelayMinutes(row.arrivalTime))})`).join('، ') : '—'}</td>
          <td className="num"><Badge tone={summary.earlyCount ? 'warning' : 'neutral'}>{fmtNumber(summary.earlyCount)}</Badge></td>
          <td className="num">{fmtDurationWords(summary.earlyMinutes)}</td>
          <td className="wrap small">{summary.earlyRecords.length ? summary.earlyRecords.map((row) => `${fmtDate(row.date)} — ${fmtTime(row.departureTime)} (${fmtDurationWords(earlyDepartureMinutes(row.departureTime))})`).join('، ') : '—'}</td>
        </tr>)}</tbody>
      </Table></TableWrap> : <EmptyState title="لا يوجد موظفون مطابقون" />}
    </Card>

    <ListCard id="attendance-records" title="سجلات الحضور والانصراف" subtitle={`${rows.length} سجل في الفترة المختارة`} note={`قائمة السجلات مخفية (${rows.length} سجل) — اضغط «إظهار البيانات» لعرضها.`}>
      {rows.length ? <TableWrap><Table>
        <thead><tr><th>الموظف</th><th>التاريخ</th><th>الحضور</th><th>التأخير</th><th>الانصراف</th><th>الانصراف المبكر</th><th>الملاحظات</th><th>إجراءات</th></tr></thead>
        <tbody>{rows.map((row) => {
          const late = attendanceDelayMinutes(row.arrivalTime);
          const early = earlyDepartureMinutes(row.departureTime);
          return <tr key={row.id}>
            <td>{employeeName(row.employeeId)}</td><td className="nowrap">{row.date ? fmtDate(row.date) : '—'}</td>
            <td>{row.arrivalTime ? fmtTime(row.arrivalTime) : '—'}</td><td>{late ? <Badge tone="danger">{fmtDurationWords(late)}</Badge> : row.arrivalTime ? 'لا يوجد' : '—'}</td>
            <td>{row.departureTime ? fmtTime(row.departureTime) : '—'}</td><td>{early ? <Badge tone="warning">{fmtDurationWords(early)}</Badge> : row.departureTime ? 'لا يوجد' : '—'}</td>
            <td className="wrap small">{row.notes || '—'}</td><td><div className="table__actions"><IconButton icon="edit" label="تعديل" onClick={() => edit(row)} /><IconButton icon="trash" tone="danger" label="حذف" onClick={() => setDeleting(row)} /></div></td>
          </tr>;
        })}</tbody>
      </Table></TableWrap> : <EmptyState title="لا توجد سجلات في الفترة المحددة" description="يمكن إضافة سجل جديد من أعلى الصفحة." />}
    </ListCard>

    <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? 'تعديل سجل الحضور والانصراف' : 'إضافة سجل حضور وانصراف'} subtitle="يمكن حفظ السجل حتى عند ترك كل الحقول دون إدخال." footer={<><Button onClick={() => setDraft(null)}>إلغاء</Button><Button variant="primary" icon="save" onClick={submit}>حفظ</Button></>}>
      {draft ? <div className="formgrid">
        <Field label="الموظف" htmlFor="att-employee"><Select id="att-employee" value={draft.employeeId} onChange={(event) => set('employeeId', event.target.value)}><option value="">— اختر الموظف —</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNo} — {employee.name}</option>)}</Select></Field>
        <Field label="التاريخ" htmlFor="att-date"><div className="date-today-row"><Input id="att-date" type="date" value={draft.date} onChange={(event) => set('date', event.target.value)} /><Button size="sm" onClick={() => set('date', todayInputValue())}>تاريخ اليوم</Button></div></Field>
        <Field label="وقت الحضور" htmlFor="att-arrival"><TimeInput id="att-arrival" label="وقت الحضور" value={draft.arrivalTime} onChange={(value) => set('arrivalTime', value)} /></Field>
        <Field label="وقت الانصراف" htmlFor="att-departure"><TimeInput id="att-departure" label="وقت الانصراف" value={draft.departureTime} onChange={(value) => set('departureTime', value)} /></Field>
        <Field label="الملاحظات" htmlFor="att-notes" className="span2"><Textarea id="att-notes" rows={3} value={draft.notes} onChange={(event) => set('notes', event.target.value)} /></Field>
        <div className="span2 callout callout--info">
          <strong>الحساب المباشر:</strong> التأخير <strong>{draft.arrivalTime ? fmtDurationWords(attendanceDelayMinutes(draft.arrivalTime)) : '—'}</strong>
          {draft.arrivalTime && attendanceDelayMinutes(draft.arrivalTime) === 0 ? ' (لا يوجد)' : ''}، والانصراف المبكر <strong>{draft.departureTime ? fmtDurationWords(earlyDepartureMinutes(draft.departureTime)) : '—'}</strong>
          {draft.departureTime && earlyDepartureMinutes(draft.departureTime) === 0 ? ' (لا يوجد)' : ''}.
        </div>
      </div> : null}
    </Modal>

    <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="حذف سجل الحضور والانصراف" size="sm" footer={<><Button onClick={() => setDeleting(null)}>إلغاء</Button><Button variant="danger" icon="trash" onClick={async () => { if (!deleting) return; await runAction(() => deleteAttendanceRecord(deleting.id), 'تم حذف السجل.'); setDeleting(null); }}>حذف</Button></>}><p className="small">هل تريد حذف هذا السجل؟</p></Modal>
  </>;
}
