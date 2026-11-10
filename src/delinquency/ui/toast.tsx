import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './kit';

export type ToastKind = 'success' | 'error' | 'info';
export type Notify = (message: string, kind?: ToastKind) => void;

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const NotifyContext = createContext<Notify>(() => undefined);

export const useNotify = (): Notify => useContext(NotifyContext);

/** رسائل قصيرة أسفل الشاشة تؤكد نتيجة كل إجراء (حفظ، حذف، تنزيل…) */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id)), []);

  const notify = useCallback<Notify>(
    (message, kind = 'info') => {
      counter.current += 1;
      const id = counter.current;
      setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3800);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <div className="dq-toasts dq-print-hide" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`dq-toast dq-toast--${toast.kind}`}>
            <Icon name={toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'info'} size={15} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="إغلاق الرسالة">
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  );
}
