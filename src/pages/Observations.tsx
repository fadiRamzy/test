import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { addObservationFollowUp, resolveObservation, restoreObservation, softDeleteObservation } from '../db/repo';
import {
  OBSERVATION_SOURCE_LABELS,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  type Observation,
} from '../db/schema';
import { exportEntityCsv } from '../db/csv';
import { downloadFile } from '../lib/utils';
import { fmtDate, fmtNumber, todayInputValue } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Table,
  TableWrap,
  Textarea,
} from '../components/ui';
import { ObservationDetails } from '../components/RecordTables';
import { SeverityBadge, useLookups } from '../components/domain';
import { ObservationForm } from '../components/forms/ObservationForm';

export function ObservationsPage() {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const route = useRoute();

  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState(route.query.get('employee') ?? 'all');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState(route.query.get('status') ?? 'all');
  const [source, setSource] = useState('all');
  const [repeatedOnly, setRepeatedOnly] = useState(route.query.get('repeat') === '1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Observation | null>(null);
  const [detail, setDetail] = useState<Observation | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Observation | null>(null);
  const [followUp, setFollowUp] = useState({ date: todayInputValue(), note: '', by: '' });
  const [resolveDate, setResolveDate] = useState(todayInputValue());
  const [resolveNote, setResolveNote] = useState('');

  useEffect(() => {
    if (route.query.get('new') === '1') {
      setEditing(null);
      setFormOpen(true);
    }
    if (route.query.get('repeat') === '1') setRepeatedOnly(true);
    const qStatus = route.query.get('status');
    if (qStatus) setStatus(qStatus);
  }, [route.query]);

  const sourceRows = showArchived ? data.archivedObservations : data.observations;

  const filtered = useMemo(() => {
    return sourceRows
      .filter((observation) => (employee === 'all' ? true : observation.employeeId === employee))
      .filter((observation) => (category === 'all' ? true : observation.categoryId === category))
      .filter((observation) => (severity === 'all' ? true : observation.severity === severity))
      .filter((observation) => (status === 'all' ? true : observation.status === status))
      .filter((observation) => (source === 'all' ? true : observation.source === source))
      .filter((observation) => (repeatedOnly ? observation.isRecurring : true))
      .filter((observation) => (from ? observation.date >= from : true))
      .filter((observation) => (to ? observation.date <= to : true))
      .filter((observation) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [
          observation.refNo,
          observation.description,
          observation.correctiveAction,
          lookups.employeeName(observation.employeeId),
          lookups.branchName(observation.branchId),
          ...(observation.followUps ?? []).map((f) => f.note),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });
  }, [sourceRows, employee, category, severity, status, source, repeatedOnly, from, to, search, lookups]);

  const counts = useMemo(() => {
    const open = data.observations.filter((o) => o.status === 'open' || o.status === 'in_progress');
    return {
      total: data.observations.length,
      open: open.length,
      repeated: data.observations.filter((o) => o.isRecurring).length,
      critical: open.filter((o) => o.severity === 'critical' || o.severity === 'high').length,
      resolved: data.observations.filter((o) => o.status === 'resolved' || o.status === 'closed').length,
    };
  }, [data.observations]);

  const submitFollowUp = async () => {
    if (!detail || !followUp.note.trim()) return;
    await runAction(
      () => addObservationFollowUp(detail.id, { date: followUp.date, note: followUp.note.trim(), by: followUp.by.trim() || undefined }),
      'تمت إضافة المتابعة.',
    );
    setFollowUp({ date: todayInputValue(), note: '', by: '' });
    setDetail(null);
  };

  const submitResolve = async () => {
    if (!detail) return;
    await runAction(() => resolveObservation(detail.id, resolveDate, resolveNote), 'تم تسجيل معالجة الملاحظة.');
    setResolveNote('');
    setDetail(null);
  };

  return (
    <>
      <PageHeader
        title="سجل الملاحظات"
        description="سجل مركزي للملاحظات مرتبط بالموظفين والفروع ودقائق الصرف والزيارات، مع متابعة كاملة حتى المعالجة."
        actions={
          <>
            <Button icon={showArchived ? 'list' : 'archive'} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'العودة للنشطة' : 'المؤرشفة'}
            </Button>
            <Button
              icon="download"
              onClick={() => {
                const csv = exportEntityCsv('observations', filtered, {
                  employees: lookups.employees,
                  branches: lookups.branches,
                  categories: settings.observationCategories,
                });
                downloadFile(`observations-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
              }}
            >
              تصدير CSV
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              ملاحظة جديدة
            </Button>
          </>
        }
      />

      <div className="grid grid--stats">
        <StatCard label="إجمالي الملاحظات" value={fmtNumber(counts.total)} hint={`${counts.resolved} تمت معالجتها`} icon="observations" tone="primary" onClick={() => setStatus('all')} />
        <StatCard label="مفتوحة / قيد المعالجة" value={fmtNumber(counts.open)} hint="تحتاج إجراءً" icon="alert" tone="danger" onClick={() => setStatus('open')} />
        <StatCard label="ملاحظات متكررة" value={fmtNumber(counts.repeated)} hint={`نافذة التكرار ${settings.thresholds.repeatedObservationWindowDays} يومًا`} icon="history" tone="warning" onClick={() => setRepeatedOnly(true)} />
        <StatCard label="عالية أو حرجة" value={fmtNumber(counts.critical)} hint="من الملاحظات المفتوحة" icon="flag" tone="warning" />
      </div>

      <div className="filter-bar mt-12">
        <SearchInput value={search} onChange={setSearch} placeholder="بحث في الوصف والإجراء والمتابعات…" />
        <span className="filter-bar__label">الموظف</span>
        <Select value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="all">الكل</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">التصنيف</span>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">الكل</option>
          {settings.observationCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">الخطورة</span>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="all">الكل</option>
          {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">الحالة</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">الكل</option>
          {Object.entries(OBSERVATION_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">المصدر</span>
        <Select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">الكل</option>
          {Object.entries(OBSERVATION_SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">من</span>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
        <span className="filter-bar__label">إلى</span>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
        <label className="checkbox">
          <input type="checkbox" checked={repeatedOnly} onChange={(e) => setRepeatedOnly(e.target.checked)} />
          المتكررة فقط
        </label>
        <span className="filter-count">{fmtNumber(filtered.length)} نتيجة</span>
      </div>

      <Card padded={false}>
        {filtered.length ? (
          <TableWrap>
            <Table className="table--compact">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>الموظف</th>
                  <th>التصنيف</th>
                  <th>الخطورة</th>
                  <th>المصدر</th>
                  <th>الوصف</th>
                  <th>الحالة</th>
                  <th>المتابعات</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((observation) => (
                  <tr key={observation.id}>
                    <td className="nowrap">
                      <button type="button" className="link-btn" onClick={() => setDetail(observation)}>
                        {observation.refNo}
                      </button>
                      {observation.isRecurring ? <span className="table__sub text-warning">متكررة</span> : null}
                    </td>
                    <td className="num nowrap">{fmtDate(observation.date)}</td>
                    <td>{lookups.employeeName(observation.employeeId)}</td>
                    <td>{settings.observationCategories.find((c) => c.id === observation.categoryId)?.name ?? '—'}</td>
                    <td>
                      <SeverityBadge severity={observation.severity} />
                    </td>
                    <td>{OBSERVATION_SOURCE_LABELS[observation.source]}</td>
                    <td>
                      <span className="cell-clip" title={observation.description}>
                        {observation.description}
                      </span>
                    </td>
                    <td>
                      <Badge tone={observation.status === 'open' ? 'danger' : observation.status === 'in_progress' ? 'warning' : observation.status === 'resolved' ? 'success' : 'neutral'}>
                        {OBSERVATION_STATUS_LABELS[observation.status]}
                      </Badge>
                    </td>
                    <td className="num">{fmtNumber(observation.followUps?.length ?? 0)}</td>
                    <td className="actions">
                      <IconButton
                        icon="edit"
                        label="تعديل"
                        onClick={() => {
                          setEditing(observation);
                          setFormOpen(true);
                        }}
                      />
                      {showArchived ? (
                        <IconButton icon="restore" label="استعادة" onClick={() => void runAction(() => restoreObservation(observation.id), 'تمت استعادة الملاحظة.')} />
                      ) : (
                        <IconButton icon="trash" label="أرشفة" variant="danger" onClick={() => setArchiveTarget(observation)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon="observations"
            title="لا توجد ملاحظات مطابقة"
            description="سجّل ملاحظة جديدة أو عدّل معايير البحث."
            action={
              <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
                ملاحظة جديدة
              </Button>
            }
          />
        )}
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `الملاحظة ${detail.refNo}` : ''}
        subtitle={detail ? lookups.employeeName(detail.employeeId) : ''}
        size="lg"
        footer={
          <>
            <Button
              icon="edit"
              onClick={() => {
                setEditing(detail);
                setDetail(null);
                setFormOpen(true);
              }}
            >
              تعديل الملاحظة
            </Button>
            {detail && detail.status !== 'resolved' && detail.status !== 'closed' ? (
              <Button variant="success" icon="check" onClick={submitResolve}>
                تسجيل المعالجة
              </Button>
            ) : null}
            <Button onClick={() => setDetail(null)}>إغلاق</Button>
          </>
        }
      >
        {detail ? (
          <div className="stack">
            <ObservationDetails observation={detail} />
            {detail.status !== 'resolved' && detail.status !== 'closed' ? (
              <div className="card" style={{ padding: 12 }}>
                <strong className="small">تسجيل المعالجة</strong>
                <div className="form-grid mt-8">
                  <Field label="تاريخ المعالجة">
                    <Input type="date" value={resolveDate} onChange={(e) => setResolveDate(e.target.value)} />
                  </Field>
                  <Field label="ملاحظة الإغلاق">
                    <Input value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="ملخص الإجراء المتخذ" />
                  </Field>
                </div>
              </div>
            ) : null}
            <div className="card" style={{ padding: 12 }}>
              <strong className="small">إضافة متابعة</strong>
              <div className="form-grid mt-8">
                <Field label="التاريخ">
                  <Input type="date" value={followUp.date} onChange={(e) => setFollowUp({ ...followUp, date: e.target.value })} />
                </Field>
                <Field label="بواسطة">
                  <Input value={followUp.by} onChange={(e) => setFollowUp({ ...followUp, by: e.target.value })} placeholder="اسم المتابع (اختياري)" />
                </Field>
                <Field label="نص المتابعة" className="fieldset-span-2">
                  <Textarea value={followUp.note} onChange={(e) => setFollowUp({ ...followUp, note: e.target.value })} rows={2} />
                </Field>
              </div>
              <div className="row mt-8">
                <Button size="sm" variant="primary" icon="plus" onClick={submitFollowUp} disabled={!followUp.note.trim()}>
                  إضافة متابعة
                </Button>
              </div>
            </div>
            <div className="row small muted">
              <Button size="sm" variant="ghost" onClick={() => navigate(`/employees/${detail.employeeId}`)}>
                ملف الموظف
              </Button>
              {detail.minuteId ? (
                <Button size="sm" variant="ghost" onClick={() => navigate('/minutes')}>
                  دقيقة الصرف المرتبطة
                </Button>
              ) : null}
              {detail.visitId ? (
                <Button size="sm" variant="ghost" onClick={() => navigate('/visits')}>
                  الزيارة المرتبطة
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ObservationForm open={formOpen} observation={editing} onClose={() => setFormOpen(false)} />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة الملاحظة"
        message={`سيتم أرشفة ${archiveTarget?.refNo ?? ''} مع الاحتفاظ بسجل المتابعات.`}
        confirmLabel="أرشفة"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void runAction(() => softDeleteObservation(target.id), 'تمت أرشفة الملاحظة.');
        }}
      />
    </>
  );
}

export function observationSummaryLabel(observation: Observation): string {
  return `${observation.refNo} — ${SEVERITY_LABELS[observation.severity]}`;
}
