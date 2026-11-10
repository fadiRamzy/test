import { useApp } from './state/store';
import { useRoute } from './state/router';
import { Layout } from './components/Layout';
import { Icon } from './components/Icon';
import { EmployeesPage } from './pages/Employees';
import { EmployeeProfilePage } from './pages/EmployeeProfile';
import { MinutesPage } from './pages/Minutes';
import { ReportsPage } from './pages/Reports';
import { VisitTimingsPage } from './pages/VisitTimings';
import { UnifiedLeavesPage } from './pages/UnifiedLeaves';
import { NotesPage } from './pages/Notes';
import { AttendanceDelaysPage } from './pages/AttendanceDelays';
import { DelinquencyPage } from './pages/Delinquency';

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

  if (!first || first === 'employees')
    return second ? <EmployeeProfilePage employeeId={second} /> : <EmployeesPage />;
  if (first === 'visit-times') return <VisitTimingsPage />;
  if (first === 'leave-permissions') return <UnifiedLeavesPage />;
  if (first === 'notes') return <NotesPage />;
  if (first === 'attendance-delays') return <AttendanceDelaysPage />;
  if (first === 'minutes') return <MinutesPage />;
  if (first === 'reports') return <ReportsPage />;
  if (first === 'delinquency') return <DelinquencyPage section={second} itemId={route.segments[2]} />;

  return <EmployeesPage />;
}
