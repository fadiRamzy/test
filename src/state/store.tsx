import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ensureSettings, isIndexedDbAvailable, readSettings, writeSettings } from '../db/database';
import {
  listAnnualNotes,
  listAttendanceRecords,
  listLeavePermissions,
  listEmployees,
  listEmployeeNotes,
  migrateLegacyEmployeeNotes,
  listFieldVisits,
  listLeaves,
  listMinutes,
  listMonthlyEvaluations,
  listObservations,
  listVisitTimings,
} from '../db/repo';
import {
  DEFAULT_SETTINGS,
  type AnnualNote,
  type AttendanceRecord,
  type AppSettings,
  type DailyMinute,
  type Employee,
  type EmployeeNote,
  type FieldVisit,
  type Leave,
  type LeavePermissionRecord,
  type MonthlyEvaluation,
  type Observation,
  type VisitTiming,
} from '../db/schema';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface AppData {
  employees: Employee[];
  employeeNotes: EmployeeNote[];
  evaluations: MonthlyEvaluation[];
  visits: FieldVisit[];
  minutes: DailyMinute[];
  visitTimings: VisitTiming[];
  observations: Observation[];
  leaves: Leave[];
  leavePermissions: LeavePermissionRecord[];
  attendanceRecords: AttendanceRecord[];
  annualNotes: AnnualNote[];
}

const EMPTY: AppData = {
  employees: [],
  employeeNotes: [],
  evaluations: [],
  visits: [],
  minutes: [],
  visitTimings: [],
  observations: [],
  leaves: [],
  leavePermissions: [],
  attendanceRecords: [],
  annualNotes: [],
};

interface AppContextValue {
  ready: boolean;
  fatalError: string | null;
  settings: AppSettings;
  data: AppData;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  /** ينفّذ عملية كتابة ثم يحدّث البيانات ويعرض رسالة نجاح أو خطأ */
  runAction: <T>(action: () => Promise<T>, successMessage?: string) => Promise<T | undefined>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<AppData>(EMPTY);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id)), []);

  const load = useCallback(async () => {
    await migrateLegacyEmployeeNotes();
    const [employees, employeeNotes, evaluations, visits, minutes, visitTimings, observations, leaves, leavePermissions, attendanceRecords, annualNotes, loadedSettings] =
      await Promise.all([
      listEmployees(true),
      listEmployeeNotes(),
      listMonthlyEvaluations(),
      listFieldVisits(),
      listMinutes(),
      listVisitTimings(),
      listObservations(),
      listLeaves(),
      listLeavePermissions(),
      listAttendanceRecords(),
      listAnnualNotes(),
      readSettings(),
    ]);
    setData({ employees, employeeNotes, evaluations, visits, minutes, visitTimings, observations, leaves, leavePermissions, attendanceRecords, annualNotes });
    setSettings(loadedSettings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isIndexedDbAvailable()) {
          setFatalError('التخزين المحلي (IndexedDB) غير متاح في هذا المتصفح. استخدم متصفحًا حديثًا بدون وضع التصفح الخاص.');
          setReady(true);
          return;
        }
        await ensureSettings();
        await load();
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
  }, [load]);

  const saveSettings = useCallback(
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
        await load();
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
    [load, notify],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      fatalError,
      settings,
      data,
      refresh: load,
      saveSettings,
      notify,
      toasts,
      dismissToast,
      runAction,
    }),
    [ready, fatalError, settings, data, load, saveSettings, notify, toasts, dismissToast, runAction],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
