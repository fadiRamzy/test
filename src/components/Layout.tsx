import { useEffect, useState } from 'react';
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

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'الرئيسية',
    items: [
      { path: '/employees', label: 'الموظفون', icon: 'employees' },
      { path: '/notes', label: 'الملاحظات والمتابعة', icon: 'observations' },
    ],
  },
  {
    label: 'العمليات الميدانية',
    items: [
      { path: '/visit-times', label: 'توقيت الزيارات', icon: 'clock' },
      { path: '/minutes', label: 'المحاضر اليومية', icon: 'minutes' },
    ],
  },
  {
    label: 'الحضور والإجازات',
    items: [
      { path: '/leave-permissions', label: 'الإجازات والأذونات', icon: 'calendar' },
      { path: '/attendance-delays', label: 'تأخيرات الحضور والانصراف', icon: 'clock' },
    ],
  },
  {
    label: 'الإدارة',
    items: [{ path: '/reports', label: 'التقارير والنسخ الاحتياطي', icon: 'reports' }],
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { settings, ready } = useApp();
  const route = useRoute();
  const [collapse, setCollapse] = useState<CollapseSignal>({ version: 0, collapsed: false });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const broadcast = (collapsed: boolean) => setCollapse((prev) => ({ version: prev.version + 1, collapsed }));
  const isActive = (path: string) => path === '/employees' ? route.path === '/' || route.path === path || route.path.startsWith(`${path}/`) : route.path === path;


  useEffect(() => {
    window.scrollTo({ top: 0 });
    setSidebarOpen(false);
  }, [route.path]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sidebarOpen]);

  return (
    <div className={cn('app-shell', sidebarCollapsed && 'is-sidebar-collapsed')}>
      <aside
        className={cn('app-sidebar print-hide', sidebarOpen && 'is-open', sidebarCollapsed && 'is-collapsed')}
        id="app-sidebar"
        aria-label="القائمة الجانبية"
      >
        <div className="sidebar__brand">
          <a className="sidebar__identity" href="#/employees" aria-label="الانتقال إلى الموظفين" onClick={() => setSidebarOpen(false)}>
            <span className="sidebar__mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 17l5-6 4 3 7-9" /></svg></span>
            <span className="sidebar__brand-copy"><strong>إدارة المخاطر</strong><small>{settings.organizationName}</small></span>
          </a>
          <button
            type="button"
            className="sidebar__collapse"
            aria-label={sidebarCollapsed ? 'توسيع الشريط الجانبي' : 'تصغير الشريط الجانبي'}
            title={sidebarCollapsed ? 'توسيع الشريط الجانبي' : 'تصغير الشريط الجانبي'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <Icon name={sidebarCollapsed ? 'chevron-left' : 'chevron-right'} size={16} />
          </button>
          <button
            type="button"
            className="app-topbar__menu"
            aria-label="فتح قائمة التنقل"
            aria-controls="app-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" size={19} />
          </button>
          <button type="button" className="sidebar__mobile-close" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="sidebar__workspace" title={settings.organizationName}>
          <span className="sidebar__workspace-label">مساحة العمل</span>
          <strong><Icon name="building" size={15} />{settings.organizationName}</strong>
        </div>

        <div className="sidebar__body">
          <nav className="sidebar__nav" aria-label="التنقل الرئيسي">
            {NAV_GROUPS.map((group) => (
              <section className="sidebar__group" key={group.label} aria-label={group.label}>
                <div className="sidebar__group-label">{group.label}</div>
                <div className="sidebar__links">
                  {group.items.map((item) => (
                    <a
                      key={item.path}
                      href={`#${item.path}`}
                      className={cn('sidebar__link', isActive(item.path) && 'is-active')}
                      aria-current={isActive(item.path) ? 'page' : undefined}
                      title={item.label}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <span className="sidebar__link-icon"><Icon name={item.icon} size={18} strokeWidth={1.65} /></span>
                      <span className="sidebar__link-label">{item.label}</span>
                      {isActive(item.path) && <span className="sidebar__active-dot" aria-hidden="true" />}
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </nav>

          <div className="sidebar__footer">
            <div className="sidebar__status">
              <span className="sidebar__status-indicator" />
              <span className="sidebar__status-copy"><strong>{ready ? 'البيانات جاهزة' : 'جارٍ فتح البيانات'}</strong><small>محفوظة على هذا الجهاز</small></span>
            </div>
            {route.path !== '/reports' ? (
              <div className="sidebar__quick-tools" aria-label="أدوات القوائم">
                <button type="button" className="iconbtn" onClick={() => broadcast(true)} title="إخفاء جميع القوائم" aria-label="إخفاء الكل">
                  <Icon name="close" size={15} />
                </button>
                <button type="button" className="iconbtn" onClick={() => broadcast(false)} title="إظهار جميع القوائم" aria-label="إظهار الكل">
                  <Icon name="list" size={15} />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="إغلاق القائمة" onClick={() => setSidebarOpen(false)} />}

      <div className="app-frame">
        <CollapseProvider signal={collapse}>
          <main className="page" id="main-content">
            {ready ? children : <div className="loading">جارٍ فتح البيانات المحلية…</div>}
          </main>
        </CollapseProvider>

        <footer className="appfoot print-hide">
          <span>البيانات محفوظة محليًا على هذا الجهاز فقط</span>
        </footer>
      </div>
    </div>
  );
}
