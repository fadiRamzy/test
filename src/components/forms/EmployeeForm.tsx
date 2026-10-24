import { useEffect, useState } from 'react';
import { useApp, useVisibleData } from '../../state/store';
import { findEmployeeDuplicates, saveEmployee } from '../../db/repo';
import type { Employee } from '../../db/schema';
import { Button, Callout, Field, Input, Modal, Select, Textarea } from '../ui';
import { todayInputValue, toDateInputValue } from '../../lib/format';
import { useLookups } from '../domain';

export function EmployeeForm({
  open,
  employee,
  onClose,
  onSaved,
}: {
  open: boolean;
  employee?: Employee | null;
  onClose: () => void;
  onSaved?: (employee: Employee) => void;
}) {
  const { runAction } = useApp();
  const { employees } = useVisibleData();
  const lookups = useLookups();
  const [form, setForm] = useState<Partial<Employee>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDuplicate(null);
    setForm(
      employee ?? {
        employeeCode: '',
        fullName: '',
        jobTitle: 'ضابط مخاطر',
        branchId: lookups.branches[0]?.id ?? null,
        governorate: lookups.branches[0]?.governorate ?? '',
        hireDate: todayInputValue(),
        status: 'active',
        phone: '',
        email: '',
        notes: '',
      },
    );
  }, [open, employee, lookups.branches]);

  const update = (patch: Partial<Employee>) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!open) return;
    let active = true;
    const run = async () => {
      if (!form.employeeCode && !form.fullName) {
        setDuplicate(null);
        return;
      }
      const found = await findEmployeeDuplicates({ ...form, id: employee?.id });
      if (!active) return;
      const messages: string[] = [];
      if (found.code) messages.push(`الرقم الوظيفي مستخدم بالفعل للموظف «${found.code.fullName}».`);
      if (found.name) messages.push(`يوجد موظف بنفس الاسم في نفس الفرع: «${found.name.fullName}».`);
      setDuplicate(messages.length ? messages.join(' ') : null);
    };
    void run();
    return () => {
      active = false;
    };
  }, [form, open, employee?.id]);

  const submit = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await runAction(() => saveEmployee({ ...form, id: employee?.id }), employee ? 'تم تحديث بيانات الموظف.' : 'تمت إضافة الموظف.');
      if (saved) {
        onSaved?.(saved);
        onClose();
      }
    } catch (error) {
      const errs = (error as { errors?: Record<string, string> }).errors;
      if (errs) setErrors(errs);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={employee ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}
      subtitle="الحقول المعلّمة بـ * مطلوبة"
      size="lg"
      footer={
        <>
          <Button variant="primary" icon="save" onClick={submit} loading={saving}>
            حفظ
          </Button>
          <Button onClick={onClose}>إلغاء</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="الاسم الكامل" required error={errors.fullName}>
          <Input value={form.fullName ?? ''} onChange={(e) => update({ fullName: e.target.value })} placeholder="مثال: محمد أحمد علي" />
        </Field>
        <Field label="الرقم الوظيفي" required error={errors.employeeCode}>
          <Input value={form.employeeCode ?? ''} onChange={(e) => update({ employeeCode: e.target.value })} placeholder="EMP-001" />
        </Field>
        <Field label="المسمى الوظيفي" required error={errors.jobTitle}>
          <Input value={form.jobTitle ?? ''} onChange={(e) => update({ jobTitle: e.target.value })} />
        </Field>
        <Field label="الفرع">
          <Select
            value={form.branchId ?? ''}
            onChange={(e) => {
              const branch = lookups.branchMap.get(e.target.value);
              update({ branchId: e.target.value || null, governorate: branch?.governorate ?? form.governorate });
            }}
          >
            <option value="">— بدون فرع —</option>
            {lookups.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المحافظة">
          <Input value={form.governorate ?? ''} onChange={(e) => update({ governorate: e.target.value })} />
        </Field>
        <Field label="تاريخ التعيين" error={errors.hireDate}>
          <Input type="date" value={toDateInputValue(form.hireDate)} onChange={(e) => update({ hireDate: e.target.value })} />
        </Field>
        <Field label="تاريخ الانتهاء" error={errors.endDate} hint="يُترك فارغًا للموظف الحالي">
          <Input type="date" value={toDateInputValue(form.endDate)} onChange={(e) => update({ endDate: e.target.value || null })} />
        </Field>
        <Field label="الحالة" required error={errors.status}>
          <Select value={form.status ?? 'active'} onChange={(e) => update({ status: e.target.value as Employee['status'] })}>
            <option value="active">على رأس العمل</option>
            <option value="inactive">غير نشط</option>
            <option value="archived">مؤرشف</option>
          </Select>
        </Field>
        <Field label="الهاتف" error={errors.phone}>
          <Input value={form.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} inputMode="tel" />
        </Field>
        <Field label="البريد الإلكتروني" error={errors.email}>
          <Input type="email" value={form.email ?? ''} onChange={(e) => update({ email: e.target.value })} dir="ltr" />
        </Field>
        <Field label="ملاحظات" className="fieldset-span-2">
          <Textarea value={form.notes ?? ''} onChange={(e) => update({ notes: e.target.value })} rows={2} />
        </Field>
      </div>

      {duplicate ? (
        <div className="mt-12">
          <Callout tone="warning" title="تحذير تكرار محتمل" icon="alert">
            {duplicate} يمكنك المتابعة إذا كان ذلك مقصودًا.
          </Callout>
        </div>
      ) : null}

      {employees.length === 0 && !open ? null : null}
    </Modal>
  );
}
