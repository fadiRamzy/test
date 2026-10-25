import { useApp } from './state/store';
import { useRoute } from './state/router';
import { Layout } from './components/Layout';
import { Icon } from './components/Icon';
import { DashboardPage } from './pages/Dashboard';
import { EmployeesPage } from './pages/Employees';
import { EmployeeProfilePage } from './pages/EmployeeProfile';
import { MonthlyEvaluationsPage } from './pages/MonthlyEvaluations';
import { AnnualEvaluationsPage } from './pages/AnnualEvaluations';
import { FieldVisitsPage } from './pages/FieldVisits';
import { MinutesPage } from './pages/Minutes';
import { ObservationsPage } from './pages/Observations';
import { LeavesPage } from './pages/Leaves';
import { ReportsPage } from './pages/Reports';

export function App() {
  const { fatalError, toasts, dismissToast } = useApp();
  const route = useRoute();

  if (fatalError) {
    return (
      <div className="fatal">
        <Icon name="alert" size={30} />
        <h1>تعذّر تشغيل التطبيق</h1>
        <p>{fatalError}</p>
      </div>
    );
  }

  return (
    <>
      <Layout>
        <Router route={route} />
      </Layout>
      <div className="toast-stack print-hide" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            <Icon name={toast.kind === 'error' ? 'alert' : 'check'} size={14} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="إغلاق">
              <Icon name="close" size={12} />
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
  if (first === 'employees') return second ? <EmployeeProfilePage employeeId={second} /> : <EmployeesPage />;
  if (first === 'monthly') return <MonthlyEvaluationsPage />;
  if (first === 'annual') return <AnnualEvaluationsPage />;
  if (first === 'visits') return <FieldVisitsPage />;
  if (first === 'minutes') return <MinutesPage />;
  if (first === 'observations') return <ObservationsPage />;
  if (first === 'leaves') return <LeavesPage />;
  if (first === 'reports') return <ReportsPage />;

  return <DashboardPage />;
}
