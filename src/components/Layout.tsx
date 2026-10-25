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
  { path: '/', label: 'لوحة المتابعة', icon: 'dashboard' },
  { path: '/employees', label: 'الموظفون', icon: 'employees' },
  { path: '/monthly', label: 'التقييم الشهري', icon: 'chart' },
  { path: '/annual', label: 'التقييم السنوي', icon: 'flag' },
  { path: '/visits', label: 'الزيارات الميدانية', icon: 'visits' },
  { path: '/minutes', label: 'دقائق الصرف', icon: 'minutes' },
  { path: '/observations', label: 'الملاحظات', icon: 'observations' },
  { path: '/leaves', label: 'الإجازات والأذونات', icon: 'calendar' },
  { path: '/reports', label: 'التقارير والنسخ', icon: 'database' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { settings, ready } = useApp();
  const route = useRoute();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.path]);

  const isActive = (path: string) => (path === '/' ? route.path === '/' : route.path.startsWith(path));

  return (
    <div className="shell">
      <header className="topnav print-hide">
        <a className="topnav__brand" href="#/">
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
        المتصفح. صدّر نسخة احتياطية من صفحة «التقارير والنسخ».
      </footer>
    </div>
  );
}
