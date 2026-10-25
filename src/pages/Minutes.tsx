import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { useRoute } from '../state/router';
import {
  Badge,
  Button,
  Callout,
  Card,
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
  Tabs,
  Textarea,
} from '../components/ui';
import { ValidationError, deleteMinute, saveMinute } from '../db/repo';
import { MINUTE_STATUS_LABELS, type Minute, type MinuteStatus } from '../db/schema';
import {
  fmtDateTime,
  fmtDurationShort,
  fromDateTimeInputValue,
  nowDateTimeInputValue,
  toDateInputValue,
  toDateTimeInputValue,
} from '../lib/format';
import { MINUTE_FLAG_LABELS, matchMinuteFlag, minuteState, type MinuteFlag } from '../lib/tracking';

interface Draft {
  id?: string;
  employeeId: string;
  branchRef: string;
  receivedAt: string;
  fileRequestedAt: string;
  fileReceivedAt: string;
  reviewStartedAt: string;
  finalResponseAt: string;
  status: MinuteStatus;
  observations: string;
  delayReason: string;
}

const FLAGS: MinuteFlag[] = ['all', 'file_not_requested', 'waiting_file', 'review_not_started', 'pending_response', 'overdue', 'completed'];

const emptyDraft = (): Draft => ({
  employeeId: '',
  branchRef: '',
  receivedAt: nowDateTimeInputValue(),
  fileRequestedAt: '',
  fileReceivedAt: '',
  reviewStartedAt: '',
  finalResponseAt: '',
  status: 'open',
  observations: '',
  delayReason: '',
});

export function MinutesPage() {
  const route = useRoute();
  const { data, settings, runAction } = useApp();
  const initialFlag = (route.query.get('flag') as MinuteFlag | null) ?? 'all';
  const [flag, setFlag] = useState<MinuteFlag>(FLAGS.includes(initialFlag) ? initialFlag : 'all');
  const [employee, setEmployee] = useState(route.query.get('employee') ?? 'all');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Minute | null>(null);

  const employees = data.employees.filter((row) => !row.archived);
  const nameOf = (id: string | null) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const counts = useMemo(() => {
    const map = {} as Record<MinuteFlag, number>;
    for (const item of FLAGS) {
      map[item] = data.minutes.filter((row) => matchMinuteFlag(minuteState(row, settings.deadlineMinutes), item)).length;
    }
    return map;
  }, [data.minutes, settings.deadlineMinutes]);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.minutes
      .filter((row) => matchMinuteFlag(minuteState(row, settings.deadlineMinutes), flag))
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) => (from ? row.receivedAt.slice(0, 10) >= from : true))
      .filter((row) => (to ? row.receivedAt.slice(0, 10) <= to : true))
      .filter((row) =>
        !text ? true : `${row.refNo} ${row.branchRef} ${row.observations} ${row.delayReason}`.toLowerCase().includes(text),
      )
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [data.minutes, flag, employee, from, to, query, settings.deadlineMinutes]);

  const startNew = () => {
    setErrors({});
    setDraft({ ...emptyDraft(), employeeId: employees[0]?.id ?? '' });
  };

  const startEdit = (minute: Minute) => {
    setErrors({});
    setDraft({
      id: minute.id,
      employeeId: minute.employeeId ?? '',
      branchRef: minute.branchRef,
      receivedAt: toDateTimeInputValue(minute.receivedAt),
      fileRequestedAt: toDateTimeInputValue(minute.fileRequestedAt),
      fileReceivedAt: toDateTimeInputValue(minute.fileReceivedAt),
      reviewStartedAt: toDateTimeInputValue(minute.reviewStartedAt),
      finalResponseAt: toDateTimeInputValue(minute.finalResponseAt),
      status: minute.status,
      observations: minute.observations,
      delayReason: minute.delayReason,
    });
  };

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      await runAction(
        () =>
          saveMinute({
            id: draft.id,
            employeeId: draft.employeeId || null,
            branchRef: draft.branchRef,
            receivedAt: fromDateTimeInputValue(draft.receivedAt) ?? '',
            fileRequestedAt: fromDateTimeInputValue(draft.fileRequestedAt),
            fileReceivedAt: fromDateTimeInputValue(draft.fileReceivedAt),
            reviewStartedAt: fromDateTimeInputValue(draft.reviewStartedAt),
            finalResponseAt: fromDateTimeInputValue(draft.finalResponseAt),
            status: draft.status,
            observations: draft.observations,
            delayReason: draft.delayReason,
          }),
        draft.id ? 'تم تحديث دقيقة الصرف.' : 'تم تسجيل دقيقة الصرف.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  const draftPreview = useMemo(() => {
    if (!draft) return null;
    return minuteState(
      {
        id: 'preview',
        createdAt: '',
        updatedAt: '',
        refNo: '—',
        employeeId: draft.employeeId || null,
        branchRef: draft.branchRef,
        receivedAt: fromDateTimeInputValue(draft.receivedAt) ?? '',
        fileRequestedAt: fromDateTimeInputValue(draft.fileRequestedAt),
        fileReceivedAt: fromDateTimeInputValue(draft.fileReceivedAt),
        reviewStartedAt: fromDateTimeInputValue(draft.reviewStartedAt),
        finalResponseAt: fromDateTimeInputValue(draft.finalResponseAt),
        status: draft.status,
        observations: draft.observations,
        delayReason: draft.delayReason,
      },
      settings.deadlineMinutes,
    );
  }, [draft, settings.deadlineMinutes]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <>
      <PageHeader
        title="دقائق الصرف"
        description={`مهلة المراجعة ${settings.deadlineMinutes} دقيقة — تُحسب المدد فقط من الأوقات المسجلة يدويًا.`}
        actions={
          <Button variant="primary" icon="plus" onClick={startNew} disabled={!employees.length}>
            تسجيل دقيقة
          </Button>
        }
      />

      <Tabs
        tabs={FLAGS.map((item) => ({ id: item, label: MINUTE_FLAG_LABELS[item], count: counts[item] }))}
        value={flag}
        onChange={setFlag}
      />

      <Card padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالمرجع أو الفرع أو الملاحظات…" />
          <Select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="تصفية بالموظف">
            <option value="all">كل الموظفين</option>
            {data.employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
          <span className="toolbar__count">{rows.length} دقيقة</span>
        </div>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>الموظف</th>
                  <th>الفرع / العميل</th>
                  <th>ورود الدقيقة</th>
                  <th>طلب الملف</th>
                  <th>استلام الملف</th>
                  <th>بدء المراجعة</th>
                  <th>الرد النهائي</th>
                  <th>انتظار الملف</th>
                  <th>زمن المراجعة</th>
                  <th>الإجمالي</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = minuteState(row, settings.deadlineMinutes);
                  return (
                    <tr key={row.id} className={state.overdue ? 'row--danger' : undefined}>
                      <td className="mono">{row.refNo}</td>
                      <td>{nameOf(row.employeeId)}</td>
                      <td>{row.branchRef}</td>
                      <td>{fmtDateTime(row.receivedAt)}</td>
                      <td>{fmtDateTime(row.fileRequestedAt)}</td>
                      <td>{fmtDateTime(row.fileReceivedAt)}</td>
                      <td>{fmtDateTime(row.reviewStartedAt)}</td>
                      <td>{fmtDateTime(row.finalResponseAt)}</td>
                      <td>{fmtDurationShort(state.waitingMinutes)}</td>
                      <td>{fmtDurationShort(state.reviewMinutes)}</td>
                      <td>{fmtDurationShort(state.totalMinutes)}</td>
                      <td>
                        <div className="stack-sm">
                          <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'info'}>
                            {MINUTE_STATUS_LABELS[row.status]}
                          </Badge>
                          {state.overdue ? <Badge tone="danger">تجاوز +{fmtDurationShort(state.overdueBy)}</Badge> : null}
                          {state.fileNotRequested ? <Badge tone="neutral">لم يُطلب الملف</Badge> : null}
                          {state.waitingForFile ? <Badge tone="warning">بانتظار الملف</Badge> : null}
                          {state.pendingFinalResponse ? <Badge tone="warning">بانتظار الرد</Badge> : null}
                        </div>
                        {row.delayReason ? <div className="small muted wrap">سبب التأخير: {row.delayReason}</div> : null}
                      </td>
                      <td className="cell-actions">
                        <IconButton icon="edit" label="تعديل" onClick={() => startEdit(row)} />
                        <IconButton icon="trash" label="حذف" variant="danger" onClick={() => setConfirmDelete(row)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="minutes"
            title="لا دقائق مطابقة"
            description={data.minutes.length ? 'جرّب تغيير التصفية أو البحث.' : 'ابدأ بتسجيل أول دقيقة صرف.'}
            action={
              <Button variant="primary" icon="plus" onClick={startNew} disabled={!employees.length}>
                تسجيل دقيقة
              </Button>
            }
          />
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل دقيقة صرف' : 'تسجيل دقيقة صرف'}
        subtitle="سجّل الأوقات كما حدثت فعلًا — تُحسب المدد والمهل تلقائيًا من هذه الأوقات فقط."
        size="lg"
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
            <Field label="الموظف المسؤول" required error={errors.employeeId} htmlFor="min-employee">
              <Select id="min-employee" value={draft.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">— اختر —</option>
                {employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.serial} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الفرع / مرجع العميل" required error={errors.branchRef} htmlFor="min-branch">
              <Input id="min-branch" value={draft.branchRef} onChange={(e) => set('branchRef', e.target.value)} />
            </Field>
            <Field label="وقت ورود الدقيقة" required error={errors.receivedAt} htmlFor="min-received">
              <Input id="min-received" type="datetime-local" value={draft.receivedAt} onChange={(e) => set('receivedAt', e.target.value)} />
            </Field>
            <Field label="وقت طلب الملف" error={errors.fileRequestedAt} htmlFor="min-freq">
              <Input id="min-freq" type="datetime-local" value={draft.fileRequestedAt} onChange={(e) => set('fileRequestedAt', e.target.value)} />
            </Field>
            <Field label="وقت استلام الملف" error={errors.fileReceivedAt} htmlFor="min-frec">
              <Input id="min-frec" type="datetime-local" value={draft.fileReceivedAt} onChange={(e) => set('fileReceivedAt', e.target.value)} />
            </Field>
            <Field label="وقت بدء المراجعة" error={errors.reviewStartedAt} htmlFor="min-review">
              <Input id="min-review" type="datetime-local" value={draft.reviewStartedAt} onChange={(e) => set('reviewStartedAt', e.target.value)} />
            </Field>
            <Field label="وقت الرد النهائي" error={errors.finalResponseAt} htmlFor="min-final">
              <Input id="min-final" type="datetime-local" value={draft.finalResponseAt} onChange={(e) => set('finalResponseAt', e.target.value)} />
            </Field>
            <Field label="حالة الدقيقة" htmlFor="min-status">
              <Select id="min-status" value={draft.status} onChange={(e) => set('status', e.target.value as MinuteStatus)}>
                <option value="open">قيد المتابعة</option>
                <option value="completed">مكتملة</option>
                <option value="cancelled">ملغاة</option>
              </Select>
            </Field>
            <Field label="سبب التأخير (إن وُجد)" htmlFor="min-delay" className="span-2">
              <Input id="min-delay" value={draft.delayReason} onChange={(e) => set('delayReason', e.target.value)} />
            </Field>
            <Field label="ملاحظات" htmlFor="min-obs" className="span-2">
              <Textarea id="min-obs" rows={2} value={draft.observations} onChange={(e) => set('observations', e.target.value)} />
            </Field>
            {draftPreview ? (
              <div className="span-2">
                <Callout tone={draftPreview.overdue ? 'danger' : 'info'} title="المدد المحسوبة">
                  انتظار الملف: {fmtDurationShort(draftPreview.waitingMinutes)} · زمن المراجعة:{' '}
                  {fmtDurationShort(draftPreview.reviewMinutes)} · الإجمالي من الورود:{' '}
                  {fmtDurationShort(draftPreview.totalMinutes)}
                  {draftPreview.overdue
                    ? ` — تجاوز المهلة بمقدار ${fmtDurationShort(draftPreview.overdueBy)}`
                    : draftPreview.isOpen
                      ? ' — داخل المهلة حتى الآن'
                      : ''}
                </Callout>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف دقيقة صرف"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteMinute(confirmDelete.id), 'تم حذف الدقيقة.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="confirm-text">
          سيتم حذف الدقيقة «{confirmDelete?.refNo}» المسجلة بتاريخ {confirmDelete ? toDateInputValue(confirmDelete.receivedAt) : ''}.
          الملاحظات المرتبطة بها ستبقى في سجل الموظف دون ارتباط.
        </p>
      </Modal>
    </>
  );
}
