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
  ListCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Table,
  TableWrap,
  Textarea,
  TimeInput,
  Toolbar,
} from '../components/ui';
import { ValidationError, deleteVisitTiming, saveVisitTiming } from '../db/repo';
import { MONTHS_AR, type VisitTiming } from '../db/schema';
import { EmployeePicker } from '../components/EmployeePicker';
import { visitTiming } from '../lib/calc';
import { fmtDate, fmtDurationWords, fmtTime } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeId: string;
  visitDate: string;
  branch: string;
  clientName: string;
  location: string;
  departureTime: string;
  returnTime: string;
  notes: string;
}

const emptyDraft = (): Draft => ({
  employeeId: '',
  visitDate: '',
  branch: '',
  clientName: '',
  location: '',
  departureTime: '',
  returnTime: '',
  notes: '',
});

function durationCell(visit: VisitTiming) {
  const timing = visitTiming(visit);
  if (timing.minutes === null) {
    return (
      <span className="small muted" title={timing.reason ?? undefined}>
        — <Badge tone="neutral">مدة غير صالحة</Badge>
      </span>
    );
  }
  return <span>{fmtDurationWords(timing.minutes)}</span>;
}

export function VisitTimingsPage() {
  const { data, runAction } = useApp();
  const now = new Date();
  const [query, setQuery] = useState('');
  const [listEmployee, setListEmployee] = useState('all');
  const [listBranch, setListBranch] = useState('all');
  const [listMonth, setListMonth] = useState('all');
  const [listYear, setListYear] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<VisitTiming | null>(null);

  const activeEmployees = data.employees.filter((row) => !row.archived);
  const nameOf = (id: string) => (id ? (data.employees.find((row) => row.id === id)?.name ?? 'موظف محذوف') : '—');

  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear()]);
    for (const visit of data.visitTimings) {
      const value = Number(visit.visitDate?.slice(0, 4));
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => b - a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.visitTimings]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const row of data.visitTimings) if (row.branch) set.add(row.branch);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [data.visitTimings]);

  /** الزيارات المطابقة لكل الفلاتر مجتمعة (الموظف + الشهر + الفرع + السنة + البحث) */
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.visitTimings
      .filter((row) => (listEmployee === 'all' ? true : row.employeeId === listEmployee))
      .filter((row) => (listBranch === 'all' ? true : row.branch === listBranch))
      .filter((row) => (listMonth === 'all' ? true : Number((row.visitDate ?? '').slice(5, 7)) === Number(listMonth)))
      .filter((row) => (listYear === 'all' ? true : (row.visitDate ?? '').slice(0, 4) === listYear))
      .filter((row) =>
        !text ? true : `${nameOf(row.employeeId)} ${row.branch} ${row.clientName} ${row.location}`.toLowerCase().includes(text),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.visitTimings, data.employees, query, listEmployee, listBranch, listMonth, listYear]);

  /** عدد الزيارات لكل موظف داخل النتائج المفلترة */
  const perEmployee = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.employeeId, (counts.get(row.employeeId) ?? 0) + 1);
    return Array.from(counts, ([employeeId, count]) => ({ employeeId, name: nameOf(employeeId), count })).sort(
      (a, b) => b.count - a.count,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, data.employees]);

  const filtersActive =
    query !== '' || listEmployee !== 'all' || listBranch !== 'all' || listMonth !== 'all' || listYear !== 'all';

  const resetListFilters = () => {
    setQuery('');
    setListEmployee('all');
    setListBranch('all');
    setListMonth('all');
    setListYear('all');
  };

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () =>
          saveVisitTiming({
            id: draft.id,
            employeeId: draft.employeeId,
            visitDate: draft.visitDate,
            branch: draft.branch,
            clientName: draft.clientName,
            location: draft.location,
            departureTime: draft.departureTime,
            returnTime: draft.returnTime,
            notes: draft.notes,
          }),
        draft.id ? 'تم حفظ تعديلات الزيارة.' : 'تمت إضافة الزيارة.',
      );
      setDraft(null);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.errors);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const exportCsv = () => {
    downloadCsv(
      csvFileName('visits'),
      ['الموظف', 'التاريخ', 'الفرع', 'اسم العميل', 'مكان الزيارة', 'توقيت التحرك', 'توقيت الرجوع', 'مدة الزيارة', 'ملاحظات'],
      rows.map((visit) => {
        const timing = visitTiming(visit);
        return [
          nameOf(visit.employeeId),
          visit.visitDate,
          visit.branch,
          visit.clientName,
          visit.location,
          visit.departureTime,
          visit.returnTime,
          timing.minutes === null ? (timing.reason ?? 'مدة غير صالحة') : fmtDurationWords(timing.minutes),
          visit.notes ?? '',
        ];
      }),
    );
  };

  const preview = draft ? visitTiming({ departureTime: draft.departureTime, returnTime: draft.returnTime }) : null;

  return (
    <>
      <PageHeader
        eyebrow="العمل الميداني"
        title="توقيت الزيارات"
        description="تسجيل زيارات الموظفين بتوقيت التحرك والرجوع، مع فلاتر وبحث داخل الزيارات المسجلة."
        actions={
          <Button
            variant="primary"
            icon="plus"
            disabled={!activeEmployees.length}
            onClick={() => {
              setErrors({});
              setDraft(emptyDraft());
            }}
          >
            إضافة زيارة
          </Button>
        }
      />

      {!activeEmployees.length ? (
        <Card>
          <EmptyState
            title="لا يوجد موظفون مسجلون"
            description="أضف موظفًا من قسم «الموظفون» أولًا لتسجيل زياراته."
          />
        </Card>
      ) : (
        <ListCard
          id="visits-records"
          padded={false}
          title="الزيارات المسجلة"
          subtitle={`${rows.length} زيارة مطابقة`}
          hideLabel="إخفاء البيانات"
          showLabel="إظهار البيانات"
          note={`قائمة الزيارات مخفية (${rows.length} زيارة) — اضغط «إظهار البيانات» لعرضها. الإخفاء لا يحذف أي سجل.`}
          actions={
            <Button icon="download" onClick={exportCsv} disabled={!rows.length}>
              تصدير CSV
            </Button>
          }
        
            controls={
              <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="بحث بالموظف أو الفرع أو العميل…" />
            <Select value={listEmployee} onChange={(e) => setListEmployee(e.target.value)} aria-label="الموظف في الزيارات">
              <option value="all">كل الموظفين</option>
              {data.employees.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
            <Select value={listMonth} onChange={(e) => setListMonth(e.target.value)} aria-label="شهر الزيارة">
              <option value="all">كل الشهور</option>
              {MONTHS_AR.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </Select>
            <Select value={listBranch} onChange={(e) => setListBranch(e.target.value)} aria-label="الفرع في الزيارات">
              <option value="all">كل الفروع</option>
              {branches.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select value={listYear} onChange={(e) => setListYear(e.target.value)} aria-label="سنة الزيارة">
              <option value="all">كل السنوات</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Button size="sm" icon="restore" onClick={resetListFilters} disabled={!filtersActive}>
              إعادة تعيين
            </Button>
            <span className="toolbar__spacer" data-testid="visit-count-total">
              عدد الزيارات: {rows.length}
            </span>
          </Toolbar>
            }>
          

          {rows.length ? (
            <>
              <div className="counts" data-testid="visit-employee-counts">
                <span className="counts__label">الزيارات حسب الموظف</span>
                <ul className="counts__list">
                  {perEmployee.map((item) => (
                    <li key={item.employeeId || 'none'} className="counts__item">
                      <span>{item.name}</span>
                      <strong>{item.count}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>التاريخ</th>
                      <th>الفرع</th>
                      <th>اسم العميل</th>
                      <th>مكان الزيارة</th>
                      <th>توقيت التحرك على الزيارة</th>
                      <th>توقيت الرجوع للفرع</th>
                      <th>مدة الزيارة</th>
                      <th>ملاحظات</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{nameOf(row.employeeId)}</td>
                        <td className="nowrap">{row.visitDate ? fmtDate(row.visitDate) : '—'}</td>
                        <td>{row.branch || '—'}</td>
                        <td>{row.clientName || '—'}</td>
                        <td>{row.location || '—'}</td>
                        <td className="nowrap">{fmtTime(row.departureTime)}</td>
                        <td className="nowrap">{fmtTime(row.returnTime)}</td>
                        <td>{durationCell(row)}</td>
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
                                  visitDate: row.visitDate ?? '',
                                  branch: row.branch ?? '',
                                  clientName: row.clientName ?? '',
                                  location: row.location ?? '',
                                  departureTime: row.departureTime ?? '',
                                  returnTime: row.returnTime ?? '',
                                  notes: row.notes ?? '',
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
            </>
          ) : (
            <EmptyState
              title={filtersActive ? 'لا زيارات مطابقة للفلاتر' : 'لا زيارات مسجلة'}
              description={
                filtersActive
                  ? 'جرّب تعديل الفلاتر أو إعادة تعيينها لاستعادة كل الزيارات.'
                  : 'اضغط «إضافة زيارة» لتسجيل أول زيارة.'
              }
            />
          )}
        </ListCard>
      )}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل زيارة' : 'إضافة زيارة'}
        subtitle="يمكن الحفظ حتى لو لم تُسجّل كل البيانات."
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
            <EmployeePicker
              id="vt-employee"
              label="الموظف"
              value={draft.employeeId}
              error={errors.employeeId}
              onChange={(value) => set('employeeId', value)}
              options={activeEmployees.map((row) => ({ id: row.id, name: row.name, meta: `رقم ${row.employeeNo}` }))}
            />
            <Field label="التاريخ" error={errors.visitDate} htmlFor="vt-date">
              <Input id="vt-date" type="date" value={draft.visitDate} onChange={(e) => set('visitDate', e.target.value)} />
            </Field>
            <Field label="الفرع" error={errors.branch} htmlFor="vt-branch">
              <Input id="vt-branch" value={draft.branch} onChange={(e) => set('branch', e.target.value)} />
            </Field>
            <Field label="اسم العميل" error={errors.clientName} htmlFor="vt-client">
              <Input
                id="vt-client"
                className="input--client"
                value={draft.clientName}
                onChange={(e) => set('clientName', e.target.value)}
              />
            </Field>
            <Field label="مكان الزيارة" error={errors.location} htmlFor="vt-location">
              <Input id="vt-location" value={draft.location} onChange={(e) => set('location', e.target.value)} />
            </Field>
            <Field label="توقيت التحرك على الزيارة" error={errors.departureTime} htmlFor="vt-departure">
              <TimeInput id="vt-departure" value={draft.departureTime} onChange={(value) => set('departureTime', value)} />
            </Field>
            <Field label="توقيت الرجوع للفرع" error={errors.returnTime} htmlFor="vt-return">
              <TimeInput id="vt-return" value={draft.returnTime} onChange={(value) => set('returnTime', value)} />
            </Field>
            <Field label="ملاحظات" htmlFor="vt-notes" className="span2">
              <Textarea id="vt-notes" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            <div className="span2 small muted" data-testid="visit-preview">
              {preview && preview.minutes !== null ? (
                <>
                  مدة الزيارة: <strong>{fmtDurationWords(preview.minutes)}</strong>
                  {preview.minutes > 0 && draft.returnTime < draft.departureTime ? (
                    <> — تم احتساب الرجوع بعد منتصف الليل</>
                  ) : null}
                </>
              ) : (
                <>أدخل توقيت التحرك والرجوع لحساب مدة الزيارة تلقائيًا. بدون توقيتين صالحين لا تُحسب مدة.</>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف زيارة"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteVisitTiming(confirmDelete.id), 'تم حذف الزيارة.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="small">
          سيتم حذف زيارة {confirmDelete ? `${nameOf(confirmDelete.employeeId)} — ${fmtDate(confirmDelete.visitDate)}` : ''}{' '}
          نهائيًا، وستُحدَّث القائمة والعدد تلقائيًا.
        </p>
      </Modal>
    </>
  );
}
