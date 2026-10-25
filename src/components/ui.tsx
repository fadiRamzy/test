import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cn } from '../lib/utils';

/* ---------------------------------- أزرار --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn('btn', `btn--${variant}`, `btn--${size}`, className)}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cn('icon-btn', `icon-btn--${variant}`, className)}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

/* --------------------------------- شارات ---------------------------------- */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('badge', `badge--${tone}`, className)}>{children}</span>;
}

export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  return <span className={cn('dot', `dot--${tone}`)} aria-hidden="true" />;
}

/* --------------------------------- بطاقات --------------------------------- */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  padded = true,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  id?: string;
}) {
  return (
    <section className={cn('card', className)} id={id}>
      {(title || actions) && (
        <header className="card__head">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
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
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head__text">
        {breadcrumb ? <div className="breadcrumb">{breadcrumb}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon = 'list',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- نموذج ---------------------------------- */

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
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
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

export function Checkbox({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label className="checkbox" htmlFor={props.id ?? id}>
      <input type="checkbox" id={props.id ?? id} {...props} />
      <span>{label}</span>
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'بحث…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('search', className)}>
      <Icon name="search" size={16} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="search__clear" onClick={() => onChange('')} aria-label="مسح البحث">
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}

/* --------------------------------- نافذة ---------------------------------- */

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
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  // نحتفظ بمرجع محدَّث لدالة الإغلاق حتى لا يعاد تركيز أول حقل عند كل كتابة
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // تركيز أول حقل مرة واحدة عند الفتح
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('modal', `modal--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'نافذة'}>
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

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  tone = 'danger',
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: ButtonVariant;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>إلغاء</Button>
          <Button variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <p className="confirm-text">{message}</p> : null}
      {children}
    </Modal>
  );
}

/* --------------------------------- جداول ---------------------------------- */

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('table-wrap', className)}>{children}</div>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn('table', className)}>{children}</table>;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={cn('tabs__item', value === tab.id && 'is-active')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {typeof tab.count === 'number' ? <span className="tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'primary',
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: IconName;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="stat__top">
        <span className="stat__label">{label}</span>
        {icon ? (
          <span className={cn('stat__icon', `stat__icon--${tone}`)}>
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <div className="stat__value">{value}</div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={cn('stat', 'stat--click', `stat--${tone}`)} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={cn('stat', `stat--${tone}`)}>{content}</div>;
}

export function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: Tone }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span className={cn('progress__bar', `progress__bar--${tone}`)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
  icon = 'info',
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={cn('callout', `callout--${tone}`)}>
      <span className="callout__icon">
        <Icon name={icon} size={17} />
      </span>
      <div>
        {title ? <strong>{title}</strong> : null}
        <div className="callout__text">{children}</div>
      </div>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="def-list">
      {items.map((item) => (
        <div key={item.label} className="def-list__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
