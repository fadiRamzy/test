import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from '../src/state/store';
import { EmployeesPage } from '../src/pages/Employees';
import { MinutesPage } from '../src/pages/Minutes';
import { EvaluationsPage } from '../src/pages/Evaluations';
import { ReportsPage } from '../src/pages/Reports';
import { clearStore, useDatabase } from '../src/db/database';
import { nextSerial, saveEmployee, saveMinute } from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';

beforeEach(async () => {
  await useDatabase(`test-ui-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
});

function renderPage(page: React.ReactNode) {
  return render(<AppProvider>{page}</AppProvider>);
}

/** ينتظر تحميل البيانات المحلية (تصبح أزرار الإضافة مفعّلة) */
async function waitReady(name: RegExp) {
  await waitFor(() => {
    const [button] = screen.getAllByRole('button', { name });
    expect(button).toBeEnabled();
  });
}

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

async function seedEmployee() {
  return saveEmployee({
    serial: await nextSerial(),
    sector: 'قطاع القاهرة',
    governorate: 'القاهرة',
    name: 'محمد عبد الله',
    code: 'RO-501',
    jobTitle: 'ضابط مخاطر',
    joiningDate: '2024-01-15T00:00:00.000Z',
    visitCount: 4,
    notes: '',
  });
}

describe('شاشة الموظفين', () => {
  it('تضيف موظفًا جديدًا وتظهره في الجدول', async () => {
    const user = userEvent.setup();
    renderPage(<EmployeesPage />);
    await waitReady(/إضافة موظف/);

    await user.click(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]);

    await user.type(byId('emp-name'), 'هدى سامي');
    await user.clear(byId('emp-code'));
    await user.type(byId('emp-code'), 'RO-777');
    await user.type(byId('emp-sector'), 'قطاع الدلتا');
    await user.type(byId('emp-gov'), 'الغربية');

    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const row = await screen.findByText('هدى سامي');
    expect(row).toBeInTheDocument();
    expect(screen.getByText('RO-777')).toBeInTheDocument();
  });

  it('يمنع حفظ موظف بدون اسم ويعرض رسالة الخطأ', async () => {
    const user = userEvent.setup();
    renderPage(<EmployeesPage />);
    await waitReady(/إضافة موظف/);

    await user.click(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]);
    await user.type(byId('emp-code'), 'RO-888');
    await user.type(byId('emp-sector'), 'قطاع الصعيد');
    await user.type(byId('emp-gov'), 'أسيوط');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    expect(await screen.findByText('اسم الموظف مطلوب')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('شاشة دقائق الصرف', () => {
  it('تعرض المدد المحسوبة ووسم تجاوز المهلة', async () => {
    const employee = await seedEmployee();
    const receivedAt = new Date(Date.now() - 240 * 60000).toISOString();
    const reviewStartedAt = new Date(Date.now() - 180 * 60000).toISOString();
    await saveMinute({
      employeeId: employee.id,
      branchRef: 'فرع الزمالك',
      receivedAt,
      fileRequestedAt: new Date(Date.now() - 230 * 60000).toISOString(),
      fileReceivedAt: new Date(Date.now() - 200 * 60000).toISOString(),
      reviewStartedAt,
      status: 'open',
    });

    renderPage(<MinutesPage />);

    expect(await screen.findByText('فرع الزمالك')).toBeInTheDocument();
    expect(await screen.findByText(/تجاوز \+/)).toBeInTheDocument();
    expect(screen.getByText('بانتظار الرد')).toBeInTheDocument();
  });

  it('تسجّل دقيقة جديدة عبر النموذج', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    renderPage(<MinutesPage />);
    await waitReady(/تسجيل دقيقة/);

    await user.click(screen.getAllByRole('button', { name: /تسجيل دقيقة/ })[0]);
    await user.selectOptions(byId('min-employee'), employee.id);
    await user.type(byId('min-branch'), 'فرع المعادي');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('فرع المعادي')).toBeInTheDocument();
  });
});

describe('شاشة التقييمات', () => {
  it('تحسب المتوسط من الدرجات المسجلة فقط دون أوزان', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    renderPage(<EvaluationsPage />);
    await waitReady(/تقييم جديد/);

    await user.click(screen.getAllByRole('button', { name: /تقييم جديد/ })[0]);

    const criteria = await screen.findAllByRole('group');
    expect(criteria).toHaveLength(8);

    const first = within(criteria[0]);
    await user.click(first.getByRole('button', { name: '4' }));
    const second = within(criteria[1]);
    await user.click(second.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(screen.getByText(/المجموع: 6 من 2/)).toBeInTheDocument();
    });
    expect(screen.getByText(/المتوسط:\s*3\.00/)).toBeInTheDocument();
  });
});

describe('تقرير الموظف', () => {
  it('يعرض بيانات الموظف ودقائقه في صفحة قابلة للطباعة', async () => {
    const employee = await seedEmployee();
    await saveMinute({
      employeeId: employee.id,
      branchRef: 'فرع المهندسين',
      receivedAt: '2026-09-01T08:00:00.000Z',
      reviewStartedAt: '2026-09-01T08:30:00.000Z',
      finalResponseAt: '2026-09-01T09:00:00.000Z',
      status: 'completed',
    });

    const { container } = renderPage(<ReportsPage />);

    expect((await screen.findAllByText('محمد عبد الله')).length).toBeGreaterThan(0);
    expect(await screen.findByText('فرع المهندسين')).toBeInTheDocument();
    expect(container.querySelector('.report-page')).not.toBeNull();
    expect(screen.getByRole('button', { name: /طباعة/ })).toBeInTheDocument();
  });
});
