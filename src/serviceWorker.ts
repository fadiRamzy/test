/**
 * تسجيل عامل الخدمة لتوفير وصول دون اتصال لأصول التطبيق.
 * لا تُخزَّن أي سجلات عمل في الـ Cache — البيانات في IndexedDB فقط.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker
      .register(swUrl, { scope: new URL('./', document.baseURI).pathname })
      .catch(() => {
        /* العمل دون اتصال غير متاح — التطبيق يعمل بشكل طبيعي */
      });
  });
}

export async function clearAppCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('roms-assets-')).map((key) => caches.delete(key)));
}
