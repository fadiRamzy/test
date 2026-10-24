import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../../state/store';
import { findVisitDuplicates, newReviewCycle, saveVisit } from '../../db/repo';
import { VISIT_STATUS_LABELS, type FieldVisit } from '../../db/schema';
import { Button, Callout, Field, Input, Modal, Select, Textarea } from '../ui';
import { fromDateTimeInputValue, toDateInputValue, toDateTimeInputValue, todayInputValue } from '../../lib/format';
import { useLookups } from '../domain';

interface FormState {
  refNo: string;
  employeeId: string;
  branchId: string;
  clientRef: string;
  visitDate: string;
  departureAt: string;
  arrivalAt: string;
  inspectionAt: string;
  returnAt: string;
  reportSubmittedAt: string;
  supervisorReviewAt: string;
  correctionsAt: string;
  resubmittedAt: string;
  finalEmailAt: string;
  status: FieldVisit['status'];
  qualityScore: string;
  feedback: string;
  pendingActions: string;
  notes: string;
}

function toFormState(visit?: FieldVisit | null): FormState {
  return {
    refNo: visit?.refNo ?? '',
    employeeId: visit?.employeeId ?? '',
    branchId: visit?.branchId ?? '',
    clientRef: visit?.clientRef ?? '',
    visitDate: visit?.visitDate?.slice(0, 10) ?? todayInputValue(),
    departureAt: toDateTimeInputValue(visit?.departureAt),
    arrivalAt: toDateTimeInputValue(visit?.arrivalAt),
    inspectionAt: toDateTimeInputValue(visit?.inspectionAt),
    returnAt: toDateTimeInputValue(visit?.returnAt),
    reportSubmittedAt: toDateTimeInputValue(visit?.reportSubmittedAt),
    supervisorReviewAt: toDateTimeInputValue(visit?.supervisorReviewAt),
    correctionsAt: toDateTimeInputValue(visit?.correctionsAt),
    resubmittedAt: toDateTimeInputValue(visit?.resubmittedAt),
    finalEmailAt: toDateTimeInputValue(visit?.finalEmailAt),
    status: visit?.status ?? 'planned',
    qualityScore: visit?.qualityScore === null || visit?.qualityScore === undefined ? '' : String(visit.qualityScore),
    feedback: visit?.feedback ?? '',
    pendingActions: visit?.pendingActions ?? '',
    notes: visit?.notes ?? '',
  };
}

export function VisitForm({
  open,
  visit,
  onClose,
  onSaved,
}: {
  open: boolean;
  visit?: FieldVisit | null;
  onClose: () => void;
  onSaved?: (visit: FieldVisit) => void;
}) {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const [form, setForm] = useState<FormState>(() => toFormState(visit));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(toFormState(visit));
    setErrors({});
    setDuplicates([]);
  }, [open, visit]);

  const patch = (values: Partial<FormState>) => setForm((prev) => ({ ...prev, ...values }));

  const payload = useMemo(
    () => ({
      id: visit?.id,
      refNo: form.refNo,
      employeeId: form.employeeId || null,
      branchId: form.branchId || null,
      clientRef: form.clientRef,
      visitDate: form.visitDate,
      departureAt: fromDateTimeInputValue(form.departureAt),
      arrivalAt: fromDateTimeInputValue(form.arrivalAt),
      inspectionAt: fromDateTimeInputValue(form.inspectionAt),
      returnAt: fromDateTimeInputValue(form.returnAt),
      reportSubmittedAt: fromDateTimeInputValue(form.reportSubmittedAt),
      supervisorReviewAt: fromDateTimeInputValue(form.supervisorReviewAt),
      correctionsAt: fromDateTimeInputValue(form.correctionsAt),
      resubmittedAt: fromDateTimeInputValue(form.resubmittedAt),
      finalEmailAt: fromDateTimeInputValue(form.finalEmailAt),
      status: form.status,
      qualityScore: form.qualityScore ? Number(form.qualityScore) : null,
      feedback: form.feedback,
      pendingActions: form.pendingActions,
      notes: form.notes,
      reviewCycles: visit?.reviewCycles ?? [newReviewCycle(1)],
      createdAt: visit?.createdAt,
      updatedAt: visit?.updatedAt,
      deletedAt: visit?.deletedAt ?? null,
      isDemo: visit?.isDemo ?? false,
    }),
    [form, visit],
  );

  useEffect(() => {
    if (!open) return;
    if (!form.clientRef || !form.visitDate) {
      setDuplicates([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const found = await findVisitDuplicates(payload);
      if (!active) return;
      setDuplicates(found.map((f) => `${f.reason} — ${(f.record as FieldVisit).refNo}`));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, form.clientRef, form.visitDate, form.employeeId, payload]);

  const submit = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await runAction(() => saveVisit(payload), visit ? 'تم تحديث الزيارة.' : 'تم تسجيل الزيارة.');
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

  const qualityOptions = Array.from(
    { length: settings.ratingScale.max - settings.ratingScale.min + 1 },
    (_, index) => settings.ratingScale.min + index,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={visit ? `تعديل الزيارة ${visit.refNo}` : 'تسجيل زيارة ميدانية'}
      subtitle="جميع الأوقات اختيارية، وتُستخدم لحساب مدة إعداد التقرير والتأخيرات."
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
        <Field label="رقم الزيارة" hint="تلقائي إن تُرك فارغًا">
          <Input value={form.refNo} onChange={(e) => patch({ refNo: e.target.value })} placeholder="VIS-0001" />
        </Field>
        <Field label="ضابط المخاطر" required error={errors.employeeId}>
          <Select value={form.employeeId} onChange={(e) => patch({ employeeId: e.target.value })}>
            <option value="">— اختر الضابط —</option>
            {data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ({employee.employeeCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الفرع">
          <Select value={form.branchId} onChange={(e) => patch({ branchId: e.target.value })}>
            <option value="">— اختر الفرع —</option>
            {lookups.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="مرجع العميل" required error={errors.clientRef}>
          <Input value={form.clientRef} onChange={(e) => patch({ clientRef: e.target.value })} />
        </Field>
        <Field label="تاريخ الزيارة" required error={errors.visitDate}>
          <Input type="date" value={toDateInputValue(form.visitDate)} onChange={(e) => patch({ visitDate: e.target.value })} />
        </Field>
        <Field label="الحالة" error={errors.status}>
          <Select value={form.status} onChange={(e) => patch({ status: e.target.value as FieldVisit['status'] })}>
            {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="جودة التقرير (1–5)" error={errors.qualityScore}>
          <Select value={form.qualityScore} onChange={(e) => patch({ qualityScore: e.target.value })}>
            <option value="">— غير مُقيَّم —</option>
            {qualityOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="form-section">
        <div className="form-section__title">تسلسل الزيارة والتقرير</div>
        <div className="form-grid">
          <Field label="وقت التحرك">
            <Input type="datetime-local" value={form.departureAt} onChange={(e) => patch({ departureAt: e.target.value })} />
          </Field>
          <Field label="وقت الوصول">
            <Input type="datetime-local" value={form.arrivalAt} onChange={(e) => patch({ arrivalAt: e.target.value })} />
          </Field>
          <Field label="وقت الفحص">
            <Input type="datetime-local" value={form.inspectionAt} onChange={(e) => patch({ inspectionAt: e.target.value })} />
          </Field>
          <Field label="وقت العودة">
            <Input type="datetime-local" value={form.returnAt} onChange={(e) => patch({ returnAt: e.target.value })} />
          </Field>
          <Field label="تسليم التقرير">
            <Input type="datetime-local" value={form.reportSubmittedAt} onChange={(e) => patch({ reportSubmittedAt: e.target.value })} />
          </Field>
          <Field label="مراجعة المشرف">
            <Input type="datetime-local" value={form.supervisorReviewAt} onChange={(e) => patch({ supervisorReviewAt: e.target.value })} />
          </Field>
          <Field label="طلب تصحيحات">
            <Input type="datetime-local" value={form.correctionsAt} onChange={(e) => patch({ correctionsAt: e.target.value })} />
          </Field>
          <Field label="إعادة التسليم">
            <Input type="datetime-local" value={form.resubmittedAt} onChange={(e) => patch({ resubmittedAt: e.target.value })} />
          </Field>
          <Field label="بريد التقييم النهائي">
            <Input type="datetime-local" value={form.finalEmailAt} onChange={(e) => patch({ finalEmailAt: e.target.value })} />
          </Field>
        </div>
        {errors.chronology ? <p className="field__error mt-8">{errors.chronology}</p> : null}
      </div>

      <div className="form-section">
        <div className="form-grid form-grid--wide">
          <Field label="التغذية الراجعة">
            <Textarea value={form.feedback} onChange={(e) => patch({ feedback: e.target.value })} rows={2} />
          </Field>
          <Field label="المهام المعلقة">
            <Textarea value={form.pendingActions} onChange={(e) => patch({ pendingActions: e.target.value })} rows={2} />
          </Field>
          <Field label="ملاحظات">
            <Textarea value={form.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} />
          </Field>
        </div>
      </div>

      {duplicates.length ? (
        <div className="mt-12">
          <Callout tone="warning" title="تحذير تكرار محتمل" icon="alert">
            {duplicates.join(' • ')}
          </Callout>
        </div>
      ) : null}

      {visit ? (
        <p className="small muted mt-12">
          تُدار دورات المراجعة من نافذة تفاصيل الزيارة، بحيث يُحفظ تاريخ كل دورة دون استبدال الدورات السابقة.
        </p>
      ) : null}
    </Modal>
  );
}
