import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { restoreMinute, softDeleteMinute } from '../db/repo';
import type { DisbursementMinute } from '../db/schema';
import { MINUTE_OUTCOME_LABELS } from '../db/schema';
import { computeMinuteTimings, summarizeMinutes, type SlaStatus } from '../lib/minuteCalc';
import { calendarFromSettings } from '../lib/analytics';
import { fmtDateTime, fmtDurationShort, fmtMinutes, fmtNumber, fmtPercent } from '../lib/format';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Table,
  TableWrap,
  DefinitionList,
} from '../components/ui';
import { SlaBadge, useLookups } from '../components/domain';
import { MinuteForm } from '../components/forms/MinuteForm';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'pending', label: 'قيد التنفيذ' },
  { value: 'overdue', label: 'متأخرة' },
  { value: 'warning', label: 'قاربت المهلة' },
  { value: 'breached', label: 'تجاوزت المهلة' },
  { value: 'closed', label: 'مغلقة' },
];

export function MinutesPage() {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const route = useRoute();

  const [search, setSearch] = useState(route.query.get('q') ?? '');
  const [status, setStatus] = useState(route.query.get('status') ?? 'all');
  const [employee, setEmployee] = useState(route.query.get('employee') ?? 'all');
  const [branch, setBranch] = useState(route.query.get('branch') ?? 'all');
  const [from, setFrom] = useState(route.query.get('from') ?? '');
  const [to, setTo] = useState(route.query.get('to') ?? '');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DisbursementMinute | null>(null);
  const [detail, setDetail] = useState<DisbursementMinute | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DisbursementMinute | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (route.query.get('new') === '1') {
      setEditing(null);
      setFormOpen(true);
    }
    const qStatus = route.query.get('status');
    if (qStatus) setStatus(qStatus);
    const qBranch = route.query.get('branch');
    if (qBranch) setBranch(qBranch);
    const qEmployee = route.query.get('employee');
    if (qEmployee) setEmployee(qEmployee);
  }, [route.query]);

  const calendar = useMemo(() => calendarFromSettings(settings), [settings]);
  const source = showArchived ? data.archivedMinutes : data.minutes;

  const timings = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeMinuteTimings>>();
    for (const minute of source) {
      map.set(minute.id, computeMinuteTimings(minute, calendar, settings.minutesDeadlineMinutes, settings.deadlineWarnPercent));
    }
    return map;
  }, [source, calendar, settings]);

  const filtered = useMemo(() => {
    return source
      .filter((minute) => {
        const timing = timings.get(minute.id);
        if (status === 'pending') return timing && !timing.isClosed && timing.slaStatus !== 'na';
        if (status === 'overdue') return timing?.slaStatus === 'overdue';
        if (status === 'warning') return timing?.slaStatus === 'warning';
        if (status === 'breached') return timing?.slaStatus === 'breached';
        if (status === 'closed') return timing?.isClosed;
        return true;
      })
      .filter((minute) => (employee === 'all' ? true : minute.employeeId === employee))
      .filter((minute) => (branch === 'all' ? true : minute.branchId === branch))
      .filter((minute) => (from ? minute.receivedAt.slice(0, 10) >= from : true))
      .filter((minute) => (to ? minute.receivedAt.slice(0, 10) <= to : true))
      .filter((minute) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [
          minute.refNo,
          minute.clientRef,
          minute.financingType,
          minute.notes,
          lookups.employeeName(minute.employeeId),
          lookups.branchName(minute.branchId),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });
  }, [source, timings, status, employee, branch, from, to, search, lookups]);

  const summary = useMemo(
    () => summarizeMinutes(filtered.map((minute) => timings.get(minute.id)!).filter(Boolean)),
    [filtered, timings],
  );

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setEmployee('all');
    setBranch('all');
    setFrom('');
    setTo('');
    navigate('/minutes', { replace: true });
  };

  const detailTimings = detail ? timings.get(detail.id) : null;

  return (
    <>
      <PageHeader
        title="دقائق الصرف اليومية"
        description={`مراجعة دقائق الصرف مع حساب المهلة بأوقات العمل (${settings.minutesDeadlineMinutes} دقيقة) وفصل زمن الضابط عن زمن انتظار الفرع.`}
        actions={
          <>
            <Button icon={showArchived ? 'list' : 'archive'} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'العودة للسجلات النشطة' : 'الدقائق المؤرشفة'}
            </Button>
            <Button variant="primary" icon="plus" onClick={openNew}>
              دقيقة جديدة
            </Button>
          </>
        }
      />

      {summary.overdue > 0 || summary.warning > 0 ? (
        <Callout tone={summary.overdue > 0 ? 'danger' : 'warning'} title="تنبيه مواعيد نهائية" icon="clock">
          {summary.overdue > 0 ? `${summary.overdue} دقيقة تجاوزت المهلة ولم تُغلق. ` : ''}
          {summary.warning > 0 ? `${summary.warning} دقيقة اقتربت من المهلة.` : ''}
        </Callout>
      ) : null}

      <div className="grid grid--stats mt-12">
        <StatCard label="إجمالي النتائج" value={fmtNumber(summary.total)} hint={`${summary.closed} مغلقة`} icon="minutes" tone="primary" />
        <StatCard label="قيد التنفيذ" value={fmtNumber(summary.pending)} hint={`${summary.overdue} متأخرة — ${summary.warning} قاربت المهلة`} icon="clock" tone={summary.overdue ? 'danger' : 'info'} onClick={() => setStatus('pending')} />
        <StatCard label="نسبة الالتزام" value={summary.compliancePercent === null ? '—' : fmtPercent(summary.compliancePercent)} hint="من الدقائق المغلقة" icon="shield" tone="success" onClick={() => setStatus('closed')} />
        <StatCard label="متوسط زمن الضابط" value={fmtMinutes(summary.avgOfficerMinutes)} hint={`انتظار الفرع: ${fmtMinutes(summary.avgWaitingMinutes)}`} icon="chart" tone="info" />
      </div>

      <div className="filter-bar mt-12">
        <SearchInput value={search} onChange={setSearch} placeholder="بحث برقم الدقيقة أو مرجع العميل…" />
        <span className="filter-bar__label">الحالة</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">الضابط</span>
        <Select value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="all">الكل</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">الفرع</span>
        <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="all">الكل</option>
          {data.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">من تاريخ</span>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
        <span className="filter-bar__label">إلى</span>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
        <Button size="sm" variant="ghost" onClick={resetFilters}>
          تفريغ الفلاتر
        </Button>
        <span className="filter-count">{fmtNumber(filtered.length)} نتيجة</span>
      </div>

      <Card padded={false}>
        {filtered.length ? (
          <>
            <TableWrap>
              <Table className="table--compact">
                <thead>
                  <tr>
                    <th>رقم الدقيقة</th>
                    <th>الضابط</th>
                    <th>الفرع</th>
                    <th>مرجع العميل</th>
                    <th>النتيجة</th>
                    <th>الاستلام</th>
                    <th>الموعد النهائي</th>
                    <th>زمن الضابط</th>
                    <th>انتظار الفرع</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((minute) => {
                    const timing = timings.get(minute.id)!;
                    return (
                      <tr key={minute.id}>
                        <td className="nowrap">
                          <button type="button" className="link-btn" onClick={() => setDetail(minute)}>
                            {minute.refNo}
                          </button>
                          <span className="table__sub">{minute.financingType}</span>
                        </td>
                        <td>{lookups.employeeName(minute.employeeId)}</td>
                        <td>{lookups.branchName(minute.branchId)}</td>
                        <td>{minute.clientRef}</td>
                        <td>{MINUTE_OUTCOME_LABELS[minute.outcome]}</td>
                        <td className="num nowrap">{fmtDateTime(minute.receivedAt)}</td>
                        <td className="num nowrap">{timing.dueAt ? fmtDateTime(timing.dueAt) : '—'}</td>
                        <td className="num nowrap">{fmtDurationShort(timing.officerMinutes)}</td>
                        <td className="num nowrap">{fmtDurationShort(timing.waitingMinutes)}</td>
                        <td>
                          <SlaBadge status={timing.slaStatus} />
                        </td>
                        <td className="actions">
                          <IconButton
                            icon="edit"
                            label="تعديل"
                            onClick={() => {
                              setEditing(minute);
                              setFormOpen(true);
                            }}
                          />
                          {showArchived ? (
                            <IconButton
                              icon="restore"
                              label="استعادة"
                              onClick={() => void runAction(() => restoreMinute(minute.id), 'تمت استعادة الدقيقة.')}
                            />
                          ) : (
                            <IconButton icon="trash" label="أرشفة" variant="danger" onClick={() => setArchiveTarget(minute)} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </>
        ) : (
          <EmptyState
            icon="minutes"
            title="لا توجد دقائق مطابقة"
            description="جرّب تعديل الفلاتر أو أضف دقيقة صرف جديدة."
            action={
              <Button variant="primary" icon="plus" onClick={openNew}>
                دقيقة جديدة
              </Button>
            }
          />
        )}
      </Card>

      <MinuteForm
        open={formOpen}
        minute={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          if (route.query.get('new') === '1') navigate('/minutes', { replace: true });
        }}
      />

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `دقيقة الصرف ${detail.refNo}` : ''}
        subtitle={detail ? `${detail.clientRef} — ${detail.financingType}` : ''}
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
              تعديل
            </Button>
            <Button onClick={() => setDetail(null)}>إغلاق</Button>
          </>
        }
      >
        {detail ? (
          <div className="stack">
            <div className="row">
              <SlaBadge status={(detailTimings?.slaStatus ?? 'na') as SlaStatus} />
              <Badge tone="neutral">{MINUTE_OUTCOME_LABELS[detail.outcome]}</Badge>
              <Badge tone="info">{lookups.employeeName(detail.employeeId)}</Badge>
              <Badge tone="neutral">{lookups.branchName(detail.branchId)}</Badge>
            </div>

            <div className="summary-strip">
              <div className="summary-strip__item">
                <span>الزمن المنقضي</span>
                <strong>{fmtMinutes(detailTimings?.elapsedMinutes ?? 0)}</strong>
              </div>
              <div className="summary-strip__item">
                <span>زمن معالجة الضابط</span>
                <strong>{fmtMinutes(detailTimings?.officerMinutes ?? 0)}</strong>
              </div>
              <div className="summary-strip__item">
                <span>زمن انتظار الفرع</span>
                <strong>{fmtMinutes(detailTimings?.waitingMinutes ?? 0)}</strong>
              </div>
              <div className="summary-strip__item">
                <span>الموعد النهائي</span>
                <strong>{detailTimings?.dueAt ? fmtDateTime(detailTimings.dueAt) : '—'}</strong>
              </div>
              <div className="summary-strip__item">
                <span>المتبقي</span>
                <strong>{detailTimings && detailTimings.remainingMinutes > 0 ? fmtMinutes(detailTimings.remainingMinutes) : 'انتهت المهلة'}</strong>
              </div>
            </div>

            <DefinitionList
              items={[
                { label: 'المبلغ', value: detail.amount === null ? '—' : fmtNumber(detail.amount) },
                { label: 'وقت الاستلام', value: fmtDateTime(detail.receivedAt) },
                { label: 'طلب الملف', value: detail.fileRequestedAt ? fmtDateTime(detail.fileRequestedAt) : '—' },
                { label: 'استلام الملف', value: detail.fileReceivedAt ? fmtDateTime(detail.fileReceivedAt) : '—' },
                { label: 'بدء المراجعة', value: detail.reviewStartedAt ? fmtDateTime(detail.reviewStartedAt) : '—' },
                { label: 'طلب الاستيضاح', value: detail.clarificationRequestedAt ? fmtDateTime(detail.clarificationRequestedAt) : '—' },
                { label: 'الرد على الاستيضاح', value: detail.clarificationRespondedAt ? fmtDateTime(detail.clarificationRespondedAt) : '—' },
                { label: 'الرد النهائي', value: detail.finalResponseAt ? fmtDateTime(detail.finalResponseAt) : 'لم يُسجّل بعد' },
                { label: 'ملاحظات', value: detail.notes || '—' },
              ]}
            />

            <div>
              <strong className="small">المسار الزمني</strong>
              <ul className="timeline mt-8">
                {[
                  { label: 'استلام الدقيقة', value: detail.receivedAt },
                  { label: 'طلب الملف', value: detail.fileRequestedAt },
                  { label: 'استلام الملف', value: detail.fileReceivedAt },
                  { label: 'بدء المراجعة', value: detail.reviewStartedAt },
                  { label: 'طلب استيضاح', value: detail.clarificationRequestedAt },
                  { label: 'رد الفرع على الاستيضاح', value: detail.clarificationRespondedAt },
                  { label: 'الرد النهائي', value: detail.finalResponseAt },
                ]
                  .filter((step) => step.value)
                  .map((step, index) => (
                    <li className="timeline__item" key={`${step.label}-${index}`}>
                      <span className="timeline__marker timeline__marker--done" />
                      <div>
                        <div className="timeline__title">{step.label}</div>
                        <div className="timeline__meta">{fmtDateTime(step.value)}</div>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة دقيقة الصرف"
        message={`سيتم أرشفة ${archiveTarget?.refNo ?? ''} (حذف ناعم). يمكن استعادتها من زر «الدقائق المؤرشفة».`}
        confirmLabel="أرشفة"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void runAction(() => softDeleteMinute(target.id), 'تمت أرشفة الدقيقة.');
        }}
      />
    </>
  );
}
