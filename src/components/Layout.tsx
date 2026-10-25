import { useEffect } from 'react';
import { useApp } from '../state/store';
import { useRoute } from '../state/router';
import { Icon, type IconName } from './Icon';
import { cn } from '../lib/utils';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { path: '/employees', label: 'الموظفون', icon: 'employees' },
  { path: '/minutes', label: 'محاضر يومية', icon: 'minutes' },
  { path: '/visit-times', label: 'توقيت الزيارات', icon: 'visits' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { settings, ready } = useApp();
  const route = useRoute();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.path]);

  const isActive = (path: string) => route.path.startsWith(path);

  return (
    <div className="shell">
      <header className="topnav print-hide">
        <a className="topnav__brand" href="#/employees">
          <span className="topnav__logo">
            <Icon name="shield" size={17} />
          </span>
          <span>
            <strong>نظام إدارة المخاطر</strong>
            <em>{settings.organizationName}</em>
          </span>
        </a>
        <nav className="topnav__nav" aria-label="التنقل الرئيسي">
          {NAV.map((item) => (
            <a key={item.path} href={`#${item.path}`} className={cn('topnav__link', isActive(item.path) && 'is-active')}>
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </header>
      <main className="page">{ready ? children : <div className="loading">جارٍ فتح البيانات المحلية…</div>}</main>
      <footer className="appfoot print-hide">
        البيانات محفوظة داخل هذا المتصفح على هذا الجهاز فقط — لا مزامنة بين الأجهزة، ويمكن فقدانها عند حذف بيانات
        المتصفح. <a href="#/reports">صدّر نسخة احتياطية</a> بشكل دوري.
      </footer>
    </div>
  );
}
