/**
 * نقطة دخول الموقع الافتراضية (index.html):
 * نظام تحليل ترحيل المتأخرات الشهري.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles/app.css';
import './styles/delinquency.css';
import { App } from './App';

document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// أصول التطبيق تُخزَّن للعمل دون اتصال (عامل الخدمة يُولَّد أثناء البناء) — لا تُخزَّن فيه أي بيانات.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl, { scope: new URL('./', document.baseURI).pathname }).catch(() => {
      /* العمل دون اتصال غير متاح — التطبيق يعمل بشكل طبيعي */
    });
  });
}
