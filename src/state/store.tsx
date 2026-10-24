import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ensureDefaults,
  isIndexedDbAvailable,
  readMeta,
  readSettings,
  useDatabase,
  writeMeta,
  writeSettings,
} from '../db/database';
import {
  listBranches,
  listEmployees,
  listEvaluations,
  listMinutes,
  listObservations,
  listVisits,
} from '../db/repo';
import { DEFAULT_SETTINGS, type AppSettings, type Branch, type DisbursementMinute, type Employee, type Evaluation, type FieldVisit, type Observation } from '../db/schema';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface RawData {
  employees: Employee[];
  branches: Branch[];
  minutes: DisbursementMinute[];
  visits: FieldVisit[];
  observations: Observation[];
  evaluations: Evaluation[];
}

const EMPTY: RawData = { employees: [], branches: [], minutes: [], visits: [], observations: [], evaluations: [] };

interface AppContextValue {
  ready: boolean;
  fatalError: string | null;
  settings: AppSettings;
  raw: RawData;
  demoMode: boolean;
  setDemoMode: (value: boolean) => void;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  toasts: Toast[];
  notify: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  runAction: <T>(action: () => Promise<T>, successMessage?: string) => Promise<T | undefined>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [raw, setRaw] = useState<RawData>(EMPTY);
  const [demoMode, setDemoModeState] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const demoRef = useRef(false);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3800);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadAll = useCallback(async (includeDemo: boolean) => {
    const options = { includeDeleted: true, includeDemo };
    const [employees, branches, minutes, visits, observations, evaluations, loadedSettings] = await Promise.all([
      listEmployees(options),
      listBranches(options),
      listMinutes(options),
      listVisits(options),
      listObservations(options),
      listEvaluations(options),
      readSettings(),
    ]);
    setRaw({ employees, branches, minutes, visits, observations, evaluations });
    setSettings(loadedSettings);
  }, []);

  const refresh = useCallback(async () => {
    await loadAll(demoRef.current);
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isIndexedDbAvailable()) {
          setFatalError(
            'التخزين المحلي (IndexedDB) غير متاح في هذا المتصفح. جرّب متصفحًا حديثًا أو اخرج من وضع التصفح الخاص.',
          );
          setReady(true);
          return;
        }
        await ensureDefaults();
        const storedDemo = await readMeta<boolean>('demoMode');
        demoRef.current = Boolean(storedDemo);
        if (!cancelled) setDemoModeState(Boolean(storedDemo));
        await loadAll(Boolean(storedDemo));
        if (!cancelled) setReady(true);
      } catch (error) {
        if (!cancelled) {
          setFatalError(error instanceof Error ? error.message : 'تعذّر تهيئة قاعدة البيانات المحلية.');
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const setDemoMode = useCallback(
    (value: boolean) => {
      demoRef.current = value;
      setDemoModeState(value);
      void writeMeta('demoMode', value).then(() => loadAll(value));
      notify(value ? 'تم تفعيل وضع البيانات التجريبية — السجلات الفعلية مخفية الآن.' : 'تم إيقاف وضع البيانات التجريبية.', 'info');
    },
    [loadAll, notify],
  );

  const saveSettingsAction = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = await writeSettings({ ...settings, ...patch });
      setSettings(next);
      notify('تم حفظ الإعدادات.', 'success');
    },
    [settings, notify],
  );

  const runAction = useCallback(
    async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T | undefined> => {
      try {
        const result = await action();
        await refresh();
        if (successMessage) notify(successMessage, 'success');
        return result;
      } catch (error) {
        const message =
          error && typeof error === 'object' && 'errors' in error
            ? Object.values((error as { errors: Record<string, string> }).errors)[0]
            : error instanceof Error
              ? error.message
              : 'حدث خطأ غير متوقع';
        notify(String(message), 'error');
        throw error;
      }
    },
    [refresh, notify],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      fatalError,
      settings,
      raw,
      demoMode,
      setDemoMode,
      refresh,
      saveSettings: saveSettingsAction,
      toasts,
      notify,
      dismissToast,
      runAction,
    }),
    [ready, fatalError, settings, raw, demoMode, setDemoMode, refresh, saveSettingsAction, toasts, notify, dismissToast, runAction],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** تصفية السجلات حسب وضع العرض: فعلي (افتراضي) أو تجريبي */
export function useVisibleData() {
  const { raw, demoMode } = useApp();
  return useMemo(() => {
    const pick = <T extends { deletedAt?: string | null; isDemo?: boolean }>(rows: T[]) =>
      rows.filter((r) => !r.deletedAt && (demoMode ? r.isDemo === true : !r.isDemo));
    const archived = <T extends { deletedAt?: string | null; isDemo?: boolean }>(rows: T[]) =>
      rows.filter((r) => r.deletedAt && (demoMode ? r.isDemo === true : !r.isDemo));
    return {
      employees: pick(raw.employees),
      archivedEmployees: archived(raw.employees),
      branches: pick(raw.branches),
      archivedBranches: archived(raw.branches),
      minutes: pick(raw.minutes),
      archivedMinutes: archived(raw.minutes),
      visits: pick(raw.visits),
      archivedVisits: archived(raw.visits),
      observations: pick(raw.observations),
      archivedObservations: archived(raw.observations),
      evaluations: pick(raw.evaluations),
      archivedEvaluations: archived(raw.evaluations),
    };
  }, [raw, demoMode]);
}

/** للاختبارات: إعادة ضبط قاعدة البيانات على اسم مخصص */
export async function prepareDatabaseForTest(name: string): Promise<void> {
  await useDatabase(name);
}
