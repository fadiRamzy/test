import { useApp } from './state/store';
import { useRoute } from './state/router';
import { Layout } from './components/Layout';
import { Icon } from './components/Icon';
import { Button, Card, EmptyState } from './components/ui';
import { DashboardPage } from './pages/Dashboard';
import { EmployeesPage } from './pages/Employees';
import { EmployeeDetailPage } from './pages/EmployeeDetail';
import { MinutesPage } from './pages/Minutes';
import { VisitsPage } from './pages/Visits';
import { ObservationsPage } from './pages/Observations';
import { EvaluationsPage } from './pages/Evaluations';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';

export function App() {
  const { ready, fatalError, toasts, dismissToast } = useApp();
  const route = useRoute();

  if (fatalError) {
    return (
      <div className="fatal">
        <Icon name="alert" size={34} />
        <h1>تعذّر تشغيل التطبيق</h1>
        <p>{fatalError}</p>
        <p className="small">
          يعتمد النظام على IndexedDB المحلي. تأكد من أنك لا تستخدم وضع التصفح الخاص، وأن المتصفح يسمح بالتخزين المحلي
          لهذا الموقع.
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="loading-screen">
        <span className="spinner" />
        جارٍ تحميل البيانات المحلية…
      </div>
    );
  }

  return (
    <>
      <Layout>
        <Router route={route} />
      </Layout>
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            <Icon name={toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'info'} size={15} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="إغلاق التنبيه">
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function Router({ route }: { route: ReturnType<typeof useRoute> }) {
  const [first, second] = route.segments;

  if (!first) return <DashboardPage />;
  if (first === 'dashboard') return <DashboardPage />;
  if (first === 'employees') return second ? <EmployeeDetailPage /> : <EmployeesPage />;
  if (first === 'minutes') return <MinutesPage />;
  if (first === 'visits') return <VisitsPage />;
  if (first === 'observations') return <ObservationsPage />;
  if (first === 'evaluations') return <EvaluationsPage />;
  if (first === 'reports') return <ReportsPage />;
  if (first === 'settings') return <SettingsPage />;

  return (
    <Card>
      <EmptyState
        icon="search"
        title="الصفحة غير موجودة"
        description={`المسار «${route.path}» غير معروف.`}
        action={<Button variant="primary" onClick={() => { window.location.hash = '#/'; }}>العودة إلى لوحة المعلومات</Button>}
      />
    </Card>
  );
}
