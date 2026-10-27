import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  const list = await screen.findByRole('listbox', { name: /الموظف/ });
  const option = await within(list).findByRole('option', { name: new RegExp(name) });
  await user.click(option);
}

/** يكتب الوقت يدويًا في حقل 12 ساعة («2:30 م») — التخزين يبقى HH:MM */
async function setTime(user: ReturnType<typeof userEvent.setup>, id: string, value: string) {
  const [hours24, minutes] = value.split(':').map(Number);
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const period = hours24 < 12 ? 'ص' : 'م';
  const text = `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
  const input = document.getElementById(id) as HTMLInputElement;
  await user.clear(input);
  await user.type(input, text);
  await user.tab();
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
    await setTime(user, 'min-request', '09:00');
    await setTime(user, 'min-received', '09:30');
    await setTime(user, 'min-response', '10:45');
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
    await setTime(user, 'vt-departure', '09:00');
    await setTime(user, 'vt-return', '10:10');
    expect(screen.getByTestId('visit-preview').textContent).toContain('ساعة و10 دقائق');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ساعة و10 دقائق').length).toBeGreaterThan(0);
    // عدّاد الزيارات داخل منطقة السجلات
    expect(screen.getByTestId('visit-count-total').textContent).toContain('1');
    // الأوقات تُعرض بنظام 12 ساعة
    expect(screen.getAllByText('9 ص').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10:10 ص').length).toBeGreaterThan(0);
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
    await setTime(user, 'vt-departure', '23:30');
    await setTime(user, 'vt-return', '00:15');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText('45 دقيقة').length).toBeGreaterThan(0);
  });

  it('يفلتر الزيارات بالشهر والسنة ويستبعد الأشهر الأخرى ويحدّث بعد الحذف', async () => {
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
    // القائمة ظاهرة افتراضيًا — السجل معروض
    await waitFor(() => expect(screen.getAllByText('عميل فبراير').length).toBeGreaterThan(0));

    // اختيار شهر مارس 2026 (لا زيارات فيه)
    await user.selectOptions(screen.getByLabelText('شهر الزيارة'), '3');
    await user.selectOptions(screen.getByLabelText('سنة الزيارة'), '2026');
    await waitFor(() => expect(screen.getByText(/لا زيارات مطابقة للفلاتر/)).toBeInTheDocument());
    expect(screen.getByTestId('visit-count-total').textContent).toContain('0');

    // العودة إلى فبراير 2026
    await user.selectOptions(screen.getByLabelText('شهر الزيارة'), '2');
    await waitFor(() => expect(screen.getAllByText('عميل فبراير').length).toBeGreaterThan(0));
    expect(screen.getByTestId('visit-count-total').textContent).toContain('1');

    // الحذف يحدّث القائمة والعدد
    await user.click(screen.getByRole('button', { name: 'حذف' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^حذف$/ }));
    await waitFor(() => expect(screen.getByText(/لا زيارات مطابقة للفلاتر/)).toBeInTheDocument());
    expect(screen.getByTestId('visit-count-total').textContent).toContain('0');
    expect(await listVisitTimings()).toHaveLength(0);
  });
});

describe('التنقل الرئيسي', () => {
  it('يعرض أقسام التنقل المطلوبة بالترتيب', async () => {
    await seedEmployee();
    renderApp();
    const nav = await screen.findByRole('navigation', { name: 'التنقل الرئيسي' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['الموظفون', 'محاضر يومية', 'توقيت الزيارات', 'الإجازات والأذونات', 'تأخيرات الحضور والانصراف']);
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

    await waitFor(() => expect(screen.getByTestId('visit-count-total')).toBeInTheDocument());
    expect(screen.queryByText(/متوسط مدة الزيارة/)).toBeNull();
    expect(screen.queryByText(/المتوسط/)).toBeNull();
    // لا يوجد قسم «ملخص شهري» مستقل بعد الآن، والفلاتر داخل منطقة السجلات
    expect(screen.queryByTestId('visit-month-totals')).toBeNull();
    expect(screen.getByLabelText('شهر الزيارة')).toBeInTheDocument();
    expect(screen.getByLabelText('سنة الزيارة')).toBeInTheDocument();
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

    // ظاهر افتراضيًا مع زر إخفاء مستقل
    const hideBtn = await screen.findByRole('button', { name: 'إخفاء البيانات' });
    expect(screen.getAllByText('شركة النور').length).toBeGreaterThan(0);

    await user.click(hideBtn);
    expect(await screen.findByRole('button', { name: 'إظهار البيانات' })).toBeInTheDocument();
    expect(screen.queryByText('شركة النور')).toBeNull();

    // الإخفاء لا يحذف السجل: بعد الإظهار مجددًا يعود
    await user.click(screen.getByRole('button', { name: 'إظهار البيانات' }));
    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
    expect(await listVisitTimings()).toHaveLength(1);
  });

  it('محاضر يومية: يتبدّل الزر بين إخفاء/إظهار البيانات ويحفظ السجلات', async () => {
    const employee = await seedEmployee();
    const user = userEvent.setup();
    await saveMinute({ employeeId: employee.id, fileReceivedTime: '09:00', responseTime: '09:30', inspectionResult: 'no_notes' });

    window.location.hash = '#/minutes';
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'إخفاء البيانات' }));
    expect(screen.queryByText('9:30 ص')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'إظهار البيانات' }));
    expect(await screen.findByText('9:30 ص')).toBeInTheDocument();
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

  it('توقيت الزيارات: تجتمع فلاتر الموظف والشهر والفرع والسنة والبحث ويُحدَّث العدد', async () => {
    const first = await seedEmployee({ name: 'أحمد سالم', code: 'RO-711' });
    const second = await seedEmployee({ name: 'منى فتحي', code: 'RO-712' });
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
    await saveVisitTiming({
      employeeId: second.id,
      visitDate: '2026-04-05',
      branch: 'فرع طنطا',
      clientName: 'شركة الأمل',
      location: 'طنطا',
      departureTime: '11:00',
      returnTime: '11:20',
    });

    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();
    await waitFor(() => expect(screen.getAllByText('شركة النور').length).toBeGreaterThan(0));
    expect(screen.getByTestId('visit-count-total').textContent).toContain('3');

    // بحث نصي
    await user.type(screen.getByLabelText(/بحث بالموظف أو الفرع أو العميل/), 'الدلتا');
    await waitFor(() => expect(screen.queryByText('شركة النور')).toBeNull());
    expect(screen.getByTestId('visit-count-total').textContent).toContain('1');
    await user.click(screen.getAllByRole('button', { name: /إعادة تعيين/ })[0]);
    await waitFor(() => expect(screen.getByTestId('visit-count-total').textContent).toContain('3'));

    // فرع + شهر + سنة معًا
    await user.selectOptions(screen.getByLabelText('الفرع في الزيارات'), 'فرع طنطا');
    await waitFor(() => expect(screen.queryByText('شركة النور')).toBeNull());
    expect(screen.getByTestId('visit-count-total').textContent).toContain('2');
    await user.selectOptions(screen.getByLabelText('شهر الزيارة'), '3');
    await waitFor(() => expect(screen.getByTestId('visit-count-total').textContent).toContain('1'));
    expect(screen.getAllByText('شركة الدلتا').length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText('سنة الزيارة'), '2026');
    await user.selectOptions(screen.getByLabelText('شهر الزيارة'), '5');
    await waitFor(() => expect(screen.getByText(/لا زيارات مطابقة للفلاتر/)).toBeInTheDocument());

    // فلتر الموظف يعمل مع الباقي، والعدد لكل موظف يظهر داخل السجلات
    await user.click(screen.getAllByRole('button', { name: /إعادة تعيين/ })[0]);
    await user.selectOptions(screen.getByLabelText('الموظف في الزيارات'), second.id);
    await waitFor(() => expect(screen.getByTestId('visit-count-total').textContent).toContain('1'));
    const counts = screen.getByTestId('visit-employee-counts');
    expect(counts.textContent).toContain('منى فتحي');
    expect(counts.textContent).not.toContain('أحمد سالم');
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

describe('عرض الوقت بنظام 12 ساعة', () => {
  it('يعرض توقيتات المحاضر والزيارات بصيغة 12 ساعة (ص/م) مع بقاء التخزين HH:MM', async () => {
    const employee = await seedEmployee({ code: 'RO-801' });
    const minute = await saveMinute({
      employeeId: employee.id,
      fileReceivedTime: '14:00',
      responseTime: '15:30',
      inspectionResult: 'no_notes',
    });
    const visit = await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-04',
      branch: 'فرع المعادي',
      clientName: 'شركة النور',
      location: 'المعادي',
      departureTime: '18:15',
      returnTime: '19:00',
    });

    window.location.hash = '#/minutes';
    renderApp();
    expect(await screen.findByText('2 م')).toBeInTheDocument();
    expect(screen.getByText('3:30 م')).toBeInTheDocument();
    // التخزين لم يتغيّر: صيغة 24 ساعة HH:MM
    expect((await listMinutes()).find((row) => row.id === minute.id)).toMatchObject({
      fileReceivedTime: '14:00',
      responseTime: '15:30',
    });

    window.location.hash = '#/visit-times';
    renderApp();
    expect((await screen.findAllByText('6:15 م')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('7 م').length).toBeGreaterThan(0);
    expect((await listVisitTimings()).find((row) => row.id === visit.id)).toMatchObject({
      departureTime: '18:15',
      returnTime: '19:00',
    });
  });

  it('حقل الوقت في النماذج يعرض ص/م ويُخزّن HH:MM', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة محضر/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة محضر/ }));
    await setTime(user, 'min-received', '14:05');
    await setTime(user, 'min-response', '15:05');
    expect(screen.getByTestId('minute-preview').textContent).toContain('ساعة');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await listMinutes())[0]).toMatchObject({ fileReceivedTime: '14:05', responseTime: '15:05' });
  });
});

describe('كل حقول النماذج اختيارية', () => {
  it('يحفظ محضرًا فارغًا تمامًا بدون أي رسالة إلزام', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة محضر/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة محضر/ }));
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const rows = await listMinutes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: '', fileRequestTime: '', fileReceivedTime: '', responseTime: '', inspectionResult: '' });
    expect(screen.getByText('بيانات غير مكتملة')).toBeInTheDocument();
  });

  it('يحفظ زيارة فارغة تمامًا وتعرض «مدة غير صالحة» دون أي حساب خاطئ', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const rows = await listVisitTimings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: '', visitDate: '', branch: '', departureTime: '', returnTime: '' });
    expect(screen.getByText('مدة غير صالحة')).toBeInTheDocument();
  });
});

describe('إخفاء وإظهار كل القوائم', () => {
  it('«إخفاء الكل» و«إظهار الكل» يعملان، وكل قائمة تُطوى باستقلال', async () => {
    const employee = await seedEmployee({ code: 'RO-811' });
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-06',
      branch: 'فرع المعادي',
      clientName: 'شركة النور',
      location: 'المعادي',
      departureTime: '09:00',
      returnTime: '10:00',
    });
    await saveMinute({ employeeId: employee.id, fileReceivedTime: '09:00', responseTime: '09:40', inspectionResult: 'no_notes' });

    const user = userEvent.setup();
    window.location.hash = '#/employees';
    renderApp();

    // قائمة الموظفين قابلة للطي باستقلال
    await user.click(await screen.findByRole('button', { name: 'إخفاء البيانات' }));
    expect(screen.queryByText('RO-811')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'إظهار البيانات' }));
    expect(await screen.findByText('RO-811')).toBeInTheDocument();

    // إخفاء الكل ثم إظهار الكل من الشريط العلوي
    await user.click(screen.getByRole('button', { name: 'إخفاء الكل' }));
    await waitFor(() => expect(screen.queryByText('RO-811')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'إظهار الكل' }));
    expect(await screen.findByText('RO-811')).toBeInTheDocument();
    expect(await listEmployees()).toHaveLength(1);
  });

  it('ملف الموظف: بيانات الموظف والمحاضر والزيارات لكل منها زر إخفاء مستقل', async () => {
    const employee = await seedEmployee({ code: 'RO-821' });
    await saveMinute({ employeeId: employee.id, fileReceivedTime: '09:00', responseTime: '09:40', inspectionResult: 'no_notes' });
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-07',
      branch: 'فرع طنطا',
      clientName: 'شركة الدلتا',
      location: 'طنطا',
      departureTime: '11:00',
      returnTime: '12:00',
    });

    const user = userEvent.setup();
    window.location.hash = `#/employees/${employee.id}`;
    renderApp();

    const buttons = await screen.findAllByRole('button', { name: 'إخفاء البيانات' });
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    // إخفاء المحاضر فقط لا يخفي الزيارات ولا بيانات الموظف
    const minutesCard = document.getElementById('profile-minutes') as HTMLElement;
    const card = minutesCard.closest('.card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'إخفاء البيانات' }));
    expect(screen.getAllByText('شركة الدلتا').length).toBeGreaterThan(0);
    expect(screen.getByText('كود الموظف')).toBeInTheDocument();
    expect(await listMinutes()).toHaveLength(1);
  });
});

describe('إخفاء القائمة مع بقاء الفلاتر', () => {
  it('توقيت الزيارات: الفلاتر تبقى ظاهرة وتعمل والقائمة مخفية ثم تُعرض النتائج المفلترة', async () => {
    const employee = await seedEmployee({ code: 'RO-901' });
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-02',
      branch: 'فرع المعادي',
      clientName: 'شركة النور',
      location: 'المعادي',
      departureTime: '09:00',
      returnTime: '10:10',
    });
    await saveVisitTiming({
      employeeId: employee.id,
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
    await waitFor(() => expect(screen.getAllByText('شركة النور').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'إخفاء البيانات' }));
    expect(screen.queryByText('شركة النور')).toBeNull();

    // الفلاتر تبقى ظاهرة وقابلة للاستخدام أثناء الإخفاء
    const branchFilter = screen.getByLabelText('الفرع في الزيارات');
    expect(branchFilter).toBeVisible();
    await user.selectOptions(branchFilter, 'فرع طنطا');
    expect(screen.getByLabelText('شهر الزيارة')).toBeVisible();
    expect(screen.getByLabelText('سنة الزيارة')).toBeVisible();
    expect(screen.getByTestId('visit-count-total').textContent).toContain('1');

    // عند الإظهار تُعرض النتائج المفلترة فقط
    await user.click(screen.getByRole('button', { name: 'إظهار البيانات' }));
    expect(screen.getAllByText('شركة الدلتا').length).toBeGreaterThan(0);
    expect(screen.queryByText('شركة النور')).toBeNull();
    expect(await listVisitTimings()).toHaveLength(2);
  });

  it('الموظفون: زر واحد يتبدّل نصّه والفلاتر تبقى متاحة', async () => {
    await seedEmployee({ name: 'أحمد سالم', code: 'RO-911' });
    const user = userEvent.setup();

    window.location.hash = '#/employees';
    renderApp();
    expect((await screen.findAllByText('أحمد سالم')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'إخفاء البيانات' }));
    expect(screen.queryByText('RO-911')).toBeNull();
    expect(screen.getByLabelText('القطاع')).toBeVisible();
    expect(screen.getByLabelText('الفرع')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'إظهار البيانات' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'إظهار البيانات' }));
    expect(await screen.findByText('RO-911')).toBeInTheDocument();
  });

  it('محاضر يومية: زر واحد يتبدّل نصّه والفلاتر تبقى متاحة', async () => {
    const employee = await seedEmployee({ name: 'أحمد سالم', code: 'RO-911' });
    await saveMinute({ employeeId: employee.id, fileReceivedTime: '09:00', responseTime: '09:30', inspectionResult: 'no_notes' });
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: 'إخفاء البيانات' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'إخفاء البيانات' }));
    expect(screen.queryByText('9:30 ص')).toBeNull();
    expect(screen.getByLabelText('الموظف في المحاضر')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('الموظف في المحاضر'), employee.id);
    expect(screen.getByLabelText('شهر المحضر')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'إظهار البيانات' }));
    expect(await screen.findByText('9:30 ص')).toBeInTheDocument();
    expect(await listMinutes()).toHaveLength(1);
  });
});

describe('ملاحظات الزيارة والوقت اليدوي', () => {
  it('تُحفظ ملاحظات الزيارة وتظهر في السجلات وفي ملف الموظف', async () => {
    const employee = await seedEmployee({ code: 'RO-921' });
    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    await pickEmployee(user, 'vt-employee', employee.name);
    await user.type(byId('vt-branch'), 'فرع المعادي');
    await user.type(byId('vt-client'), 'شركة النور');
    await user.type(byId('vt-departure'), '2:30 م');
    await user.tab();
    await user.type(byId('vt-return'), '3:40 م');
    await user.tab();
    await user.type(byId('vt-notes'), 'تمت الزيارة بحضور مدير الفرع');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [saved] = await listVisitTimings();
    expect(saved).toMatchObject({
      departureTime: '14:30',
      returnTime: '15:40',
      notes: 'تمت الزيارة بحضور مدير الفرع',
    });
    expect(screen.getAllByText('تمت الزيارة بحضور مدير الفرع').length).toBeGreaterThan(0);
  });

  it('تظهر ملاحظات الزيارة في ملف الموظف', async () => {
    const employee = await seedEmployee({ code: 'RO-922' });
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-09',
      branch: 'فرع طنطا',
      clientName: 'شركة الدلتا',
      location: 'طنطا',
      departureTime: '14:30',
      returnTime: '15:40',
      notes: 'تمت الزيارة بحضور مدير الفرع',
    });

    window.location.hash = `#/employees/${employee.id}`;
    renderApp();
    expect(await screen.findByText('تمت الزيارة بحضور مدير الفرع')).toBeInTheDocument();
    expect(screen.getAllByText('ساعة و10 دقائق').length).toBeGreaterThan(0);
  });

  it('تعديل المحضر والزيارة يعبئ المنتقي بالقيم المحفوظة ويحدّث الحسابات', async () => {
    const employee = await seedEmployee({ code: 'RO-929' });
    const minute = await saveMinute({
      employeeId: employee.id,
      fileRequestTime: '08:10',
      fileReceivedTime: '14:00',
      responseTime: '15:30',
      inspectionResult: 'no_notes',
    });
    const visit = await saveVisitTiming({
      employeeId: employee.id,
      visitDate: '2026-03-04',
      branch: 'فرع المعادي',
      clientName: 'شركة التحرير',
      location: 'المعادي',
      departureTime: '18:15',
      returnTime: '19:00',
    });
    const user = userEvent.setup();

    window.location.hash = '#/minutes';
    renderApp();
    const minuteRow = await screen.findByText('2 م');
    const minuteTr = minuteRow.closest('tr') as HTMLElement;
    await user.click(within(minuteTr).getByRole('button', { name: 'تعديل' }));
    expect(byId('min-request').value).toBe('8:10 ص');
    expect(byId('min-received').value).toBe('2 م');
    expect(byId('min-response').value).toBe('3:30 م');
    expect(screen.getByTestId('minute-preview').textContent).toContain('ساعة و30 دقيقة');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await listMinutes()).find((row) => row.id === minute.id)).toMatchObject({
      fileReceivedTime: '14:00',
      responseTime: '15:30',
    });

    window.location.hash = '#/visit-times';
    renderApp();
    const visitRow = await screen.findByText('شركة التحرير');
    await user.click(within(visitRow.closest('tr') as HTMLElement).getByRole('button', { name: 'تعديل' }));
    expect(byId('vt-departure').value).toBe('6:15 م');
    expect(byId('vt-return').value).toBe('7 م');
    expect(screen.getByTestId('visit-preview').textContent).toContain('45 دقيقة');
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await listVisitTimings()).find((row) => row.id === visit.id)).toMatchObject({
      departureTime: '18:15',
      returnTime: '19:00',
    });
  });

  it('حقل الوقت يقبل الكتابة اليدوية والاختيار من المنتقي (12 ساعة)', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/minutes';
    renderApp();

    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة محضر/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة محضر/ }));

    // كتابة يدوية
    await user.type(byId('min-received'), '9:15 ص');
    await user.tab();
    expect(byId('min-received').value).toBe('9:15 ص');

    // منتقي الوقت: 3 عصرًا و45 دقيقة
    const responseField = within(byId('min-response').closest('.timefield') as HTMLElement);
    await user.click(responseField.getByRole('button', { name: 'اختيار الوقت من القائمة' }));
    const picker = screen.getByRole('dialog', { name: 'منتقي الوقت' });
    await user.selectOptions(within(picker).getByLabelText('الساعة'), '3');
    await user.selectOptions(within(picker).getByLabelText('الدقيقة'), '45');
    await user.selectOptions(within(picker).getByLabelText('الفترة'), 'م');
    expect(byId('min-response').value).toBe('3:45 م');
    expect(screen.getByTestId('minute-preview').textContent).toContain('6 ساعات و30 دقيقة');

    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await listMinutes())[0]).toMatchObject({ fileReceivedTime: '09:15', responseTime: '15:45' });
  });

  it('لا تظهر كلمة «اختياري» في تسميات النماذج مع بقاء الحقول اختيارية', async () => {
    await seedEmployee();
    const user = userEvent.setup();
    window.location.hash = '#/visit-times';
    renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: /إضافة زيارة/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /إضافة زيارة/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain('اختياري');
    expect(dialog.querySelectorAll('.req')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await listVisitTimings()).toHaveLength(1);
  });
});

describe('استخراج بيانات الموظفين PDF', () => {
  it('يفتح نافذة الاستخراج ويولّد PDF من السجلات الفعلية', async () => {
    const employee = await seedEmployee({ name: 'أبأنوب جرجس', code: 'RO-931' });
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-05`;
    await saveVisitTiming({
      employeeId: employee.id,
      visitDate: iso,
      branch: 'فرع طنطا',
      clientName: 'شركة النور',
      location: 'طنطا',
      departureTime: '09:00',
      returnTime: '09:35',
    });
    await saveMinute({ employeeId: employee.id, fileReceivedTime: '09:00', responseTime: '09:20', inspectionResult: 'no_notes' });

    // توفير الخطوط عبر fetch المحاكى (الملفات موجودة في public/fonts)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const file = url.includes('bold') ? 'public/fonts/times-new-roman-bold.ttf' : 'public/fonts/times-new-roman-regular.ttf';
      const { readFileSync } = await import('node:fs');
      const data = readFileSync(file);
      return new Response(new Uint8Array(data), { status: 200 });
    }) as typeof fetch;

    let captured: Blob | null = null;
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured = blob;
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      const user = userEvent.setup();
      window.location.hash = '#/employees';
      renderApp();

      await user.click(await screen.findByRole('button', { name: 'استخراج بيانات' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('كل الموظفين')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('نوع التقرير')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('الشهر')).toBeInTheDocument();

      await user.selectOptions(within(dialog).getByLabelText('الموظف'), employee.id);
      await user.selectOptions(within(dialog).getByLabelText('نوع التقرير'), 'year');
      expect(within(dialog).queryByLabelText('الشهر')).toBeNull();

      await user.click(within(dialog).getByRole('button', { name: /تصدير PDF/ }));
      await waitFor(() => expect(captured).not.toBeNull());
      expect(captured!.type).toBe('application/pdf');
      expect(captured!.size).toBeGreaterThan(30000);
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreate;
      clickSpy.mockRestore();
    }
  });
});

describe('النسخ الاحتياطي المبسّط', () => {
  it('يبقى التصدير والاستيراد فقط دون أزرار أو أقسام زائدة', async () => {
    await seedEmployee();
    window.location.hash = '#/reports';
    renderApp();

    expect(await screen.findByRole('button', { name: /تصدير نسخة كاملة/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /استيراد نسخة/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /عرض عدد السجلات/ })).toBeNull();
    expect(screen.queryByText('لم يُعرض العدد بعد')).toBeNull();
  });
});
