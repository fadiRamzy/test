import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { Icon, type IconName } from './Icon';
import { cn } from '../lib/utils';
import { Badge } from './ui';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
}

const NAV: NavItem[] = [
  { path: '/', label: 'لوحة المعلومات', icon: 'dashboard', match: (p) => p === '/' || p === '/dashboard' },
  { path: '/employees', label: 'الموظفون', icon: 'employees', match: (p) => p.startsWith('/employees') },
  { path: '/minutes', label: 'دقائق الصرف', icon: 'minutes', match: (p) => p.startsWith('/minutes') },
  { path: '/visits', label: 'الزيارات والتقارير', icon: 'visits', match: (p) => p.startsWith('/visits') },
  { path: '/observations', label: 'سجل الملاحظات', icon: 'observations', match: (p) => p.startsWith('/observations') },
  { path: '/evaluations', label: 'التقييمات', icon: 'evaluations', match: (p) => p.startsWith('/evaluations') },
  { path: '/reports', label: 'تقارير الموظفين', icon: 'reports', match: (p) => p.startsWith('/reports') },
  { path: '/settings', label: 'الإعدادات', icon: 'settings', match: (p) => p.startsWith('/settings') },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { settings, demoMode } = useApp();
  const route = useRoute();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [route.path]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const body = document.body;
    const check = () => setPrintMode(body.classList.contains('print-mode'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (printMode) return <>{children}</>;

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', mobileOpen && 'is-open')} aria-label="التنقل الرئيسي">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">
            <Icon name="shield" size={20} />
          </span>
          <div>
            <strong>إدارة ضباط المخاطر</strong>
            <span>{settings.departmentName}</span>
          </div>
        </div>
        <nav className="sidebar__nav">
          {NAV.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={cn('nav-item', item.match(route.path) && 'is-active')}
              onClick={() => setMobileOpen(false)}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__note">
            <Icon name="database" size={15} />
            <span>البيانات محفوظة في هذا المتصفح فقط</span>
          </div>
        </div>
      </aside>

      {mobileOpen ? <div className="scrim" onClick={() => setMobileOpen(false)} role="presentation" /> : null}

      <div className="main">
        <header className="topbar">
          <div className="topbar__start">
            <button
              type="button"
              className="icon-btn icon-btn--ghost mobile-only"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="القائمة"
            >
              <Icon name="menu" size={19} />
            </button>
            <div className="topbar__org">
              <Icon name="building" size={16} />
              <span>{settings.organizationName}</span>
            </div>
          </div>
          <div className="topbar__end">
            {demoMode ? (
              <Badge tone="warning">وضع البيانات التجريبية</Badge>
            ) : null}
            {!online ? (
              <Badge tone="neutral">
                <Icon name="info" size={12} /> غير متصل — التطبيق يعمل محليًا
              </Badge>
            ) : null}
            <button type="button" className="icon-btn icon-btn--ghost" onClick={() => navigate('/settings')} aria-label="الإعدادات">
              <Icon name="settings" size={18} />
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="app-footer">
          <span>جميع البيانات محلية على هذا الجهاز — لا يتم إرسال أي بيانات لأي خادم.</span>
          <span>التخزين في المتصفح ليس نسخة احتياطية دائمة؛ صدّر نسخة JSON دوريًا.</span>
        </footer>
      </div>
    </div>
  );
}
