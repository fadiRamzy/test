import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDatabase, wipeAllData } from '../src/db/database';
import { saveBranch, saveEmployee, saveMinute } from '../src/db/repo';
import { AppProvider } from '../src/state/store';
import { App } from '../src/App';

beforeAll(async () => {
  await useDatabase('roms-test-app');
});

beforeEach(async () => {
  await wipeAllData();
  window.location.hash = '#/';
});

function renderApp() {
  return render(
    <AppProvider>
      <App />
    </AppProvider>,
  );
}

describe('واجهة التطبيق', () => {
  it('يعرض لوحة المعلومات عند عدم وجود بيانات', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'لوحة المعلومات' })).toBeInTheDocument();
    expect(screen.getByText('لا توجد سجلات بعد')).toBeInTheDocument();
  });

  it('ينشئ موظفًا من الواجهة ويظهر في القائمة', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'لوحة المعلومات' });

    window.location.hash = '#/employees';
    await waitFor(() => expect(window.location.hash).toBe('#/employees'));

    await user.click(await screen.findByRole('button', { name: /موظف جديد/ }));

    const nameInput = await screen.findByPlaceholderText('مثال: محمد أحمد علي');
    await user.type(nameInput, 'هبة مصطفى');
    await user.type(screen.getByPlaceholderText('EMP-001'), 'UI-500');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(screen.getByText('هبة مصطفى')).toBeInTheDocument());
    expect(screen.getByText('UI-500')).toBeInTheDocument();
  });

  it('يحافظ على البيانات بعد إعادة تحميل الصفحة (إعادة تركيب التطبيق)', async () => {
    const branch = await saveBranch({ code: 'BR-UI', name: 'فرع الواجهة', governorate: 'القاهرة' });
    await saveEmployee({
      employeeCode: 'UI-1',
      fullName: 'سجل ثابت للاختبار',
      jobTitle: 'ضابط مخاطر',
      branchId: branch.id,
      hireDate: '2024-01-01',
      status: 'active',
    });

    const first = renderApp();
    window.location.hash = '#/employees';
    await waitFor(() => expect(screen.getByText('سجل ثابت للاختبار')).toBeInTheDocument());
    first.unmount();

    renderApp();
    await waitFor(() => expect(screen.getByText('سجل ثابت للاختبار')).toBeInTheDocument());
  });

  it('يفلتر دقائق الصرف المتأخرة ويعرض إحصاءاتها', async () => {
    const branch = await saveBranch({ code: 'BR-M', name: 'فرع الدقائق', governorate: 'الجيزة' });
    const employee = await saveEmployee({
      employeeCode: 'M-1',
      fullName: 'ضابط متأخر',
      jobTitle: 'ضابط مخاطر',
      branchId: branch.id,
      hireDate: '2024-01-01',
      status: 'active',
    });
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    await saveMinute({
      employeeId: employee.id,
      branchId: branch.id,
      clientRef: 'CL-LATE-1',
      financingType: 'تمويل قائمة',
      receivedAt: threeDaysAgo.toISOString(),
      status: 'in_progress',
      finalResponseAt: null,
    });

    renderApp();
    window.location.hash = '#/minutes?status=overdue';
    await waitFor(() => expect(screen.getByText('CL-LATE-1')).toBeInTheDocument());
    const table = screen.getByRole('table');
    expect(within(table).getByText('متأخر')).toBeInTheDocument();
  });

  it('يفصل البيانات التجريبية عن الفعلية في الواجهة', async () => {
    const branch = await saveBranch({ code: 'BR-D', name: 'فرع حقيقي', governorate: 'القاهرة' });
    await saveEmployee({
      employeeCode: 'REAL-1',
      fullName: 'موظف حقيقي',
      jobTitle: 'ضابط مخاطر',
      branchId: branch.id,
      hireDate: '2024-01-01',
      status: 'active',
    });
    await saveEmployee({
      employeeCode: 'DEMO-1',
      fullName: 'موظف تجريبي',
      jobTitle: 'ضابط مخاطر',
      branchId: branch.id,
      hireDate: '2024-01-01',
      status: 'active',
      isDemo: true,
    });

    renderApp();
    window.location.hash = '#/employees';
    await waitFor(() => expect(screen.getByText('موظف حقيقي')).toBeInTheDocument());
    expect(screen.queryByText('موظف تجريبي')).not.toBeInTheDocument();
  });

  it('يفتح صفحة التقرير ويولّد مستند الطباعة', async () => {
    const branch = await saveBranch({ code: 'BR-R', name: 'فرع التقارير', governorate: 'القاهرة' });
    const employee = await saveEmployee({
      employeeCode: 'R-9',
      fullName: 'مريم للتقرير',
      jobTitle: 'ضابط مخاطر',
      branchId: branch.id,
      hireDate: '2024-01-01',
      status: 'active',
    });
    await saveMinute({
      employeeId: employee.id,
      branchId: branch.id,
      clientRef: 'CL-RPT',
      financingType: 'تمويل قائمة',
      receivedAt: new Date().toISOString(),
      status: 'completed',
      finalResponseAt: new Date().toISOString(),
    });

    renderApp();
    window.location.hash = `#/reports?employee=${employee.id}`;
    await waitFor(() => expect(screen.getAllByText(/تقرير أداء ضابط مخاطر/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/مريم للتقرير/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /طباعة \/ حفظ PDF/ })).toBeInTheDocument();
  });
});
