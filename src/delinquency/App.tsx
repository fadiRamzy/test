/**
 * نظام تحليل ترحيل المتأخرات الشهري — تطبيق مستقل، وهو التطبيق الافتراضي للموقع.
 * الإطار: شريط علوي أبيض باسم النظام، ثم مساحة العمل.
 */
import { useCallback, useEffect, useState } from 'react';
import { DelinquencyPage } from './pages/Delinquency';
import { useRoute } from './router';
import { ToastProvider } from './ui/toast';

export const APP_TITLE = 'نظام تحليل ترحيل المتأخرات الشهري';

function BrandMark() {
  return (
    <svg className="dq-brand__mark" viewBox="0 0 40 40" width="34" height="34" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="10" fill="#0f3357" />
      <rect x="8" y="22" width="5" height="10" rx="1.4" fill="#ffffff" fillOpacity="0.55" />
      <rect x="15" y="17" width="5" height="15" rx="1.4" fill="#ffffff" fillOpacity="0.7" />
      <rect x="22" y="12" width="5" height="20" rx="1.4" fill="#ffffff" fillOpacity="0.85" />
      <rect x="29" y="8" width="5" height="24" rx="1.4" fill="#ffffff" />
    </svg>
  );
}

export function App() {
  const route = useRoute();
  const [organization, setOrganization] = useState('');

  const changeOrganization = useCallback((name: string) => {
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
                <h1>{APP_TITLE}</h1>
                {organization ? <small>{organization}</small> : null}
              </span>
            </a>
          </div>
        </header>

        <main className="dq-main" id="dq-main">
          <DelinquencyPage section={route.section} itemId={route.itemId} organization={organization} onOrganizationChange={changeOrganization} />
        </main>
      </ToastProvider>
    </div>
  );
}
