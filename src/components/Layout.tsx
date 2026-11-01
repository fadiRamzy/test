import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { useRoute } from '../state/router';
import { Icon, type IconName } from './Icon';
import { CollapseProvider, type CollapseSignal } from './ui';
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
  { path: '/leave-permissions', label: 'الإجازات والأذونات', icon: 'calendar' },
  { path: '/attendance-delays', label: 'تأخيرات الحضور والانصراف', icon: 'clock' },
];

const MORE_NAV: NavItem[] = [
  { path: '/dashboard', label: 'لوحة المتابعة', icon: 'chart' },
  { path: '/monthly', label: 'التقييم الشهري', icon: 'calendar' },
  { path: '/annual', label: 'التقييم السنوي', icon: 'chart' },
  { path: '/visits', label: 'الزيارات الميدانية', icon: 'visits' },
  { path: '/observations', label: 'الملاحظات والمتابعات', icon: 'alert' },
  { path: '/leaves', label: 'الإجازات', icon: 'calendar' },
  { path: '/reports', label: 'التقارير والنسخ الاحتياطي', icon: 'database' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { settings, ready } = useApp();
  const route = useRoute();

  const [collapse, setCollapse] = useState<CollapseSignal>({ version: 0, collapsed: false });
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const broadcast = (collapsed: boolean) => setCollapse((prev) => ({ version: prev.version + 1, collapsed }));

  useEffect(() => {
    window.scrollTo({ top: 0 });
    moreMenu.current?.removeAttribute('open');
  }, [route.path]);

  const isActive = (path: string) => route.path.startsWith(path);

  return (
    <div className="shell">
      <header className="topnav print-hide">
        <a className="topnav__brand" href="#/employees" aria-label="الصفحة الرئيسية — الموظفون">
          <span className="topnav__logo">
            <Icon name="shield" size={18} />
          </span>
          <span>
            <strong>نظام إدارة المخاطر</strong>
            <em>{settings.organizationName}</em>
          </span>
        </a>
        <nav className="topnav__nav" aria-label="التنقل الرئيسي">
          {NAV.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={cn('topnav__link', isActive(item.path) && 'is-active')}
              aria-current={isActive(item.path) ? 'page' : undefined}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <details className={cn('topnav__more', MORE_NAV.some((item) => isActive(item.path)) && 'is-active')} ref={moreMenu}>
          <summary role="button" aria-label="المزيد من الأقسام">
            <Icon name="menu" size={15} />
            <span>الأقسام</span>
            <Icon name="chevron-down" size={13} />
          </summary>
          <div className="topnav__menu">
            {MORE_NAV.map((item) => (
              <a key={item.path} href={`#${item.path}`} className={cn(isActive(item.path) && 'is-active')}>
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
        </details>
        <div className="topnav__tools">
          <button type="button" className="btn btn--sm" onClick={() => broadcast(true)}>
            <Icon name="close" size={13} />
            <span>إخفاء الكل</span>
          </button>
          <button type="button" className="btn btn--sm" onClick={() => broadcast(false)}>
            <Icon name="list" size={13} />
            <span>إظهار الكل</span>
          </button>
          <a className="btn btn--sm topnav__backup" href="#/reports">
            <Icon name="database" size={14} />
            <span>النسخ الاحتياطي</span>
          </a>
        </div>
      </header>
      <CollapseProvider signal={collapse}>
        <main className="page" id="main-content">
          {ready ? children : <div className="loading">جارٍ فتح البيانات المحلية…</div>}
        </main>
      </CollapseProvider>
      <footer className="appfoot print-hide">
        البيانات محفوظة داخل هذا المتصفح على هذا الجهاز فقط — لا مزامنة بين الأجهزة، ويمكن فقدانها عند حذف بيانات
        المتصفح. <a href="#/reports">صدّر نسخة احتياطية</a> بشكل دوري.
      </footer>
    </div>
  );
}
