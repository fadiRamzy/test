import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
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
import { ValidationError, deleteObservation, saveObservation } from '../db/repo';
import {
  OBSERVATION_SOURCES,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  type Observation,
  type ObservationStatus,
  type Severity,
} from '../db/schema';
import { fmtDate, toDateInputValue, todayInputValue } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeId: string;
  date: string;
  source: string;
  branch: string;
  reference: string;
  category: string;
  severity: Severity;
  details: string;
  correctiveAction: string;
  notificationDate: string;
  status: ObservationStatus;
  resolutionDate: string;
  recurrence: boolean;
  followUpNotes: string;
}

const emptyDraft = (employeeId = ''): Draft => ({
  employeeId,
  date: todayInputValue(),
  source: 'ملاحظة مباشرة',
  branch: '',
  reference: '',
  category: '',
  severity: 'medium',
  details: '',
  correctiveAction: '',
  notificationDate: '',
  status: 'open',
  resolutionDate: '',
  recurrence: false,
  followUpNotes: '',
});

export function ObservationsPage() {
  const { data, settings, runAction } = useApp();
  const [employee, setEmployee] = useState('all');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Observation | null>(null);

  const nameOf = (id: string) => data.employees.find((row) => row.id === id)?.name ?? '—';

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.observations
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) => (category === 'all' ? true : row.category === category))
      .filter((row) => (status === 'all' ? true : row.status === status))
      .filter((row) => (from ? row.date >= from : true))
      .filter((row) => (to ? row.date <= to : true))
      .filter((row) => (!text ? true : `${row.details} ${row.correctiveAction} ${row.followUpNotes} ${row.branch}`.toLowerCase().includes(text)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [data.observations, employee, category, status, from, to, query]);

  const categories = Array.from(new Set([...settings.observationCategories, ...data.observations.map((row) => row.category)].filter(Boolean)));

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () =>
          saveObservation({
            id: draft.id,
            employeeId: draft.employeeId,
            date: draft.date,
            source: draft.source,
            branch: draft.branch,
            reference: draft.reference,
            category: draft.category,
            severity: draft.severity,
            details: draft.details,
            correctiveAction: draft.correctiveAction,
            notificationDate: draft.notificationDate || null,
            status: draft.status,
            resolutionDate: draft.resolutionDate || null,
            recurrence: draft.recurrence,
            followUpNotes: draft.followUpNotes,
          }),
        draft.id ? 'تم حفظ تعديلات الملاحظة.' : 'تمت إضافة الملاحظة.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const exportCsv = () => {
    downloadCsv(
      csvFileName('observations'),
      ['التاريخ', 'الموظف', 'المصدر', 'الفرع', 'المرجع', 'التصنيف', 'الخطورة', 'التفاصيل', 'الإجراء التصحيحي', 'تاريخ الإبلاغ', 'الحالة', 'تاريخ الحل', 'متكررة', 'متابعة'],
      rows.map((row) => [
        row.date,
        nameOf(row.employeeId),
        row.source,
        row.branch,
        row.reference,
        row.category,
        SEVERITY_LABELS[row.severity],
        row.details,
        row.correctiveAction,
        row.notificationDate ?? '',
        OBSERVATION_STATUS_LABELS[row.status],
        row.resolutionDate ?? '',
        row.recurrence ? 'نعم' : 'لا',
        row.followUpNotes,
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="سجل الملاحظات"
        description="كل ملاحظة سجل مستقل بتاريخها ومصدرها وإجراءها التصحيحي."
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
              إضافة ملاحظة
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <Toolbar>
          <Select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="الموظف">
            <option value="all">كل الموظفين</option>
            {data.employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="التصنيف">
            <option value="all">كل التصنيفات</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            <option value="open">مفتوحة</option>
            <option value="closed">مغلقة</option>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
          <SearchInput value={query} onChange={setQuery} placeholder="بحث في التفاصيل…" />
          <span className="toolbar__spacer">{rows.length} ملاحظة</span>
        </Toolbar>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الموظف</th>
                  <th>المصدر</th>
                  <th>الفرع</th>
                  <th>المرجع</th>
                  <th>التصنيف</th>
                  <th>الخطورة</th>
                  <th>التفاصيل</th>
                  <th>الإجراء التصحيحي</th>
                  <th>الإبلاغ</th>
                  <th>الحالة</th>
                  <th>تاريخ الحل</th>
                  <th>تكرار</th>
                  <th>متابعة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{fmtDate(row.date)}</td>
                    <td>{nameOf(row.employeeId)}</td>
                    <td>{row.source}</td>
                    <td>{row.branch || '—'}</td>
                    <td>{row.reference || '—'}</td>
                    <td>{row.category || '—'}</td>
                    <td>
                      <Badge tone={row.severity === 'high' ? 'danger' : row.severity === 'medium' ? 'warning' : 'neutral'}>
                        {SEVERITY_LABELS[row.severity]}
                      </Badge>
                    </td>
                    <td className="wrap small">{row.details}</td>
                    <td className="wrap small">{row.correctiveAction || '—'}</td>
                    <td className="nowrap small">{row.notificationDate ? fmtDate(row.notificationDate) : '—'}</td>
                    <td>
                      <Badge tone={row.status === 'open' ? 'warning' : 'success'}>{OBSERVATION_STATUS_LABELS[row.status]}</Badge>
                    </td>
                    <td className="nowrap small">{row.resolutionDate ? fmtDate(row.resolutionDate) : '—'}</td>
                    <td>{row.recurrence ? <Badge tone="danger">متكررة</Badge> : '—'}</td>
                    <td className="wrap small">{row.followUpNotes || '—'}</td>
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
                              source: row.source,
                              branch: row.branch,
                              reference: row.reference,
                              category: row.category,
                              severity: row.severity,
                              details: row.details,
                              correctiveAction: row.correctiveAction,
                              notificationDate: row.notificationDate ? toDateInputValue(row.notificationDate) : '',
                              status: row.status,
                              resolutionDate: row.resolutionDate ? toDateInputValue(row.resolutionDate) : '',
                              recurrence: row.recurrence,
                              followUpNotes: row.followUpNotes,
                            });
                          }}
                        />
                        <IconButton icon="trash" tone="danger" label="حذف" onClick={() => setConfirmDelete(row)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="لا ملاحظات مطابقة" description="أضف ملاحظة جديدة أو غيّر الفلاتر." />
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل ملاحظة' : 'إضافة ملاحظة'}
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
            <Field label="الموظف" required error={errors.employeeId} htmlFor="obs-employee">
              <Select id="obs-employee" value={draft.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">— اختر —</option>
                {data.employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.employeeNo} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ الملاحظة" required error={errors.date} htmlFor="obs-date">
              <Input id="obs-date" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="المصدر" htmlFor="obs-source">
              <Select id="obs-source" value={draft.source} onChange={(e) => set('source', e.target.value)}>
                {OBSERVATION_SOURCES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الفرع" htmlFor="obs-branch">
              <Input id="obs-branch" value={draft.branch} onChange={(e) => set('branch', e.target.value)} />
            </Field>
            <Field label="المرجع / الحالة" htmlFor="obs-ref">
              <Input id="obs-ref" value={draft.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            <Field label="التصنيف" htmlFor="obs-category">
              <Input id="obs-category" list="obs-categories" value={draft.category} onChange={(e) => set('category', e.target.value)} />
              <datalist id="obs-categories">
                {settings.observationCategories.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="الخطورة" htmlFor="obs-severity">
              <Select id="obs-severity" value={draft.severity} onChange={(e) => set('severity', e.target.value as Severity)}>
                {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تفاصيل الملاحظة" required error={errors.details} htmlFor="obs-details" className="span2">
              <Textarea id="obs-details" rows={3} value={draft.details} onChange={(e) => set('details', e.target.value)} />
            </Field>
            <Field label="الإجراء التصحيحي" htmlFor="obs-corrective" className="span2">
              <Textarea id="obs-corrective" rows={2} value={draft.correctiveAction} onChange={(e) => set('correctiveAction', e.target.value)} />
            </Field>
            <Field label="تاريخ الإبلاغ" htmlFor="obs-notify">
              <Input id="obs-notify" type="date" value={draft.notificationDate} onChange={(e) => set('notificationDate', e.target.value)} />
            </Field>
            <Field label="الحالة" htmlFor="obs-status">
              <Select id="obs-status" value={draft.status} onChange={(e) => set('status', e.target.value as ObservationStatus)}>
                <option value="open">مفتوحة</option>
                <option value="closed">مغلقة</option>
              </Select>
            </Field>
            <Field label="تاريخ الحل" htmlFor="obs-resolution">
              <Input id="obs-resolution" type="date" value={draft.resolutionDate} onChange={(e) => set('resolutionDate', e.target.value)} />
            </Field>
            <Field label="ملاحظات المتابعة" htmlFor="obs-follow" className="span2">
              <Textarea id="obs-follow" rows={2} value={draft.followUpNotes} onChange={(e) => set('followUpNotes', e.target.value)} />
            </Field>
            <div className="span2">
              <Checkbox label="ملاحظة متكررة (سبق تسجيلها)" checked={draft.recurrence} onChange={(e) => set('recurrence', e.target.checked)} />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف ملاحظة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteObservation(confirmDelete.id), 'تم حذف الملاحظة.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="small">سيتم حذف الملاحظة المؤرخة {confirmDelete ? fmtDate(confirmDelete.date) : ''} نهائيًا.</p>
      </Modal>
    </>
  );
}
