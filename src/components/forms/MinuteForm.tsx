import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../../state/store';
import { findMinuteDuplicates, saveMinute } from '../../db/repo';
import { FINANCING_TYPES, MINUTE_OUTCOME_LABELS, MINUTE_STATUS_LABELS, type DisbursementMinute } from '../../db/schema';
import { Button, Callout, Field, Input, Modal, Select, Textarea } from '../ui';
import { fromDateTimeInputValue, fmtDateTime, fmtMinutes, toDateTimeInputValue } from '../../lib/format';
import { computeMinuteTimings } from '../../lib/minuteCalc';
import { calendarFromSettings } from '../../lib/analytics';
import { useLookups } from '../domain';

interface FormState {
  refNo: string;
  branchId: string;
  employeeId: string;
  clientRef: string;
  financingType: string;
  amount: string;
  outcome: DisbursementMinute['outcome'];
  status: DisbursementMinute['status'];
  receivedAt: string;
  fileRequestedAt: string;
  fileReceivedAt: string;
  reviewStartedAt: string;
  clarificationRequestedAt: string;
  clarificationRespondedAt: string;
  finalResponseAt: string;
  notes: string;
}

function toFormState(minute?: DisbursementMinute | null, defaults?: { employeeId?: string; branchId?: string }): FormState {
  return {
    refNo: minute?.refNo ?? '',
    branchId: minute?.branchId ?? defaults?.branchId ?? '',
    employeeId: minute?.employeeId ?? defaults?.employeeId ?? '',
    clientRef: minute?.clientRef ?? '',
    financingType: minute?.financingType ?? FINANCING_TYPES[0],
    amount: minute?.amount === null || minute?.amount === undefined ? '' : String(minute.amount),
    outcome: minute?.outcome ?? 'pending',
    status: minute?.status ?? 'in_progress',
    receivedAt: toDateTimeInputValue(minute?.receivedAt ?? new Date()),
    fileRequestedAt: toDateTimeInputValue(minute?.fileRequestedAt),
    fileReceivedAt: toDateTimeInputValue(minute?.fileReceivedAt),
    reviewStartedAt: toDateTimeInputValue(minute?.reviewStartedAt),
    clarificationRequestedAt: toDateTimeInputValue(minute?.clarificationRequestedAt),
    clarificationRespondedAt: toDateTimeInputValue(minute?.clarificationRespondedAt),
    finalResponseAt: toDateTimeInputValue(minute?.finalResponseAt),
    notes: minute?.notes ?? '',
  };
}

export function MinuteForm({
  open,
  minute,
  onClose,
  onSaved,
}: {
  open: boolean;
  minute?: DisbursementMinute | null;
  onClose: () => void;
  onSaved?: (minute: DisbursementMinute) => void;
}) {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const [form, setForm] = useState<FormState>(() => toFormState(minute));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(toFormState(minute));
    setErrors({});
    setDuplicates([]);
  }, [open, minute]);

  const patch = (values: Partial<FormState>) => setForm((prev) => ({ ...prev, ...values }));

  const payload = useMemo<Partial<DisbursementMinute>>(
    () => ({
      id: minute?.id,
      refNo: form.refNo,
      branchId: form.branchId || null,
      employeeId: form.employeeId || null,
      clientRef: form.clientRef,
      financingType: form.financingType,
      amount: form.amount.trim() ? Number(form.amount) : null,
      outcome: form.outcome,
      status: form.status,
      receivedAt: fromDateTimeInputValue(form.receivedAt) ?? undefined,
      fileRequestedAt: fromDateTimeInputValue(form.fileRequestedAt),
      fileReceivedAt: fromDateTimeInputValue(form.fileReceivedAt),
      reviewStartedAt: fromDateTimeInputValue(form.reviewStartedAt),
      clarificationRequestedAt: fromDateTimeInputValue(form.clarificationRequestedAt),
      clarificationRespondedAt: fromDateTimeInputValue(form.clarificationRespondedAt),
      finalResponseAt: fromDateTimeInputValue(form.finalResponseAt),
      notes: form.notes,
      createdAt: minute?.createdAt,
      updatedAt: minute?.updatedAt,
      deletedAt: minute?.deletedAt ?? null,
      isDemo: minute?.isDemo ?? false,
    }),
    [form, minute],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(async () => {
      if (!form.clientRef && !form.refNo) {
        setDuplicates([]);
        return;
      }
      const found = await findMinuteDuplicates(payload);
      if (!active) return;
      setDuplicates(found.map((f) => `${f.reason} — ${(f.record as DisbursementMinute).refNo}`));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, form.clientRef, form.refNo, form.employeeId, payload]);

  const preview = useMemo(() => {
    if (!payload.receivedAt) return null;
    return computeMinuteTimings(
      {
        ...(payload as unknown as DisbursementMinute),
        id: 'preview',
        createdAt: '',
        updatedAt: '',
      },
      calendarFromSettings(settings),
      settings.minutesDeadlineMinutes,
      settings.deadlineWarnPercent,
    );
  }, [payload, settings]);

  const submit = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await runAction(
        () => saveMinute(payload),
        minute ? 'تم تحديث دقيقة الصرف.' : 'تم تسجيل دقيقة الصرف.',
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

  const activeEmployees = data.employees.filter((e) => e.status !== 'archived');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={minute ? `تعديل دقيقة الصرف ${minute.refNo}` : 'تسجيل دقيقة صرف'}
      subtitle={`المهلة المحسوبة: ${settings.minutesDeadlineMinutes} دقيقة عمل — أيام العمل: ${settings.workingDays.length} يومًا أسبوعيًا`}
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
        <Field label="رقم الدقيقة" error={errors.refNo} hint="يُنشأ تلقائيًا إن تُرك فارغًا">
          <Input value={form.refNo} onChange={(e) => patch({ refNo: e.target.value })} placeholder="MIN-0001" />
        </Field>
        <Field label="مرجع العميل / الملف" required error={errors.clientRef}>
          <Input value={form.clientRef} onChange={(e) => patch({ clientRef: e.target.value })} placeholder="CL-1024" />
        </Field>
        <Field label="الفرع" error={errors.branchId}>
          <Select value={form.branchId} onChange={(e) => patch({ branchId: e.target.value })}>
            <option value="">— اختر الفرع —</option>
            {lookups.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ضابط المخاطر المسؤول" required error={errors.employeeId}>
          <Select value={form.employeeId} onChange={(e) => patch({ employeeId: e.target.value })}>
            <option value="">— اختر الضابط —</option>
            {activeEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ({employee.employeeCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="نوع التمويل" required error={errors.financingType}>
          <Select value={form.financingType} onChange={(e) => patch({ financingType: e.target.value })}>
            {FINANCING_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المبلغ" error={errors.amount} hint="بالجنيه المصري">
          <Input value={form.amount} onChange={(e) => patch({ amount: e.target.value })} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="النتيجة" error={errors.outcome}>
          <Select value={form.outcome} onChange={(e) => patch({ outcome: e.target.value as DisbursementMinute['outcome'] })}>
            {Object.entries(MINUTE_OUTCOME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الحالة" error={errors.status}>
          <Select value={form.status} onChange={(e) => patch({ status: e.target.value as DisbursementMinute['status'] })}>
            {Object.entries(MINUTE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="form-section">
        <div className="form-section__title">الطوابع الزمنية (لحساب المهلة وأزمنة الانتظار)</div>
        <div className="form-grid">
          <Field label="وقت استلام الدقيقة" required error={errors.receivedAt}>
            <Input type="datetime-local" value={form.receivedAt} onChange={(e) => patch({ receivedAt: e.target.value })} />
          </Field>
          <Field label="وقت طلب الملف" error={errors.fileRequestedAt}>
            <Input type="datetime-local" value={form.fileRequestedAt} onChange={(e) => patch({ fileRequestedAt: e.target.value })} />
          </Field>
          <Field label="وقت استلام الملف" error={errors.fileReceivedAt}>
            <Input type="datetime-local" value={form.fileReceivedAt} onChange={(e) => patch({ fileReceivedAt: e.target.value })} />
          </Field>
          <Field label="وقت بدء المراجعة" error={errors.reviewStartedAt}>
            <Input type="datetime-local" value={form.reviewStartedAt} onChange={(e) => patch({ reviewStartedAt: e.target.value })} />
          </Field>
          <Field label="وقت طلب الاستيضاح" error={errors.clarificationRequestedAt}>
            <Input
              type="datetime-local"
              value={form.clarificationRequestedAt}
              onChange={(e) => patch({ clarificationRequestedAt: e.target.value })}
            />
          </Field>
          <Field label="وقت الرد على الاستيضاح" error={errors.clarificationRespondedAt}>
            <Input
              type="datetime-local"
              value={form.clarificationRespondedAt}
              onChange={(e) => patch({ clarificationRespondedAt: e.target.value })}
            />
          </Field>
          <Field label="وقت الرد النهائي" error={errors.finalResponseAt} hint="عند تعبئته تُغلق الدقيقة">
            <Input type="datetime-local" value={form.finalResponseAt} onChange={(e) => patch({ finalResponseAt: e.target.value })} />
          </Field>
        </div>
        {errors.chronology ? <p className="field__error mt-8">{errors.chronology}</p> : null}
        {Object.keys(errors).length > 0 && !errors.chronology ? (
          <Callout tone="danger" title="تحقق من التواريخ" icon="alert">
            يجب أن تكون الطوابع الزمنية مرتبة تصاعديًا.
          </Callout>
        ) : null}
      </div>

      <div className="form-section">
        <Field label="ملاحظات">
          <Textarea value={form.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} />
        </Field>
      </div>

      {preview ? (
        <div className="summary-strip mt-12">
          <div className="summary-strip__item">
            <span>الموعد النهائي</span>
            <strong>{preview.dueAt ? fmtDateTime(preview.dueAt) : '—'}</strong>
          </div>
          <div className="summary-strip__item">
            <span>الزمن المنقضي</span>
            <strong>{fmtMinutes(preview.elapsedMinutes)}</strong>
          </div>
          <div className="summary-strip__item">
            <span>زمن معالجة الضابط</span>
            <strong>{fmtMinutes(preview.officerMinutes)}</strong>
          </div>
          <div className="summary-strip__item">
            <span>زمن انتظار الفرع</span>
            <strong>{fmtMinutes(preview.waitingMinutes)}</strong>
          </div>
          <div className="summary-strip__item">
            <span>المتبقي</span>
            <strong>{preview.remainingMinutes > 0 ? fmtMinutes(preview.remainingMinutes) : 'انتهت المهلة'}</strong>
          </div>
        </div>
      ) : null}

      {duplicates.length ? (
        <div className="mt-12">
          <Callout tone="warning" title="تحذير تكرار محتمل" icon="alert">
            {duplicates.join(' • ')}
          </Callout>
        </div>
      ) : null}
    </Modal>
  );
}
