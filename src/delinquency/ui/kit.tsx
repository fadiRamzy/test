/**
 * عناصر الواجهة الأساسية لنظام تحليل ترحيل المتأخرات (أزرار، حقول، نوافذ، أيقونات).
 * مكتوبة خصيصًا لهذا النظام ومستقلة عن أي نظام آخر في المستودع.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/* -------------------------------- الأيقونات ------------------------------- */

export type IconName =
  | 'chart' | 'dashboard' | 'edit' | 'history' | 'database' | 'plus' | 'trash' | 'save' | 'download' | 'upload'
  | 'calendar' | 'building' | 'arrow-left' | 'restore' | 'list' | 'flag' | 'check' | 'close' | 'alert' | 'info'
  | 'employees' | 'evaluations' | 'shield' | 'layers' | 'swap' | 'sparkles' | 'external';

const paths: Record<IconName, ReactNode> = {
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  evaluations: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  history: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>,
  save: <><path d="M5 3h12l4 4v14H3V3z" /><path d="M7 3v6h10V3M7 21v-7h10v7" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  building: <><path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4" /></>,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  restore: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" /></>,
  flag: <><path d="M5 21V4M5 4c5-3 9 3 14 0v11c-5 3-9-3-14 0" /></>,
  check: <path d="M5 12l4 4L19 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  employees: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.9c2 .6 3.2 2.3 3.6 5.1" /></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="M9 12l2 2 4-4" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5M3 17.5l9 5 9-5" /></>,
  swap: <><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></>,
  sparkles: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16v4M17 18h4" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
};

export function Icon({
  name,
  size = 18,
  className,
  style,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={cn('dq-ic', className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ strokeWidth, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

/* --------------------------------- الأزرار -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: IconName }) {
  return (
    <button type="button" className={cn('dq-btn', `dq-btn--${variant}`, `dq-btn--${size}`, className)} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  tone,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; tone?: 'danger' }) {
  return (
    <button
      type="button"
      className={cn('dq-iconbtn', tone === 'danger' && 'dq-iconbtn--danger', className)}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/* --------------------------------- الشارات -------------------------------- */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('dq-badge', `dq-badge--${tone}`)}>{children}</span>;
}

export function Callout({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn('dq-callout', `dq-callout--${tone}`)}>{children}</div>;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="dq-empty">
      {icon ? (
        <span className="dq-empty__icon">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="dq-empty__action">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- الحقول --------------------------------- */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('dq-field', error && 'dq-field--error', className)}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="dq-field__req"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <span className="dq-field__hint">{hint}</span> : null}
      {error ? <span className="dq-field__err">{error}</span> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('dq-input', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('dq-select', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('dq-textarea', props.className)} />;
}

/* --------------------------------- النوافذ -------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="dq-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('dq-modal', `dq-modal--${size}`)} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dq-modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton icon="close" label="إغلاق" onClick={onClose} />
        </header>
        <div className="dq-modal__body" ref={ref}>
          {children}
        </div>
        {footer ? <footer className="dq-modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
