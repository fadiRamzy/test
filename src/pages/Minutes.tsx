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
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Table,
  TableWrap,
  Textarea,
  Toolbar,
} from '../components/ui';
import { ValidationError, deleteMinute, saveMinute } from '../db/repo';
import {
  MINUTE_RESULT_LABELS,
  MINUTE_STATUS_LABELS,
  type DisbursementMinute,
  type MinuteResult,
  type MinuteStatus,
} from '../db/schema';
import { isMinuteOutstanding, minuteDurations } from '../lib/calc';
import { fmtDate, fmtNumber, todayInputValue, toDateInputValue } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeId: string;
  date: string;
  branch: string;
  clientRef: string;
  financingType: string;
  amount: string;
  minuteReceivedTime: string;
  fileRequestTime: string;
  fileReceivedTime: string;
  finalResponseTime: string;
  result: MinuteResult;
  status: MinuteStatus;
  notes: string;
}

const emptyDraft = (employeeId = ''): Draft => ({
  employeeId,
  date: todayInputValue(),
  branch: '',
  clientRef: '',
  financingType: '',
  amount: '',
  minuteReceivedTime: '',
  fileRequestTime: '',
  fileReceivedTime: '',
  finalResponseTime: '',
  result: 'pending',
  status: 'open',
  notes: '',
});

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, index) => current + 1 - index);
})();

export function MinutesPage() {
  const { data, settings, runAction } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [employee, setEmployee] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<DisbursementMinute | null>(null);

  const nameOf = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.minutes
      .filter((row) => row.date.startsWith(String(year)))
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) =>
        status === 'all' ? true : status === 'outstanding' ? isMinuteOutstanding(row) : row.status === status,
      )
      .filter((row) => (!text ? true : `${row.branch} ${row.clientRef} ${row.notes} ${nameOf(row.employeeId)}`.toLowerCase().includes(text)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.minutes, data.employees, year, employee, status, query]);

  const outstanding = data.minutes.filter((row) => row.date.startsWith(String(year)) && isMinuteOutstanding(row)).length;

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () =>
          saveMinute({
            id: draft.id,
            employeeId: draft.employeeId,
            date: draft.date,
            branch: draft.branch,
            clientRef: draft.clientRef,
            financingType: draft.financingType,
            amount: draft.amount === '' ? null : Number(draft.amount),
            minuteReceivedTime: draft.minuteReceivedTime,
            fileRequestTime: draft.fileRequestTime,
            fileReceivedTime: draft.fileReceivedTime,
            finalResponseTime: draft.finalResponseTime,
            result: draft.result,
            status: draft.status,
            notes: draft.notes,
          }),
        draft.id ? 'تم حفظ تعديلات الدقيقة.' : 'تمت إضافة دقيقة الصرف.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const exportCsv = () => {
    downloadCsv(
      csvFileName(`minutes-${year}`),
      ['التاريخ', 'الفرع', 'الموظف', 'مرجع العميل', 'نوع التمويل', 'المبلغ', 'وقت الاستلام', 'طلب الملف', 'استلام الملف', 'الرد النهائي', 'المدة (دقيقة)', 'النتيجة', 'الحالة', 'ملاحظات'],
      rows.map((row) => {
        const durations = minuteDurations(row);
        return [
          row.date,
          row.branch,
          nameOf(row.employeeId),
          row.clientRef,
          row.financingType,
          row.amount ?? '',
          row.minuteReceivedTime,
          row.fileRequestTime,
          row.fileReceivedTime,
          row.finalResponseTime,
          durations.totalMinutes ?? '',
          MINUTE_RESULT_LABELS[row.result],
          MINUTE_STATUS_LABELS[row.status],
          row.notes,
        ];
      }),
    );
  };

  const draftDurations = draft ? minuteDurations({ ...emptyDraft(), ...draft, amount: null } as DisbursementMinute) : null;

  return (
    <>
      <PageHeader
        title="دقائق الصرف اليومية"
        description="سجل يدوي مبسط: التاريخ والفرع والعميل والأوقات والنتيجة. الحقول الاختيارية يمكن تركها فارغة."
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
              إضافة دقيقة
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <Toolbar>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
            {YEARS.map((item) => (
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
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            <option value="open">قيد الإجراء</option>
            <option value="closed">منتهية</option>
            <option value="outstanding">بدون رد نهائي</option>
          </Select>
          <SearchInput value={query} onChange={setQuery} placeholder="بحث بالفرع أو العميل…" />
          <span className="toolbar__spacer">
            {rows.length} دقيقة · بدون رد نهائي {outstanding}
          </span>
        </Toolbar>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>ضابط المخاطر</th>
                  <th>مرجع العميل</th>
                  <th>نوع التمويل</th>
                  <th className="num">المبلغ</th>
                  <th>استلام</th>
                  <th>طلب الملف</th>
                  <th>استلام الملف</th>
                  <th>الرد النهائي</th>
                  <th className="num">المدة</th>
                  <th>النتيجة</th>
                  <th>الحالة</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const durations = minuteDurations(row);
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{fmtDate(row.date)}</td>
                      <td>{row.branch}</td>
                      <td>{nameOf(row.employeeId)}</td>
                      <td>{row.clientRef || '—'}</td>
                      <td>{row.financingType || '—'}</td>
                      <td className="num">{row.amount === null ? '—' : fmtNumber(row.amount)}</td>
                      <td className="mono">{row.minuteReceivedTime || '—'}</td>
                      <td className="mono">{row.fileRequestTime || '—'}</td>
                      <td className="mono">{row.fileReceivedTime || '—'}</td>
                      <td className="mono">{row.finalResponseTime || '—'}</td>
                      <td className="num">{durations.totalMinutes === null ? '—' : durations.totalMinutes}</td>
                      <td>{MINUTE_RESULT_LABELS[row.result]}</td>
                      <td>
                        <Badge tone={row.status === 'closed' ? 'success' : 'warning'}>{MINUTE_STATUS_LABELS[row.status]}</Badge>
                      </td>
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
                                date: toDateInputValue(row.date),
                                branch: row.branch,
                                clientRef: row.clientRef,
                                financingType: row.financingType,
                                amount: row.amount === null ? '' : String(row.amount),
                                minuteReceivedTime: row.minuteReceivedTime,
                                fileRequestTime: row.fileRequestTime,
                                fileReceivedTime: row.fileReceivedTime,
                                finalResponseTime: row.finalResponseTime,
                                result: row.result,
                                status: row.status,
                                notes: row.notes,
                              });
                            }}
                          />
                          <IconButton icon="trash" tone="danger" label="حذف" onClick={() => setConfirmDelete(row)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="لا دقائق مسجلة في هذه السنة" description="أضف أول دقيقة صرف من الزر أعلى الصفحة." />
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل دقيقة صرف' : 'إضافة دقيقة صرف'}
        size="lg"
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
            <Field label="التاريخ" required error={errors.date} htmlFor="min-date">
              <Input id="min-date" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="الفرع" required error={errors.branch} htmlFor="min-branch">
              <Input id="min-branch" list="branches-list" value={draft.branch} onChange={(e) => set('branch', e.target.value)} />
              <datalist id="branches-list">
                {settings.branches.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="ضابط المخاطر المسؤول" required error={errors.employeeId} htmlFor="min-employee">
              <Select id="min-employee" value={draft.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">— اختر —</option>
                {data.employees.filter((row) => !row.archived).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.employeeNo} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="مرجع العميل / الحالة" htmlFor="min-client">
              <Input id="min-client" value={draft.clientRef} onChange={(e) => set('clientRef', e.target.value)} />
            </Field>
            <Field label="نوع التمويل" htmlFor="min-type">
              <Input id="min-type" list="financing-types" value={draft.financingType} onChange={(e) => set('financingType', e.target.value)} />
              <datalist id="financing-types">
                {settings.financingTypes.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="المبلغ" error={errors.amount} htmlFor="min-amount">
              <Input id="min-amount" type="number" min={0} step="0.01" value={draft.amount} onChange={(e) => set('amount', e.target.value)} />
            </Field>
            <Field label="وقت استلام الدقيقة" required error={errors.minuteReceivedTime} htmlFor="min-received">
              <Input id="min-received" type="time" value={draft.minuteReceivedTime} onChange={(e) => set('minuteReceivedTime', e.target.value)} />
            </Field>
            <Field label="وقت طلب الملف" htmlFor="min-freq">
              <Input id="min-freq" type="time" value={draft.fileRequestTime} onChange={(e) => set('fileRequestTime', e.target.value)} />
            </Field>
            <Field label="وقت استلام الملف" htmlFor="min-frec">
              <Input id="min-frec" type="time" value={draft.fileReceivedTime} onChange={(e) => set('fileReceivedTime', e.target.value)} />
            </Field>
            <Field label="وقت الرد النهائي" htmlFor="min-final">
              <Input id="min-final" type="time" value={draft.finalResponseTime} onChange={(e) => set('finalResponseTime', e.target.value)} />
            </Field>
            <Field label="النتيجة" htmlFor="min-result">
              <Select id="min-result" value={draft.result} onChange={(e) => set('result', e.target.value as MinuteResult)}>
                {Object.entries(MINUTE_RESULT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الحالة" htmlFor="min-status">
              <Select id="min-status" value={draft.status} onChange={(e) => set('status', e.target.value as MinuteStatus)}>
                {Object.entries(MINUTE_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ملاحظات" htmlFor="min-notes" className="span2">
              <Textarea id="min-notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            {draftDurations && draftDurations.totalMinutes !== null ? (
              <p className="small muted span2">
                المدة من الاستلام إلى الرد النهائي: {draftDurations.totalMinutes} دقيقة
                {draftDurations.fileWaitMinutes !== null ? ` · انتظار الملف: ${draftDurations.fileWaitMinutes} دقيقة` : ''}
              </p>
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
        <p className="small">
          سيتم حذف دقيقة {confirmDelete ? `${fmtDate(confirmDelete.date)} — ${confirmDelete.branch}` : ''} نهائيًا.
        </p>
      </Modal>
    </>
  );
}
