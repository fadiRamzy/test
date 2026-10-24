import { useEffect, useMemo, useState } from 'react';
import { useApp, useVisibleData } from '../state/store';
import { useRoute } from '../state/router';
import { addReviewCycle, softDeleteVisit } from '../db/repo';
import { exportEntityCsv } from '../db/csv';
import { downloadFile } from '../lib/utils';
import type { FieldVisit } from '../db/schema';
import { VISIT_STATUS_LABELS } from '../db/schema';
import { visitMetrics } from '../lib/analytics';
import { countNoun, fmtDate, fmtDateTime, fmtNumber, fromDateTimeInputValue } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DefinitionList,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Textarea,
} from '../components/ui';
import { VisitsTable } from '../components/RecordTables';
import { QualityRating, useLookups } from '../components/domain';
import { VisitForm } from '../components/forms/VisitForm';

type QuickFilter = 'all' | 'delayed' | 'returned' | 'pending_reports' | 'awaiting_email';

export function VisitsPage() {
  const { settings, runAction } = useApp();
  const data = useVisibleData();
  const lookups = useLookups();
  const route = useRoute();

  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState(route.query.get('employee') ?? 'all');
  const [status, setStatus] = useState(route.query.get('status') ?? 'all');
  const [quick, setQuick] = useState<QuickFilter>((route.query.get('filter') as QuickFilter) ?? 'all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FieldVisit | null>(null);
  const [detail, setDetail] = useState<FieldVisit | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FieldVisit | null>(null);

  useEffect(() => {
    if (route.query.get('new') === '1') {
      setEditing(null);
      setFormOpen(true);
    }
    const filter = route.query.get('filter');
    if (filter) setQuick(filter as QuickFilter);
  }, [route.query]);

  const source = showArchived ? data.archivedVisits : data.visits;

  const withMetrics = useMemo(
    () => source.map((visit) => ({ visit, metrics: visitMetrics(visit, settings) })),
    [source, settings],
  );

  const filtered = useMemo(() => {
    return withMetrics
      .filter(({ visit, metrics }) => {
        if (quick === 'delayed') return metrics.reportDelayed;
        if (quick === 'returned') return metrics.returnedForCorrections;
        if (quick === 'pending_reports') return visit.status === 'report_pending' || !visit.reportSubmittedAt;
        if (quick === 'awaiting_email') return metrics.awaitingFinalEmail;
        return true;
      })
      .filter(({ visit }) => (employee === 'all' ? true : visit.employeeId === employee))
      .filter(({ visit }) => (status === 'all' ? true : visit.status === status))
      .filter(({ visit }) => (from ? visit.visitDate >= from : true))
      .filter(({ visit }) => (to ? visit.visitDate <= to : true))
      .filter(({ visit }) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [visit.refNo, visit.clientRef, visit.feedback, visit.pendingActions, lookups.employeeName(visit.employeeId)]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .map(({ visit }) => visit);
  }, [withMetrics, quick, employee, status, from, to, search, lookups]);

  const counts = useMemo(
    () => ({
      total: source.length,
      completed: source.filter((v) => v.status === 'completed').length,
      delayed: withMetrics.filter((m) => m.metrics.reportDelayed).length,
      returned: withMetrics.filter((m) => m.metrics.returnedForCorrections).length,
      pending: source.filter((v) => v.status === 'report_pending').length,
      avgQuality:
        source.filter((v) => typeof v.qualityScore === 'number').length > 0
          ? source
              .filter((v) => typeof v.qualityScore === 'number')
              .reduce((sum, v) => sum + (v.qualityScore ?? 0), 0) / source.filter((v) => typeof v.qualityScore === 'number').length
          : null,
    }),
    [source, withMetrics],
  );

  const detailMetrics = detail ? visitMetrics(detail, settings) : null;

  return (
    <>
      <PageHeader
        title="الزيارات الميدانية والتقارير"
        description="تسجيل الزيارة، أوقاتها، تسليم التقرير، مراجعة المشرف، دورات التصحيح، والبريد النهائي — مع الحفاظ على كل دورة مراجعة."
        actions={
          <>
            <Button icon={showArchived ? 'list' : 'archive'} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'العودة للنشطة' : 'المؤرشفة'}
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              زيارة جديدة
            </Button>
          </>
        }
      />

      <div className="grid grid--stats">
        <StatCard label="إجمالي الزيارات" value={fmtNumber(counts.total)} hint={`${countNoun(counts.completed, 'visit')} مكتملة`} icon="visits" tone="primary" onClick={() => setQuick('all')} />
        <StatCard label="تقارير متأخرة" value={fmtNumber(counts.delayed)} hint={`حد التأخير ${settings.thresholds.reportDelayWarnHours} ساعة عمل`} icon="clock" tone="warning" onClick={() => setQuick('delayed')} />
        <StatCard label="تقارير أعيدت للتصحيح" value={fmtNumber(counts.returned)} hint="دورات مراجعة بها تصحيحات" icon="history" tone="info" onClick={() => setQuick('returned')} />
        <StatCard label="بانتظار التقرير" value={fmtNumber(counts.pending)} hint="لم يُسلَّم التقرير بعد" icon="reports" tone="danger" onClick={() => setQuick('pending_reports')} />
        <StatCard label="متوسط جودة التقارير" value={counts.avgQuality === null ? '—' : `${counts.avgQuality.toFixed(1)} / 5`} hint="من تقييمات 1–5 المسجلة" icon="evaluations" tone="success" />
      </div>

      <div className="filter-bar mt-12">
        <SearchInput value={search} onChange={setSearch} placeholder="بحث برقم الزيارة أو العميل…" />
        <span className="filter-bar__label">عرض</span>
        <Select value={quick} onChange={(e) => setQuick(e.target.value as QuickFilter)}>
          <option value="all">كل الزيارات</option>
          <option value="delayed">تقارير متأخرة</option>
          <option value="returned">أعيدت للتصحيح</option>
          <option value="pending_reports">بانتظار التقرير</option>
          <option value="awaiting_email">بانتظار البريد النهائي</option>
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
        <span className="filter-bar__label">الحالة</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">الكل</option>
          {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className="filter-bar__label">من</span>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
        <span className="filter-bar__label">إلى</span>
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
        <span className="filter-count">{fmtNumber(filtered.length)} نتيجة</span>
      </div>

      <Card padded={false}>
        {filtered.length ? (
          <VisitsTable visits={filtered} onOpen={(visit) => setDetail(visit)} />
        ) : (
          <EmptyState
            icon="visits"
            title="لا توجد زيارات مطابقة"
            description="عدّل الفلاتر أو سجّل زيارة جديدة."
            action={
              <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
                زيارة جديدة
              </Button>
            }
          />
        )}
      </Card>

      {detail ? (
        <VisitsDetail
          visit={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
            setFormOpen(true);
          }}
          onArchive={() => {
            setArchiveTarget(detail);
            setDetail(null);
          }}
          metrics={detailMetrics}
        />
      ) : null}

      {filtered.length ? (
        <div className="row mt-12" style={{ justifyContent: 'flex-end' }}>
          <Button
            size="sm"
            variant="ghost"
            icon="download"
            onClick={() => {
              const csv = exportEntityCsv('visits', filtered, {
                employees: lookups.employees,
                branches: lookups.branches,
              });
              downloadFile(`visits-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
            }}
          >
            تصدير النتائج CSV
          </Button>
        </div>
      ) : null}

      <VisitForm open={formOpen} visit={editing} onClose={() => setFormOpen(false)} />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة الزيارة"
        message={`سيتم أرشفة الزيارة ${archiveTarget?.refNo ?? ''} مع الاحتفاظ بدورات المراجعة.`}
        confirmLabel="أرشفة"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void runAction(() => softDeleteVisit(target.id), 'تمت أرشفة الزيارة.');
        }}
      />
    </>
  );
}

function VisitsDetail({
  visit,
  onClose,
  onEdit,
  onArchive,
  metrics,
}: {
  visit: FieldVisit;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  metrics: ReturnType<typeof visitMetrics> | null;
}) {
  const { runAction } = useApp();
  const lookups = useLookups();
  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleForm, setCycleForm] = useState({
    submittedAt: '',
    reviewedAt: '',
    correctionsRequestedAt: '',
    correctionsNotes: '',
    resubmittedAt: '',
    qualityScore: '',
    feedback: '',
    finalEmailAt: '',
  });

  const submitCycle = async () => {
    await runAction(
      () =>
        addReviewCycle(visit.id, {
          submittedAt: fromDateTimeInputValue(cycleForm.submittedAt),
          reviewedAt: fromDateTimeInputValue(cycleForm.reviewedAt),
          correctionsRequestedAt: fromDateTimeInputValue(cycleForm.correctionsRequestedAt),
          correctionsNotes: cycleForm.correctionsNotes,
          resubmittedAt: fromDateTimeInputValue(cycleForm.resubmittedAt),
          qualityScore: cycleForm.qualityScore ? Number(cycleForm.qualityScore) : null,
          feedback: cycleForm.feedback,
          finalEmailAt: fromDateTimeInputValue(cycleForm.finalEmailAt),
        }),
      'تمت إضافة دورة مراجعة جديدة.',
    );
    setCycleOpen(false);
    setCycleForm({
      submittedAt: '',
      reviewedAt: '',
      correctionsRequestedAt: '',
      correctionsNotes: '',
      resubmittedAt: '',
      qualityScore: '',
      feedback: '',
      finalEmailAt: '',
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`الزيارة ${visit.refNo}`}
      subtitle={`${visit.clientRef} — ${lookups.employeeName(visit.employeeId)} — ${lookups.branchName(visit.branchId)}`}
      size="lg"
      footer={
        <>
          <Button variant="primary" icon="plus" onClick={() => setCycleOpen((v) => !v)}>
            دورة مراجعة جديدة
          </Button>
          <Button icon="edit" onClick={onEdit}>
            تعديل الزيارة
          </Button>
          <Button variant="danger" icon="archive" onClick={onArchive}>
            أرشفة
          </Button>
          <Button onClick={onClose}>إغلاق</Button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <QualityRating score={visit.qualityScore} />
          {metrics?.reportDelayed ? <Badge tone="warning">تقرير متأخر</Badge> : null}
          {metrics?.returnedForCorrections ? <Badge tone="info">أُعيد للتصحيح</Badge> : null}
          {metrics?.awaitingFinalEmail ? <Badge tone="primary">بانتظار البريد النهائي</Badge> : null}
        </div>

        <DefinitionList
          items={[
            { label: 'تاريخ الزيارة', value: fmtDate(visit.visitDate) },
            { label: 'التحرك / الوصول', value: `${visit.departureAt ? fmtDateTime(visit.departureAt) : '—'} / ${visit.arrivalAt ? fmtDateTime(visit.arrivalAt) : '—'}` },
            { label: 'الفحص / العودة', value: `${visit.inspectionAt ? fmtDateTime(visit.inspectionAt) : '—'} / ${visit.returnAt ? fmtDateTime(visit.returnAt) : '—'}` },
            { label: 'تسليم التقرير', value: visit.reportSubmittedAt ? fmtDateTime(visit.reportSubmittedAt) : 'لم يُسلَّم' },
            { label: 'زمن إعداد التقرير (ساعات عمل)', value: metrics?.reportDelayHours === null || metrics === null ? '—' : `${metrics.reportDelayHours} ساعة` },
            { label: 'مراجعة المشرف', value: visit.supervisorReviewAt ? fmtDateTime(visit.supervisorReviewAt) : '—' },
            { label: 'البريد النهائي', value: visit.finalEmailAt ? fmtDateTime(visit.finalEmailAt) : '—' },
            { label: 'التغذية الراجعة', value: visit.feedback || '—' },
            { label: 'المهام المعلقة', value: visit.pendingActions || '—' },
            { label: 'ملاحظات', value: visit.notes || '—' },
          ]}
        />

        <div>
          <strong className="small">دورات المراجعة ({visit.reviewCycles?.length ?? 0})</strong>
          <div className="mt-8">
            {(visit.reviewCycles ?? []).map((cycle) => (
              <div className="cycle-card" key={cycle.id}>
                <div className="cycle-card__head">
                  <span className="cycle-card__title">دورة #{cycle.cycleNo}</span>
                  <span className="row" style={{ gap: 5 }}>
                    <QualityRating score={cycle.qualityScore} />
                    {cycle.finalEmailAt ? <Badge tone="success">بريد نهائي</Badge> : <Badge tone="neutral">مفتوحة</Badge>}
                  </span>
                </div>
                <div className="small muted">
                  تسليم: {cycle.submittedAt ? fmtDateTime(cycle.submittedAt) : '—'} · مراجعة:{' '}
                  {cycle.reviewedAt ? fmtDateTime(cycle.reviewedAt) : '—'} · تصحيحات:{' '}
                  {cycle.correctionsRequestedAt ? fmtDateTime(cycle.correctionsRequestedAt) : '—'} · إعادة تسليم:{' '}
                  {cycle.resubmittedAt ? fmtDateTime(cycle.resubmittedAt) : '—'} · بريد:{' '}
                  {cycle.finalEmailAt ? fmtDateTime(cycle.finalEmailAt) : '—'}
                </div>
                {cycle.correctionsNotes ? <p className="small mt-8">تصحيحات: {cycle.correctionsNotes}</p> : null}
                {cycle.feedback ? <p className="small mt-8">تغذية راجعة: {cycle.feedback}</p> : null}
              </div>
            ))}
          </div>
        </div>

        {cycleOpen ? (
          <div className="card" style={{ padding: 12 }}>
            <strong className="small">إضافة دورة مراجعة</strong>
            <div className="form-grid mt-8">
              <Field label="وقت التسليم">
                <Input type="datetime-local" value={cycleForm.submittedAt} onChange={(e) => setCycleForm({ ...cycleForm, submittedAt: e.target.value })} />
              </Field>
              <Field label="وقت المراجعة">
                <Input type="datetime-local" value={cycleForm.reviewedAt} onChange={(e) => setCycleForm({ ...cycleForm, reviewedAt: e.target.value })} />
              </Field>
              <Field label="طلب التصحيحات">
                <Input
                  type="datetime-local"
                  value={cycleForm.correctionsRequestedAt}
                  onChange={(e) => setCycleForm({ ...cycleForm, correctionsRequestedAt: e.target.value })}
                />
              </Field>
              <Field label="إعادة التسليم">
                <Input type="datetime-local" value={cycleForm.resubmittedAt} onChange={(e) => setCycleForm({ ...cycleForm, resubmittedAt: e.target.value })} />
              </Field>
              <Field label="البريد النهائي">
                <Input type="datetime-local" value={cycleForm.finalEmailAt} onChange={(e) => setCycleForm({ ...cycleForm, finalEmailAt: e.target.value })} />
              </Field>
              <Field label="الجودة (1–5)">
                <Select value={cycleForm.qualityScore} onChange={(e) => setCycleForm({ ...cycleForm, qualityScore: e.target.value })}>
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="ملاحظات التصحيح" className="fieldset-span-2">
                <Textarea value={cycleForm.correctionsNotes} onChange={(e) => setCycleForm({ ...cycleForm, correctionsNotes: e.target.value })} rows={2} />
              </Field>
              <Field label="التغذية الراجعة" className="fieldset-span-2">
                <Textarea value={cycleForm.feedback} onChange={(e) => setCycleForm({ ...cycleForm, feedback: e.target.value })} rows={2} />
              </Field>
            </div>
            <div className="row mt-8">
              <Button variant="primary" size="sm" icon="plus" onClick={submitCycle}>
                إضافة الدورة
              </Button>
              <Button size="sm" onClick={() => setCycleOpen(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

