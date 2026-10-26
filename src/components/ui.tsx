import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cn } from '../lib/utils';
import { fmtTime, joinTime12, parseTimeText, splitTime12 } from '../lib/format';

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

/* --------------------------- إخفاء/إظهار القوائم ------------------------- */

export interface CollapseSignal {
  /** يزيد عند الضغط على «إخفاء الكل» أو «إظهار الكل» */
  version: number;
  collapsed: boolean;
}

const CollapseContext = createContext<CollapseSignal>({ version: 0, collapsed: false });

/** يوفّر إشارة عامة لكل بطاقات القوائم في الصفحة الحالية */
export function CollapseProvider({ signal, children }: { signal: CollapseSignal; children: ReactNode }) {
  return <CollapseContext.Provider value={signal}>{children}</CollapseContext.Provider>;
}

/** حالة طي مستقلة لكل قائمة، تتأثر بـ«إخفاء الكل» و«إظهار الكل» */
export function useCollapse(defaultCollapsed = false) {
  const signal = useContext(CollapseContext);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const seen = useRef(signal.version);

  useEffect(() => {
    if (signal.version === seen.current) return;
    seen.current = signal.version;
    setCollapsed(signal.collapsed);
  }, [signal]);

  const toggle = useCallback(() => setCollapsed((value) => !value), []);
  return { collapsed, toggle };
}

/** بطاقة قائمة بيانات مع زر إخفاء/إظهار مستقل */
export function ListCard({
  id,
  title,
  subtitle,
  actions,
  controls,
  children,
  padded = false,
  defaultCollapsed = false,
  hideLabel = 'إخفاء البيانات',
  showLabel = 'إظهار البيانات',
  note,
  className,
}: {
  id: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** الفلاتر وأدوات البحث — تبقى ظاهرة وتعمل حتى عند إخفاء القائمة */
  controls?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  defaultCollapsed?: boolean;
  hideLabel?: string;
  showLabel?: string;
  note?: ReactNode;
  className?: string;
}) {
  const { collapsed, toggle } = useCollapse(defaultCollapsed);
  return (
    <Card
      className={className}
      title={title}
      subtitle={subtitle}
      padded={padded}
      actions={
        <>
          {actions}
          <Button
            size="sm"
            icon={collapsed ? 'list' : 'close'}
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls={id}
          >
            {collapsed ? showLabel : hideLabel}
          </Button>
        </>
      }
    >
      {controls ? <div className="listcard__controls">{controls}</div> : null}
      <div className="listcard__list" id={id} data-collapsed={collapsed ? 'true' : 'false'}>
        {collapsed ? (
          <div className="collapsed-note small muted">
            {note ?? 'البيانات مخفية — اضغط «إظهار البيانات» لعرضها. الإخفاء لا يحذف أي سجل.'}
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
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

/**
 * حقل وقت موحّد بنظام 12 ساعة:
 * - كتابة يدوية داخل الحقل نفسه (2:30 م / 9:05 ص / 14:30) مع تطبيع تلقائي.
 * - اختيار بصري: الضغط على الحقل أو أيقونة الساعة يفتح منتقيًا (ساعة 1‑12 · دقيقة 00‑59 · ص/م).
 * القيمة المخزّنة تبقى HH:MM بنظام 24 ساعة — لا تتغيّر الحسابات.
 */
export function TimeInput({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const autoId = useId();
  const parts = splitTime12(value);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? fmtTime(value) : '');
  /** القيمة التي أرسلها هذا الحقل — لتمييز الكتابة اليدوية عن التغيير الخارجي */
  const emitted = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hourRef = useRef<HTMLSelectElement>(null);
  const panelId = `${id ?? autoId}-panel`;

  useEffect(() => {
    if (emitted.current === value) return;
    setText(value ? fmtTime(value) : '');
  }, [value]);

  // إغلاق عند الضغط خارج الحقل أو Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Escape يغلق المنتقي فقط، ولا يغلق النموذج المفتوح
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    // مرحلة الالتقاط لتسبق مستمع النموذج (Modal) وتغلق المنتقي وحده
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const commit = (next: string) => {
    emitted.current = next;
    setText(next ? fmtTime(next) : '');
    onChange(next);
  };

  const typeText = (next: string) => {
    setText(next);
    const parsed = parseTimeText(next);
    emitted.current = parsed;
    if (parsed) onChange(parsed);
    else if (!next.trim()) onChange('');
  };

  const openPanel = (focusPanel = false) => {
    if (disabled) return;
    setOpen(true);
    if (focusPanel) setTimeout(() => hourRef.current?.focus(), 0);
  };

  const setHour = (hours: string) => commit(joinTime12(hours, parts.minutes, parts.period));
  const setMinutes = (minutes: string) => commit(joinTime12(parts.hours, minutes, parts.period));
  const setPeriod = (period: string) => commit(joinTime12(parts.hours, parts.minutes, period === 'م' ? 'م' : 'ص'));
  const now = () => {
    const date = new Date();
    commit(joinTime12(String(date.getHours() % 12 === 0 ? 12 : date.getHours() % 12), String(date.getMinutes()).padStart(2, '0'), date.getHours() < 12 ? 'ص' : 'م'));
  };
  const empty = !parts.hours;

  return (
    <div className={cn('timefield', open && 'is-open')} ref={rootRef}>
      <div className="timefield__row">
        <input
          ref={inputRef}
          id={id}
          className="input timefield__input"
          type="text"
          inputMode="numeric"
          dir="ltr"
          placeholder="2:30 م"
          aria-label={label ? `${label} — كتابة يدوية أو اختيار` : 'الوقت'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          autoComplete="off"
          value={text}
          disabled={disabled}
          onClick={() => openPanel()}
          onFocus={() => openPanel()}
          onChange={(event) => typeText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              openPanel(true);
            }
          }}
          onBlur={() => {
            const parsed = parseTimeText(text);
            if (parsed) commit(parsed);
            else if (text.trim()) setText(value ? fmtTime(value) : '');
            else if (value) onChange('');
          }}
        />
        <button
          type="button"
          className={cn('timefield__pick', open && 'is-open')}
          aria-label="اختيار الوقت من القائمة"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openPanel(true))}
        >
          <Icon name="clock" size={15} />
        </button>
      </div>

      {open ? (
        <div className="timefield__pop" id={panelId} role="dialog" aria-label="منتقي الوقت">
          <div className="timefield__cols">
            <label className="timefield__col">
              <span>الساعة</span>
              <select
                ref={hourRef}
                className="select"
                aria-label="الساعة"
                value={parts.hours}
                onChange={(e) => setHour(e.target.value)}
              >
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
            </label>
            <label className="timefield__col">
              <span>الدقيقة</span>
              <select
                className="select"
                aria-label="الدقيقة"
                value={parts.minutes}
                disabled={empty}
                onChange={(e) => setMinutes(e.target.value)}
              >
                {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')).map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </label>
            <label className="timefield__col">
              <span>الفترة</span>
              <select
                className="select"
                aria-label="الفترة"
                value={parts.period}
                disabled={empty}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="ص">ص</option>
                <option value="م">م</option>
              </select>
            </label>
          </div>
          <div className="timefield__preview" aria-live="polite">
            {empty ? 'لم يُحدَّد وقت' : fmtTime(joinTime12(parts.hours, parts.minutes, parts.period))}
          </div>
          <div className="timefield__actions">
            <Button size="sm" onClick={now}>
              الآن
            </Button>
            <Button size="sm" onClick={() => commit('')} disabled={empty}>
              مسح
            </Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
              تم
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
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
