import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { cn } from '../lib/utils';

/**
 * قائمة اختيار موظف مخصّصة بدل <select> الأصلية.
 *
 * سبب الاستبدال: القائمة الأصلية في بعض المتصفحات تقصّ الاسم الطويل (اتجاه RTL + أسماء عربية مركّبة)
 * فتبقى المساحة الباقية بيضاء. هنا يُعرض الاسم كاملًا في الزر وفي القائمة، بلا اقتصاص،
 * مع التفاف تلقائي للسطر والبحث والتنقل بلوحة المفاتيح.
 */

export interface PickerOption {
  id: string;
  /** الاسم الكامل كما هو مسجل */
  name: string;
  /** نص ثانوي (رقم الموظف / الكود) */
  meta?: string;
}

interface EmployeePickerProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

export function EmployeePicker({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = '— اختر الموظف —',
  error,
  required,
  className,
}: EmployeePickerProps) {
  const autoId = useId();
  const controlId = id ?? `picker-${autoId}`;
  const listId = `${controlId}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.id === value) ?? null;

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return options;
    return options.filter((option) => `${option.name} ${option.meta ?? ''}`.toLowerCase().includes(text));
  }, [options, query]);

  const openAt = () => {
    const node = buttonRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const width = Math.max(box.width, 280);
    const left = Math.min(Math.max(8, box.right - width), window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - box.bottom;
    const nextPlacement = spaceBelow < 260 && box.top > spaceBelow ? 'top' : 'bottom';
    setRect({ top: nextPlacement === 'top' ? box.top - 6 : box.bottom + 6, left, width });
    setPlacement(nextPlacement);
  };

  const openList = () => {
    openAt();
    setQuery('');
    setActiveIndex(Math.max(0, options.findIndex((option) => option.id === value)));
    setOpen(true);
  };

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popRef.current?.contains(target)) return;
      close();
    };
    const onScrollOrResize = () => openAt();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.clearTimeout(timer);
    };
  }, [open]);

  const choose = (option: PickerOption) => {
    onChange(option.id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      buttonRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) choose(option);
      return;
    }
    if (event.key === 'Tab') close();
  };

  return (
    <div className={cn('field picker-field', error && 'field--error', className)}>
      <label htmlFor={controlId}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>

      <button
        ref={buttonRef}
        id={controlId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        className={cn('picker__control', !selected && 'picker__control--empty')}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <span className="picker__value">
            <span className="picker__name">{selected.name}</span>
            {selected.meta ? <span className="picker__meta">{selected.meta}</span> : null}
          </span>
        ) : (
          <span className="picker__placeholder">{placeholder}</span>
        )}
        <Icon name="chevron-down" size={15} className="picker__chevron" />
      </button>

      {error ? <span className="err">{error}</span> : null}

      {open && rect
        ? createPortal(
            <div
              ref={popRef}
              className={cn('picker__pop', placement === 'top' && 'picker__pop--top')}
              style={{ top: rect.top, left: rect.left, width: rect.width }}
              onKeyDown={onKeyDown}
            >
              <div className="picker__search">
                <Icon name="search" size={14} />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder="ابحث بالاسم أو الرقم…"
                  aria-label="بحث في الموظفين"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                  }}
                />
              </div>

              <ul className="picker__list" id={listId} role="listbox" aria-label={label}>
                {filtered.length ? (
                  filtered.map((option, index) => (
                    <li
                      key={option.id}
                      role="option"
                      aria-selected={option.id === value}
                      className={cn(
                        'picker__option',
                        index === activeIndex && 'is-active',
                        option.id === value && 'is-selected',
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(option)}
                    >
                      <span className="picker__name">{option.name}</span>
                      {option.meta ? <span className="picker__meta">{option.meta}</span> : null}
                      {option.id === value ? <Icon name="check" size={14} /> : null}
                    </li>
                  ))
                ) : (
                  <li className="picker__empty">لا يوجد موظف مطابق لهذا البحث.</li>
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
