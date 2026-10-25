import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cn } from '../lib/utils';

/* --------------------------------- أزرار --------------------------------- */

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
    <button type="button" className={cn('btn', `btn--${variant}`, `btn--${size}`, className)} {...rest}>
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
    <button type="button" className={cn('iconbtn', tone === 'danger' && 'iconbtn--danger', className)} title={label} aria-label={label} {...rest}>
      <Icon name={icon} size={15} />
    </button>
  );
}

/* -------------------------------- شارات ---------------------------------- */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('badge', `badge--${tone}`)}>{children}</span>;
}

/* -------------------------------- بطاقات --------------------------------- */

export function Card({
  title,
  subtitle,
  actions,
  children,
  padded = true,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={cn('card', className)}>
      {(title || actions) && (
        <header className="card__head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="card__actions">{actions}</div> : null}
        </header>
      )}
      <div className={cn('card__body', !padded && 'card__body--flush')}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="pagehead">
      <div className="pagehead__text">
        {eyebrow ? <span className="pagehead__eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="pagehead__actions">{actions}</div> : null}
    </header>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar print-hide">{children}</div>;
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
    <div className="empty">
      {icon ? (
        <span className="empty__icon">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function Callout({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn('callout', `callout--${tone}`)}>{children}</div>;
}

/* -------------------------------- الحقول --------------------------------- */

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
    <div className={cn('field', error && 'field--error', className)}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <span className="hint">{hint}</span> : null}
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('select', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('textarea', props.className)} />;
}

export function Checkbox({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label className="checkbox" htmlFor={props.id ?? id}>
      <input type="checkbox" id={props.id ?? id} {...props} />
      <span>{label}</span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'بحث…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <Icon name="search" size={14} />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="مسح البحث">
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------- النوافذ -------------------------------- */

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
    <div className="overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('modal', `modal--${size}`)} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton icon="close" label="إغلاق" onClick={onClose} />
        </header>
        <div className="modal__body" ref={ref}>
          {children}
        </div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* -------------------------------- الجداول -------------------------------- */

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('tablewrap', className)}>{children}</div>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn('table', className)}>{children}</table>;
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
  tone?: Tone;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon ? (
        <span className={cn('stat__icon', `stat__icon--${tone}`)}>
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="stat stat--click" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat">{content}</div>
  );
}
