import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_TITLE, App } from '../src/delinquency/App';
import {
  clearDelinquencyData,
  getClientList,
  listSavedComparisons,
  listSnapshots,
  saveClientList,
  saveSnapshot,
  useDelinquencyDatabase,
} from '../src/delinquency/db/delinquencyDb';
import { BACKUP_APP_ID } from '../src/delinquency/lib/backupFile';
import { SAMPLE_BRANCH_A, SAMPLE_BRANCH_B } from '../src/delinquency/lib/sampleData';
import { parseClientList } from '../src/delinquency/lib/delinquencyMigration';
import { SHEET_COMPARISON, SHEET_MIGRATION, SHEET_SUMMARY } from '../src/delinquency/lib/delinquencyExcel';
import { LIST_A, LIST_B, OCT, SEP, openWorkbook, toInput, type BucketPairs } from './delinquency-helpers';

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2);
  await useDelinquencyDatabase(`test-dq-ui-${suffix}`);
  await clearDelinquencyData();
  window.localStorage.clear();
  window.location.hash = '#/';
});

function renderApp() {
  return render(<App />);
}

async function openPage(hash: string) {
  window.location.hash = hash;
  renderApp();
  await screen.findByRole('heading', { level: 1, name: 'تحليل ترحيل المتأخرات الشهري' });
}

const AUG: BucketPairs = [[100, 400000], [70, 300000], [40, 250000], [25, 180000], [55, 650000]];

async function seedMinya() {
  await saveSnapshot(toInput('فرع المنيا', 2026, 8, AUG));
  await saveSnapshot(toInput('فرع المنيا', 2026, 9, SEP));
  await saveSnapshot(toInput('فرع المنيا', 2026, 10, OCT));
}

/** فرع صغير له قوائم عملاء للشهرين (إجمالياته مطابقة للقوائم) */
async function seedAsyutWithLists() {
  const a = await saveSnapshot(toInput('فرع أسيوط', 2026, 9, [[2, 1600], [1, 2000], [1, 3000], [1, 4000], [1, 5000]]));
  const b = await saveSnapshot(toInput('فرع أسيوط', 2026, 10, [[2, 1800], [1, 1100], [1, 3000], [0, 0], [2, 5100]]));
  await saveClientList(a.id, parseClientList(LIST_A).clients);
  await saveClientList(b.id, parseClientList(LIST_B).clients);
}

const text = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function fill(user: ReturnType<typeof userEvent.setup>, id: string, value: string) {
  const input = byId<HTMLInputElement>(id);
  await user.clear(input);
  if (value) await user.type(input, value);
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** يلتقط الملف الذي ينزّله التطبيق بدل تنزيله فعليًا */
function captureDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:dq-test';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return {
    blobs,
    names,
    restore() {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
      // يبقى الإلغاء دالة فارغة إن لم تكن البيئة توفره: التطبيق يستدعيه بمؤقّت بعد التنزيل
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke ?? (() => undefined) });
      click.mockRestore();
    },
  };
}

describe('التطبيق الافتراضي: نظام تحليل ترحيل المتأخرات', () => {
  it('يفتح مباشرة على النظام الجديد بهويته وشرائحه الخمس — لا على نظام الموظفين', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'تحليل ترحيل المتأخرات الشهري' })).toBeInTheDocument();
    expect(APP_TITLE).toBe('نظام تحليل ترحيل المتأخرات الشهري');
    expect(document.title).toBe(APP_TITLE);
    expect(document.querySelector('[data-app="delinquency-migration-analysis"]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /نظام تحليل ترحيل المتأخرات الشهري — الصفحة الرئيسية/ })).toHaveAttribute('href', '#/');

    const buckets = within(screen.getByRole('list', { name: 'شرائح التأخير الخمس' })).getAllByRole('listitem');
    expect(buckets.map((item) => text(item))).toEqual(['1–30 يوم', '31–60 يوم', '61–90 يوم', '91–120 يوم', 'أكثر من 120 يوم (NPL)']);

    // لا أثر لواجهة نظام الموظفين القديم داخل التطبيق الافتراضي
    expect(screen.queryByRole('navigation', { name: 'التنقل الرئيسي' })).not.toBeInTheDocument();
    expect(document.querySelector('.app-sidebar')).not.toBeInTheDocument();
    for (const oldLabel of ['الموظفون', 'المحاضر اليومية', 'توقيت الزيارات', 'الإجازات والأذونات']) {
      expect(screen.queryByRole('link', { name: oldLabel })).not.toBeInTheDocument();
    }
    // النظام السابق محفوظ في صفحة مستقلة يُشار إليها من التذييل فقط
    expect(screen.getByRole('link', { name: /النظام السابق/ })).toHaveAttribute('href', './employees.html');

    expect(await screen.findByText('لا توجد بيانات شهرية بعد')).toBeInTheDocument();
    expect(within(screen.getByTestId('dq-welcome')).getAllByRole('listitem')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'إدخال بيانات شهر' }));
    await waitFor(() => expect(window.location.hash).toBe('#/entry'));
    await waitFor(() => expect(byId('dq-clients-d1_30')).toBeInTheDocument());
  });

  it('أربعة تبويبات: المقارنة، الإدخال، المحفوظات، البيانات', async () => {
    const user = userEvent.setup();
    await openPage('#/');
    const nav = screen.getByRole('navigation', { name: 'أقسام تحليل المتأخرات' });
    const tabs = within(nav).getAllByRole('link');
    expect(tabs.map((tab) => text(tab))).toEqual(['لوحة المقارنة', 'إدخال البيانات الشهرية', 'المقارنات المحفوظة', 'البيانات والنسخ الاحتياطي']);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual(['#/', '#/entry', '#/saved', '#/data']);
    expect(tabs[0]).toHaveAttribute('aria-current', 'page');

    await user.click(tabs[3]);
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'البيانات والنسخ الاحتياطي' })).toHaveAttribute('aria-current', 'page'));
    expect(await screen.findByTestId('dq-data-stats')).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'المقارنات المحفوظة' }));
    expect(await screen.findByText('لا توجد مقارنات محفوظة')).toBeInTheDocument();
  });

  it('الروابط القديمة (#/delinquency/…) ومسارات نظام الموظفين تفتح النظام الجديد', async () => {
    await openPage('#/delinquency/entry'); // رابط قديم
    await waitFor(() => expect(byId('dq-clients-d1_30')).toBeInTheDocument());
    cleanup();

    await openPage('#/employees'); // مسار من النظام السابق
    expect(await screen.findByText('لا توجد بيانات شهرية بعد')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'أقسام تحليل المتأخرات' })).getByRole('link', { name: 'لوحة المقارنة' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('البيانات التجريبية: تُحمَّل بطلب صريح، تُعلَّم بوضوح، وتُحذف وحدها', async () => {
    const user = userEvent.setup();
    await openPage('#/');
    await user.click(await screen.findByRole('button', { name: 'جرّب ببيانات تجريبية' }));

    const dashboard = await screen.findByTestId('dq-dashboard');
    expect(text(dashboard)).not.toMatch(/NaN|Infinity|undefined/);
    expect(text(screen.getByTestId('dq-sample-banner'))).toContain('بيانات تجريبية (5 أشهر):');
    const branchSelect = byId<HTMLSelectElement>('dq-select-branch');
    expect(Array.from(branchSelect.options).map((option) => option.value)).toEqual([SAMPLE_BRANCH_A, SAMPLE_BRANCH_B]);
    // الفرع (ب) له قوائم عملاء ⇒ مصفوفة ترحيل فعلية
    expect(branchSelect.value).toBe(SAMPLE_BRANCH_B);
    expect(screen.getByTestId('dq-matrix-actual')).toBeInTheDocument();
    await user.selectOptions(branchSelect, SAMPLE_BRANCH_A);
    expect(await screen.findByTestId('dq-matrix-aggregate')).toBeInTheDocument();

    await user.click(within(screen.getByTestId('dq-sample-banner')).getByRole('button', { name: 'حذف البيانات التجريبية' }));
    expect(await screen.findByText('لا توجد بيانات شهرية بعد')).toBeInTheDocument();
    expect(await listSnapshots()).toEqual([]);
  });
});

describe('البيانات والنسخ الاحتياطي', () => {
  const statsText = () => text(screen.getByTestId('dq-data-stats'));

  it('ينزّل نسخة احتياطية ثم يستعيدها بعد حذف كل البيانات', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage('#/data');
      await screen.findByTestId('dq-data-stats');
      expect(statsText()).toBe('أشهر مُدخلة5فروع2قوائم عملاء2مقارنات محفوظة0');

      await user.click(screen.getByRole('button', { name: 'تنزيل نسخة احتياطية' }));
      expect(await screen.findByText('تم تنزيل النسخة الاحتياطية.')).toBeInTheDocument();
      expect(downloads.names[0]).toMatch(/^نسخة-احتياطية-تحليل-المتأخرات_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
      const backupText = new TextDecoder().decode(await readBlob(downloads.blobs[0]));
      const backup = JSON.parse(backupText);
      expect(backup.app).toBe(BACKUP_APP_ID);
      expect(backup.counts).toEqual({ months: 5, clientLists: 2, comparisons: 0 });

      // حذف كل البيانات يتطلب تأكيدًا
      await user.click(screen.getByRole('button', { name: 'حذف كل البيانات…' }));
      const confirm = await screen.findByRole('dialog', { name: 'حذف كل بيانات النظام' });
      await user.click(within(confirm).getByRole('button', { name: 'إلغاء' }));
      expect(await listSnapshots()).toHaveLength(5);
      await user.click(screen.getByRole('button', { name: 'حذف كل البيانات…' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'نعم، احذف كل البيانات' }));
      await waitFor(async () => expect(await listSnapshots()).toEqual([]));
      await waitFor(() => expect(screen.getByRole('button', { name: 'تنزيل نسخة احتياطية' })).toBeDisabled());

      // ملف غريب يُرفض برسالة ولا يغيّر شيئًا
      const fileInput = byId<HTMLInputElement>('dq-restore-file');
      await user.upload(fileInput, new File([JSON.stringify({ employees: [] })], 'other.json', { type: 'application/json' }));
      expect(await screen.findByText('هذا الملف ليس نسخة احتياطية لنظام تحليل ترحيل المتأخرات.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // الاستعادة: فحص ثم تأكيد
      await user.upload(fileInput, new File([backupText], 'backup.json', { type: 'application/json' }));
      const restore = await screen.findByRole('dialog', { name: 'تأكيد دمج البيانات' });
      expect(text(restore)).toContain('محتوى الملف: 5 أشهر، قائمتا عملاء، لا مقارنات محفوظة');
      expect(await listSnapshots()).toEqual([]);
      await user.click(within(restore).getByRole('button', { name: 'دمج مع البيانات الحالية' }));
      await waitFor(async () => expect(await listSnapshots()).toHaveLength(5));
      expect((await getClientList('2026-10|فرع أسيوط'))?.clients).toHaveLength(6);
      await waitFor(() => expect(screen.queryByText('هذا الملف ليس نسخة احتياطية لنظام تحليل ترحيل المتأخرات.')).not.toBeInTheDocument());
    } finally {
      downloads.restore();
    }
  });

  it('وضع الاستبدال يحذف ما ليس في الملف بعد تأكيد صريح', async () => {
    await seedMinya();
    const user = userEvent.setup();
    await openPage('#/data');
    await screen.findByTestId('dq-data-stats');
    const file = {
      app: BACKUP_APP_ID,
      formatVersion: 1,
      exportedAt: '2026-11-01T08:00:00.000Z',
      organization: '',
      data: { months: [(await listSnapshots())[2]], clientLists: [], comparisons: [] },
    };
    await user.selectOptions(byId('dq-restore-mode'), 'replace');
    await user.upload(byId<HTMLInputElement>('dq-restore-file'), new File([JSON.stringify(file)], 'one-month.json', { type: 'application/json' }));
    const dialog = await screen.findByRole('dialog', { name: 'تأكيد استبدال البيانات' });
    expect(text(dialog)).toContain('سيُحذف كل ما هو مخزَّن حاليًا');
    await user.click(within(dialog).getByRole('button', { name: 'استبدال البيانات الحالية' }));
    await waitFor(async () => expect((await listSnapshots()).map((row) => row.id)).toEqual(['2026-10|فرع المنيا']));
  });

  it('اسم الجهة يُحفظ ويظهر في رأس الصفحة ويبقى بعد إعادة الفتح', async () => {
    const user = userEvent.setup();
    await openPage('#/data');
    await screen.findByTestId('dq-data-stats');
    const save = screen.getByRole('button', { name: 'حفظ الاسم' });
    expect(save).toBeDisabled();
    await user.type(byId('dq-organization'), 'إدارة المخاطر — قطاع الصعيد');
    await user.click(save);
    expect(await screen.findByText('تم حفظ اسم الجهة.')).toBeInTheDocument();
    const brand = () => text(screen.getByRole('link', { name: /الصفحة الرئيسية/ }));
    expect(brand()).toContain('إدارة المخاطر — قطاع الصعيد');

    cleanup();
    await openPage('#/');
    expect(brand()).toContain('إدارة المخاطر — قطاع الصعيد');
  });
});

describe('حالات اللوحة الخاصة', () => {
  it('شهر واحد فقط: يطلب إدخال شهر آخر', async () => {
    await saveSnapshot(toInput('', 2026, 9, SEP));
    await openPage('#/');
    expect(await screen.findByText('يوجد شهر واحد فقط لـ الفرع الرئيسي')).toBeInTheDocument();
    expect(screen.queryByTestId('dq-dashboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ المقارنة' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'تصدير Excel' })).toBeDisabled();
  });
});

describe('إدخال البيانات الشهرية', () => {
  it('خمس شرائح، لكل شريحة حقلان فقط، والإجمالي يتحدث أثناء الكتابة', async () => {
    const user = userEvent.setup();
    await openPage('#/entry');
    await waitFor(() => expect(byId('dq-clients-d1_30')).toBeInTheDocument());

    const table = document.querySelector('.dq-entry-table') as HTMLElement;
    const bodyRows = table.querySelectorAll('tbody tr');
    expect(Array.from(bodyRows).map((row) => text(row.querySelector('th')))).toEqual([
      '1–30 يوم',
      '31–60 يوم',
      '61–90 يوم',
      '91–120 يوم',
      'أكثر من 120 يوم (NPL)',
    ]);
    expect(table.querySelectorAll('tbody input')).toHaveLength(10);

    await fill(user, 'dq-clients-d1_30', '120');
    await fill(user, 'dq-amount-d1_30', '450,000.50');
    await fill(user, 'dq-clients-npl', '٦٠');
    await fill(user, 'dq-amount-npl', '720000');
    expect(text(screen.getByTestId('dq-entry-total-clients'))).toBe('180');
    expect(text(screen.getByTestId('dq-entry-total-amount'))).toBe('1,170,000.50');
  });

  it('يحفظ الشهر ويظهر في جدول الشهور ثم يجهّز الشهر التالي لنفس الفرع', async () => {
    const user = userEvent.setup();
    await openPage('#/entry');
    await waitFor(() => expect(byId('dq-month')).toBeInTheDocument());

    await user.selectOptions(byId('dq-month'), '9');
    await fill(user, 'dq-year', '2026');
    await fill(user, 'dq-branch', 'فرع المنيا');
    const ids = ['d1_30', 'd31_60', 'd61_90', 'd91_120', 'npl'];
    for (let index = 0; index < ids.length; index += 1) {
      await fill(user, `dq-clients-${ids[index]}`, String(SEP[index][0]));
      await fill(user, `dq-amount-${ids[index]}`, String(SEP[index][1]));
    }
    await fill(user, 'dq-notes', 'إقفال سبتمبر');
    await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));

    expect(await screen.findByText('تم حفظ بيانات سبتمبر 2026 — فرع المنيا.')).toBeInTheDocument();
    const stored = await listSnapshots();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: '2026-09|فرع المنيا', notes: 'إقفال سبتمبر' });
    expect(stored[0].buckets.d1_30).toEqual({ clients: 120, amount: 450000.5 });
    expect(stored[0].buckets.npl).toEqual({ clients: 60, amount: 720000 });

    const row = within(screen.getByTestId('dq-months-table')).getByRole('row', { name: /سبتمبر 2026/ });
    expect(text(row)).toContain('فرع المنيا');
    expect(text(row)).toContain('335');
    expect(text(row)).toContain('2,050,000.75');

    // النموذج جاهز للشهر التالي
    expect(byId<HTMLSelectElement>('dq-month').value).toBe('10');
    expect(byId<HTMLInputElement>('dq-branch').value).toBe('فرع المنيا');
    expect(byId<HTMLInputElement>('dq-clients-d1_30').value).toBe('');
  });

  it('يرفض القيم غير الصالحة ويعرض الخطأ بجوار الحقل دون حفظ', async () => {
    const user = userEvent.setup();
    await openPage('#/entry');
    await waitFor(() => expect(byId('dq-clients-d1_30')).toBeInTheDocument());
    await fill(user, 'dq-clients-d1_30', '-3');
    await fill(user, 'dq-amount-d31_60', 'abc');
    await fill(user, 'dq-clients-d61_90', '2.5');
    await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));

    expect((await screen.findAllByText('عدد العملاء لا يمكن أن يكون سالبًا.')).length).toBeGreaterThan(0);
    expect(screen.getByText('المبلغ يجب أن يكون رقمًا.')).toBeInTheDocument();
    expect(screen.getByText('عدد العملاء يجب أن يكون عددًا صحيحًا.')).toBeInTheDocument();
    expect(await listSnapshots()).toEqual([]);
  });

  it('لا يكتب فوق شهر محفوظ: يعرض تنبيهًا ويحمّل السجل للتعديل', async () => {
    await saveSnapshot(toInput('', 2026, 9, SEP));
    const user = userEvent.setup();
    await openPage('#/entry');
    await waitFor(() => expect(byId('dq-month')).toBeInTheDocument());
    await user.selectOptions(byId('dq-month'), '9');
    await fill(user, 'dq-year', '2026');
    await fill(user, 'dq-clients-d1_30', '1');
    await fill(user, 'dq-amount-d1_30', '1');

    expect(await screen.findByText(/توجد بيانات محفوظة بالفعل لشهر سبتمبر 2026/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));
    await waitFor(async () => expect((await listSnapshots())[0].buckets.d1_30.clients).toBe(120));

    await user.click(screen.getByRole('button', { name: 'تحميل البيانات المحفوظة للتعديل' }));
    await waitFor(() => expect(byId<HTMLInputElement>('dq-clients-d1_30').value).toBe('120'));
    expect(screen.getByRole('button', { name: 'حفظ التعديلات' })).toBeInTheDocument();

    await fill(user, 'dq-clients-d1_30', '125');
    await user.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(async () => expect((await listSnapshots())[0].buckets.d1_30.clients).toBe(125));
    expect(await listSnapshots()).toHaveLength(1);
  });

  it('قائمة العملاء الاختيارية: أخطاؤها تمنع الحفظ، وتعبئة الشرائح منها تعمل', async () => {
    const user = userEvent.setup();
    await openPage('#/entry');
    await waitFor(() => expect(byId('dq-month')).toBeInTheDocument());
    await user.selectOptions(byId('dq-month'), '9');
    await fill(user, 'dq-year', '2026');

    await user.click(screen.getByText(/قائمة العملاء \(اختياري\)/));
    const area = byId<HTMLTextAreaElement>('dq-clients-text');
    await user.click(area);
    await user.paste('C1\t10\t1000\nC1\t40\t2000');
    expect(await screen.findByText(/رقم العميل C1 مكرر/)).toBeInTheDocument();
    await fill(user, 'dq-clients-d1_30', '1');
    await fill(user, 'dq-amount-d1_30', '1000');
    await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));
    expect((await screen.findAllByText(/قائمة العملاء بها أخطاء/)).length).toBeGreaterThan(0);
    expect(await listSnapshots()).toEqual([]);

    await user.clear(area);
    await user.click(area);
    await user.paste(LIST_A);
    expect(await screen.findByText(/تمت قراءة 6/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تعبئة الشرائح من القائمة' }));
    expect(byId<HTMLInputElement>('dq-clients-d1_30').value).toBe('2');
    expect(byId<HTMLInputElement>('dq-amount-d1_30').value).toBe('1600');
    expect(byId<HTMLInputElement>('dq-clients-npl').value).toBe('1');
    expect(text(screen.getByTestId('dq-entry-total-clients'))).toBe('6');
    expect(text(screen.getByTestId('dq-entry-total-amount'))).toBe('15,600.00');

    await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));
    await waitFor(async () => expect(await listSnapshots()).toHaveLength(1));
    const list = await getClientList('2026-09|');
    expect(list?.clients).toHaveLength(6);
  });

  it('حذف شهر يتطلب تأكيدًا', async () => {
    await saveSnapshot(toInput('', 2026, 9, SEP));
    await saveSnapshot(toInput('', 2026, 10, OCT));
    const user = userEvent.setup();
    await openPage('#/entry');
    await user.click(await screen.findByRole('button', { name: 'حذف سبتمبر 2026 — الفرع الرئيسي' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('المقارنات المحفوظة سابقًا لا تتأثر');
    expect(await listSnapshots()).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'حذف' }));
    await waitFor(async () => expect((await listSnapshots()).map((row) => row.id)).toEqual(['2026-10|']));
  });
});

describe('لوحة المقارنة', () => {
  it('تقارن آخر شهرين تلقائيًا وتعرض المؤشرات والجدول وأداء الفرع', async () => {
    await seedMinya();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    expect(byId<HTMLSelectElement>('dq-select-a').value).toBe('2026-09|فرع المنيا');
    expect(byId<HTMLSelectElement>('dq-select-b').value).toBe('2026-10|فرع المنيا');
    expect(byId('dq-select-branch')).toBeNull();

    expect(text(screen.getByTestId('dq-headline'))).toContain('زيادة صافية في المتأخرات بمقدار 168,250.60');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('2,218,251.35');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('+168,250.60');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('+8.2%');
    expect(text(screen.getByTestId('dq-kpi-clients'))).toContain('356');
    expect(text(screen.getByTestId('dq-kpi-clients'))).toContain('+21');
    expect(text(screen.getByTestId('dq-kpi-npl'))).toContain('38.1%');
    expect(text(screen.getByTestId('dq-kpi-status'))).toContain('زيادة صافية');

    const table = screen.getByTestId('dq-comparison-table');
    const row = (bucket: string) => text(table.querySelector(`[data-bucket="${bucket}"]`));
    expect(row('d1_30')).toContain('120');
    expect(row('d1_30')).toContain('135');
    expect(row('d1_30')).toContain('+15');
    expect(row('d1_30')).toContain('+12.5%');
    expect(row('d1_30')).toContain('450,000.50');
    expect(row('d1_30')).toContain('498,500.75');
    expect(row('d1_30')).toContain('+48,500.25');
    expect(row('d1_30')).toContain('+10.8%');
    expect(row('d31_60')).toContain('−10');
    expect(row('d31_60')).toContain('−39,000.00');
    expect(row('d31_60')).toContain('−10.3%');
    expect(row('d31_60')).toContain('الأفضل');
    expect(row('npl')).toContain('+125,250.10');
    expect(row('npl')).toContain('+17.4%');
    expect(row('npl')).toContain('الأسوأ');
    const total = text(screen.getByTestId('dq-total-row'));
    for (const value of ['335', '356', '+21', '+6.3%', '2,050,000.75', '2,218,251.35', '+168,250.60', '+8.2%']) expect(total).toContain(value);

    expect(text(screen.getByTestId('dq-perf-reduction'))).toBe('51,000.00');
    expect(text(screen.getByTestId('dq-perf-increase'))).toBe('219,250.60');
    expect(text(screen.getByTestId('dq-perf-net'))).toContain('+168,250.60');
    expect(text(screen.getByTestId('dq-best'))).toContain('31–60 يوم');
    expect(text(screen.getByTestId('dq-worst'))).toContain('أكثر من 120 يوم (NPL)');

    // الرسوم البيانية موجودة (بدائل نصية)
    expect(screen.getByRole('img', { name: /مبلغ المتأخرات حسب الشريحة/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /عدد العملاء المتأخرين حسب الشريحة/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /صافي التغير في مبلغ المتأخرات/ })).toBeInTheDocument();
  });

  it('لا تدّعي تحصيلًا ولا تختلق ترحيلًا من البيانات الإجمالية', async () => {
    await seedMinya();
    await openPage('#/');
    const dashboard = await screen.findByTestId('dq-dashboard');

    expect(screen.queryByTestId('dq-matrix-actual')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dq-flowstats')).not.toBeInTheDocument();
    const frame = screen.getByTestId('dq-matrix-aggregate');
    const unknownCells = Array.from(frame.querySelectorAll('td')).filter((cell) => text(cell) === '؟');
    expect(unknownCells).toHaveLength(25);
    // المجاميع الطرفية المعلومة فقط
    expect(text(frame)).toContain('120');
    expect(text(frame)).toContain('135');
    expect(text(dashboard)).toContain('صافي تغير فقط');
    expect(text(dashboard)).toContain('لا تُعرض أي أرقام ترحيل مُقدَّرة');

    const body = text(dashboard);
    expect(body).toContain('لا يُصنَّف «تحصيلًا مؤكدًا»');
    for (const sentence of body.split(/[.؛]/).filter((part) => part.includes('تحصيل'))) {
      expect(sentence).toMatch(/لا يُعد تحصيلًا|لا يُصنَّف «تحصيلًا|ليس حركة عملاء ولا تحصيلًا|يتطلب سجلات تحصيل|دون سجلات تحصيل/);
    }
  });

  it('تغيير الشهرين والتبديل بينهما يعيد الحساب', async () => {
    await seedMinya();
    const user = userEvent.setup();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    await user.selectOptions(byId('dq-select-a'), '2026-08|فرع المنيا');
    // أغسطس 1,780,000 ← أكتوبر 2,218,251.35
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('+438,251.35'));
    expect(text(screen.getByTestId('dq-total-row'))).toContain('1,780,000.00');

    await user.click(screen.getByRole('button', { name: 'تبديل الشهرين' }));
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('−438,251.35'));
    expect(byId<HTMLSelectElement>('dq-select-a').value).toBe('2026-10|فرع المنيا');
    expect(screen.getByText('شهر الأساس أحدث من شهر المقارنة')).toBeInTheDocument();
    expect(text(screen.getByTestId('dq-kpi-status'))).toContain('انخفاض صافٍ');

    await user.selectOptions(byId('dq-select-b'), '2026-10|فرع المنيا');
    expect(await screen.findByText('اختر شهرين مختلفين للمقارنة.')).toBeInTheDocument();
    expect(screen.queryByTestId('dq-dashboard')).not.toBeInTheDocument();
  });

  it('مع قوائم العملاء تظهر مصفوفة الترحيل الفعلية', async () => {
    await seedAsyutWithLists();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    expect(screen.queryByTestId('dq-matrix-aggregate')).not.toBeInTheDocument();
    const matrix = screen.getByTestId('dq-matrix-actual');
    const cell = (key: string) => text(matrix.querySelector(`[data-cell="${key}"]`));
    expect(cell('d1_30>d31_60')).toContain('1');
    expect(cell('d1_30>d31_60')).toContain('1,100.00');
    expect(cell('d31_60>d1_30')).toContain('1,500.00');
    expect(cell('d61_90>d61_90')).toContain('3,000.00');
    expect(cell('d91_120>npl')).toContain('4,200.00');
    expect(cell('npl>exit')).toContain('5,000.00');
    expect(cell('new>npl')).toContain('900.00');
    expect(cell('d1_30>d1_30')).toBe('0');

    const stats = Array.from(screen.getByTestId('dq-flowstats').querySelectorAll('.dq-flowstat')).map((card) => [
      text(card.querySelector(':scope > span')),
      text(card.querySelector(':scope > strong')),
    ]);
    expect(stats).toEqual([
      ['انتقلوا لشريحة أسوأ', '2'],
      ['بقوا في نفس الشريحة', '1'],
      ['تحسنوا لشريحة أحدث', '1'],
      ['خرجوا من قائمة المتأخرات', '2'],
      ['دخول جديد للقائمة', '2'],
    ]);
    expect(text(screen.getByTestId('dq-flowstats'))).toContain('السبب غير محدد');
    expect(screen.getByText('ترحيل فعلي (بأرقام العملاء)')).toBeInTheDocument();
    // القوائم مطابقة للإجماليات المدخلة ← لا تحذير عدم تطابق
    expect(screen.queryByText(/لا تطابق الإجماليات المدخلة/)).not.toBeInTheDocument();
  });

  it('عدة فروع: يظهر اختيار الفرع وجدول أداء الفروع', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    const user = userEvent.setup();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    const branchSelect = byId<HTMLSelectElement>('dq-select-branch');
    expect(Array.from(branchSelect.options).map((option) => option.value).sort()).toEqual(['فرع أسيوط', 'فرع المنيا'].sort());

    await user.selectOptions(branchSelect, 'فرع المنيا');
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60'));
    const branches = screen.getByTestId('dq-branches-table');
    const rows = Array.from(branches.querySelectorAll('tbody tr')).map((row) => text(row));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('فرع أسيوط');
    expect(rows[0]).toContain('−4,600.00');
    expect(rows[1]).toContain('فرع المنيا');
    expect(rows[1]).toContain('+168,250.60');

    await user.selectOptions(branchSelect, 'فرع أسيوط');
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('−4,600.00'));
    expect(screen.getByTestId('dq-matrix-actual')).toBeInTheDocument();
  });

  it('أساس صفري: تظهر «جديد» بدل نسبة غير معرّفة', async () => {
    await saveSnapshot(toInput('', 2026, 1, [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]));
    await saveSnapshot(toInput('', 2026, 2, [[5, 1000], [0, 0], [0, 0], [0, 0], [2, 500]]));
    await openPage('#/');
    const dashboard = await screen.findByTestId('dq-dashboard');
    expect(text(screen.getByTestId('dq-total-row'))).toContain('+1,500.00');
    expect(text(screen.getByTestId('dq-total-row'))).toContain('جديد');
    expect(text(dashboard)).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('تصدير Excel من الواجهة', () => {
  it('ينزّل مصنفًا صالحًا يحتوي كل الحسابات', async () => {
    await seedMinya();
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage('#/');
      await screen.findByTestId('dq-dashboard');
      await user.click(screen.getByRole('button', { name: 'تصدير Excel' }));
      expect(await screen.findByText('تم تنزيل ملف Excel بكل الحسابات.')).toBeInTheDocument();

      expect(downloads.names).toEqual(['delinquency-2026-09-vs-2026-10-فرع-المنيا.xlsx']);
      expect(downloads.blobs[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const workbook = openWorkbook(await readBlob(downloads.blobs[0]));
      expect(workbook.order.map((sheet) => sheet.name)).toContain(SHEET_SUMMARY);
      const comparison = workbook.sheets.get(SHEET_COMPARISON)!;
      expect(comparison.get('F10')?.value).toBe(2050000.75);
      expect(comparison.get('G10')?.value).toBe(2218251.35);
      expect(comparison.get('H10')?.value).toBe(168250.6);
      const migration = Array.from(workbook.sheets.get(SHEET_MIGRATION)!.values()).map((cell) => cell.value);
      expect(migration.filter((value) => value === 'غير متاح')).toHaveLength(25);
    } finally {
      downloads.restore();
    }
  });
});

describe('حفظ المقارنات والرجوع إليها', () => {
  it('يحفظ المقارنة ويفتحها لاحقًا كنسخة مجمّدة حتى بعد تعديل بيانات الشهر', async () => {
    await seedMinya();
    const user = userEvent.setup();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    await user.click(screen.getByRole('button', { name: 'حفظ المقارنة' }));
    const dialog = await screen.findByRole('dialog');
    const title = byId<HTMLInputElement>('dq-save-title');
    expect(title.value).toBe('مقارنة سبتمبر 2026 مع أكتوبر 2026 — فرع المنيا');
    await user.clear(title);
    await user.type(title, 'مراجعة أكتوبر');
    await user.type(byId('dq-save-note'), 'للعرض على الإدارة');
    await user.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(async () => expect(await listSavedComparisons()).toHaveLength(1));

    // تعديل بيانات أكتوبر بعد الحفظ
    await saveSnapshot(toInput('فرع المنيا', 2026, 10, SEP));

    await user.click(within(screen.getByRole('navigation', { name: 'أقسام تحليل المتأخرات' })).getByRole('link', { name: /المقارنات المحفوظة/ }));
    const saved = await screen.findByTestId('dq-saved-table');
    expect(text(saved)).toContain('مراجعة أكتوبر');
    expect(text(saved)).toContain('للعرض على الإدارة');
    expect(text(saved)).toContain('+168,250.60');
    expect(text(saved)).toContain('صافي تغير');

    await user.click(within(saved).getByRole('button', { name: 'فتح' }));
    await screen.findByTestId('dq-dashboard');
    expect(window.location.hash).toMatch(/^#\/saved\/.+/);
    expect(screen.getByRole('heading', { level: 2, name: 'مراجعة أكتوبر' })).toBeInTheDocument();
    expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('2,218,251.35');
  });

  it('يعرض تنبيهًا عند اختلاف البيانات الحالية عن النسخة المحفوظة ويتيح حذفها', async () => {
    await seedMinya();
    const user = userEvent.setup();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');
    await user.click(screen.getByRole('button', { name: 'حفظ المقارنة' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'حفظ' }));
    await waitFor(async () => expect(await listSavedComparisons()).toHaveLength(1));
    const [saved] = await listSavedComparisons();
    await saveSnapshot(toInput('فرع المنيا', 2026, 10, SEP));
    cleanup();

    await openPage(`#/saved/${saved.id}`);
    await screen.findByTestId('dq-dashboard');
    expect(screen.getByText(/عُدّلت بعد حفظ هذه المقارنة/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'عرض البيانات الحالية' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('0.00'));
    expect(text(screen.getByTestId('dq-kpi-status'))).toContain('لا تغير');

    window.location.hash = `#/saved/${saved.id}`;
    await user.click(await screen.findByRole('button', { name: 'حذف المقارنة' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'حذف' }));
    await waitFor(async () => expect(await listSavedComparisons()).toEqual([]));
    await waitFor(() => expect(window.location.hash).toBe('#/saved'));
    expect(await screen.findByText('لا توجد مقارنات محفوظة')).toBeInTheDocument();
    // بيانات الشهور لم تُمس
    expect(await listSnapshots()).toHaveLength(3);
  });

  it('رابط مقارنة محذوفة يعرض رسالة واضحة', async () => {
    await openPage('#/saved/dqc_missing');
    expect(await screen.findByText('لم يتم العثور على هذه المقارنة')).toBeInTheDocument();
  });
});
