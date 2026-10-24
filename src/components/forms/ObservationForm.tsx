import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../../state/store';
import { findObservationDuplicates, saveObservation } from '../../db/repo';
import {
  OBSERVATION_SOURCE_LABELS,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  type Observation,
} from '../../db/schema';
import { Button, Callout, Field, Input, Modal, Select, Textarea } from '../ui';
import { fromDateInputValue, toDateInputValue, todayInputValue } from '../../lib/format';
import { useLookups } from '../domain';

export function ObservationForm({
  open,
  observation,
  onClose,
  onSaved,
}: {
  open: boolean;
  observation?: Observation | null;
  onClose: () => void;
  onSaved?: (observation: Observation) => void;
}) {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const [form, setForm] = useState<Partial<Observation>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDuplicates([]);
    setForm(
      observation ?? {
        employeeId: data.employees[0]?.id ?? null,
        branchId: data.employees[0]?.branchId ?? null,
        date: todayInputValue(),
        categoryId: settings.observationCategories[0]?.id ?? '',
        severity: 'medium',
        source: 'review',
        description: '',
        correctiveAction: '',
        status: 'open',
        isRecurring: false,
        followUps: [],
      },
    );
  }, [open, observation, data.employees, settings.observationCategories]);

  const patch = (values: Partial<Observation>) => setForm((prev) => ({ ...prev, ...values }));

  const employeeMinutes = useMemo(
    () => data.minutes.filter((minute) => minute.employeeId === form.employeeId).slice(0, 60),
    [data.minutes, form.employeeId],
  );
  const employeeVisits = useMemo(
    () => data.visits.filter((visit) => visit.employeeId === form.employeeId).slice(0, 60),
    [data.visits, form.employeeId],
  );

  useEffect(() => {
    if (!open) return;
    if (!form.employeeId || !form.categoryId || !form.date) {
      setDuplicates([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const found = await findObservationDuplicates({ ...form, id: observation?.id });
      if (!active) return;
      setDuplicates(found.map((f) => `${f.reason} — ${(f.record as Observation).refNo}`));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, form, observation?.id]);

  const submit = async () => {
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        ...form,
        date: form.date ? form.date.slice(0, 10) : '',
        notifiedAt: form.notifiedAt ? fromDateInputValue(toDateInputValue(form.notifiedAt)) : null,
        resolvedAt: form.resolvedAt ? fromDateInputValue(toDateInputValue(form.resolvedAt)) : null,
      };
      const saved = await runAction(
        () => saveObservation(payload),
        observation ? 'تم تحديث الملاحظة.' : 'تم تسجيل الملاحظة.',
      );
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
      title={observation ? `تعديل الملاحظة ${observation.refNo}` : 'تسجيل ملاحظة جديدة'}
      subtitle="سجل مركزي يمكن ربطه بالموظف والفرع ودقيقة الصرف أو الزيارة."
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
        <Field label="الموظف" required error={errors.employeeId}>
          <Select
            value={form.employeeId ?? ''}
            onChange={(e) => {
              const employee = lookups.employeeMap.get(e.target.value);
              patch({ employeeId: e.target.value || null, branchId: employee?.branchId ?? form.branchId });
            }}
          >
            <option value="">— اختر الموظف —</option>
            {data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ({employee.employeeCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الفرع">
          <Select value={form.branchId ?? ''} onChange={(e) => patch({ branchId: e.target.value || null })}>
            <option value="">— بدون فرع —</option>
            {lookups.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="تاريخ الملاحظة" required error={errors.date}>
          <Input type="date" value={toDateInputValue(form.date)} onChange={(e) => patch({ date: e.target.value })} />
        </Field>
        <Field label="التصنيف" required error={errors.categoryId}>
          <Select value={form.categoryId ?? ''} onChange={(e) => patch({ categoryId: e.target.value })}>
            {settings.observationCategories.filter((c) => c.active).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="درجة الخطورة" required error={errors.severity}>
          <Select value={form.severity ?? 'medium'} onChange={(e) => patch({ severity: e.target.value as Observation['severity'] })}>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المصدر" required error={errors.source}>
          <Select value={form.source ?? 'review'} onChange={(e) => patch({ source: e.target.value as Observation['source'] })}>
            {Object.entries(OBSERVATION_SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="دقيقة صرف مرتبطة">
          <Select value={form.minuteId ?? ''} onChange={(e) => patch({ minuteId: e.target.value || null })}>
            <option value="">— بدون —</option>
            {employeeMinutes.map((minute) => (
              <option key={minute.id} value={minute.id}>
                {minute.refNo} — {minute.clientRef}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="زيارة مرتبطة">
          <Select value={form.visitId ?? ''} onChange={(e) => patch({ visitId: e.target.value || null })}>
            <option value="">— بدون —</option>
            {employeeVisits.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.refNo} — {visit.clientRef}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="تاريخ الإخطار">
          <Input type="date" value={toDateInputValue(form.notifiedAt)} onChange={(e) => patch({ notifiedAt: e.target.value })} />
        </Field>
        <Field label="الحالة" required error={errors.status}>
          <Select value={form.status ?? 'open'} onChange={(e) => patch({ status: e.target.value as Observation['status'] })}>
            {Object.entries(OBSERVATION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="تاريخ المعالجة" error={errors.resolvedAt} hint="مطلوب عند الحالة «تمت المعالجة»">
          <Input type="date" value={toDateInputValue(form.resolvedAt)} onChange={(e) => patch({ resolvedAt: e.target.value })} />
        </Field>
        <Field label="ملاحظة متكررة؟">
          <Select value={form.isRecurring ? 'yes' : 'no'} onChange={(e) => patch({ isRecurring: e.target.value === 'yes' })}>
            <option value="no">لا</option>
            <option value="yes">نعم</option>
          </Select>
        </Field>
      </div>

      <div className="form-section">
        <Field label="الوصف الكامل" required error={errors.description}>
          <Textarea value={form.description ?? ''} onChange={(e) => patch({ description: e.target.value })} rows={3} />
        </Field>
        <Field label="الإجراء التصحيحي" className="mt-12">
          <Textarea value={form.correctiveAction ?? ''} onChange={(e) => patch({ correctiveAction: e.target.value })} rows={2} />
        </Field>
      </div>

      {duplicates.length ? (
        <div className="mt-12">
          <Callout tone="warning" title="ملاحظة مشابهة مسجلة" icon="alert">
            {duplicates.join(' • ')}
          </Callout>
        </div>
      ) : null}
    </Modal>
  );
}
