import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { AppProvider } from '../src/state/store';
import { clearStore, useDatabase } from '../src/db/database';
import { nextEmployeeNo, saveEmployee, saveMonthlyEvaluation, listMonthlyEvaluations } from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';

beforeEach(async () => {
  await useDatabase(`test-ui-${Math.random().toString(36).slice(2)}`);
  for (const store of STORE_NAMES) await clearStore(store);
  window.location.hash = '#/';
});

function renderApp() {
  return render(
    <AppProvider>
      <App />
    </AppProvider>,
  );
}

async function seedEmployee(overrides: Partial<Parameters<typeof saveEmployee>[0]> = {}) {
  return saveEmployee({
    employeeNo: await nextEmployeeNo(),
    name: 'محمد عبد الله',
    code: 'RO-501',
    sector: 'قطاع القاهرة',
    governorate: 'القاهرة',
    jobTitle: 'ضابط مخاطر',
    employmentDate: '2024-01-15',
    branches: 'فرع الزمالك',
    status: 'active',
    notes: '',
    ...overrides,
  });
}

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('إضافة موظف', () => {
  it('يحفظ موظفًا جديدًا ويظهره في الجدول', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/employees';
    renderApp();

    await waitFor(() => expect(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]).toBeEnabled());
    await user.click(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]);

    await user.click(byId('emp-name'));
    await user.type(byId('emp-name'), 'هدى سامي');
    await user.clear(byId('emp-code'));
    await user.type(byId('emp-code'), 'RO-777');
    await user.type(byId('emp-sector'), 'قطاع الدلتا');
    await user.type(byId('emp-gov'), 'الغربية');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('هدى سامي')).toBeInTheDocument();
    expect(screen.getByText('RO-777')).toBeInTheDocument();
  });

  it('يعرض رسالة خطأ عند ترك الاسم فارغًا', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/employees';
    renderApp();

    await waitFor(() => expect(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]).toBeEnabled());
    await user.click(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]);
    await user.clear(byId('emp-code'));
    await user.type(byId('emp-code'), 'RO-888');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    expect((await screen.findAllByText('اسم الموظف مطلوب')).length).toBeGreaterThan(0);
  });
});

describe('التقييم الشهري', () => {
  it('يحسب الإجمالي تلقائيًا (زيارات + درجات) ويحفظ القيم', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/monthly';
    renderApp();

    const visits = await screen.findByLabelText(`عدد الزيارات — ${employee.name}`);
    await user.type(visits, '5');

    const criteria = [5, 4, 3, 4, 5, 4, 3, 5];
    const scoreSelects = Array.from(document.querySelectorAll('select.cell--score')) as HTMLSelectElement[];
    expect(scoreSelects).toHaveLength(8);
    for (const [index, value] of criteria.entries()) {
      await user.selectOptions(scoreSelects[index], String(value));
    }

    // 33 درجة + 5 زيارات = 38
    await waitFor(() => expect(screen.getByText('38')).toBeInTheDocument());
    expect(screen.getByText('مكتمل')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /حفظ الشهر/ }));
    await waitFor(async () => {
      const rows = await listMonthlyEvaluations();
      expect(rows).toHaveLength(1);
      expect(rows[0].visits).toBe(5);
      expect(rows[0].scores.c1).toBe(5);
    });
  });

  it('يعيد تحميل القيم المحفوظة عند إعادة فتح الشهر', async () => {
    const employee = await seedEmployee();
    await saveMonthlyEvaluation({
      employeeId: employee.id,
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      visits: 2,
      scores: { c1: 3, c2: 3, c3: 3, c4: 3, c5: 3, c6: 3, c7: 3, c8: 3 },
      notes: 'ملاحظة محفوظة',
    });

    window.location.hash = '#/monthly';
    renderApp();

    const visits = await screen.findByLabelText(`عدد الزيارات — ${employee.name}`);
    expect((visits as HTMLInputElement).value).toBe('2');
    expect(screen.getByDisplayValue('ملاحظة محفوظة')).toBeInTheDocument();
    // 24 + 2 = 26
    expect(screen.getByText('26')).toBeInTheDocument();
  });
});

describe('التقييم السنوي', () => {
  it('يجمع النقاط والزيارات من الشهور المسجلة ويطبق التقدير', async () => {
    const employee = await seedEmployee();
    const year = new Date().getFullYear();
    await saveMonthlyEvaluation({
      employeeId: employee.id,
      year,
      month: 1,
      visits: 5,
      scores: { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5, c6: 5, c7: 5, c8: 5 },
    });

    window.location.hash = '#/annual';
    renderApp();

    const row = (await screen.findByText(employee.name)).closest('tr') as HTMLTableRowElement;
    const cells = within(row).getAllByRole('cell');
    expect(cells[6].textContent).toBe('5'); // الزيارات
    expect(cells[7].textContent).toBe('45'); // 40 + 5
    expect(cells[9].textContent).toBe('1'); // أشهر مقيّمة
  });
});

describe('سجلات الإدخال اليدوي', () => {
  it('تضيف زيارة ميدانية وتظهرها في الجدول', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/visits';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    await user.selectOptions(byId('vis-employee'), employee.id);
    await user.type(byId('vis-branch'), 'فرع المعادي');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('فرع المعادي')).toBeInTheDocument();
  });

  it('تضيف دقيقة صرف بأقل الحقول المطلوبة', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة دقيقة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة دقيقة/ }));
    await user.selectOptions(byId('min-employee'), employee.id);
    await user.type(byId('min-branch'), 'فرع طنطا');
    await user.type(byId('min-received'), '09:30');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('فرع طنطا')).toBeInTheDocument();
  });

  it('تضيف ملاحظة وإجازة', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();

    window.location.hash = '#/observations';
    const { unmount } = renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة ملاحظة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة ملاحظة/ }));
    await user.selectOptions(byId('obs-employee'), employee.id);
    await user.type(byId('obs-details'), 'تأخر في تسليم التقرير');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('تأخر في تسليم التقرير')).toBeInTheDocument();
    unmount();

    window.location.hash = '#/leaves';
    renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة سجل/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة سجل/ }));
    await user.selectOptions(byId('lev-employee'), employee.id);
    await user.clear(byId('lev-days'));
    await user.type(byId('lev-days'), '3');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await screen.findAllByText('إجازة سنوية')).length).toBeGreaterThan(0);
  });
});

describe('ملف الموظف ولوحة المتابعة', () => {
  it('يعرض سجل الموظف الكامل', async () => {
    const employee = await seedEmployee();
    await saveMonthlyEvaluation({
      employeeId: employee.id,
      year: new Date().getFullYear(),
      month: 2,
      visits: 1,
      scores: { c1: 4 },
      notes: 'ملاحظة الشهر',
    });

    window.location.hash = `#/employees/${employee.id}`;
    renderApp();

    expect((await screen.findAllByText(employee.name)).length).toBeGreaterThan(0);
    expect(await screen.findByText('ملاحظة الشهر')).toBeInTheDocument();
    expect(screen.getByText('التقييمات الشهرية ' + new Date().getFullYear())).toBeInTheDocument();
  });

  it('تعرض لوحة المتابعة مؤشرات حقيقية وتحيل إلى السجلات', async () => {
    await seedEmployee();
    window.location.hash = '#/';
    renderApp();

    expect(await screen.findByText('موظفون على رأس العمل')).toBeInTheDocument();
    expect(screen.getByText('موظفون بدون تقييم هذا الشهر')).toBeInTheDocument();
    expect(screen.getByText('موظفون بدون تقييم شهري')).toBeInTheDocument();
  });
});
