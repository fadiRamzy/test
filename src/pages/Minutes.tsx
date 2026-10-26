import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  ListCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Table,
  TableWrap,
  TimeInput,
  Toolbar,
} from '../components/ui';
import { ValidationError, deleteMinute, saveMinute } from '../db/repo';
import {
  INSPECTION_RESULT_LABELS,
  INSPECTION_RESULT_OPTIONS,
  type DailyMinute,
  type InspectionResult,
} from '../db/schema';
import { EmployeePicker } from '../components/EmployeePicker';
import { minuteTiming } from '../lib/calc';
import { fmtDurationWords, fmtTime, monthName } from '../lib/format';
import { downloadCsv, csvFileName } from '../lib/csv';

interface Draft {
  id?: string;
  employeeId: string;
  fileRequestTime: string;
  fileReceivedTime: string;
  responseTime: string;
  inspectionResult: InspectionResult | '';
}

const emptyDraft = (): Draft => ({
  employeeId: '',
  fileRequestTime: '',
  fileReceivedTime: '',
  responseTime: '',
  inspectionResult: '',
});

export function MinutesPage() {
  const { data, runAction } = useApp();
  const [query, setQuery] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<DailyMinute | null>(null);

  const activeEmployees = data.employees.filter((row) => !row.archived);
  const nameOf = (id: string) => (id ? (data.employees.find((row) => row.id === id)?.name ?? 'موظف محذوف') : '—');

  /** تاريخ المحضر: التاريخ المسجل إن وُجد، وإلا تاريخ الإنشاء */
  const dateOf = (row: DailyMinute) => row.date ?? row.createdAt.slice(0, 10);

  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const row of data.minutes) {
      const value = Number(dateOf(row).slice(0, 4));
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [data.minutes]);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.minutes
      .filter((row) => (employeeFilter === 'all' ? true : row.employeeId === employeeFilter))
      .filter((row) => (yearFilter === 'all' ? true : dateOf(row).slice(0, 4) === yearFilter))
      .filter((row) => (monthFilter === 'all' ? true : Number(dateOf(row).slice(5, 7)) === Number(monthFilter)))
      .filter((row) => (!text ? true : nameOf(row.employeeId).toLowerCase().includes(text)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.minutes, data.employees, query, employeeFilter, monthFilter, yearFilter]);

  const resetFilters = () => {
    setQuery('');
    setEmployeeFilter('all');
    setMonthFilter('all');
    setYearFilter('all');
  };
  const filtersActive = query !== '' || employeeFilter !== 'all' || monthFilter !== 'all' || yearFilter !== 'all';

  const submit = async () => {
    if (!draft) return;
    setErrors({});
    try {
      await runAction(
        () =>
          saveMinute({
            id: draft.id,
            employeeId: draft.employeeId,
            fileRequestTime: draft.fileRequestTime,
            fileReceivedTime: draft.fileReceivedTime,
            responseTime: draft.responseTime,
            inspectionResult: draft.inspectionResult,
          }),
        draft.id ? 'تم حفظ تعديلات المحضر.' : 'تمت إضافة المحضر.',
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
      csvFileName('minutes'),
      ['الموظف', 'توقيت طلب الملف', 'توقيت استلام الملف', 'توقيت الرد على الملف', 'نتيجة الفحص', 'المدة', 'حالة التأخير'],
      rows.map((row) => {
        const timing = minuteTiming(row);
        return [
          nameOf(row.employeeId),
          row.fileRequestTime || '',
          row.fileReceivedTime || '',
          row.responseTime || '',
          row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : '',
          timing.minutes === null ? '' : fmtDurationWords(timing.minutes),
          timing.invalid ? (timing.reason ?? 'بيانات غير مكتملة') : timing.delayed ? 'متأخر' : 'في الوقت',
        ];
      }),
    );
  };

  const preview = draft
    ? minuteTiming({ fileReceivedTime: draft.fileReceivedTime, responseTime: draft.responseTime })
    : null;

  return (
    <>
      <PageHeader
        eyebrow="العمليات اليومية"
        title="محاضر يومية"
        description="محضر لكل موظف: توقيت طلب الملف واستلامه والرد عليه ونتيجة الفحص. المدة تُحسب من استلام الملف إلى الرد عليه."
        actions={
          <>
            <Button icon="download" onClick={exportCsv} disabled={!rows.length}>
              تصدير CSV
            </Button>
            <Button
              variant="primary"
              icon="plus"
              disabled={!activeEmployees.length}
              onClick={() => {
                setErrors({});
                setDraft(emptyDraft());
              }}
            >
              إضافة محضر
            </Button>
          </>
        }
      />

      {!activeEmployees.length ? (
        <Card>
          <EmptyState
            title="لا يوجد موظفون مسجلون"
            description="أضف موظفًا من قسم «الموظفون» أولًا ليظهر في قائمة المحاضر."
          />
        </Card>
      ) : (
        <ListCard
          id="minutes-records"
          padded={false}
          title="المحاضر المسجلة"
          subtitle={`${rows.length} محضر`}
          hideLabel="إخفاء البيانات"
          showLabel="إظهار البيانات"
          note={`قائمة المحاضر مخفية (${rows.length} محضر) — اضغط «إظهار البيانات» لعرضها. الإخفاء لا يحذف أي سجل.`}
        
            controls={
              <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="بحث باسم الموظف…" />
            <Select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} aria-label="الموظف في المحاضر">
              <option value="all">كل الموظفين</option>
              {data.employees.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
            <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} aria-label="شهر المحضر">
              <option value="all">كل الشهور</option>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {monthName(value)}
                </option>
              ))}
            </Select>
            <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="سنة المحضر">
              <option value="all">كل السنوات</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Button size="sm" icon="restore" onClick={resetFilters} disabled={!filtersActive}>
              إعادة تعيين
            </Button>
            <span className="toolbar__spacer">{rows.length} محضر</span>
          </Toolbar>
            }>
          

          {rows.length ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>الموظف</th>
                    <th>توقيت طلب الملف</th>
                    <th>توقيت استلام الملف</th>
                    <th>توقيت الرد على الملف</th>
                    <th>نتيجة الفحص</th>
                    <th>المدة</th>
                    <th>حالة التأخير</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const timing = minuteTiming(row);
                    return (
                      <tr key={row.id}>
                        <td>{nameOf(row.employeeId)}</td>
                        <td className="nowrap">{fmtTime(row.fileRequestTime)}</td>
                        <td className="nowrap">{fmtTime(row.fileReceivedTime)}</td>
                        <td className="nowrap">{fmtTime(row.responseTime)}</td>
                        <td>{row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : '—'}</td>
                        <td className="num" title={timing.reason ?? undefined}>
                          {timing.minutes === null ? '—' : fmtDurationWords(timing.minutes)}
                        </td>
                        <td>
                          {timing.invalid ? (
                            <Badge tone="neutral">بيانات غير مكتملة</Badge>
                          ) : timing.delayed ? (
                            <Badge tone="danger">متأخر</Badge>
                          ) : (
                            <Badge tone="success">في الوقت</Badge>
                          )}
                        </td>
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
                                  fileRequestTime: row.fileRequestTime ?? '',
                                  fileReceivedTime: row.fileReceivedTime ?? '',
                                  responseTime: row.responseTime || row.finalResponseTime || '',
                                  inspectionResult: row.inspectionResult ?? '',
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
            <EmptyState
              title={filtersActive ? 'لا محاضر مطابقة للفلاتر' : 'لا محاضر مسجلة'}
              description={filtersActive ? 'جرّب تعديل الفلاتر أو إعادة تعيينها.' : 'اضغط «إضافة محضر» لتسجيل أول محضر يومي.'}
            />
          )}
        </ListCard>
      )}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'تعديل محضر' : 'إضافة محضر'}
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
              id="min-employee"
              label="الموظف"
              className="span2"
              value={draft.employeeId}
              error={errors.employeeId}
              onChange={(value) => set('employeeId', value)}
              options={activeEmployees.map((row) => ({ id: row.id, name: row.name, meta: `رقم ${row.employeeNo}` }))}
            />

            <Field label="توقيت طلب الملف" error={errors.fileRequestTime} htmlFor="min-request">
              <TimeInput id="min-request" value={draft.fileRequestTime} onChange={(value) => set('fileRequestTime', value)} />
            </Field>
            <Field label="توقيت استلام الملف" error={errors.fileReceivedTime} htmlFor="min-received">
              <TimeInput id="min-received" value={draft.fileReceivedTime} onChange={(value) => set('fileReceivedTime', value)} />
            </Field>
            <Field label="توقيت الرد على الملف" error={errors.responseTime} htmlFor="min-response">
              <TimeInput id="min-response" value={draft.responseTime} onChange={(value) => set('responseTime', value)} />
            </Field>
            <Field label="نتيجة الفحص" error={errors.inspectionResult} htmlFor="min-result">
              <Select
                id="min-result"
                value={draft.inspectionResult}
                onChange={(e) => set('inspectionResult', e.target.value as InspectionResult | '')}
              >
                <option value="">— اختر النتيجة —</option>
                {INSPECTION_RESULT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {INSPECTION_RESULT_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="span2 small muted" data-testid="minute-preview">
              {preview && preview.minutes !== null ? (
                <>
                  المدة من استلام الملف إلى الرد عليه: <strong>{fmtDurationWords(preview.minutes)}</strong>
                  {preview.delayed ? ' — متأخر (أكثر من 60 دقيقة)' : ' — في الوقت (60 دقيقة أو أقل)'}
                </>
              ) : (
                <>أدخل توقيت استلام الملف وتوقيت الرد لحساب المدة تلقائيًا.</>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="حذف محضر"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>إلغاء</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                if (!confirmDelete) return;
                await runAction(() => deleteMinute(confirmDelete.id), 'تم حذف المحضر.');
                setConfirmDelete(null);
              }}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="small">
          سيتم حذف محضر {confirmDelete ? `${nameOf(confirmDelete.employeeId)} نهائيًا` : ''}. لا يمكن التراجع.
        </p>
      </Modal>
    </>
  );
}
