/** إعداد بسيط واحد: اسم الجهة الذي يظهر في رأس الصفحة وفي ملفات Excel */
const KEY = 'dq.organization';

export function loadOrganization(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveOrganization(name: string): void {
  try {
    const value = name.trim();
    if (value) window.localStorage.setItem(KEY, value);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* التخزين المحلي غير متاح — يبقى الاسم للجلسة الحالية فقط */
  }
}
