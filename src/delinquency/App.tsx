/**
 * نظام تحليل ترحيل المتأخرات الشهري — تطبيق مستقل، وهو التطبيق الافتراضي للموقع.
 * الإطار: شريط علوي بهوية النظام، تعريف مختصر بالشرائح الخمس، ثم مساحة العمل.
 */
import { useCallback, useEffect, useState } from 'react';
import { BUCKETS } from './lib/delinquency';
import { DelinquencyPage } from './pages/Delinquency';
import { useRoute } from './router';
import { loadOrganization, saveOrganization } from './settings';
import { Icon } from './ui/kit';
import { ToastProvider } from './ui/toast';

export const APP_TITLE = 'نظام تحليل ترحيل المتأخرات الشهري';
const PAGE_TITLE = 'تحليل ترحيل المتأخرات الشهري';

/** رابط النظام السابق (إدارة مسؤولي المخاطر) — ما زال متاحًا ببياناته في صفحة مستقلة */
const LEGACY_URL = './employees.html';

function BrandMark() {
  return (
    <svg className="dq-brand__mark" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="#ffffff" fillOpacity="0.12" />
      <rect x="7" y="23" width="4.4" height="9" rx="1.4" fill="#7fd1ae" />
      <rect x="12.9" y="19" width="4.4" height="13" rx="1.4" fill="#bfe3a3" />
      <rect x="18.8" y="15" width="4.4" height="17" rx="1.4" fill="#f4d58a" />
      <rect x="24.7" y="11" width="4.4" height="21" rx="1.4" fill="#f2a57b" />
      <rect x="30.6" y="7" width="4.4" height="25" rx="1.4" fill="#ee7d70" />
    </svg>
  );
}

export function App() {
  const route = useRoute();
  const [organization, setOrganization] = useState(() => loadOrganization());

  const changeOrganization = useCallback((name: string) => {
    saveOrganization(name);
    setOrganization(name.trim());
  }, []);

  useEffect(() => {
    document.title = APP_TITLE;
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  return (
    <div className="dq-app" data-app="delinquency-migration-analysis">
      <ToastProvider>
        <header className="dq-topbar dq-print-hide">
          <div className="dq-topbar__inner">
            <a className="dq-brand" href="#/" aria-label={`${APP_TITLE} — الصفحة الرئيسية`}>
              <BrandMark />
              <span className="dq-brand__text">
                <strong>{APP_TITLE}</strong>
                <small>{organization || 'مقارنة شهرية لمحفظة المتأخرات حسب شرائح التأخير'}</small>
              </span>
            </a>
            <span className="dq-topbar__badge" title="لا تُرسل أي بيانات إلى خادم">
              <Icon name="shield" size={14} />
              <span>البيانات محفوظة على هذا الجهاز فقط</span>
            </span>
          </div>
        </header>

        <main className="dq-main" id="dq-main">
          <section className="dq-hero">
            <div className="dq-hero__text">
              <h1>{PAGE_TITLE}</h1>
              <p>
                أدخل عدد العملاء المتأخرين ومبلغ المتأخرات لكل شريحة شهريًا، ثم قارن أي شهرين لمعرفة صافي التغير، حركة الترحيل بين الشرائح، وأداء
                الفرع — مع تصدير كل الحسابات إلى Excel.
              </p>
            </div>
            <ul className="dq-hero__buckets" aria-label="شرائح التأخير الخمس">
              {BUCKETS.map((bucket, index) => (
                <li key={bucket.id} className={`dq-chip dq-chip--${index + 1}`}>
                  {bucket.label}
                </li>
              ))}
            </ul>
          </section>

          <DelinquencyPage section={route.section} itemId={route.itemId} organization={organization} onOrganizationChange={changeOrganization} />
        </main>

        <footer className="dq-footer dq-print-hide">
          <span>{APP_TITLE} — يعمل بالكامل داخل المتصفح دون خادم.</span>
          <a href={LEGACY_URL} className="dq-footer__link">
            <Icon name="external" size={13} />
            <span>نظام إدارة مسؤولي المخاطر (النظام السابق)</span>
          </a>
        </footer>
      </ToastProvider>
    </div>
  );
}
