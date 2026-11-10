import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_TITLE, App } from '../src/delinquency/App';
import {
  clearDelinquencyData,
  exportDelinquencyData,
  getClientList,
  listSavedComparisons,
  listSnapshots,
  saveClientList,
  saveComparison,
  saveSnapshot,
} from '../src/delinquency/db/delinquencyDb';
import { BACKUP_APP_ID } from '../src/delinquency/lib/backupFile';
import { REPORT_HEADERS, SHEET_REPORT } from '../src/delinquency/lib/delinquencyExcel';
import { colName } from '../src/delinquency/lib/xlsx';
import { LIST_A, LIST_B, OCT, SEP, clientsOf, openWorkbook, toInput, type BucketPairs } from './delinquency-helpers';

beforeEach(async () => {
  await clearDelinquencyData();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = '#/';
});

function renderApp() {
  return render(<App />);
}

async function openPage(hash: string) {
  window.location.hash = hash;
  renderApp();
  await screen.findByRole('heading', { level: 1, name: APP_TITLE });
}

const AUG: BucketPairs = [[100, 400000], [70, 300000], [40, 250000], [25, 180000], [55, 650000]];

async function seedMinya() {
  await saveSnapshot(toInput('فرع المنيا', 2026, 8, AUG));
  await saveSnapshot(toInput('فرع المنيا', 2026, 9, SEP));
  await saveSnapshot(toInput('فرع المنيا', 2026, 10, OCT));
}

const ASYUT_SEP: BucketPairs = [[2, 1600], [1, 2000], [1, 3000], [1, 4000], [1, 5000]];
const ASYUT_OCT: BucketPairs = [[2, 1800], [1, 1100], [1, 3000], [0, 0], [2, 5100]];

/** فرع ثانٍ صغير، ومعه قوائم عملاء محفوظة من إصدار سابق (يجب ألا تضيع) */
async function seedAsyutWithLists() {
  const a = await saveSnapshot(toInput('فرع أسيوط', 2026, 9, ASYUT_SEP));
  const b = await saveSnapshot(toInput('فرع أسيوط', 2026, 10, ASYUT_OCT));
  await saveClientList(a.id, clientsOf(LIST_A));
  await saveClientList(b.id, clientsOf(LIST_B));
}

const TAB_LABELS = ['لوحة المقارنة', 'إدخال البيانات الشهرية', 'المقارنات المحفوظة', 'النسخ الاحتياطي'];
const tabsNav = () => screen.getByRole('navigation', { name: 'أقسام النظام' });

/** نصوص وعناصر أُزيلت من الواجهة ويجب ألا تعود */
const REMOVED_TEXT = /الملخص التنفيذي|مصفوفة الترحيل|على هذا الجهاز|بيانات تجريبية|قائمة العملاء|تحصيل|ترحيل فعلي/;

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

describe('التطبيق الافتراضي', () => {
  it('يفتح مباشرة على نظام المتأخرات بواجهة مبسطة — لا على نظام الموظفين', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: APP_TITLE })).toBeInTheDocument();
    expect(APP_TITLE).toBe('نظام تحليل ترحيل المتأخرات الشهري');
    expect(document.title).toBe(APP_TITLE);
    expect(document.querySelector('[data-app="delinquency-migration-analysis"]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /الصفحة الرئيسية/ })).toHaveAttribute('href', '#/');

    // لا أثر لواجهة نظام الموظفين القديم
    expect(document.querySelector('.app-sidebar')).not.toBeInTheDocument();
    for (const oldLabel of ['الموظفون', 'المحاضر اليومية', 'توقيت الزيارات', 'الإجازات والأذونات']) {
      expect(screen.queryByRole('link', { name: oldLabel })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: /النظام السابق|مسؤولي المخاطر/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="employees"]')).not.toBeInTheDocument();
    expect(document.querySelector('footer')).not.toBeInTheDocument();

    // حالة فارغة بسيطة: عنوان وزر واحد، بلا شروحات أو بيانات تجريبية
    expect(await screen.findByText('لا توجد بيانات شهرية بعد')).toBeInTheDocument();
    expect(screen.queryByTestId('dq-welcome')).not.toBeInTheDocument();
    expect(text(document.body)).not.toMatch(REMOVED_TEXT);
    expect(document.querySelectorAll('.dq-callout')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'إدخال بيانات شهر' }));
    await waitFor(() => expect(window.location.hash).toBe('#/entry'));
    await waitFor(() => expect(byId('dq-clients-d1_30')).toBeInTheDocument());
  });

  it('أربعة تبويبات فقط: المقارنة، الإدخال، المحفوظات، النسخ الاحتياطي', async () => {
    const user = userEvent.setup();
    await openPage('#/');
    const tabs = within(tabsNav()).getAllByRole('link');
    expect(tabs.map((tab) => text(tab))).toEqual(TAB_LABELS);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual(['#/', '#/entry', '#/saved', '#/data']);
    expect(tabs[0]).toHaveAttribute('aria-current', 'page');

    await user.click(tabs[3]);
    await waitFor(() => expect(within(tabsNav()).getByRole('link', { name: 'النسخ الاحتياطي' })).toHaveAttribute('aria-current', 'page'));
    expect(await screen.findByRole('button', { name: 'تصدير Excel' })).toBeInTheDocument();
    await user.click(within(tabsNav()).getByRole('link', { name: 'المقارنات المحفوظة' }));
    expect(await screen.findByText('لا توجد مقارنات محفوظة')).toBeInTheDocument();
  });

  it('الروابط القديمة (#/delinquency/…) ومسارات النظام السابق تفتح النظام الجديد', async () => {
    await openPage('#/delinquency/entry');
    await waitFor(() => expect(byId('dq-clients-d1_30')).toBeInTheDocument());
    cleanup();

    await openPage('#/employees');
    expect(await screen.findByText('لا توجد بيانات شهرية بعد')).toBeInTheDocument();
    expect(within(tabsNav()).getByRole('link', { name: 'لوحة المقارنة' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('صفحة النسخ الاحتياطي — ثلاثة أزرار فقط', () => {
  const BUTTONS = ['تصدير Excel', 'تنزيل نسخة احتياطية (JSON)', 'رفع نسخة احتياطية (JSON)'];
  const backupSection = async () => (await screen.findByRole('region', { name: 'النسخ الاحتياطي' })) as HTMLElement;

  it('لا تحتوي الصفحة إلا الأزرار الثلاثة: لا بطاقات ولا شروحات ولا عناصر تحكم أخرى', async () => {
    await seedMinya();
    await openPage('#/data');
    const section = await backupSection();
    await waitFor(() => expect(within(section).getByRole('button', { name: BUTTONS[0] })).toBeEnabled());

    expect(within(section).getAllByRole('button').map((button) => text(button))).toEqual(BUTTONS);
    // النص الظاهر في الصفحة = نص الأزرار فقط
    expect(text(section)).toBe(BUTTONS.join(''));
    expect(section.querySelectorAll('.dq-panel, .dq-card, .dq-callout, h2, h3, p, select, textarea')).toHaveLength(0);
    // حقل الملف الوحيد مخفي ويخدم زر الرفع
    const inputs = section.querySelectorAll('input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute('type', 'file');
    expect(inputs[0]).toHaveClass('dq-visually-hidden');

    // خارج الأزرار: الشريط العلوي والتبويبات والتذييل فقط
    const main = byId('dq-main');
    expect(main.querySelectorAll('button')).toHaveLength(3);
    expect(text(main)).toBe(TAB_LABELS.join('') + BUTTONS.join(''));
    for (const removed of ['حذف كل البيانات…', 'تحميل بيانات تجريبية', 'حفظ الاسم']) {
      expect(screen.queryByRole('button', { name: removed })).not.toBeInTheDocument();
    }
  });

  it('بلا بيانات: التصدير والتنزيل معطلان والرفع متاح', async () => {
    await openPage('#/data');
    const section = await backupSection();
    expect(within(section).getByRole('button', { name: BUTTONS[0] })).toBeDisabled();
    expect(within(section).getByRole('button', { name: BUTTONS[1] })).toBeDisabled();
    expect(within(section).getByRole('button', { name: BUTTONS[2] })).toBeEnabled();
  });

  it('ينزّل نسخة JSON بكل البيانات ثم يستعيدها في نظام فارغ دون نقص', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    const [a, b] = [(await listSnapshots())[2], (await listSnapshots())[4]];
    await saveComparison({ title: 'مقارنة محفوظة', note: 'ملاحظة', a, b });
    const before = await exportDelinquencyData();

    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage('#/data');
      const section = await backupSection();
      await waitFor(() => expect(within(section).getByRole('button', { name: BUTTONS[1] })).toBeEnabled());

      await user.click(within(section).getByRole('button', { name: BUTTONS[1] }));
      expect(await screen.findByText('تم تنزيل النسخة الاحتياطية.')).toBeInTheDocument();
      expect(downloads.names[0]).toMatch(/^نسخة-احتياطية-تحليل-المتأخرات_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
      expect(downloads.blobs[0].type).toContain('application/json');
      const backupText = new TextDecoder().decode(await readBlob(downloads.blobs[0]));
      const backup = JSON.parse(backupText);
      expect(backup.app).toBe(BACKUP_APP_ID);
      expect(backup.counts).toEqual({ months: 5, clientLists: 2, comparisons: 1 });
      expect(backup.data).toEqual(before);

      // «صفحة جديدة»: بيانات فارغة تمامًا
      cleanup();
      await clearDelinquencyData();
      expect(await listSnapshots()).toEqual([]);
      await openPage('#/data');
      const fresh = await backupSection();

      // ملف غريب يُرفض برسالة ولا يغيّر شيئًا
      await user.upload(byId<HTMLInputElement>('dq-restore-file'), new File([JSON.stringify({ employees: [] })], 'other.json', { type: 'application/json' }));
      expect(await screen.findByText('هذا الملف ليس نسخة احتياطية لنظام تحليل ترحيل المتأخرات.')).toBeInTheDocument();
      expect(await listSnapshots()).toEqual([]);

      // النظام فارغ ← الاستعادة مباشرة بلا أسئلة
      await user.upload(byId<HTMLInputElement>('dq-restore-file'), new File([backupText], 'backup.json', { type: 'application/json' }));
      expect(await screen.findByText('تمت الاستعادة: 5 أشهر، مقارنة محفوظة واحدة.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const after = await exportDelinquencyData();
      const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
      expect(sorted(after.months)).toEqual(sorted(before.months));
      expect(sorted(after.clientLists)).toEqual(sorted(before.clientLists));
      expect(sorted(after.comparisons)).toEqual(sorted(before.comparisons));
      expect((await getClientList('2026-10|فرع أسيوط'))?.clients).toHaveLength(6);
      await waitFor(() => expect(within(fresh).getByRole('button', { name: BUTTONS[0] })).toBeEnabled());

      // البيانات المستعادة تعمل في لوحة المقارنة
      await user.click(within(tabsNav()).getByRole('link', { name: 'لوحة المقارنة' }));
      await screen.findByTestId('dq-dashboard');
      await user.selectOptions(byId('dq-select-branch'), 'فرع المنيا');
      await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60'));
    } finally {
      downloads.restore();
    }
  });

  it('مع وجود بيانات: الاستعادة تطلب تأكيدًا، تعيد أرقام الملف، ولا تحذف ما أُدخل بعده', async () => {
    await seedMinya();
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage('#/data');
      const section = await backupSection();
      await waitFor(() => expect(within(section).getByRole('button', { name: BUTTONS[1] })).toBeEnabled());
      await user.click(within(section).getByRole('button', { name: BUTTONS[1] }));
      await waitFor(() => expect(downloads.blobs).toHaveLength(1));
      const backupText = new TextDecoder().decode(await readBlob(downloads.blobs[0]));
      cleanup();

      // بعد النسخة: تعديل خاطئ على أكتوبر + شهر جديد
      await saveSnapshot(toInput('فرع المنيا', 2026, 10, AUG));
      await saveSnapshot(toInput('فرع المنيا', 2026, 11, SEP));

      await openPage('#/data');
      await backupSection();
      await waitFor(() => expect(screen.getByRole('button', { name: BUTTONS[1] })).toBeEnabled());
      const fileInput = byId<HTMLInputElement>('dq-restore-file');

      // الإلغاء لا يغيّر شيئًا
      await user.upload(fileInput, new File([backupText], 'backup.json', { type: 'application/json' }));
      let dialog = await screen.findByRole('dialog', { name: 'استعادة النسخة الاحتياطية' });
      expect(text(dialog)).toContain('الملف يحتوي 3 أشهر');
      await user.click(within(dialog).getByRole('button', { name: 'إلغاء' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect((await listSnapshots()).find((row) => row.id === '2026-10|فرع المنيا')?.buckets.d1_30.clients).toBe(100);

      await user.upload(fileInput, new File([backupText], 'backup.json', { type: 'application/json' }));
      dialog = await screen.findByRole('dialog', { name: 'استعادة النسخة الاحتياطية' });
      await user.click(within(dialog).getByRole('button', { name: 'استعادة' }));
      expect(await screen.findByText('تمت الاستعادة: 3 أشهر، لا مقارنات محفوظة.')).toBeInTheDocument();

      const months = await listSnapshots();
      expect(months.map((row) => row.id)).toEqual(['2026-08|فرع المنيا', '2026-09|فرع المنيا', '2026-10|فرع المنيا', '2026-11|فرع المنيا']);
      expect(months[2].buckets.d1_30).toEqual({ clients: 135, amount: 498500.75 });
      expect(months[2].buckets.npl).toEqual({ clients: 71, amount: 845250.1 });
      expect(months[3].buckets.d1_30).toEqual({ clients: 120, amount: 450000.5 });
    } finally {
      downloads.restore();
    }
  });

  it('زر تصدير Excel ينزّل تقرير كل الفروع لآخر شهرين', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage('#/data');
      const section = await backupSection();
      await waitFor(() => expect(within(section).getByRole('button', { name: BUTTONS[0] })).toBeEnabled());
      await user.click(within(section).getByRole('button', { name: BUTTONS[0] }));
      expect(await screen.findByText('تم تنزيل ملف Excel.')).toBeInTheDocument();
      expect(downloads.names).toEqual(['delinquency-report-2026-09-vs-2026-10.xlsx']);

      const workbook = openWorkbook(await readBlob(downloads.blobs[0]));
      const values = Array.from(workbook.sheets.get(SHEET_REPORT)!.values()).map((cell) => cell.value);
      expect(values.filter((value) => value === 'فرع المنيا')).toHaveLength(3);
      expect(values.filter((value) => value === 'فرع أسيوط')).toHaveLength(3);
      expect(values.filter((value) => value === 'الإجمالي')).toHaveLength(3);
    } finally {
      downloads.restore();
    }
  });
});

describe('البيانات مؤقتة: تحديث الصفحة يمسح كل ما أُدخل', () => {
  const databaseNames = async (): Promise<string[]> => (await indexedDB.databases()).map((db) => db.name ?? '');

  it('ما يُدخل من الواجهة يعمل داخل الصفحة، لا يُكتب على الجهاز، ويختفي بعد تحديثها', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open');
    const storageSet = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    await openPage('#/entry');
    await waitFor(() => expect(byId('dq-month')).toBeInTheDocument());

    const ids = ['d1_30', 'd31_60', 'd61_90', 'd91_120', 'npl'];
    const enter = async (month: string, pairs: BucketPairs) => {
      await user.selectOptions(byId('dq-month'), month);
      await fill(user, 'dq-year', '2026');
      await fill(user, 'dq-branch', 'فرع المنيا');
      for (let index = 0; index < ids.length; index += 1) {
        await fill(user, `dq-clients-${ids[index]}`, String(pairs[index][0]));
        await fill(user, `dq-amount-${ids[index]}`, String(pairs[index][1]));
      }
      await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));
    };
    await enter('9', SEP);
    expect(await screen.findByText('تم حفظ بيانات سبتمبر 2026 — فرع المنيا.')).toBeInTheDocument();
    await enter('10', OCT);
    expect(await screen.findByText('تم حفظ بيانات أكتوبر 2026 — فرع المنيا.')).toBeInTheDocument();
    expect((await exportDelinquencyData()).months).toHaveLength(2);

    // داخل الصفحة نفسها: التنقل بين التبويبات يحتفظ بالبيانات والحسابات كما هي
    await user.click(within(tabsNav()).getByRole('link', { name: 'لوحة المقارنة' }));
    await screen.findByTestId('dq-dashboard');
    expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('2,218,251.35');
    expect(text(screen.getByTestId('dq-kpi-clients'))).toContain('356');

    // لا شيء كُتب على الجهاز
    expect(openSpy).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
    expect(await databaseNames()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    // تحديث الصفحة: كل الوحدات تُحمَّل من جديد
    cleanup();
    vi.resetModules();
    const fresh = await import('@testing-library/react');
    const { App: FreshApp } = await import('../src/delinquency/App');
    const freshDb = await import('../src/delinquency/db/delinquencyDb');
    try {
      window.location.hash = '#/';
      fresh.render(<FreshApp />);
      expect(await fresh.screen.findByText('لا توجد بيانات شهرية بعد')).toBeInTheDocument();
      expect(fresh.screen.queryByTestId('dq-dashboard')).not.toBeInTheDocument();
      expect(await freshDb.exportDelinquencyData()).toEqual({ months: [], clientLists: [], comparisons: [] });
      expect(await databaseNames()).toEqual([]);
    } finally {
      fresh.cleanup();
    }
  });

  it('اسم الجهة المستورد من نسخة احتياطية يظهر في الصفحة ولا يُحفظ على الجهاز', async () => {
    const user = userEvent.setup();
    await saveSnapshot(toInput('فرع المنيا', 2026, 9, SEP));
    const data = await exportDelinquencyData();
    await clearDelinquencyData();
    const file = { app: BACKUP_APP_ID, formatVersion: 1, exportedAt: '2026-10-01T00:00:00.000Z', organization: 'إدارة المخاطر', counts: { months: 1, clientLists: 0, comparisons: 0 }, data };

    await openPage('#/data');
    await user.upload(byId<HTMLInputElement>('dq-restore-file'), new File([JSON.stringify(file)], 'backup.json', { type: 'application/json' }));
    expect(await screen.findByText('تمت الاستعادة: شهر واحد، لا مقارنات محفوظة.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /الصفحة الرئيسية/ })).toHaveTextContent('إدارة المخاطر');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    // إعادة تحميل التطبيق: الاسم لا يعود
    cleanup();
    await clearDelinquencyData();
    await openPage('#/');
    expect(screen.getByRole('link', { name: /الصفحة الرئيسية/ })).not.toHaveTextContent('إدارة المخاطر');
  });
});

describe('لوحة المقارنة — حالات خاصة', () => {
  it('شهر واحد فقط: يطلب إدخال شهر آخر', async () => {
    await saveSnapshot(toInput('', 2026, 9, SEP));
    await openPage('#/');
    expect(await screen.findByText('أدخل شهرًا آخر لنفس الفرع لتظهر المقارنة')).toBeInTheDocument();
    expect(screen.queryByTestId('dq-dashboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ المقارنة' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'تصدير Excel' })).toBeDisabled();
  });

  it('أساس صفري: تظهر «—» بدل نسبة غير معرّفة', async () => {
    await saveSnapshot(toInput('', 2026, 1, [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]));
    await saveSnapshot(toInput('', 2026, 2, [[5, 1000], [0, 0], [0, 0], [0, 0], [2, 500]]));
    await openPage('#/');
    const dashboard = await screen.findByTestId('dq-dashboard');
    expect(text(screen.getByTestId('dq-total-row'))).toContain('+1,500.00');
    expect(text(screen.getByTestId('dq-total-row'))).toContain('—');
    expect(text(dashboard)).not.toMatch(/NaN|Infinity|undefined/);
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
    // لا حقول إضافية: الشهر والسنة والفرع، 10 خانات، والملاحظات
    expect(byId('dq-entry').querySelectorAll('input, select, textarea')).toHaveLength(14);
    expect(text(byId('dq-main'))).not.toMatch(REMOVED_TEXT);

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

    const row = await within(await screen.findByTestId('dq-months-table')).findByRole('row', { name: /سبتمبر 2026/ });
    expect(text(row)).toContain('فرع المنيا');
    expect(text(row)).toContain('335');
    expect(text(row)).toContain('2,050,000.75');

    // النموذج جاهز للشهر التالي
    await waitFor(() => expect(byId<HTMLSelectElement>('dq-month').value).toBe('10'));
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

    expect(await screen.findByText(/توجد بيانات محفوظة لشهر سبتمبر 2026/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'حفظ بيانات الشهر' }));
    await waitFor(async () => expect((await listSnapshots())[0].buckets.d1_30.clients).toBe(120));

    await user.click(screen.getByRole('button', { name: 'تعديل البيانات المحفوظة' }));
    await waitFor(() => expect(byId<HTMLInputElement>('dq-clients-d1_30').value).toBe('120'));
    expect(await screen.findByRole('button', { name: 'حفظ التعديلات' })).toBeInTheDocument();

    await fill(user, 'dq-clients-d1_30', '125');
    await user.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(async () => expect((await listSnapshots())[0].buckets.d1_30.clients).toBe(125));
    expect(await listSnapshots()).toHaveLength(1);
  });

  it('تعديل شهر من الجدول يحفظ الأرقام الجديدة ولا يمس قائمة عملائه المحفوظة سابقًا', async () => {
    await seedAsyutWithLists();
    const user = userEvent.setup();
    await openPage('#/entry');
    await user.click(await screen.findByRole('button', { name: 'تعديل أكتوبر 2026 — فرع أسيوط' }));
    await waitFor(() => expect(byId<HTMLInputElement>('dq-clients-npl').value).toBe('2'));
    await fill(user, 'dq-clients-npl', '3');
    await fill(user, 'dq-amount-npl', '6200.5');
    await user.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(async () => expect((await listSnapshots())[1].buckets.npl).toEqual({ clients: 3, amount: 6200.5 }));
    expect(await listSnapshots()).toHaveLength(2);
    expect((await getClientList('2026-10|فرع أسيوط'))?.clients).toEqual(clientsOf(LIST_B));
    expect((await getClientList('2026-09|فرع أسيوط'))?.clients).toEqual(clientsOf(LIST_A));
  });

  it('حذف شهر يتطلب تأكيدًا', async () => {
    await saveSnapshot(toInput('', 2026, 9, SEP));
    await saveSnapshot(toInput('', 2026, 10, OCT));
    const user = userEvent.setup();
    await openPage('#/entry');
    await user.click(await screen.findByRole('button', { name: 'حذف سبتمبر 2026 — الفرع الرئيسي' }));
    const dialog = await screen.findByRole('dialog', { name: 'حذف بيانات الشهر' });
    expect(await listSnapshots()).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'حذف' }));
    await waitFor(async () => expect((await listSnapshots()).map((row) => row.id)).toEqual(['2026-10|']));
  });
});

describe('لوحة المقارنة', () => {
  it('تقارن آخر شهرين تلقائيًا وتعرض المؤشرات وجدول الشرائح', async () => {
    await seedMinya();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    expect(byId<HTMLSelectElement>('dq-select-a').value).toBe('2026-09|فرع المنيا');
    expect(byId<HTMLSelectElement>('dq-select-b').value).toBe('2026-10|فرع المنيا');
    expect(byId('dq-select-branch')).toBeNull();

    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('2,218,251.35');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('+168,250.60');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('+8.2%');
    expect(text(screen.getByTestId('dq-kpi-clients'))).toContain('356');
    expect(text(screen.getByTestId('dq-kpi-clients'))).toContain('+21');
    expect(text(screen.getByTestId('dq-kpi-clients'))).toContain('+6.3%');
    expect(text(screen.getByTestId('dq-kpi-npl'))).toContain('38.1%');

    const table = screen.getByTestId('dq-comparison-table');
    expect(Array.from(table.querySelectorAll('tbody tr')).map((item) => item.getAttribute('data-bucket'))).toEqual(['d1_30', 'd31_60', 'd61_90', 'd91_120', 'npl']);
    const row = (bucket: string) => text(table.querySelector(`[data-bucket="${bucket}"]`));
    for (const value of ['120', '135', '+15', '+12.5%', '450,000.50', '498,500.75', '+48,500.25', '+10.8%']) expect(row('d1_30')).toContain(value);
    for (const value of ['80', '70', '−10', '−12.5%', '380,000.00', '341,000.00', '−39,000.00', '−10.3%']) expect(row('d31_60')).toContain(value);
    for (const value of ['45', '52', '+7', '290,000.25', '335,500.50', '+45,500.25']) expect(row('d61_90')).toContain(value);
    for (const value of ['30', '28', '−2', '210,000.00', '198,000.00', '−12,000.00']) expect(row('d91_120')).toContain(value);
    for (const value of ['60', '71', '+11', '720,000.00', '845,250.10', '+125,250.10', '+17.4%']) expect(row('npl')).toContain(value);
    const total = text(screen.getByTestId('dq-total-row'));
    for (const value of ['335', '356', '+21', '+6.3%', '2,050,000.75', '2,218,251.35', '+168,250.60', '+8.2%']) expect(total).toContain(value);
  });

  it('لا ملخص تنفيذي ولا مصفوفة ترحيل ولا رسوم ولا صناديق تنبيه', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    await openPage('#/');
    const dashboard = await screen.findByTestId('dq-dashboard');

    for (const id of ['dq-summary', 'dq-headline', 'dq-matrix', 'dq-matrix-actual', 'dq-matrix-framework', 'dq-kpi-status', 'dq-perf-net', 'dq-best', 'dq-worst']) {
      expect(screen.queryByTestId(id), id).not.toBeInTheDocument();
    }
    expect(document.getElementById('dq-summary')).toBeNull();
    expect(document.getElementById('dq-matrix')).toBeNull();
    expect(text(document.body)).not.toMatch(REMOVED_TEXT);
    expect(document.querySelectorAll('.dq-callout')).toHaveLength(0);
    expect(dashboard.querySelectorAll('svg, canvas, [role="img"]')).toHaveLength(0);
    // اللوحة: المؤشرات + جدول الشرائح + جدول الفروع فقط
    expect(Array.from(dashboard.querySelectorAll('h2')).map((heading) => text(heading))).toEqual(['مقارنة الشرائح — فرع المنيا', 'مقارنة الفروع']);
    expect(dashboard.querySelectorAll('table')).toHaveLength(2);
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
    expect(screen.getByText('الشهر السابق المختار أحدث من الشهر الحالي')).toBeInTheDocument();

    await user.selectOptions(byId('dq-select-b'), '2026-10|فرع المنيا');
    expect(await screen.findByText('اختر شهرين مختلفين')).toBeInTheDocument();
    expect(screen.queryByTestId('dq-dashboard')).not.toBeInTheDocument();
  });

  it('عدة فروع: يظهر اختيار الفرع وجدول مقارنة الفروع', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    const user = userEvent.setup();
    await openPage('#/');
    await screen.findByTestId('dq-dashboard');

    const branchSelect = byId<HTMLSelectElement>('dq-select-branch');
    expect(Array.from(branchSelect.options).map((option) => option.value).sort()).toEqual(['فرع أسيوط', 'فرع المنيا'].sort());

    await user.selectOptions(branchSelect, 'فرع المنيا');
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60'));
    const rows = Array.from(screen.getByTestId('dq-branches-table').querySelectorAll('tbody tr')).map((row) => text(row));
    expect(rows).toHaveLength(2);
    const asyut = rows.find((row) => row.includes('فرع أسيوط')) as string;
    const minya = rows.find((row) => row.includes('فرع المنيا')) as string;
    for (const value of ['6', '15,600.00', '11,000.00', '−4,600.00', '−29.5%']) expect(asyut).toContain(value);
    for (const value of ['335', '356', '+21', '2,050,000.75', '2,218,251.35', '+168,250.60', '+8.2%']) expect(minya).toContain(value);

    await user.selectOptions(branchSelect, 'فرع أسيوط');
    await waitFor(() => expect(text(screen.getByTestId('dq-total-row'))).toContain('−4,600.00'));
  });
});

describe('تصدير Excel من لوحة المقارنة', () => {
  it('ينزّل تقريرًا: صف لكل فرع، 12 عمودًا، السابق والحالي والفرق بالأرقام الفعلية', async () => {
    await seedMinya();
    await seedAsyutWithLists();
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage('#/');
      await screen.findByTestId('dq-dashboard');
      await user.click(screen.getByRole('button', { name: 'تصدير Excel' }));
      expect(await screen.findByText('تم تنزيل ملف Excel.')).toBeInTheDocument();

      expect(downloads.names).toEqual(['delinquency-report-2026-09-vs-2026-10.xlsx']);
      expect(downloads.blobs[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const workbook = openWorkbook(await readBlob(downloads.blobs[0]));
      expect(workbook.order.map((sheet) => sheet.name)).toEqual([SHEET_REPORT]);
      const cells = workbook.sheets.get(SHEET_REPORT)!;

      /** كل صفوف فرع معيّن بالترتيب (السابق، الحالي، الفرق) */
      const rowsOf = (label: string) =>
        Array.from(cells.values())
          .filter((cell) => /^A\d+$/.test(cell.ref) && cell.value === label)
          .map((cell) => Number(cell.ref.slice(1)))
          .sort((x, y) => x - y)
          .map((row) => REPORT_HEADERS.map((_, col) => cells.get(`${colName(col)}${row}`)?.value).slice(1));

      expect(rowsOf('الفرع')).toHaveLength(3);
      expect(rowsOf('الفرع')[0]).toEqual(['1-30', '31-60', '61-90', '91-120', 'NPL', 'مبلغ 1-30', 'مبلغ 31-60', 'مبلغ 61-90', 'مبلغ 91-120', 'مبلغ NPL', 'إجمالي العملاء', 'إجمالي المبلغ']);
      expect(rowsOf('فرع المنيا')).toEqual([
        [120, 80, 45, 30, 60, 450000.5, 380000, 290000.25, 210000, 720000, 335, 2050000.75],
        [135, 70, 52, 28, 71, 498500.75, 341000, 335500.5, 198000, 845250.1, 356, 2218251.35],
        [15, -10, 7, -2, 11, 48500.25, -39000, 45500.25, -12000, 125250.1, 21, 168250.6],
      ]);
      expect(rowsOf('فرع أسيوط')).toEqual([
        [2, 1, 1, 1, 1, 1600, 2000, 3000, 4000, 5000, 6, 15600],
        [2, 1, 1, 0, 2, 1800, 1100, 3000, 0, 5100, 6, 11000],
        [0, 0, 0, -1, 1, 200, -900, 0, -4000, 100, 0, -4600],
      ]);
      expect(rowsOf('الإجمالي')).toEqual([
        [122, 81, 46, 31, 61, 451600.5, 382000, 293000.25, 214000, 725000, 341, 2065600.75],
        [137, 71, 53, 28, 73, 500300.75, 342100, 338500.5, 198000, 850350.1, 362, 2229251.35],
        [15, -10, 7, -3, 12, 48700.25, -39900, 45500.25, -16000, 125350.1, 21, 163650.6],
      ]);
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

    await user.click(within(tabsNav()).getByRole('link', { name: 'المقارنات المحفوظة' }));
    const saved = await screen.findByTestId('dq-saved-table');
    expect(text(saved)).toContain('مراجعة أكتوبر');
    expect(text(saved)).toContain('للعرض على الإدارة');
    expect(text(saved)).toContain('+168,250.60');

    await user.click(within(saved).getByRole('button', { name: 'فتح' }));
    await screen.findByTestId('dq-dashboard');
    expect(window.location.hash).toMatch(/^#\/saved\/.+/);
    expect(await screen.findByRole('heading', { level: 2, name: 'مراجعة أكتوبر' })).toBeInTheDocument();
    expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60');
    expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('2,218,251.35');
  });

  it('تصدير المقارنة المحفوظة يستخدم أرقامها المجمّدة', async () => {
    await seedMinya();
    const [, a, b] = await listSnapshots();
    const saved = await saveComparison({ title: 'محفوظة', a, b });
    await saveSnapshot(toInput('فرع المنيا', 2026, 10, AUG));
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPage(`#/saved/${saved.id}`);
      await screen.findByTestId('dq-dashboard');
      await user.click(screen.getByRole('button', { name: 'تصدير Excel' }));
      await waitFor(() => expect(downloads.blobs).toHaveLength(1));
      const cells = openWorkbook(await readBlob(downloads.blobs[0])).sheets.get(SHEET_REPORT)!;
      const totals = Array.from(cells.values())
        .filter((cell) => /^M\d+$/.test(cell.ref) && typeof cell.value === 'number')
        .map((cell) => cell.value);
      expect(totals).toEqual([2050000.75, 2218251.35, 168250.6]);
    } finally {
      downloads.restore();
    }
  });

  it('فتح البيانات الحالية من مقارنة محفوظة ثم حذفها', async () => {
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
    expect(text(screen.getByTestId('dq-total-row'))).toContain('+168,250.60');

    await user.click(screen.getByRole('button', { name: 'عرض البيانات الحالية' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    await waitFor(() => expect(text(screen.getByTestId('dq-kpi-amount'))).toContain('2,050,000.75'));
    expect(text(screen.getByTestId('dq-total-row'))).not.toContain('168,250.60');

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
