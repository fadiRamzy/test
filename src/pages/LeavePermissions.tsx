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
  Toolbar,
} from '../components/ui';
import { ValidationError, deleteLeavePermission, saveLeavePermission } from '../db/repo';
import type { LeavePermissionRecord } from '../db/schema';
import { MONTHS_AR } from '../db/schema';
import { todayInputValue, fmtDate, fmtNumber } from '../lib/format';
import { summarizeLeavePermissions } from '../lib/leavePermission';

const LEAVE_TYPES = ['إجازة اعتيادي', 'إجازة عارضة', 'إجازة بخصم'] as const;
const PERMISSION_TYPES = ['إذن انصرف', 'إذن حضور'] as const;
const currentYear = () => String(new Date().getFullYear());
const currentMonth = () => String(new Date().getMonth() + 1).padStart(2, '0');

interface Draft {
  id?: string;
  employeeId: string;
  requestType: 'leave' | 'permission';
  category: string;
  date: string;
  durationHours: '' | '1' | '2';
  notes: string;
}

const emptyDraft = (): Draft => ({
  employeeId: '',
  requestType: 'leave',
  category: LEAVE_TYPES[0],
  date: todayInputValue(),
  durationHours: '',
  notes: '',
});

export function LeavePermissionsPage() {
  const { data, runAction } = useApp();
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState(currentMonth());
  const [yearFilter, setYearFilter] = useState(currentYear());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<LeavePermissionRecord | null>(null);

  const yearOptions = useMemo(() => {
    const values = new Set([currentYear(), ...data.leavePermissions.map((row) => row.date.slice(0, 4)).filter(Boolean)]);
    return Array.from(values).sort().reverse();
  }, [data.leavePermissions]);

  const filters = { employeeId: employeeFilter, month: monthFilter, year: yearFilter };
  const summaries = useMemo(
    () => summarizeLeavePermissions(data.employees, data.leavePermissions, filters),
    [data.employees, data.leavePermissions, employeeFilter, monthFilter, yearFilter],
  );
  const rows = useMemo(
    () => data.leavePermissions
      .filter((row) => employeeFilter === 'all' || row.employeeId === employeeFilter)
      .filter((row) => !row.date || (yearFilter === 'all' || row.date.startsWith(yearFilter)))
      .filter((row) => !row.date || monthFilter === 'all' || row.date.slice(5, 7) === monthFilter)
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [data.leavePermissions, employeeFilter, monthFilter, yearFilter],
  );
  const employeeName = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () => saveLeavePermission({
          id: draft.id,
          employeeId: draft.employeeId,
          requestType: draft.requestType,
          category: draft.category as LeavePermissionRecord['category'],
          date: draft.date,
          durationHours: draft.requestType === 'permission' ? Number(draft.durationHours) as 1 | 2 : null,
          notes: draft.notes,
        }),
        draft.id ? 'تم حفظ تعديلات الطلب.' : 'تمت إضافة الطلب.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const openEdit = (row: LeavePermissionRecord) => {
    setErrors({});
    setDraft({
      id: row.id,
      employeeId: row.employeeId,
      requestType: row.requestType,
      category: row.category,
      date: row.date,
      durationHours: row.durationHours ? String(row.durationHours) as '1' | '2' : '',
      notes: row.notes,
    });
  };

  const updateRequestType = (requestType: Draft['requestType']) => {
    set('requestType', requestType);
    set('category', requestType === 'leave' ? LEAVE_TYPES[0] : PERMISSION_TYPES[0]);
    set('durationHours', '');
  };

  return (
    <>
      <PageHeader
        eyebrow="السجلات اليدوية"
        title="الإجازات والأذونات"
        description="تسجيل ومتابعة الطلبات، مع احتساب رصيد الأذونات الشهري لكل موظف."
        actions={<Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft(emptyDraft()); }}>إضافة سجل</Button>}
      />

      <Card title="ملخص الشهر والفلاتر" subtitle="الحد الشهري للأذونات: 4 طلبات وبحد أقصى 4 ساعات لكل موظف">
        <Toolbar>
          <Select aria-label="الموظف" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
            <option value="all">كل الموظفين</option>
            {data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </Select>
          <Select aria-label="الشهر" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
            <option value="all">كل الشهور</option>
            {MONTHS_AR.map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}
          </Select>
          <Select aria-label="السنة" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
            <option value="all">كل السنوات</option>
            {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
          </Select>
        </Toolbar>
        {summaries.length ? (
          <TableWrap>
            <Table>
              <thead><tr>
                <th>الموظف</th><th className="num">إجازات اعتيادي</th><th className="num">إجازات عارضة</th><th className="num">إجازات بخصم</th><th className="num">إجمالي الإجازات</th>
                <th className="num">أذونات انصراف</th><th className="num">أذونات حضور</th><th className="num">إجمالي الأذونات</th><th className="num">ساعات مستخدمة</th><th className="num">ساعات متبقية للشهر</th>
              </tr></thead>
              <tbody>{summaries.map((summary) => (
                <tr key={summary.employee.id}>
                  <td>{summary.employee.name}</td>
                  <td className="num">{summary.regularLeaves}</td><td className="num">{summary.casualLeaves}</td><td className="num">{summary.deductedLeaves}</td><td className="num"><strong>{summary.totalLeaves}</strong></td>
                  <td className="num">{summary.departurePermissions}</td><td className="num">{summary.attendancePermissions}</td><td className="num"><strong>{summary.totalPermissions}</strong></td><td className="num">{fmtNumber(summary.permissionHours)}</td><td className="num">{monthFilter !== 'all' && yearFilter !== 'all' ? fmtNumber(summary.remainingHours) : '—'}</td>
                </tr>
              ))}</tbody>
            </Table>
          </TableWrap>
        ) : <EmptyState title="لا يوجد موظفون مطابقون" />}
      </Card>

      <ListCard
        id="leave-permission-records"
        title="سجلات الإجازات والأذونات"
        subtitle={`${rows.length} سجل في الفترة المختارة`}
        note={`قائمة الطلبات مخفية (${rows.length} سجل) — اضغط «إظهار البيانات» لعرضها.`}
      >
        {rows.length ? <TableWrap><Table>
          <thead><tr><th>الموظف</th><th>نوع الطلب</th><th>نوع الإجازة أو الإذن</th><th>التاريخ</th><th className="num">مدة الإذن</th><th>السبب / الملاحظات</th><th>إجراءات</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td>{employeeName(row.employeeId)}</td>
            <td><Badge tone={row.requestType === 'leave' ? 'info' : 'warning'}>{row.requestType === 'leave' ? 'إجازة' : 'إذن'}</Badge></td>
            <td>{row.category}</td><td className="nowrap">{fmtDate(row.date)}</td>
            <td className="num">{row.durationHours ? `${row.durationHours === 1 ? 'ساعة واحدة' : 'ساعتان'}` : '—'}</td>
            <td className="wrap small">{row.notes || '—'}</td>
            <td><div className="table__actions"><IconButton icon="edit" label="تعديل" onClick={() => openEdit(row)} /><IconButton icon="trash" tone="danger" label="حذف" onClick={() => setConfirmDelete(row)} /></div></td>
          </tr>)}</tbody>
        </Table></TableWrap> : <EmptyState title="لا توجد طلبات في الفترة المحددة" description="يمكن إضافة سجل جديد من أعلى الصفحة." />}
      </ListCard>

      <Modal open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? 'تعديل طلب' : 'إضافة إجازة أو إذن'} footer={<><Button onClick={() => setDraft(null)}>إلغاء</Button><Button variant="primary" icon="save" onClick={submit}>حفظ</Button></>}>
        {draft ? <div className="formgrid">
          <Field label="الموظف" htmlFor="lp-employee" error={errors.employeeId}>
            <Select id="lp-employee" value={draft.employeeId} onChange={(event) => set('employeeId', event.target.value)}>
              <option value="">— اختر الموظف —</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNo} — {employee.name}</option>)}
            </Select>
          </Field>
          <Field label="نوع الطلب" htmlFor="lp-request-type">
            <Select id="lp-request-type" value={draft.requestType} onChange={(event) => updateRequestType(event.target.value as Draft['requestType'])}>
              <option value="leave">إجازة</option><option value="permission">إذن</option>
            </Select>
          </Field>
          <Field label={draft.requestType === 'leave' ? 'نوع الإجازة' : 'نوع الإذن'} htmlFor="lp-category" error={errors.category}>
            <Select id="lp-category" value={draft.category} onChange={(event) => set('category', event.target.value)}>
              {(draft.requestType === 'leave' ? LEAVE_TYPES : PERMISSION_TYPES).map((type) => <option key={type} value={type}>{type}</option>)}
            </Select>
          </Field>
          <Field label="التاريخ" htmlFor="lp-date" error={errors.date}>
            <div className="date-today-row"><Input id="lp-date" type="date" value={draft.date} onChange={(event) => set('date', event.target.value)} /><Button size="sm" onClick={() => set('date', todayInputValue())}>تاريخ اليوم</Button></div>
          </Field>
          {draft.requestType === 'permission' ? <Field label="مدة الإذن" htmlFor="lp-duration" error={errors.durationHours}>
            <Select id="lp-duration" value={draft.durationHours} onChange={(event) => set('durationHours', event.target.value as Draft['durationHours'])}>
              <option value="">— اختر المدة —</option><option value="1">ساعة واحدة</option><option value="2">ساعتان</option>
            </Select>
          </Field> : null}
          <Field label="السبب / الملاحظات" htmlFor="lp-notes" className="span2"><Textarea id="lp-notes" rows={3} value={draft.notes} onChange={(event) => set('notes', event.target.value)} /></Field>
          {errors.permissionLimit ? <div className="span2 callout callout--warning" role="alert">{errors.permissionLimit}</div> : null}
        </div> : null}
      </Modal>

      <Modal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="حذف الطلب" size="sm" footer={<><Button onClick={() => setConfirmDelete(null)}>إلغاء</Button><Button variant="danger" icon="trash" onClick={async () => { if (!confirmDelete) return; await runAction(() => deleteLeavePermission(confirmDelete.id), 'تم حذف الطلب.'); setConfirmDelete(null); }}>حذف</Button></>}>
        <p className="small">سيتم حذف طلب «{confirmDelete?.category}» المسجل بتاريخ {confirmDelete ? fmtDate(confirmDelete.date) : '—'}.</p>
      </Modal>
    </>
  );
}
