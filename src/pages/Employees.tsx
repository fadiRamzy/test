import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { navigate } from '../state/router';
import {
  Badge,
  Button,
  Card,
  Checkbox,
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
import { ValidationError, deleteEmployee, nextEmployeeNo, saveEmployee, setEmployeeArchived } from '../db/repo';
import { EMPLOYEE_STATUS_LABELS, type Employee, type EmployeeStatus } from '../db/schema';
import { fmtDate, toDateInputValue, todayInputValue } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeNo: string;
  name: string;
  code: string;
  sector: string;
  governorate: string;
  jobTitle: string;
  employmentDate: string;
  branches: string;
  status: EmployeeStatus;
  notes: string;
}

const emptyDraft = (employeeNo: number): Draft => ({
  employeeNo: String(employeeNo),
  name: '',
  code: '',
  sector: '',
  governorate: '',
  jobTitle: 'ضابط مخاطر',
  employmentDate: todayInputValue(),
  branches: '',
  status: 'active',
  notes: '',
});

export function EmployeesPage() {
  const { data, settings, runAction } = useApp();
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [governorate, setGovernorate] = useState('all');
  const [status, setStatus] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Employee | null>(null);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.employees
      .filter((row) => (showArchived ? true : !row.archived))
      .filter((row) => (sector === 'all' ? true : row.sector === sector))
      .filter((row) => (governorate === 'all' ? true : row.governorate === governorate))
      .filter((row) => (status === 'all' ? true : row.status === status))
      .filter((row) =>
        !text ? true : [row.name, row.code, row.sector, row.governorate, row.jobTitle, row.branches].join(' ').toLowerCase().includes(text),
      )
      .sort((a, b) => a.employeeNo - b.employeeNo);
  }, [data.employees, query, sector, governorate, status, showArchived]);

  const sectors = Array.from(new Set([...settings.sectors, ...data.employees.map((row) => row.sector)].filter(Boolean)));
  const governorates = Array.from(new Set([...settings.governorates, ...data.employees.map((row) => row.governorate)].filter(Boolean)));

  const openNew = async () => {
    setErrors({});
    setDraft(emptyDraft(await nextEmployeeNo()));
  };

  const openEdit = (employee: Employee) => {
    setErrors({});
    setDraft({
      id: employee.id,
      employeeNo: String(employee.employeeNo),
      name: employee.name,
      code: employee.code,
      sector: employee.sector,
      governorate: employee.governorate,
      jobTitle: employee.jobTitle,
      employmentDate: toDateInputValue(employee.employmentDate),
      branches: employee.branches,
      status: employee.status,
      notes: employee.notes,
    });
  };

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      await runAction(
        () =>
          saveEmployee({
            id: draft.id,
            employeeNo: Number(draft.employeeNo),
            name: draft.name,
            code: draft.code,
            sector: draft.sector,
            governorate: draft.governorate,
            jobTitle: draft.jobTitle,
            employmentDate: draft.employmentDate,
            branches: draft.branches,
            status: draft.status,
            notes: draft.notes,
          }),
        draft.id ? 'تم حفظ تعديلات الموظف.' : 'تمت إضافة الموظف.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const exportCsv = () => {
    downloadCsv(
      csvFileName('employees'),
      ['الرقم', 'الاسم', 'الكود', 'القطاع', 'المحافظة', 'المسمى الوظيفي', 'تاريخ التعيين', 'الفروع', 'الحالة', 'ملاحظات'],
      rows.map((row) => [
        row.employeeNo,
        row.name,
        row.code,
        row.sector,
        row.governorate,
        row.jobTitle,
        row.employmentDate,
        row.branches,
        EMPLOYEE_STATUS_LABELS[row.status],
        row.notes,
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="الموظفون"
        description="قائمة ضباط المخاطر — كل موظف يُدخل مرة واحدة ثم يظهر تلقائيًا في التقييمات والزيارات والدقائق."
        actions={
          <>
            <Button icon="download" onClick={exportCsv} disabled={!rows.length}>
              تصدير CSV
            </Button>
            <Button variant="primary" icon="plus" onClick={openNew}>
              إضافة موظف
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <Toolbar>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالاسم أو الكود…" />
          <Select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="القطاع">
            <option value="all">كل القطاعات</option>
            {sectors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={governorate} onChange={(e) => setGovernorate(e.target.value)} aria-label="المحافظة">
            <option value="all">كل المحافظات</option>
            {governorates.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            <option value="active">على رأس العمل</option>
            <option value="inactive">غير نشط</option>
          </Select>
          <Checkbox label="إظهار المؤرشفين" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span className="toolbar__spacer">{rows.length} موظف</span>
        </Toolbar>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th className="num">الرقم</th>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>القطاع</th>
                  <th>المحافظة</th>
                  <th>المسمى الوظيفي</th>
                  <th>تاريخ التعيين</th>
                  <th>الفروع</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((employee) => (
                  <tr key={employee.id}>
                    <td className="num">{employee.employeeNo}</td>
                    <td>
                      <a href={`#/employees/${employee.id}`}>{employee.name}</a>
                      {employee.archived ? <Badge> مؤرشف</Badge> : null}
                    </td>
                    <td className="mono">{employee.code}</td>
                    <td>{employee.sector}</td>
                    <td>{employee.governorate}</td>
                    <td>{employee.jobTitle}</td>
                    <td className="nowrap">{fmtDate(employee.employmentDate)}</td>
                    <td>{employee.branches || '—'}</td>
                    <td>
                      <Badge tone={employee.status === 'active' ? 'success' : 'neutral'}>{EMPLOYEE_STATUS_LABELS[employee.status]}</Badge>
                    </td>
                    <td>
                      <div className="table__actions">
                        <IconButton icon="user" label="عرض الملف" onClick={() => navigate(`/employees/${employee.id}`)} />
                        <IconButton icon="edit" label="تعديل" onClick={() => openEdit(employee)} />
                        <IconButton
                          icon="archive"
                          label={employee.archived ? 'إلغاء الأرشفة' : 'أرشفة'}
                          onClick={() =>
                            runAction(
                              () => setEmployeeArchived(employee.id, !employee.archived),
                              employee.archived ? 'تم إلغاء الأرشفة.' : 'تمت أرشفة الموظف.',
                            )
                          }
                        />
                        <IconButton icon="trash" tone="danger" label="حذف" onClick={() => setConfirmDelete(employee)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            title="لا يوجد موظفون"
            description="ابدأ بإضافة أول ضابط مخاطر."
            action={
              <Button variant="primary" icon="plus" onClick={openNew}>
                إضافة موظف
              </Button>
            }
          />
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل موظف' : 'إضافة موظف'}
        size="lg"
        footer={
          <>
            <Button onClick={() => setDraft(null)}>إلغاء</Button>
            <Button variant="primary" icon="save" onClick={submit} disabled={saving}>
              حفظ
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="formgrid">
            <Field label="رقم الموظف" required error={errors.employeeNo} htmlFor="emp-no">
              <Input id="emp-no" type="number" min={1} value={draft.employeeNo} onChange={(e) => set('employeeNo', e.target.value)} />
            </Field>
            <Field label="كود الموظف" required error={errors.code} htmlFor="emp-code">
              <Input id="emp-code" value={draft.code} onChange={(e) => set('code', e.target.value)} placeholder="RO-1001" />
            </Field>
            <Field label="اسم الموظف" required error={errors.name} htmlFor="emp-name" className="span2">
              <Input id="emp-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="القطاع" required error={errors.sector} htmlFor="emp-sector">
              <Input id="emp-sector" list="sectors-list" value={draft.sector} onChange={(e) => set('sector', e.target.value)} />
              <datalist id="sectors-list">
                {settings.sectors.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="المحافظة" required error={errors.governorate} htmlFor="emp-gov">
              <Input id="emp-gov" list="govs-list" value={draft.governorate} onChange={(e) => set('governorate', e.target.value)} />
              <datalist id="govs-list">
                {settings.governorates.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="المسمى الوظيفي" required error={errors.jobTitle} htmlFor="emp-title">
              <Input id="emp-title" list="jobs-list" value={draft.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
              <datalist id="jobs-list">
                {settings.jobTitles.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="تاريخ التعيين" required error={errors.employmentDate} htmlFor="emp-hire">
              <Input id="emp-hire" type="date" value={draft.employmentDate} onChange={(e) => set('employmentDate', e.target.value)} />
            </Field>
            <Field label="الفرع / الفروع المكلف بها" hint="افصل بين الفروع بفاصلة" htmlFor="emp-branches">
              <Input id="emp-branches" value={draft.branches} onChange={(e) => set('branches', e.target.value)} />
            </Field>
            <Field label="الحالة" htmlFor="emp-status">
              <Select id="emp-status" value={draft.status} onChange={(e) => set('status', e.target.value as EmployeeStatus)}>
                <option value="active">على رأس العمل</option>
                <option value="inactive">غير نشط</option>
              </Select>
            </Field>
            <Field label="ملاحظات عامة" htmlFor="emp-notes" className="span2">
              <Textarea id="emp-notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف موظف"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteEmployee(confirmDelete.id), 'تم حذف الموظف.').catch(() => undefined);
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="small">
          سيُحذف «{confirmDelete?.name}» نهائيًا. لا يمكن الحذف إذا كان لديه تقييمات أو زيارات أو دقائق أو ملاحظات أو إجازات —
          استخدم «أرشفة» في هذه الحالة.
        </p>
      </Modal>
    </>
  );
}
