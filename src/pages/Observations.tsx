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
} from '../components/ui';
import { ValidationError, deleteObservation, saveObservation } from '../db/repo';
import { OBSERVATION_STATUS_LABELS, type Observation } from '../db/schema';
import { fmtDate, todayInputValue, toDateInputValue } from '../lib/format';

interface Draft {
  id?: string;
  employeeId: string;
  minuteId: string;
  visitId: string;
  cycleId: string;
  date: string;
  type: string;
  text: string;
  status: 'open' | 'closed';
  resolution: string;
}

export function ObservationsPage() {
  const { data, settings, runAction } = useApp();
  const [employee, setEmployee] = useState('all');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Observation | null>(null);

  const nameOf = (id: string | null) => data.employees.find((row) => row.id === id)?.name ?? '—';
  const minuteOf = (id: string | null) => data.minutes.find((row) => row.id === id)?.refNo ?? null;
  const visitOf = (id: string | null) => data.visits.find((row) => row.id === id)?.refNo ?? null;
  const cycleOf = (id: string | null) => {
    if (!id) return null;
    for (const visit of data.visits) {
      const cycle = (visit.reviewCycles ?? []).find((item) => item.id === id);
      if (cycle) return `دورة ${cycle.seq} — ${visit.refNo}`;
    }
    return null;
  };

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.observations
      .filter((row) => (employee === 'all' ? true : row.employeeId === employee))
      .filter((row) => (type === 'all' ? true : row.type === type))
      .filter((row) => (status === 'all' ? true : row.status === status))
      .filter((row) => (from ? row.date >= from : true))
      .filter((row) => (to ? row.date <= to : true))
      .filter((row) => (!text ? true : `${row.text} ${row.type} ${row.resolution}`.toLowerCase().includes(text)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [data.observations, employee, type, status, from, to, query]);

  const typeOptions = useMemo(
    () => Array.from(new Set([...settings.observationTypes, ...data.observations.map((row) => row.type)].filter(Boolean))),
    [settings.observationTypes, data.observations],
  );

  const startNew = () => {
    setErrors({});
    setDraft({
      employeeId: data.employees[0]?.id ?? '',
      minuteId: '',
      visitId: '',
      cycleId: '',
      date: todayInputValue(),
      type: settings.observationTypes[0] ?? 'أخرى',
      text: '',
      status: 'open',
      resolution: '',
    });
  };

  const startEdit = (row: Observation) => {
    setErrors({});
    setDraft({
      id: row.id,
      employeeId: row.employeeId ?? '',
      minuteId: row.minuteId ?? '',
      visitId: row.visitId ?? '',
      cycleId: row.cycleId ?? '',
      date: toDateInputValue(row.date),
      type: row.type,
      text: row.text,
      status: row.status,
      resolution: row.resolution,
    });
  };

  const submit = async () => {
    if (!draft) return;
    try {
      await runAction(
        () =>
          saveObservation({
            id: draft.id,
            employeeId: draft.employeeId || null,
            minuteId: draft.minuteId || null,
            visitId: draft.visitId || null,
            cycleId: draft.cycleId || null,
            date: draft.date,
            type: draft.type,
            text: draft.text,
            status: draft.status,
            resolution: draft.resolution,
          }),
        draft.id ? 'تم تحديث الملاحظة.' : 'تمت إضافة الملاحظة.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const cyclesForVisit = draft?.visitId ? data.visits.find((row) => row.id === draft.visitId)?.reviewCycles ?? [] : [];

  return (
    <>
      <PageHeader
        title="سجل الملاحظات"
        description="ملاحظات مؤرَّخة على الموظفين أو دقائق الصرف أو الزيارات أو دورات مراجعة التقارير."
        actions={
          <Button variant="primary" icon="plus" onClick={startNew} disabled={!data.employees.length}>
            ملاحظة جديدة
          </Button>
        }
      />

      <Card padded={false}>
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="بحث في نص الملاحظات…" />
          <Select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="الموظف">
            <option value="all">كل الموظفين</option>
            {data.employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="النوع">
            <option value="all">كل الأنواع</option>
            {typeOptions.map((item) => (
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
          <span className="toolbar__count">{rows.length} ملاحظة</span>
        </div>

        {rows.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الموظف</th>
                  <th>النوع</th>
                  <th>الملاحظة</th>
                  <th>مرتبطة بـ</th>
                  <th>الحالة</th>
                  <th>المعالجة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.date)}</td>
                    <td>{nameOf(row.employeeId)}</td>
                    <td>
                      <Badge tone="info">{row.type}</Badge>
                    </td>
                    <td className="wrap">{row.text}</td>
                    <td className="small">
                      {[
                        minuteOf(row.minuteId) ? `دقيقة ${minuteOf(row.minuteId)}` : null,
                        visitOf(row.visitId) ? `زيارة ${visitOf(row.visitId)}` : null,
                        cycleOf(row.cycleId),
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'الموظف فقط'}
                    </td>
                    <td>
                      <Badge tone={row.status === 'open' ? 'warning' : 'success'}>{OBSERVATION_STATUS_LABELS[row.status]}</Badge>
                    </td>
                    <td className="small wrap">{row.resolution || '—'}</td>
                    <td className="cell-actions">
                      <IconButton icon="edit" label="تعديل" onClick={() => startEdit(row)} />
                      <IconButton icon="trash" label="حذف" variant="danger" onClick={() => setConfirmDelete(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="observations"
            title="لا ملاحظات مطابقة"
            description="أضف ملاحظة جديدة أو عدّل عوامل التصفية."
            action={
              <Button variant="primary" icon="plus" onClick={startNew} disabled={!data.employees.length}>
                ملاحظة جديدة
              </Button>
            }
          />
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل ملاحظة' : 'ملاحظة جديدة'}
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
          <div className="form-grid">
            <Field label="الموظف" required error={errors.employeeId} htmlFor="obs-employee">
              <Select
                id="obs-employee"
                value={draft.employeeId}
                onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}
              >
                <option value="">— اختر —</option>
                {data.employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.serial} — {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التاريخ" required error={errors.date} htmlFor="obs-date">
              <Input id="obs-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="النوع" required error={errors.type} htmlFor="obs-type">
              <Input
                id="obs-type"
                list="obs-type-options"
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              />
              <datalist id="obs-type-options">
                {settings.observationTypes.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="الحالة" htmlFor="obs-status">
              <Select
                id="obs-status"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as 'open' | 'closed' })}
              >
                <option value="open">مفتوحة</option>
                <option value="closed">مغلقة</option>
              </Select>
            </Field>
            <Field label="نص الملاحظة" required error={errors.text} htmlFor="obs-text" className="span-2">
              <Textarea id="obs-text" rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </Field>
            <Field label="دقيقة صرف مرتبطة (اختياري)" htmlFor="obs-minute">
              <Select
                id="obs-minute"
                value={draft.minuteId}
                onChange={(e) => setDraft({ ...draft, minuteId: e.target.value })}
              >
                <option value="">بدون</option>
                {data.minutes
                  .filter((row) => !draft.employeeId || row.employeeId === draft.employeeId)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.refNo} — {row.branchRef}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="زيارة مرتبطة (اختياري)" htmlFor="obs-visit">
              <Select
                id="obs-visit"
                value={draft.visitId}
                onChange={(e) => setDraft({ ...draft, visitId: e.target.value, cycleId: '' })}
              >
                <option value="">بدون</option>
                {data.visits
                  .filter((row) => !draft.employeeId || row.employeeId === draft.employeeId)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.refNo} — {row.branchRef}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="دورة مراجعة مرتبطة (اختياري)" htmlFor="obs-cycle" className="span-2">
              <Select
                id="obs-cycle"
                value={draft.cycleId}
                onChange={(e) => setDraft({ ...draft, cycleId: e.target.value })}
                disabled={!cyclesForVisit.length}
              >
                <option value="">{cyclesForVisit.length ? 'بدون' : 'اختر زيارة تحتوي دورات مراجعة أولًا'}</option>
                {cyclesForVisit.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    الدورة {cycle.seq} — {fmtDate(cycle.reviewedAt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المعالجة / الإغلاق" htmlFor="obs-resolution" className="span-2">
              <Input
                id="obs-resolution"
                value={draft.resolution}
                onChange={(e) => setDraft({ ...draft, resolution: e.target.value })}
                placeholder="ما تم اتخاذه لمعالجة الملاحظة"
              />
            </Field>
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
        <p className="confirm-text">سيتم حذف الملاحظة المؤرخة {confirmDelete ? fmtDate(confirmDelete.date) : ''} نهائيًا.</p>
      </Modal>
    </>
  );
}
