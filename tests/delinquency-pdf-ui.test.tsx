/**
 * واجهة «رفع PDF»: الرفع، جدول المراجعة، التصحيح اليدوي، التأكيد، الحفظ، وتصدير Excel.
 * قراءة الملف نفسها (pdf.js) مختبرة في delinquency-pdf.test.ts؛ هنا تُستبدل بعناصر التقرير الاصطناعي.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_TITLE, App } from '../src/delinquency/App';
import { clearDelinquencyData, listSnapshots, saveSnapshot, useDelinquencyDatabase } from '../src/delinquency/db/delinquencyDb';
import { BUCKET_IDS } from '../src/delinquency/lib/delinquency';
import { REPORT_HEADERS, SHEET_REPORT } from '../src/delinquency/lib/delinquencyExcel';
import { OFFICES } from '../src/delinquency/lib/offices';
import type { PdfTextItem } from '../src/delinquency/lib/parReport';
import { PdfReadError, readPdfText } from '../src/delinquency/lib/pdfText';
import { colName } from '../src/delinquency/lib/xlsx';
import { SEP, openWorkbook, toInput } from './delinquency-helpers';
import { PAR_TITLE, amountOf, buildFixtureItems, findCells, fixtureOffices, fmtAmount, fmtCount } from './par-fixture';

vi.mock('../src/delinquency/lib/pdfText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/delinquency/lib/pdfText')>();
  return { ...actual, readPdfText: vi.fn() };
});

const truth = fixtureOffices();

beforeEach(async () => {
  await useDelinquencyDatabase(`test-dq-pdf-ui-${Math.random().toString(36).slice(2)}`);
  await clearDelinquencyData();
  window.localStorage.clear();
  window.location.hash = '#/entry';
});

const text = (element: Element | null) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function pdfReturns(items: PdfTextItem[], emptyPages: number[] = []) {
  vi.mocked(readPdfText).mockResolvedValue({ items, pageCount: 6, emptyPages });
}

function itemsWithGaps(): PdfTextItem[] {
  const items = buildFixtureItems();
  const drop = new Set([
    ...findCells(items, { section: PAR_TITLE, row: 'مكتب سمسطا', label: '31-60', kind: 'amount' }),
    ...findCells(items, { section: PAR_TITLE, row: 'مكتب طاميه' }),
  ]);
  return items.filter((item) => !drop.has(item));
}

async function openPdfMode(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: APP_TITLE });
  await user.click(await screen.findByRole('button', { name: 'رفع PDF' }));
  await screen.findByRole('button', { name: 'اختيار ملف PDF' });
}

async function upload(user: ReturnType<typeof userEvent.setup>, name = 'aging-2031-09.pdf') {
  await user.upload(byId<HTMLInputElement>('dq-pdf-file'), new File(['%PDF-1.4 test'], name, { type: 'application/pdf' }));
}

const reviewRows = () => Array.from(screen.getByTestId('dq-pdf-table').querySelectorAll('tbody tr')) as HTMLElement[];
const rowOf = (office: string) => reviewRows().find((row) => row.dataset.office === office)!;
const cellInput = (office: string, label: string) => within(rowOf(office)).getByLabelText(label) as HTMLInputElement;

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function captureDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => (blobs.push(blob), 'blob:dq-test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return {
    blobs,
    names,
    restore() {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke ?? (() => undefined) });
      click.mockRestore();
    },
  };
}

describe('اختيار طريقة الإدخال', () => {
  it('«رفع PDF» بجوار «إدخال يدوي»، والإدخال اليدوي يبقى كما هو', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: APP_TITLE });

    const group = await screen.findByRole('group', { name: 'طريقة الإدخال' });
    expect(within(group).getAllByRole('button').map((button) => text(button))).toEqual(['إدخال يدوي', 'رفع PDF']);
    expect(within(group).getByRole('button', { name: 'إدخال يدوي' })).toHaveAttribute('aria-pressed', 'true');
    expect(byId('dq-entry')).toBeInTheDocument();

    // مسودة الإدخال اليدوي لا تضيع عند التبديل
    await user.type(byId('dq-clients-d1_30'), '12');
    await user.click(within(group).getByRole('button', { name: 'رفع PDF' }));
    expect(byId('dq-entry')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اختيار ملف PDF' })).toBeInTheDocument();
    expect(byId<HTMLInputElement>('dq-pdf-file').accept).toContain('pdf');
    // جدول الشهور المحفوظة يبقى ظاهرًا في الوضعين
    expect(byId('dq-months')).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'إدخال يدوي' }));
    expect(byId<HTMLInputElement>('dq-clients-d1_30').value).toBe('12');
    expect(byId('dq-pdf')).not.toBeInTheDocument();
  });
});

describe('رفع PDF ومراجعته', () => {
  it('يعرض المكاتب التسعة عشر بالترتيب مع كل الأرقام والإجماليات ومصدرها', async () => {
    pdfReturns(buildFixtureItems());
    const user = userEvent.setup();
    await openPdfMode(user);
    await upload(user);

    const table = await screen.findByTestId('dq-pdf-table');
    expect(readPdfText).toHaveBeenCalledTimes(1);
    expect(reviewRows().map((row) => row.dataset.office)).toEqual([...OFFICES]);
    expect(Array.from(table.querySelectorAll('thead tr:first-child th')).map((cell) => text(cell))).toEqual([
      'المكتب',
      'عدد العملاء',
      'المبلغ',
      'إجمالي العملاء',
      'إجمالي المبلغ',
      'الحالة',
    ]);
    expect(Array.from(table.querySelectorAll('thead tr:nth-child(2) th')).map((cell) => text(cell))).toEqual([
      '1–30', '31–60', '61–90', '91–120', '+120 (NPL)',
      '1–30', '31–60', '61–90', '91–120', '+120 (NPL)',
    ]);

    // مصدر الأرقام والشهر المقروء من «حتى تاريخ»
    const source = text(screen.getByTestId('dq-pdf-source'));
    expect(source).toContain(`القسم: ${PAR_TITLE}`);
    expect(source).toContain('الصفحات: 3, 4, 5, 6');
    expect(source).toContain('حتى تاريخ: 30/09/2031');
    expect(byId<HTMLSelectElement>('dq-pdf-month').value).toBe('9');
    expect(byId<HTMLInputElement>('dq-pdf-year').value).toBe('2031');
    expect(text(screen.getByTestId('dq-pdf-checks'))).toContain('تم تجاهل: المتأخرات');
    expect(screen.getByTestId('dq-pdf-checks').querySelectorAll('li.is-warn')).toHaveLength(0);

    // كل خانة = الرقم كما في الملف
    truth.forEach((office) => {
      const inputs = Array.from(rowOf(office.name).querySelectorAll('input')).map((input) => input.value);
      expect(inputs).toEqual([...office.par.map(([count]) => fmtCount(count)), ...office.par.map(([, mills]) => fmtAmount(mills))]);
      const cells = Array.from(rowOf(office.name).querySelectorAll('td')).map((cell) => text(cell));
      expect(cells[10]).toBe(fmtCount(office.par.reduce((sum, [count]) => sum + count, 0)));
      expect(cells[12]).toBe('مطابق');
    });
    expect(table.querySelectorAll('tbody input')).toHaveLength(190);
    expect(table.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(text(screen.getByTestId('dq-pdf-total-clients'))).toBe(fmtCount(truth.reduce((sum, office) => sum + office.par.reduce((s, [count]) => s + count, 0), 0)));
    expect(screen.queryByTestId('dq-pdf-notes')).not.toBeInTheDocument();
  });

  it('التأكيد يحفظ المكاتب في بيانات الشهر كما رُوجعت، ويظهر الشهر في الجدول والمقارنة', async () => {
    pdfReturns(buildFixtureItems());
    const user = userEvent.setup();
    await openPdfMode(user);
    await upload(user);
    await screen.findByTestId('dq-pdf-table');

    await user.click(screen.getByRole('button', { name: 'تأكيد وحفظ' }));
    expect(await screen.findByText('تم حفظ بيانات 19 مكتبًا لشهر سبتمبر 2031.')).toBeInTheDocument();

    const stored = await listSnapshots();
    expect(stored.map((row) => row.branch)).toEqual([...OFFICES]);
    truth.forEach((office, index) => {
      expect(stored[index]).toMatchObject({ year: 2031, month: 9, notes: 'مستورد من PDF: aging-2031-09.pdf' });
      BUCKET_IDS.forEach((id, b) => expect(stored[index].buckets[id]).toEqual({ clients: office.par[b][0], amount: amountOf(office.par[b][1]) }));
    });

    // انتهت المراجعة وعاد زر الاختيار؛ الشهور المحفوظة تعرض المكاتب
    await waitFor(() => expect(screen.queryByTestId('dq-pdf-table')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'اختيار ملف PDF' })).toBeInTheDocument();
    const months = screen.getByTestId('dq-months-table');
    expect(months.querySelectorAll('tbody tr')).toHaveLength(19);
    expect(text(months)).toContain('مكتب اطسا الفيوم');

    // تعديل سجل مستورد يفتح الإدخال اليدوي بنفس الأرقام (ثلاث خانات عشرية)
    await user.click(screen.getByRole('button', { name: 'تعديل سبتمبر 2031 — مكتب الفشن' }));
    await waitFor(() => expect(byId('dq-entry')).toBeInTheDocument());
    expect(byId<HTMLInputElement>('dq-branch').value).toBe('مكتب الفشن');
    expect(byId<HTMLInputElement>('dq-amount-d1_30').value).toBe(String(amountOf(truth[0].par[0][1])));
    expect(byId<HTMLInputElement>('dq-clients-d1_30').value).toBe(String(truth[0].par[0][0]));
  });

  it('الخانات غير المقروءة ظاهرة وفارغة، وتمنع الحفظ والتصدير حتى تُصحَّح يدويًا', async () => {
    pdfReturns(itemsWithGaps());
    const user = userEvent.setup();
    await openPdfMode(user);
    await upload(user);
    await screen.findByTestId('dq-pdf-table');

    const missing = cellInput('مكتب سمسطا', 'مكتب سمسطا — المبلغ — 31–60 يوم');
    expect(missing.value).toBe('');
    expect(missing).toHaveAttribute('aria-invalid', 'true');
    expect(missing.title).toBe('غير موجود في الملف');
    expect(rowOf('مكتب سمسطا').dataset.status).toBe('incomplete');
    expect(text(rowOf('مكتب سمسطا'))).toContain('ناقص');
    expect(rowOf('مكتب طاميه').dataset.status).toBe('empty');
    expect(Array.from(rowOf('مكتب طاميه').querySelectorAll('input')).every((input) => input.value === '')).toBe(true);
    expect(text(rowOf('مكتب طاميه'))).toContain('بلا بيانات');

    const checks = text(screen.getByTestId('dq-pdf-checks'));
    expect(checks).toContain('المكاتب: 18 من 19');
    expect(checks).toContain('غير موجود: مكتب طاميه');
    expect(checks).toContain('11 خانة تحتاج إدخالًا يدويًا');
    expect(text(screen.getByTestId('dq-pdf-notes'))).toContain('مكتب سمسطا: 1 خانة ناقصة أو غير صحيحة.');

    expect(screen.getByRole('button', { name: 'تأكيد وحفظ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'تصدير Excel' })).toBeDisabled();
    expect(text(screen.getByRole('alert'))).toContain('أكمل الخانات الناقصة أو أفرغ الصف كله: مكتب سمسطا.');

    // قيمة خاطئة: الصف يكتمل لكنه لا يطابق إجمالي المكتب في التقرير
    await user.type(missing, '5');
    expect(rowOf('مكتب سمسطا').dataset.status).toBe('complete');
    expect(text(rowOf('مكتب سمسطا'))).toContain('راجِع');
    expect(text(screen.getByTestId('dq-pdf-notes'))).toContain('مكتب سمسطا: الإجمالي لا يطابق إجمالي المكتب في التقرير');

    // القيمة الصحيحة
    await user.clear(missing);
    await user.type(missing, fmtAmount(truth[3].par[1][1]));
    expect(text(rowOf('مكتب سمسطا'))).toContain('معدّل — مطابق');
    expect(missing).toHaveAttribute('aria-invalid', 'false');
    expect(missing.title).toBe('أُدخل يدويًا');
    expect(screen.getByRole('button', { name: 'تأكيد وحفظ' })).toBeEnabled();

    // المكتب الخالي لا يُحفظ، ويُذكر ذلك صراحة قبل الحفظ
    await user.click(screen.getByRole('button', { name: 'تأكيد وحفظ' }));
    const dialog = await screen.findByRole('dialog', { name: 'تأكيد حفظ بيانات PDF' });
    expect(text(dialog)).toContain('حفظ بيانات 18 مكتبًا لشهر سبتمبر 2031.');
    expect(text(dialog)).toContain('لن تُحفظ (بلا بيانات): مكتب طاميه.');
    expect(await listSnapshots()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByText('تم حفظ بيانات 18 مكتبًا لشهر سبتمبر 2031.')).toBeInTheDocument();

    const stored = await listSnapshots();
    expect(stored.map((row) => row.branch)).toEqual(OFFICES.filter((name) => name !== 'مكتب طاميه'));
    const samasta = stored.find((row) => row.branch === 'مكتب سمسطا')!;
    expect(samasta.buckets.d31_60.amount).toBe(amountOf(truth[3].par[1][1]));
    expect(samasta.notes).toBe('مستورد من PDF: aging-2031-09.pdf (مع تعديل يدوي)');
    expect(stored.find((row) => row.branch === 'مكتب الفشن')!.notes).toBe('مستورد من PDF: aging-2031-09.pdf');
  });

  it('لا يستبدل بيانات شهر محفوظة إلا بعد تأكيد صريح', async () => {
    const existing = await saveSnapshot(toInput('مكتب ببا', 2031, 9, SEP));
    pdfReturns(buildFixtureItems());
    const user = userEvent.setup();
    await openPdfMode(user);
    await upload(user);
    await screen.findByTestId('dq-pdf-table');
    expect(text(byId('dq-pdf'))).toContain('توجد بيانات محفوظة لشهر سبتمبر 2031 لعدد 1 من هذه المكاتب');

    await user.click(screen.getByRole('button', { name: 'تأكيد وحفظ' }));
    let dialog = await screen.findByRole('dialog', { name: 'تأكيد حفظ بيانات PDF' });
    expect(text(dialog)).toContain('سيتم استبدال البيانات المحفوظة لهذا الشهر للمكاتب: مكتب ببا.');
    await user.click(within(dialog).getByRole('button', { name: 'إلغاء' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await listSnapshots()).toEqual([existing]);
    // جدول المراجعة باقٍ كما هو بعد الإلغاء
    expect(reviewRows()).toHaveLength(19);

    // تغيير الشهر إلى شهر بلا بيانات يلغي الحاجة إلى الاستبدال
    await user.selectOptions(byId('dq-pdf-month'), '10');
    expect(text(byId('dq-pdf'))).not.toContain('توجد بيانات محفوظة');
    await user.selectOptions(byId('dq-pdf-month'), '9');

    await user.click(screen.getByRole('button', { name: 'تأكيد وحفظ' }));
    dialog = await screen.findByRole('dialog', { name: 'تأكيد حفظ بيانات PDF' });
    await user.click(within(dialog).getByRole('button', { name: 'استبدال وحفظ' }));
    expect(await screen.findByText('تم حفظ بيانات 19 مكتبًا لشهر سبتمبر 2031.')).toBeInTheDocument();
    const stored = await listSnapshots();
    expect(stored).toHaveLength(19);
    expect(stored[1].buckets.d1_30).toEqual({ clients: truth[1].par[0][0], amount: amountOf(truth[1].par[0][1]) });
    expect(stored[1].createdAt).toBe(existing.createdAt);
  });

  it('الشهر مطلوب عندما لا يُقرأ تاريخ التقرير', async () => {
    pdfReturns(buildFixtureItems({ asOf: null }));
    const user = userEvent.setup();
    await openPdfMode(user);
    await upload(user);
    await screen.findByTestId('dq-pdf-table');
    expect(byId<HTMLSelectElement>('dq-pdf-month').value).toBe('');
    expect(text(screen.getByTestId('dq-pdf-source'))).toContain('تاريخ التقرير غير مقروء');
    expect(screen.getByRole('button', { name: 'تأكيد وحفظ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'تصدير Excel' })).toBeDisabled();

    await user.selectOptions(byId('dq-pdf-month'), '3');
    await user.type(byId('dq-pdf-year'), '2030');
    await user.click(screen.getByRole('button', { name: 'تأكيد وحفظ' }));
    expect(await screen.findByText('تم حفظ بيانات 19 مكتبًا لشهر مارس 2030.')).toBeInTheDocument();
    expect((await listSnapshots()).every((row) => row.year === 2030 && row.month === 3)).toBe(true);
  });

  it('تصدير Excel من جدول المراجعة: 19 مكتبًا بالترتيب والأرقام بعد التعديل اليدوي', async () => {
    pdfReturns(itemsWithGaps());
    const downloads = captureDownloads();
    try {
      const user = userEvent.setup();
      await openPdfMode(user);
      await upload(user);
      await screen.findByTestId('dq-pdf-table');
      await user.type(cellInput('مكتب سمسطا', 'مكتب سمسطا — المبلغ — 31–60 يوم'), fmtAmount(truth[3].par[1][1]));
      // تعديل يدوي لرقم مقروء
      const edited = cellInput('مكتب الفشن', 'مكتب الفشن — عدد العملاء — 1–30 يوم');
      await user.clear(edited);
      await user.type(edited, '٩٩');
      expect(edited.title).toBe(`أُدخل يدويًا — المقروء من الملف: ${fmtCount(truth[0].par[0][0])}`);

      await user.click(screen.getByRole('button', { name: 'تصدير Excel' }));
      expect(await screen.findByText('تم تنزيل ملف Excel.')).toBeInTheDocument();
      expect(downloads.names).toEqual(['delinquency-report-2031-09.xlsx']);

      const cells = openWorkbook(await readBlob(downloads.blobs[0])).sheets.get(SHEET_REPORT)!;
      const column = Array.from(cells.values())
        .filter((cell) => /^A\d+$/.test(cell.ref))
        .sort((x, y) => Number(x.ref.slice(1)) - Number(y.ref.slice(1)));
      const header = column.findIndex((cell) => cell.value === 'الفرع');
      expect(column.slice(header + 1, header + 21).map((cell) => cell.value)).toEqual([...OFFICES, 'الإجمالي']);
      const valuesOf = (label: string) => {
        const row = Number(column.find((cell) => cell.value === label)!.ref.slice(1));
        return REPORT_HEADERS.map((_, col) => cells.get(`${colName(col)}${row}`)?.value).slice(1);
      };
      const first = truth[0].par;
      expect(valuesOf('مكتب الفشن')).toEqual([
        99,
        ...first.slice(1).map(([count]) => count),
        ...first.map(([, mills]) => amountOf(mills)),
        99 + first.slice(1).reduce((sum, [count]) => sum + count, 0),
        amountOf(first.reduce((sum, [, mills]) => sum + mills, 0)),
      ]);
      expect(valuesOf('مكتب سمسطا')[6]).toBe(amountOf(truth[3].par[1][1]));
      expect(valuesOf('مكتب طاميه')).toEqual(Array.from({ length: 12 }, () => '—'));
      // التصدير لا يحفظ شيئًا
      expect(await listSnapshots()).toEqual([]);
    } finally {
      downloads.restore();
    }
  });
});

describe('أخطاء قراءة الملف تظهر بوضوح', () => {
  it('ملف ممسوح ضوئيًا، ثم ملف بلا القسم المطلوب، ثم ملف سليم', async () => {
    const user = userEvent.setup();
    await openPdfMode(user);

    vi.mocked(readPdfText).mockRejectedValueOnce(new PdfReadError('scanned', 'الملف لا يحتوي نصًا قابلًا للقراءة — يبدو أنه صور ممسوحة ضوئيًا ويحتاج إلى OCR.'));
    await upload(user, 'scan.pdf');
    expect(text(await screen.findByRole('alert'))).toContain('يحتاج إلى OCR');
    expect(screen.queryByTestId('dq-pdf-table')).not.toBeInTheDocument();

    // ملف فيه «المتأخرات» فقط: لا تؤخذ منه أرقام
    vi.mocked(readPdfText).mockResolvedValueOnce({ items: buildFixtureItems({ tables: [0, 1] }), pageCount: 3, emptyPages: [] });
    await upload(user, 'arrears-only.pdf');
    await waitFor(() => expect(text(screen.getByRole('alert'))).toContain('لم يُعثر في الملف على قسم «المحفظة في ظل المخاطر»'));
    expect(screen.queryByTestId('dq-pdf-table')).not.toBeInTheDocument();
    expect(await listSnapshots()).toEqual([]);

    vi.mocked(readPdfText).mockRejectedValueOnce(new Error('boom'));
    await upload(user, 'broken.pdf');
    await waitFor(() => expect(text(screen.getByRole('alert'))).toBe('تعذّرت قراءة الملف: boom'));

    pdfReturns(buildFixtureItems(), [2]);
    await upload(user, 'good.pdf');
    await screen.findByTestId('dq-pdf-table');
    expect(screen.queryByText(/يحتاج إلى OCR/)).not.toBeInTheDocument();
    // صفحة بلا نص داخل ملف نصي تُذكر
    expect(text(byId('dq-pdf'))).toContain('صفحات بلا نص مقروء (صور): 2');
  });

  it('إلغاء المراجعة لا يحفظ شيئًا، وحالة المراجعة تبقى عند التنقل بين التبويبات', async () => {
    pdfReturns(buildFixtureItems());
    const user = userEvent.setup();
    await openPdfMode(user);
    await upload(user);
    await screen.findByTestId('dq-pdf-table');
    const edited = cellInput('مكتب ببا', 'مكتب ببا — عدد العملاء — 61–90 يوم');
    await user.clear(edited);
    await user.type(edited, '7');

    await user.click(screen.getByRole('link', { name: 'النسخ الاحتياطي' }));
    await waitFor(() => expect(screen.queryByTestId('dq-pdf-table')).not.toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'إدخال البيانات الشهرية' }));
    await screen.findByTestId('dq-pdf-table');
    expect(cellInput('مكتب ببا', 'مكتب ببا — عدد العملاء — 61–90 يوم').value).toBe('7');

    await user.click(within(byId('dq-pdf')).getByRole('button', { name: 'إلغاء' }));
    expect(screen.queryByTestId('dq-pdf-table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اختيار ملف PDF' })).toBeInTheDocument();
    expect(await listSnapshots()).toEqual([]);
  });
});
