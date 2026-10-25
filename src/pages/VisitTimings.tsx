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
  Stat,
  Table,
  TableWrap,
  Toolbar,
} from '../components/ui';
import { ValidationError, deleteVisitTiming, saveVisitTiming } from '../db/repo';
import { MONTHS_AR, type VisitTiming } from '../db/schema';
import { EmployeePicker } from '../components/EmployeePicker';
import { monthlyVisitSummary, visitTiming } from '../lib/calc';
import { fmtDate, fmtDurationWords, todayInputValue } from '../lib/format';
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
}

const emptyDraft = (employeeId = ''): Draft => ({
  employeeId,
  visitDate: todayInputValue(),
  branch: '',
  clientName: '',
  location: '',
  departureTime: '',
  returnTime: '',
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
  const [showRecords, setShowRecords] = useState(false);
  const [listEmployee, setListEmployee] = useState('all');
  const [listBranch, setListBranch] = useState('all');
  const [summaryBranch, setSummaryBranch] = useState('all');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<VisitTiming | null>(null);

  const activeEmployees = data.employees.filter((row) => !row.archived);
  const nameOf = (id: string) => data.employees.find((row) => row.id === id)?.name ?? 'موظف محذوف';

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

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.visitTimings
      .filter((row) => (listEmployee === 'all' ? true : row.employeeId === listEmployee))
      .filter((row) => (listBranch === 'all' ? true : row.branch === listBranch))
      .filter((row) =>
        !text ? true : `${nameOf(row.employeeId)} ${row.branch} ${row.clientName} ${row.location}`.toLowerCase().includes(text),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.visitTimings, data.employees, query, listEmployee, listBranch]);

  const resetListFilters = () => {
    setQuery('');
    setListEmployee('all');
    setListBranch('all');
  };

  const summarySource = useMemo(
    () => (summaryBranch === 'all' ? data.visitTimings : data.visitTimings.filter((row) => row.branch === summaryBranch)),
    [data.visitTimings, summaryBranch],
  );

  const summaries = useMemo(
    () =>
      monthlyVisitSummary(
        summarySource,
        data.employees,
        year,
        month,
        employeeFilter === 'all' ? null : employeeFilter,
      ),
    [summarySource, data.employees, year, month, employeeFilter],
  );

  const totals = useMemo(() => {
    const totalVisits = summaries.reduce((sum, row) => sum + row.totalVisits, 0);
    const validVisits = summaries.reduce((sum, row) => sum + row.validVisits, 0);
    const invalidVisits = summaries.reduce((sum, row) => sum + row.invalidVisits, 0);
    const totalMinutes = summaries.reduce((sum, row) => sum + row.totalMinutes, 0);
    return { totalVisits, validVisits, invalidVisits, totalMinutes };
  }, [summaries]);

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

  const exportMonthCsv = () => {
    downloadCsv(
      csvFileName(`visits-${year}-${String(month).padStart(2, '0')}`),
      ['الموظف', 'التاريخ', 'الفرع', 'اسم العميل', 'مكان الزيارة', 'توقيت التحرك', 'توقيت الرجوع', 'مدة الزيارة'],
      summaries.flatMap((summary) =>
        summary.visits.map(({ visit, timing }) => [
          summary.employeeName,
          visit.visitDate,
          visit.branch,
          visit.clientName,
          visit.location,
          visit.departureTime,
          visit.returnTime,
          timing.minutes === null ? (timing.reason ?? 'مدة غير صالحة') : fmtDurationWords(timing.minutes),
        ]),
      ),
    );
  };

  const preview = draft ? visitTiming({ departureTime: draft.departureTime, returnTime: draft.returnTime }) : null;

  return (
    <>
      <PageHeader
        eyebrow="العمل الميداني"
        title="توقيت الزيارات"
        description="تسجيل زيارات الموظفين بتوقيت التحرك والرجوع، مع ملخص شهري تلقائي لكل موظف."
        actions={
          <Button
            variant="primary"
            icon="plus"
            disabled={!activeEmployees.length}
            onClick={() => {
              setErrors({});
              setDraft(emptyDraft(activeEmployees[0]?.id ?? ''));
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
        <>
          <Card
            padded={false}
            title="الزيارات المسجلة"
            subtitle={`${rows.length} زيارة`}
            actions={
              <Button
                icon={showRecords ? 'close' : 'list'}
                onClick={() => setShowRecords((value) => !value)}
                aria-expanded={showRecords}
                aria-controls="visits-records"
              >
                {showRecords ? 'إخفاء الزيارات' : 'إظهار الزيارات'}
              </Button>
            }
          >
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
              <Select value={listBranch} onChange={(e) => setListBranch(e.target.value)} aria-label="الفرع في الزيارات">
                <option value="all">كل الفروع</option>
                {branches.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Button size="sm" icon="restore" onClick={resetListFilters} disabled={query === '' && listEmployee === 'all' && listBranch === 'all'}>
                إعادة تعيين
              </Button>
              <span className="toolbar__spacer">{rows.length} زيارة</span>
            </Toolbar>
            {!showRecords ? (
              <div className="collapsed-note small muted">قائمة الزيارات مخفية — اضغط «إظهار الزيارات» لعرضها.</div>
            ) : rows.length ? (
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
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{nameOf(row.employeeId)}</td>
                        <td className="nowrap">{fmtDate(row.visitDate)}</td>
                        <td>{row.branch || '—'}</td>
                        <td>{row.clientName || '—'}</td>
                        <td>{row.location || '—'}</td>
                        <td className="mono">{row.departureTime || '—'}</td>
                        <td className="mono">{row.returnTime || '—'}</td>
                        <td>{durationCell(row)}</td>
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
              <EmptyState
                title={query || listEmployee !== 'all' || listBranch !== 'all' ? 'لا زيارات مطابقة للفلاتر' : 'لا زيارات مسجلة'}
                description={
                  query || listEmployee !== 'all' || listBranch !== 'all'
                    ? 'جرّب تعديل الفلاتر أو إعادة تعيينها.'
                    : 'اضغط «إضافة زيارة» لتسجيل أول زيارة.'
                }
              />
            )}
          </Card>

          <Card
            title="الملخص الشهري للزيارات"
            subtitle={`${MONTHS_AR[month - 1]} ${year} — يُحدَّث تلقائيًا عند إضافة أو تعديل أو حذف زيارة`}
            actions={
              <Button icon="download" onClick={exportMonthCsv} disabled={!summaries.length}>
                تصدير الشهر
              </Button>
            }
            padded={false}
          >
            <Toolbar>
              <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="الشهر">
                {MONTHS_AR.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="السنة">
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                aria-label="الموظف"
              >
                <option value="all">كل الموظفين</option>
                {data.employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
              <Select value={summaryBranch} onChange={(e) => setSummaryBranch(e.target.value)} aria-label="فرع الملخص">
                <option value="all">كل الفروع</option>
                {branches.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                icon="restore"
                disabled={employeeFilter === 'all' && summaryBranch === 'all'}
                onClick={() => {
                  setEmployeeFilter('all');
                  setSummaryBranch('all');
                }}
              >
                إعادة تعيين
              </Button>
            </Toolbar>

            <div className="stats" data-testid="visit-month-totals">
              <Stat icon="visits" label="إجمالي الزيارات" value={totals.totalVisits} hint={`${MONTHS_AR[month - 1]} ${year}`} />
              <Stat
                icon="check"
                tone="success"
                label="زيارات بمدة صالحة"
                value={totals.validVisits}
                hint={totals.invalidVisits ? `${totals.invalidVisits} بمدة غير صالحة` : 'كل الزيارات صالحة'}
              />
              <Stat
                icon="clock"
                label="إجمالي مدة الزيارات"
                value={totals.validVisits ? fmtDurationWords(totals.totalMinutes) : '—'}
              />
            </div>

            {summaries.length ? (
              <div className="visit-summary">
                {summaries.map((summary) => (
                  <section key={summary.employeeId} className="visit-summary__group" data-testid="visit-summary-group">
                    <header className="visit-summary__head">
                      <h3>{summary.employeeName}</h3>
                      <p className="small muted">
                        عدد الزيارات: <strong>{summary.totalVisits}</strong> · إجمالي المدة:{' '}
                        <strong>{summary.validVisits ? fmtDurationWords(summary.totalMinutes) : '—'}</strong>
                        {summary.invalidVisits ? ` · ${summary.invalidVisits} زيارة بمدة غير صالحة (مستبعدة من المجموع)` : ''}
                      </p>
                    </header>
                    <TableWrap>
                      <Table>
                        <thead>
                          <tr>
                            <th>التاريخ</th>
                            <th>الموظف</th>
                            <th>الفرع</th>
                            <th>اسم العميل</th>
                            <th>مكان الزيارة</th>
                            <th>توقيت التحرك</th>
                            <th>توقيت الرجوع</th>
                            <th>مدة الزيارة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.visits.map(({ visit, timing }) => (
                            <tr key={visit.id}>
                              <td className="nowrap">{fmtDate(visit.visitDate)}</td>
                              <td>{summary.employeeName}</td>
                              <td>{visit.branch || '—'}</td>
                              <td>{visit.clientName || '—'}</td>
                              <td>{visit.location || '—'}</td>
                              <td className="mono">{visit.departureTime || '—'}</td>
                              <td className="mono">{visit.returnTime || '—'}</td>
                              <td title={timing.reason ?? undefined}>
                                {timing.minutes === null ? (
                                  <span className="small muted">
                                    — <Badge tone="neutral">{timing.reason ?? 'مدة غير صالحة'}</Badge>
                                  </span>
                                ) : (
                                  fmtDurationWords(timing.minutes)
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrap>
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState
                title="لا زيارات في الشهر المحدد"
                description="لا توجد زيارات مسجلة لهذا الشهر — الإجماليات تظهر صفرًا. جرّب تغيير الشهر أو السنة أو الموظف."
              />
            )}
          </Card>
        </>
      )}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل زيارة' : 'إضافة زيارة'}
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
              required
              value={draft.employeeId}
              error={errors.employeeId}
              onChange={(value) => set('employeeId', value)}
              options={activeEmployees.map((row) => ({ id: row.id, name: row.name, meta: `رقم ${row.employeeNo}` }))}
            />
            <Field label="التاريخ" required error={errors.visitDate} htmlFor="vt-date">
              <Input id="vt-date" type="date" value={draft.visitDate} onChange={(e) => set('visitDate', e.target.value)} />
            </Field>
            <Field label="الفرع" required error={errors.branch} htmlFor="vt-branch">
              <Input id="vt-branch" value={draft.branch} onChange={(e) => set('branch', e.target.value)} />
            </Field>
            <Field label="اسم العميل" required error={errors.clientName} htmlFor="vt-client">
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
            <Field label="توقيت التحرك على الزيارة" required error={errors.departureTime} htmlFor="vt-departure">
              <Input
                id="vt-departure"
                type="time"
                value={draft.departureTime}
                onChange={(e) => set('departureTime', e.target.value)}
              />
            </Field>
            <Field label="توقيت الرجوع للفرع" required error={errors.returnTime} htmlFor="vt-return">
              <Input
                id="vt-return"
                type="time"
                value={draft.returnTime}
                onChange={(e) => set('returnTime', e.target.value)}
              />
            </Field>
            <div className="span2 small muted" data-testid="visit-preview">
              {preview && preview.minutes !== null ? (
                <>
                  مدة الزيارة: <strong>{fmtDurationWords(preview.minutes)}</strong>
                  {preview.minutes > 0 && (preview.minutes ?? 0) >= 0 && (draft.returnTime < draft.departureTime) ? (
                    <> — تم احتساب الرجوع بعد منتصف الليل</>
                  ) : null}
                </>
              ) : (
                <>أدخل توقيت التحرك والرجوع لحساب مدة الزيارة تلقائيًا.</>
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
          نهائيًا، وسيتحدث الملخص الشهري تلقائيًا.
        </p>
      </Modal>
    </>
  );
}
