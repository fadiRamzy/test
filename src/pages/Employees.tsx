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
import { ValidationError, deleteEmployee, nextSerial, saveEmployee, setEmployeeArchived } from '../db/repo';
import type { Employee } from '../db/schema';
import { fmtDate, fmtNumber, todayInputValue, fromDateInputValue, toDateInputValue } from '../lib/format';

interface Draft {
  id?: string;
  serial: string;
  sector: string;
  governorate: string;
  name: string;
  code: string;
  jobTitle: string;
  joiningDate: string;
  visitCount: string;
  notes: string;
  archived: boolean;
}

const emptyDraft = (serial: number): Draft => ({
  serial: String(serial),
  sector: '',
  governorate: '',
  name: '',
  code: '',
  jobTitle: 'ضابط مخاطر',
  joiningDate: todayInputValue(),
  visitCount: '',
  notes: '',
  archived: false,
});

export function EmployeesPage() {
  const { data, settings, runAction, notify } = useApp();
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('all');
  const [governorate, setGovernorate] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Employee | null>(null);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.employees
      .filter((row) => (showArchived ? true : !row.archived))
      .filter((row) => (sector === 'all' ? true : row.sector === sector))
      .filter((row) => (governorate === 'all' ? true : row.governorate === governorate))
      .filter((row) =>
        !text
          ? true
          : [row.name, row.code, row.sector, row.governorate, row.jobTitle]
              .join(' ')
              .toLowerCase()
              .includes(text),
      )
      .sort((a, b) => a.serial - b.serial);
  }, [data.employees, query, sector, governorate, showArchived]);

  const sectors = useMemo(
    () => Array.from(new Set([...settings.sectors, ...data.employees.map((row) => row.sector)].filter(Boolean))).sort(),
    [settings.sectors, data.employees],
  );
  const governorates = useMemo(
    () =>
      Array.from(new Set([...settings.governorates, ...data.employees.map((row) => row.governorate)].filter(Boolean))).sort(),
    [settings.governorates, data.employees],
  );

  const openNew = async () => {
    setErrors({});
    setDraft(emptyDraft(await nextSerial()));
  };

  const openEdit = (employee: Employee) => {
    setErrors({});
    setDraft({
      id: employee.id,
      serial: String(employee.serial),
      sector: employee.sector,
      governorate: employee.governorate,
      name: employee.name,
      code: employee.code,
      jobTitle: employee.jobTitle,
      joiningDate: toDateInputValue(employee.joiningDate),
      visitCount: employee.visitCount === null ? '' : String(employee.visitCount),
      notes: employee.notes,
      archived: Boolean(employee.archived),
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
            serial: Number(draft.serial),
            sector: draft.sector,
            governorate: draft.governorate,
            name: draft.name,
            code: draft.code,
            jobTitle: draft.jobTitle,
            joiningDate: fromDateInputValue(draft.joiningDate) ?? '',
            visitCount: draft.visitCount === '' ? null : Number(draft.visitCount),
            notes: draft.notes,
            archived: draft.archived,
          }),
        draft.id ? 'تم تحديث بيانات الموظف.' : 'تمت إضافة الموظف.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await runAction(() => deleteEmployee(deleting.id), 'تم حذف الموظف نهائيًا.');
      setDeleting(null);
    } catch {
      setDeleting(null);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <>
      <PageHeader
        title="الموظفون"
        description="إدارة ضباط المخاطر المسؤولين عن دقائق الصرف والزيارات والتقييمات."
        actions={
          <Button variant="primary" icon="plus" onClick={openNew}>
            إضافة موظف
          </Button>
        }
      />

      <Card padded={false}>
        <Toolbar>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالاسم أو الكود…" />
          <Select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="تصفية بالقطاع">
            <option value="all">كل القطاعات</option>
            {sectors.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={governorate} onChange={(e) => setGovernorate(e.target.value)} aria-label="تصفية بالمحافظة">
            <option value="all">كل المحافظات</option>
            {governorates.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Checkbox label="إظهار المؤرشفين" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span className="toolbar__count">
            {rows.length} من {data.employees.length}
          </span>
        </Toolbar>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>م</th>
                  <th>الاسم</th>
                  <th>الكود</th>
                  <th>المسمى الوظيفي</th>
                  <th>القطاع</th>
                  <th>المحافظة</th>
                  <th>تاريخ الالتحاق</th>
                  <th>عدد الزيارات</th>
                  <th>دقائق مفتوحة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((employee) => {
                  const openMinutes = data.minutes.filter(
                    (minute) => minute.employeeId === employee.id && minute.status === 'open',
                  ).length;
                  return (
                    <tr key={employee.id} className={employee.archived ? 'row--muted' : undefined}>
                      <td className="num">{employee.serial}</td>
                      <td>
                        <a href={`#/employees/${employee.id}`} className="link">
                          {employee.name}
                        </a>
                        {employee.archived ? <Badge tone="neutral"> مؤرشف</Badge> : null}
                      </td>
                      <td className="mono">{employee.code}</td>
                      <td>{employee.jobTitle}</td>
                      <td>{employee.sector}</td>
                      <td>{employee.governorate}</td>
                      <td>{fmtDate(employee.joiningDate)}</td>
                      <td className="num">{fmtNumber(employee.visitCount)}</td>
                      <td className="num">{openMinutes}</td>
                      <td className="cell-actions">
                        <IconButton icon="user" label="الملف الشخصي" onClick={() => navigate(`/employees/${employee.id}`)} />
                        <IconButton icon="edit" label="تعديل" onClick={() => openEdit(employee)} />
                        <IconButton icon="trash" label="حذف" variant="danger" onClick={() => setDeleting(employee)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="employees"
            title="لا توجد نتائج"
            description="أضف موظفًا جديدًا أو عدّل معايير التصفية."
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
        title={draft?.id ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}
        subtitle="كل الحقول الأساسية مطلوبة. تُدخل البيانات يدويًا بالكامل."
        footer={
          <>
            <Button onClick={() => setDraft(null)}>إلغاء</Button>
            <Button variant="primary" icon="save" loading={saving} onClick={submit}>
              حفظ
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="form-grid">
            <Field label="الرقم التسلسلي" required error={errors.serial} htmlFor="emp-serial">
              <Input
                id="emp-serial"
                type="number"
                min={1}
                value={draft.serial}
                onChange={(e) => set('serial', e.target.value)}
              />
            </Field>
            <Field label="كود الموظف" required error={errors.code} htmlFor="emp-code">
              <Input id="emp-code" value={draft.code} onChange={(e) => set('code', e.target.value)} placeholder="مثال: RO-1024" />
            </Field>
            <Field label="اسم الموظف" required error={errors.name} htmlFor="emp-name" className="span-2">
              <Input id="emp-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="المسمى الوظيفي" required error={errors.jobTitle} htmlFor="emp-title">
              <Input id="emp-title" value={draft.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
            </Field>
            <Field label="تاريخ الالتحاق" required error={errors.joiningDate} htmlFor="emp-joining">
              <Input id="emp-joining" type="date" value={draft.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
            </Field>
            <Field label="القطاع" required error={errors.sector} htmlFor="emp-sector">
              <Input
                id="emp-sector"
                list="sector-options"
                value={draft.sector}
                onChange={(e) => set('sector', e.target.value)}
              />
              <datalist id="sector-options">
                {settings.sectors.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="المحافظة" required error={errors.governorate} htmlFor="emp-gov">
              <Input
                id="emp-gov"
                list="gov-options"
                value={draft.governorate}
                onChange={(e) => set('governorate', e.target.value)}
              />
              <datalist id="gov-options">
                {settings.governorates.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field
              label="عدد الزيارات"
              error={errors.visitCount}
              hint="إدخال يدوي — اتركه فارغًا إن لم يكن محددًا."
              htmlFor="emp-visits"
            >
              <Input
                id="emp-visits"
                type="number"
                min={0}
                value={draft.visitCount}
                onChange={(e) => set('visitCount', e.target.value)}
              />
            </Field>
            <Field label="ملاحظات عامة" htmlFor="emp-notes" className="span-2">
              <Textarea id="emp-notes" rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            <div className="span-2">
              <Checkbox label="موظف مؤرشف (يُخفى من القوائم)" checked={draft.archived} onChange={(e) => set('archived', e.target.checked)} />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="حذف موظف"
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>إلغاء</Button>
            <Button variant="danger" onClick={confirmDelete} icon="trash">
              حذف نهائي
            </Button>
          </>
        }
      >
        <p className="confirm-text">
          سيتم حذف «{deleting?.name}» نهائيًا. لا يمكن الحذف إذا كان لديه دقائق أو زيارات أو ملاحظات أو تقييمات مسجلة —
          استخدم الأرشفة في هذه الحالة.
        </p>
        <Button
          variant="secondary"
          icon="archive"
          onClick={async () => {
            if (!deleting) return;
            await runAction(() => setEmployeeArchived(deleting.id, true), 'تم أرشفة الموظف.');
            setDeleting(null);
            notify('يمكنك إظهار المؤرشفين من خيار «إظهار المؤرشفين».', 'info');
          }}
        >
          أرشفة بدلًا من الحذف
        </Button>
      </Modal>
    </>
  );
}
