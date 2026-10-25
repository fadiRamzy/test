import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { AppProvider } from '../src/state/store';
import { clearStore, useDatabase } from '../src/db/database';
import {
  listEmployees,
  listMinutes,
  listVisitTimings,
  listMonthlyEvaluations,
  nextEmployeeNo,
  saveEmployee,
  saveMinute,
  saveMonthlyEvaluation,
  saveVisitTiming,
} from '../src/db/repo';
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

/** يختار موظفًا من قائمة الاختيار المخصّصة (بدل <select>) */
async function pickEmployee(user: ReturnType<typeof userEvent.setup>, controlId: string, name: string) {
  await user.click(document.getElementById(controlId) as HTMLElement);
  const list = await screen.findByRole('listbox', { name: 'الموظف' });
  const option = await within(list).findByRole('option', { name: new RegExp(name) });
  await user.click(option);
}

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

    // 24 + 2 = 26 — ننتظر تحميل البيانات المحلية أولًا
    expect(await screen.findByText('26')).toBeInTheDocument();
    const visits = screen.getByLabelText(`عدد الزيارات — ${employee.name}`) as HTMLInputElement;
    expect(visits.value).toBe('2');
    expect(screen.getByDisplayValue('ملاحظة محفوظة')).toBeInTheDocument();
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

  it('تضيف محضرًا يوميًا بالحقول الجديدة وتحسب المدة', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة محضر/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة محضر/ }));
    await pickEmployee(user, 'min-employee', employee.name);
    await user.type(byId('min-request'), '09:00');
    await user.type(byId('min-received'), '09:30');
    await user.type(byId('min-response'), '10:45');
    await user.selectOptions(byId('min-result'), 'has_notes');
    expect(screen.getByTestId('minute-preview').textContent).toContain('ساعة و15 دقيقة');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('يوجد ملاحظات')).toBeInTheDocument();
    expect(screen.getByText('ساعة و15 دقيقة')).toBeInTheDocument();
    expect(screen.getByText('متأخر')).toBeInTheDocument();
  });

  it('لا يعدّ محضر 60 دقيقة متأخرًا', async () => {
    await seedEmployee();
    await saveMinute({
      employeeId: (await listEmployees(true))[0].id,
      fileReceivedTime: '09:00',
      responseTime: '10:00',
      inspectionResult: 'no_notes',
    });
    window.location.hash = '#/minutes';
    renderApp();

    expect(await screen.findByText('ساعة')).toBeInTheDocument();
    expect(screen.getByText('في الوقت')).toBeInTheDocument();
    expect(screen.queryByText('متأخر')).not.toBeInTheDocument();
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
    expect(screen.getByText('التقييمات الشهرية')).toBeInTheDocument();
    expect(screen.getByText('بيانات الموظف')).toBeInTheDocument();
  });

  it('تعرض لوحة المتابعة مؤشرات حقيقية وتحيل إلى السجلات', async () => {
    await seedEmployee();
    window.location.hash = '#/dashboard';
    renderApp();

    expect(await screen.findByText('موظفون بحالة تعيين')).toBeInTheDocument();
    expect(screen.getByText('موظفون بدون تقييم هذا الشهر')).toBeInTheDocument();
    expect(screen.getByText('موظفون بدون تقييم شهري')).toBeInTheDocument();
  });
});

describe('توقيت الزيارات', () => {
  it('تضيف زيارة وتحسب المدة وتظهر في الملخص الشهري', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    window.location.hash = '#/visit-times';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    await pickEmployee(user, 'vt-employee', employee.name);
    await user.clear(byId('vt-date'));
    await user.type(byId('vt-date'), iso);
    await user.type(byId('vt-branch'), 'فرع المعادي');
    await user.type(byId('vt-client'), 'شركة النور');
    await user.type(byId('vt-location'), 'المعادي');
    await user.type(byId('vt-departure'), '09:00');
    await user.type(byId('vt-return'), '10:10');
    expect(screen.getByTestId('visit-preview').textContent).toContain('ساعة و10 دقائق');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
    // تظهر في جدول الزيارات وفي الملخص الشهري معًا
    expect(screen.getAllByText('ساعة و10 دقائق').length).toBeGreaterThan(1);
    const totals = screen.getByTestId('visit-month-totals');
    expect(totals.textContent).toContain('إجمالي الزيارات');
    expect(totals.textContent).toContain('ساعة و10 دقائق');
    expect(screen.queryByText('متأخر')).not.toBeInTheDocument();
  });

  it('يحسب مدة زيارة تعبر منتصف الليل', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    await pickEmployee(user, 'vt-employee', employee.name);
    await user.type(byId('vt-branch'), 'فرع أ');
    await user.type(byId('vt-client'), 'عميل');
    await user.type(byId('vt-departure'), '23:30');
    await user.type(byId('vt-return'), '00:15');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText('45 دقيقة').length).toBeGreaterThan(0);
  });

  it('يفلتر الملخص الشهري ويستبعد الأشهر الأخرى ويحدّث بعد الحذف', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-02-11',
      branch: 'فرع شبين',
      clientName: 'عميل فبراير',
      location: 'شبين',
      departureTime: '09:00',
      returnTime: '09:45',
    });

    window.location.hash = '#/visit-times';
    renderApp();
    // القائمة مخفية افتراضيًا — نفتحها لعرض السجلات
    await user.click(await screen.findByRole('button', { name: 'إظهار الزيارات' }));
    await waitFor(() => expect(screen.getAllByText('عميل فبراير').length).toBeGreaterThan(0));

    // اختيار شهر مارس 2026 (لا زيارات فيه)
    await user.selectOptions(screen.getByLabelText('الشهر'), '3');
    await user.selectOptions(screen.getByLabelText('السنة'), '2026');
    await waitFor(() => expect(screen.getByText(/لا زيارات في الشهر المحدد/)).toBeInTheDocument());

    // العودة إلى فبراير 2026
    await user.selectOptions(screen.getByLabelText('الشهر'), '2');
    await waitFor(() => expect(screen.getByTestId('visit-month-totals').textContent).toContain('45 دقيقة'));

    // الحذف يحدّث الإجماليات
    await user.click(screen.getByRole('button', { name: 'حذف' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^حذف$/ }));
    await waitFor(() => expect(screen.getByText(/لا زيارات في الشهر المحدد/)).toBeInTheDocument());
    expect(screen.getByTestId('visit-month-totals').textContent).toContain('0');
  });
});

describe('التنقل الرئيسي', () => {
  it('يعرض ثلاثة أقسام فقط بالترتيب المطلوب', async () => {
    await seedEmployee();
    renderApp();
    const nav = await screen.findByRole('navigation', { name: 'التنقل الرئيسي' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['الموظفون', 'محاضر يومية', 'توقيت الزيارات']);
  });
});

describe('ملف الموظف — بيانات الموظف فقط', () => {
  it('يعرض محاضر وزيارات الموظف المحدد فقط مع الإجماليات الصحيحة', async () => {
    const first = await seedEmployee({ name: 'أحمد سالم', code: 'RO-801' });
    const second = await saveEmployee({
      employeeNo: await nextEmployeeNo(),
      name: 'منى فتحي',
      code: 'RO-802',
      sector: 'قطاع الدلتا',
      governorate: 'الغربية',
      jobTitle: 'ضابط مخاطر',
      employmentDate: '2024-02-01',
      branches: 'فرع طنطا',
      status: 'inactive',
      notes: '',
    });

    // سجلات الموظف الأول: محضران + زيارتان (70 + 45 = 115 دقيقة)
    await saveMinute({ employeeId: first.id, fileRequestTime: '08:00', fileReceivedTime: '09:00', responseTime: '10:01', inspectionResult: 'has_notes' });
    await saveMinute({ employeeId: first.id, fileReceivedTime: '09:00', responseTime: '09:45', inspectionResult: 'no_notes' });
    await saveVisitTiming({
      employeeId: first.id,
      visitDate: '2026-03-02',
      branch: 'فرع المعادي',
      clientName: 'عميل الموظف الأول',
      location: 'المعادي',
      departureTime: '09:00',
      returnTime: '10:10',
    });
    await saveVisitTiming({
      employeeId: first.id,
      visitDate: '2026-03-03',
      branch: 'فرع حلوان',
      clientName: 'عميل ثانٍ للأول',
      location: 'حلوان',
      departureTime: '23:30',
      returnTime: '00:15',
    });

    // سجلات موظف آخر — يجب ألا تظهر في ملف الأول
    await saveMinute({ employeeId: second.id, fileReceivedTime: '11:00', responseTime: '11:20', inspectionResult: 'no_notes' });
    await saveVisitTiming({
      employeeId: second.id,
      visitDate: '2026-03-04',
      branch: 'فرع طنطا',
      clientName: 'عميل الموظف الثاني',
      location: 'طنطا',
      departureTime: '08:00',
      returnTime: '09:00',
    });

    window.location.hash = `#/employees/${first.id}`;
    renderApp();

    expect(await screen.findByRole('heading', { name: 'أحمد سالم' })).toBeInTheDocument();
    // كل تفاصيل سجلات الموظف ظاهرة
    expect(await screen.findByText('عميل الموظف الأول')).toBeInTheDocument();
    expect(screen.getByText('عميل ثانٍ للأول')).toBeInTheDocument();
    expect(screen.getByText('يوجد ملاحظات')).toBeInTheDocument();
    expect(screen.getByText('متأخر')).toBeInTheDocument();
    // لا تظهر سجلات الموظف الآخر
    expect(screen.queryByText('عميل الموظف الثاني')).toBeNull();

    // الإجماليات: محضران، زيارتان، إجمالي مدة الزيارات 115 دقيقة
    const metrics = Array.from(document.querySelectorAll('.stat')).map((node) => node.textContent ?? '');
    const minutesCard = metrics.find((text) => text.includes('عدد المحاضر اليومية'));
    const visitsCard = metrics.find((text) => text.includes('عدد الزيارات'));
    const durationCard = metrics.find((text) => text.includes('إجمالي مدة الزيارات'));
    expect(minutesCard).toContain('2');
    expect(visitsCard).toContain('2');
    expect(durationCard).toContain('ساعة و55 دقيقة');
  });

  it('يعرض حالة الموظف «مستقيل» للسجلات القديمة دون فقدانها', async () => {
    const employee = await seedEmployee({ name: 'سعيد كامل', code: 'RO-803', status: 'inactive' });
    window.location.hash = `#/employees/${employee.id}`;
    renderApp();

    expect(await screen.findByRole('heading', { name: 'سعيد كامل' })).toBeInTheDocument();
    expect(screen.getAllByText('مستقيل').length).toBeGreaterThan(0);
  });
});

describe('حالة الموظف', () => {
  it('يستخدم «حالة الموظف» بخياري تعيين ومستقيل فقط', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/employees';
    renderApp();

    await waitFor(() => expect(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]).toBeEnabled());
    await user.click(screen.getAllByRole('button', { name: /إضافة موظف/ })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('حالة الموظف')).toBeInTheDocument();
    expect(within(dialog).queryByText(/على رأس العمل|غير نشط/)).toBeNull();
    const select = within(dialog).getByLabelText('حالة الموظف') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options).toEqual(['تعيين', 'مستقيل']);
  });
});

describe('الملخص الشهري للزيارات', () => {
  it('لا يعرض متوسط مدة الزيارة', async () => {
    const employee = await seedEmployee();
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-02',
      branch: 'فرع أ',
      clientName: 'عميل',
      location: 'مكان',
      departureTime: '09:00',
      returnTime: '10:00',
    });
    window.location.hash = '#/visit-times';
    renderApp();

    await waitFor(() => expect(screen.getByTestId('visit-month-totals')).toBeInTheDocument());
    expect(screen.queryByText(/متوسط مدة الزيارة/)).toBeNull();
    expect(screen.queryByText(/المتوسط/)).toBeNull();
    expect(screen.getByText('إجمالي مدة الزيارات')).toBeInTheDocument();
  });
});

describe('قائمة اختيار الموظف', () => {
  it('تعرض اسم الموظف كاملًا في «إضافة محضر»', async () => {
    const longName = 'عبد الرحمن محمد إبراهيم السيد الشافعي';
    await seedEmployee({ name: longName, code: 'RO-990' });
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة محضر/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة محضر/ }));

    const control = document.getElementById('min-employee') as HTMLElement;
    await pickEmployee(user, 'min-employee', longName);
    expect(control.textContent).toContain(longName);
    // لا نقاط حذف ولا اقتصاص
    expect(control.textContent).not.toContain('…');
  });
});

describe('إخفاء وإظهار السجلات', () => {
  it('توقيت الزيارات: يبدأ مخفيًا ويتبدّل الزر بين إظهار/إخفاء مع بقاء السجلات', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-02',
      branch: 'فرع المعادي',
      clientName: 'شركة النور',
      location: 'المعادي',
      departureTime: '09:00',
      returnTime: '10:10',
    });

    window.location.hash = '#/visit-times';
    renderApp();

    // مخفي افتراضيًا: السجل غير معروض لكن الملخص الشهري ظاهر
    const showBtn = await screen.findByRole('button', { name: 'إظهار الزيارات' });
    expect(screen.queryByText('شركة النور')).toBeNull();
    expect(screen.getByTestId('visit-month-totals')).toBeInTheDocument();

    await user.click(showBtn);
    expect(await screen.findByRole('button', { name: 'إخفاء الزيارات' })).toBeInTheDocument();
    expect(screen.getAllByText('شركة النور').length).toBeGreaterThan(0);

    // الإخفاء لا يحذف السجل: بعد الإظهار مجددًا يعود
    await user.click(screen.getByRole('button', { name: 'إخفاء الزيارات' }));
    expect(screen.queryByText('شركة النور')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'إظهار الزيارات' }));
    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
    expect(await listVisitTimings()).toHaveLength(1);
  });

  it('محاضر يومية: يتبدّل الزر بين إظهار/إخفاء المحاضر ويحفظ السجلات', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    await saveMinute({ employeeId: employee.id, fileReceivedTime: '09:00', responseTime: '09:30', inspectionResult: 'no_notes' });

    window.location.hash = '#/minutes';
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'إخفاء المحاضر' }));
    expect(screen.queryByText('09:30')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'إظهار المحاضر' }));
    expect(await screen.findByText('09:30')).toBeInTheDocument();
    expect(await listMinutes()).toHaveLength(1);
  });
});

describe('الفلاتر', () => {
  it('محاضر يومية: تُجمع فلاتر الموظف والشهر والسنة والبحث وتُعاد تعيينها', async () => {
    const first = await seedEmployee({ name: 'أحمد سالم', code: 'RO-701' });
    const second = await saveEmployee({
      employeeNo: await nextEmployeeNo(),
      name: 'منى فتحي',
      code: 'RO-702',
      sector: 'قطاع الدلتا',
      governorate: 'الغربية',
      jobTitle: 'ضابط مخاطر',
      employmentDate: '2024-02-01',
      branches: '',
      status: 'active',
      notes: '',
    });
    await saveMinute({ employeeId: first.id, fileRequestTime: '07:00', fileReceivedTime: '09:00', responseTime: '09:30', inspectionResult: 'no_notes' });
    await saveMinute({ employeeId: second.id, fileRequestTime: '06:00', fileReceivedTime: '08:00', responseTime: '08:45', inspectionResult: 'has_notes' });

    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    const rowCount = () => document.querySelectorAll('table tbody tr').length;
    await waitFor(() => expect(rowCount()).toBe(2));

    await user.selectOptions(screen.getByLabelText('الموظف في المحاضر'), first.id);
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(screen.getAllByText('أحمد سالم').length).toBeGreaterThan(0);

    // فلتر شهر لا يطابق السجلات (تاريخ الإنشاء هو الشهر الحالي) → حالة فراغ
    const otherMonth = String((new Date().getMonth() + 1) % 12 + 1);
    await user.selectOptions(screen.getByLabelText('شهر المحضر'), otherMonth);
    await waitFor(() => expect(screen.getByText(/لا محاضر مطابقة للفلاتر/)).toBeInTheDocument());

    // إعادة التعيين تُرجع كل السجلات
    await user.click(screen.getByRole('button', { name: /إعادة تعيين/ }));
    await waitFor(() => expect(rowCount()).toBe(2));
    expect(await listMinutes()).toHaveLength(2);
  });

  it('توقيت الزيارات: فلتر الفرع والموظف والبحث تُطبَّق على القائمة ويُحدَّث الملخص', async () => {
    const first = await seedEmployee({ name: 'أحمد سالم', code: 'RO-711' });
    await saveVisitTiming({
      employeeId: first.id,
      visitDate: '2026-03-02',
      branch: 'فرع المعادي',
      clientName: 'شركة النور',
      location: 'المعادي',
      departureTime: '09:00',
      returnTime: '10:10',
    });
    await saveVisitTiming({
      employeeId: first.id,
      visitDate: '2026-03-03',
      branch: 'فرع طنطا',
      clientName: 'شركة الدلتا',
      location: 'طنطا',
      departureTime: '09:00',
      returnTime: '09:35',
    });

    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'إظهار الزيارات' }));
    await waitFor(() => expect(screen.getAllByText('شركة النور').length).toBeGreaterThan(0));

    // بحث نصي
    await user.type(screen.getByLabelText(/بحث بالموظف أو الفرع أو العميل/), 'الدلتا');
    await waitFor(() => expect(screen.queryByText('شركة النور')).toBeNull());
    await user.click(screen.getAllByRole('button', { name: /إعادة تعيين/ })[0]);

    // فلتر الفرع في القائمة
    await user.selectOptions(screen.getByLabelText('الفرع في الزيارات'), 'فرع طنطا');
    await waitFor(() => expect(screen.queryByText('شركة النور')).toBeNull());
    expect(screen.getAllByText('شركة الدلتا').length).toBeGreaterThan(0);

    // فلتر الفرع في الملخص يقيّد الحساب (مع اختيار شهر مارس 2026 الذي فيه الزيارات)
    await user.selectOptions(screen.getByLabelText('الشهر'), '3');
    await user.selectOptions(screen.getByLabelText('السنة'), '2026');
    await waitFor(() => expect(screen.getByTestId('visit-month-totals').textContent).toContain('ساعة و45 دقيقة'));
    await user.selectOptions(screen.getByLabelText('فرع الملخص'), 'فرع طنطا');
    await waitFor(() => expect(screen.getByTestId('visit-month-totals').textContent).toContain('35 دقيقة'));
  });

  it('الموظفون: فلتر الفرع يعمل مع الحالة والبحث ويُعاد تعيينه', async () => {
    await seedEmployee({ name: 'أحمد سالم', code: 'RO-721', branches: 'فرع المعادي، فرع طنطا' });
    await seedEmployee({ name: 'منى فتحي', code: 'RO-722', branches: 'فرع طنطا', status: 'inactive' });

    const user = userEvent.setup();
    window.location.hash = '#/employees';
    renderApp();
    await waitFor(() => expect(screen.getAllByText('أحمد سالم').length).toBeGreaterThan(0));

    await user.selectOptions(screen.getByLabelText('الفرع'), 'فرع المعادي');
    await waitFor(() => expect(screen.queryByText('منى فتحي')).toBeNull());
    expect(screen.getAllByText('أحمد سالم').length).toBeGreaterThan(0);

    // فرع مشترك + حالة: لا نتائج
    await user.selectOptions(screen.getByLabelText('الفرع'), 'فرع طنطا');
    await user.selectOptions(screen.getByLabelText('حالة الموظف'), 'active');
    await waitFor(() => expect(screen.queryByText('منى فتحي')).toBeNull());
    expect(screen.getAllByText('أحمد سالم').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /إعادة تعيين/ }));
    await waitFor(() => expect(screen.getAllByText('منى فتحي').length).toBeGreaterThan(0));
  });

  it('ملف الموظف: فلاتر الشهر والسنة والفرع تُطبَّق على سجلاته فقط', async () => {
    const employee = await seedEmployee({ name: 'أحمد سالم', code: 'RO-731' });
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-02',
      branch: 'فرع المعادي',
      clientName: 'عميل مارس',
      location: 'المعادي',
      departureTime: '09:00',
      returnTime: '10:00',
    });
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-04-05',
      branch: 'فرع طنطا',
      clientName: 'عميل أبريل',
      location: 'طنطا',
      departureTime: '09:00',
      returnTime: '09:30',
    });

    const user = userEvent.setup();
    window.location.hash = `#/employees/${employee.id}`;
    renderApp();
    await waitFor(() => expect(screen.getAllByText('عميل مارس').length).toBeGreaterThan(0));
    expect(screen.getAllByText('عميل أبريل').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('الشهر'), '4');
    await waitFor(() => expect(screen.queryByText('عميل مارس')).toBeNull());
    expect(screen.getAllByText('عميل أبريل').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('الفرع'), 'فرع المعادي');
    await waitFor(() => expect(screen.getByText(/لا زيارات مطابقة للفلاتر/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /إعادة تعيين/ }));
    await waitFor(() => expect(screen.getAllByText('عميل مارس').length).toBeGreaterThan(0));
    expect(await listVisitTimings()).toHaveLength(2);
  });
});

describe('حقل اسم العميل', () => {
  it('يحمل نمطًا مميزًا في نموذج الزيارة', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    const input = byId('vt-client');
    expect(input.className).toContain('input--client');
  });
});
