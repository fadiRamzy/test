import { useMemo } from 'react';
import { useVisibleData } from '../state/store';
import {
  EMPLOYEE_STATUS_LABELS,
  MINUTE_STATUS_LABELS,
  OBSERVATION_STATUS_LABELS,
  SEVERITY_LABELS,
  VISIT_STATUS_LABELS,
  type EmployeeStatus,
  type MinuteStatus,
  type ObservationSeverity,
  type ObservationStatus,
  type VisitStatus,
} from '../db/schema';
import { Badge, type Tone } from './ui';
import { SLA_LABELS, type SlaStatus } from '../lib/minuteCalc';

export function useLookups() {
  const data = useVisibleData();
  return useMemo(() => {
    const employeeMap = new Map(data.employees.map((e) => [e.id, e]));
    const branchMap = new Map(data.branches.map((b) => [b.id, b]));
    return {
      ...data,
      employeeMap,
      branchMap,
      employeeName: (id?: string | null) => (id ? (employeeMap.get(id)?.fullName ?? 'موظف غير معروف') : '—'),
      branchName: (id?: string | null) => (id ? (branchMap.get(id)?.name ?? 'فرع غير معروف') : '—'),
      employeeCode: (id?: string | null) => (id ? (employeeMap.get(id)?.employeeCode ?? '—') : '—'),
    };
  }, [data]);
}

const employeeTone: Record<EmployeeStatus, Tone> = {
  active: 'success',
  inactive: 'warning',
  archived: 'neutral',
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge tone={employeeTone[status]}>{EMPLOYEE_STATUS_LABELS[status]}</Badge>;
}

const minuteStatusTone: Record<MinuteStatus, Tone> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

export function MinuteStatusBadge({ status }: { status: MinuteStatus }) {
  return <Badge tone={minuteStatusTone[status]}>{MINUTE_STATUS_LABELS[status]}</Badge>;
}

const slaToneMap: Record<SlaStatus, Tone> = {
  met: 'success',
  breached: 'danger',
  pending: 'info',
  warning: 'warning',
  overdue: 'danger',
  na: 'neutral',
};

export function SlaBadge({ status }: { status: SlaStatus }) {
  return <Badge tone={slaToneMap[status]}>{SLA_LABELS[status]}</Badge>;
}

const visitTone: Record<VisitStatus, Tone> = {
  planned: 'neutral',
  in_progress: 'info',
  report_pending: 'warning',
  under_review: 'primary',
  completed: 'success',
  cancelled: 'neutral',
};

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return <Badge tone={visitTone[status]}>{VISIT_STATUS_LABELS[status]}</Badge>;
}

const severityTone: Record<ObservationSeverity, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

export function SeverityBadge({ severity }: { severity: ObservationSeverity }) {
  return <Badge tone={severityTone[severity]}>{SEVERITY_LABELS[severity]}</Badge>;
}

const observationTone: Record<ObservationStatus, Tone> = {
  open: 'danger',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};

export function ObservationStatusBadge({ status }: { status: ObservationStatus }) {
  return <Badge tone={observationTone[status]}>{OBSERVATION_STATUS_LABELS[status]}</Badge>;
}

export function QualityRating({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="muted">—</span>;
  return (
    <span className="rating" title={`جودة التقرير: ${score} من 5`} aria-label={`جودة التقرير ${score} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= score ? 'on' : ''} />
      ))}
      <span className="small muted" style={{ marginInlineStart: 5, background: 'none', width: 'auto', height: 'auto', borderRadius: 0 }}>
        {score}/5
      </span>
    </span>
  );
}

export function EmployeeCell({ name, code }: { name: string; code?: string }) {
  return (
    <div>
      <span className="table__primary">{name}</span>
      {code ? <span className="table__sub">{code}</span> : null}
    </div>
  );
}

export function MetricRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'success' | 'danger' | 'warning';
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
      <span className="small muted">{label}</span>
      <strong className={tone ? `text-${tone}` : ''} style={{ fontSize: 13 }}>
        {value}
      </strong>
    </div>
  );
}
