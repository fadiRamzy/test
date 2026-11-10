/**
 * محلّل تقرير «اعمار الديون»: القراءة من قسم «المحفظة في ظل المخاطر» فقط،
 * المكاتب التسعة عشر بترتيبها، ولا تخمين لأي خانة ناقصة أو غير مقروءة.
 * كل الأرقام هنا مختلَقة (tests/par-fixture.ts).
 */
import { describe, expect, it } from 'vitest';
import { BUCKET_IDS } from '../src/delinquency/lib/delinquency';
import { OFFICES, compareBranchNames, matchOffice, normalizeArabic, officeRank } from '../src/delinquency/lib/offices';
import { ParReportError, parseParReport, parseReportAmount, parseReportCount, type ParExtraction, type PdfTextItem } from '../src/delinquency/lib/parReport';
import {
  ARREARS_TITLE,
  GRAND_ROW,
  PAR_TITLE,
  amountOf,
  buildFixtureItems,
  findCells,
  fixtureOffices,
  type FixtureItem,
  type FixtureOffice,
} from './par-fixture';

const check = (result: ParExtraction, id: ParExtraction['checks'][number]['id']) => result.checks.find((item) => item.id === id)!;
const officeOf = (result: ParExtraction, name: string) => result.offices.find((office) => office.office === name)!;

/** يتحقق من أن كل خانة مستخرجة تساوي الأرقام الأصلية للتقرير الاصطناعي */
function expectTruth(result: ParExtraction, truth: FixtureOffice[], except: string[] = []) {
  for (const office of truth) {
    if (except.includes(office.name)) continue;
    const row = officeOf(result, office.name);
    expect(BUCKET_IDS.map((id) => row.buckets[id].clients.value), office.name).toEqual(office.par.map(([count]) => count));
    expect(BUCKET_IDS.map((id) => row.buckets[id].amount.value), office.name).toEqual(office.par.map(([, mills]) => amountOf(mills)));
  }
}

const setText = (items: FixtureItem[], match: Parameters<typeof findCells>[1], text: string | ((old: string) => string)) => {
  const cells = findCells(items, match);
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) cell.text = typeof text === 'function' ? text(cell.text) : text;
};
const remove = (items: FixtureItem[], match: Parameters<typeof findCells>[1]): FixtureItem[] => {
  const cells = new Set(findCells(items, match));
  expect(cells.size).toBeGreaterThan(0);
  return items.filter((item) => !cells.has(item));
};

describe('قائمة المكاتب المعتمدة', () => {
  it('تسعة عشر مكتبًا بالترتيب المطلوب', () => {
    expect(OFFICES).toEqual([
      'مكتب الفشن',
      'مكتب ببا',
      'مكتب بني سويف',
      'مكتب سمسطا',
      'مكتب اهناسيا',
      'مكتب ناصر',
      'مكتب الفنت',
      'مكتب تلت',
      'مكتب سدس',
      'مكتب سدمنت',
      'مكتب بني سويف شرق',
      'مكتب طنسا',
      'مكتب طاميه',
      'مكتب الفيوم',
      'مكتب سنورس',
      'مكتب صفط راشين',
      'مكتب دنديل',
      'مكتب الواسطى',
      'مكتب اطسا الفيوم',
    ]);
    expect(new Set(OFFICES.map(normalizeArabic)).size).toBe(19);
  });

  it('يطابق الاسم مطابقة تامة مع تحمّل اختلافات الكتابة العربية فقط', () => {
    expect(matchOffice('مكتب الفشن')).toBe('مكتب الفشن');
    expect(matchOffice('  مكتب   بني  سويف ')).toBe('مكتب بني سويف');
    expect(matchOffice('مكتب بني سويف شرق')).toBe('مكتب بني سويف شرق');
    // الألف والياء والتاء المربوطة
    expect(matchOffice('مكتب إهناسيا')).toBe('مكتب اهناسيا');
    expect(matchOffice('مكتب أطسا الفيوم')).toBe('مكتب اطسا الفيوم');
    expect(matchOffice('مكتب الواسطي')).toBe('مكتب الواسطى');
    expect(matchOffice('مكتب طامية')).toBe('مكتب طاميه');
    // أشكال العرض كما تخرج من ملفات PDF
    expect(matchOffice('ﻣﻜﺘﺐ ﺍﻟﻔﺸﻦ')).toBe('مكتب الفشن');
    expect(matchOffice('ﻣﻜﺘﺐ ﺑﻨﻲ ﺳﻮﻳﻒ ﺷﺮﻕ')).toBe('مكتب بني سويف شرق');
    expect(matchOffice('ﻣﻜﺘﺐ ﺍﻟﻮﺍﺳﻄﻰ')).toBe('مكتب الواسطى');
    // نص مخزَّن بترتيب بصري (معكوس)
    expect(matchOffice(Array.from('مكتب صفط راشين').reverse().join(''))).toBe('مكتب صفط راشين');
  });

  it('لا يطابق اسمًا مختلفًا أو جزئيًا', () => {
    for (const name of ['مكتب بني', 'بني سويف', 'مكتب بني سويف غرب', 'مكتب الفيوم الجديدة', 'مكتب اطسا', 'المجموع الكلي', 'مكتب', '']) {
      expect(matchOffice(name), name).toBeNull();
    }
  });

  it('ترتيب الفروع: المكاتب المعتمدة بترتيبها ثم الباقي أبجديًا', () => {
    expect(officeRank('مكتب ببا')).toBe(1);
    expect(officeRank('فرع المنيا')).toBe(-1);
    const names = ['فرع المنيا', 'مكتب اطسا الفيوم', 'مكتب ببا', 'فرع أسيوط', 'مكتب الفشن'];
    expect([...names].sort(compareBranchNames)).toEqual(['مكتب الفشن', 'مكتب ببا', 'مكتب اطسا الفيوم', 'فرع أسيوط', 'فرع المنيا']);
  });
});

describe('قراءة الأرقام كما كُتبت', () => {
  it('الأعداد: صحيحة فقط، مع فواصل آلاف سليمة وأرقام عربية أو لاتينية', () => {
    expect(parseReportCount('0')).toBe(0);
    expect(parseReportCount('17')).toBe(17);
    expect(parseReportCount('1,024')).toBe(1024);
    expect(parseReportCount('12,345,678')).toBe(12345678);
    expect(parseReportCount('١٬٠٢٤')).toBe(1024);
    expect(parseReportCount('٤٥')).toBe(45);
    for (const bad of ['', '1.5', '41,207.563', '1,02', '10,24', '1,0244', '-3', '3-', '12a', '1 024', ',5', '5,']) {
      expect(parseReportCount(bad), bad).toBeNull();
    }
  });

  it('المبالغ: حتى ثلاث خانات عشرية دون أي تقريب', () => {
    expect(parseReportAmount('41,207.563')).toBe(41207.563);
    expect(parseReportAmount('88,310.27')).toBe(88310.27);
    expect(parseReportAmount('163,500')).toBe(163500);
    expect(parseReportAmount('0')).toBe(0);
    expect(parseReportAmount('2,045,118.906')).toBe(2045118.906);
    expect(parseReportAmount('٤١٬٢٠٧٫٥٦٣')).toBe(41207.563);
    expect(parseReportAmount('۱۲۳٫۵')).toBe(123.5);
    for (const bad of ['', '1.2345', '1,23.5', '41.207.563', '12,5', '-5', '5.', '.5', 'O', '2,045,118.906.2', '12 500']) {
      expect(parseReportAmount(bad), bad).toBeNull();
    }
  });
});

describe('استخراج قسم «المحفظة في ظل المخاطر»', () => {
  const truth = fixtureOffices();

  it('يقرأ كل خانات المكاتب التسعة عشر من القسم الصحيح فقط وبالترتيب المعتمد', () => {
    const result = parseParReport(buildFixtureItems());

    expect(result.sectionTitle).toBe(PAR_TITLE);
    expect(result.ignoredSections).toEqual([ARREARS_TITLE]);
    expect(result.offices.map((office) => office.office)).toEqual([...OFFICES]);
    expect(result.offices.every((office) => office.found)).toBe(true);
    expect(result.unresolved).toBe(0);
    expect(result.extraOffices).toEqual([]);
    expect(result.warnings).toEqual([]);
    expectTruth(result, truth);

    // لا رقم واحد من قسم «المتأخرات» (أعداده في التقرير الاصطناعي ≥ 100 فوق أعداد المحفظة)
    for (const office of truth) {
      const row = officeOf(result, office.name);
      BUCKET_IDS.forEach((id, index) => {
        expect(row.buckets[id].clients.value).not.toBe(office.arrears[index][0]);
        expect(row.buckets[id].amount.value).not.toBe(amountOf(office.arrears[index][1]));
      });
    }
    expect(result.checks.map((item) => [item.id, item.ok])).toEqual([
      ['section', true],
      ['offices', true],
      ['duplicates', true],
      ['figures', true],
      ['office-totals', true],
      ['column-totals', true],
    ]);
    for (const office of result.offices) expect(office.warnings, office.office).toEqual([]);
  });

  it('إجمالي كل مكتب في التقرير يُقرأ للتحقق ولا يدخل في الشرائح', () => {
    const result = parseParReport(buildFixtureItems());
    for (const office of truth) {
      const row = officeOf(result, office.name);
      expect(row.reportTotal.clients).toBe(office.par.reduce((sum, [count]) => sum + count, 0));
      expect(row.reportTotal.amount).toBe(amountOf(office.par.reduce((sum, [, mills]) => sum + mills, 0)));
    }
  });

  it('يقرأ تاريخ «حتى تاريخ» ولا يستخدم تاريخ الطباعة', () => {
    expect(parseParReport(buildFixtureItems()).asOf).toEqual({ year: 2031, month: 9, day: 30, text: '30/09/2031' });
    expect(parseParReport(buildFixtureItems({ asOf: '٣١/١٢/٢٠٣٠' })).asOf).toMatchObject({ year: 2030, month: 12, day: 31 });
    expect(parseParReport(buildFixtureItems({ asOf: null })).asOf).toBeNull();
    expect(parseParReport(buildFixtureItems({ asOf: '31/13/2031' })).asOf).toBeNull();
    // تاريخان مختلفان بين الصفحات: لا يُخمَّن الشهر
    const items = buildFixtureItems();
    const dates = items.filter((item) => item.text === '30/09/2031');
    expect(dates.length).toBeGreaterThan(1);
    dates[0].text = '31/08/2031';
    expect(parseParReport(items).asOf).toBeNull();
  });

  it('يتعرف على العنوان بصيغتيه ولا يقرأ من «المتأخرات» أبدًا', () => {
    const renamed = buildFixtureItems();
    for (const item of renamed) if (item.text === PAR_TITLE) item.text = 'المحفظة في ظل المخاطر';
    const result = parseParReport(renamed);
    expect(result.sectionTitle).toBe('المحفظة في ظل المخاطر');
    expectTruth(result, truth);

    // ملف فيه قسم المتأخرات فقط
    let error: unknown;
    try {
      parseParReport(buildFixtureItems({ tables: [0, 1] }));
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ParReportError);
    expect((error as ParReportError).code).toBe('no-section');
    expect((error as ParReportError).message).toContain('المتأخرات');

    // ملف فيه قسم المحفظة فقط
    const parOnly = parseParReport(buildFixtureItems({ tables: [2, 3] }));
    expect(parOnly.ignoredSections).toEqual([]);
    expectTruth(parOnly, truth);
  });

  it('قسم بعنوان آخر يُتجاهل مع تنبيه، ولا تؤخذ منه أرقام', () => {
    const items = buildFixtureItems();
    for (const item of items) if (item.text === ARREARS_TITLE) item.text = 'أرصدة العملاء';
    const result = parseParReport(items);
    expect(result.ignoredSections).toEqual(['أرصدة العملاء']);
    expect(result.warnings.some((warning) => warning.includes('أرصدة العملاء'))).toBe(true);
    expectTruth(result, truth);
  });

  it('ملف بلا نص أو بلا أي مكتب مطلوب: خطأ واضح', () => {
    expect(() => parseParReport([])).toThrowError(ParReportError);
    expect(() => parseParReport([{ page: 1, x: 0, y: 0, width: 0, height: 0, text: '   ' }])).toThrowError(/لا يحتوي نصًا/);
    const others = fixtureOffices(['مكتب القاهرة', 'مكتب الجيزة']);
    expect(() => parseParReport(buildFixtureItems({ offices: others }))).toThrowError(/لم يُعثر فيه على أي مكتب/);
  });

  it('لا يتأثر بإزاحة الصفحة أو ترتيب العناصر أو المسافات الفارغة', () => {
    const items: PdfTextItem[] = buildFixtureItems().map((item) => ({ ...item, x: item.x * 1.07 + 13, y: item.y * 1.05 + 20, width: item.width * 1.07 }));
    const shuffled = [...items].reverse();
    shuffled.push({ page: 3, x: 300, y: 300, width: 2, height: 0, text: ' ' }, { page: 4, x: 10, y: 10, width: 0, height: 0, text: '' });
    const result = parseParReport(shuffled);
    expect(result.unresolved).toBe(0);
    expectTruth(result, truth);
  });

  it('أرقام عربية-هندية، وأسماء بترتيب بصري معكوس', () => {
    const items = buildFixtureItems();
    const toIndic = (text: string) => text.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]).replace(/,/g, '٬').replace(/\./g, '٫');
    for (const item of items) {
      if (item.tag?.kind === 'count' || item.tag?.kind === 'amount') item.text = toIndic(item.text);
      else if (/[\u0600-\u06FF]/.test(item.text)) item.text = Array.from(item.text).reverse().join('');
    }
    const result = parseParReport(items);
    expect(result.unresolved).toBe(0);
    expect(result.offices.every((office) => office.found)).toBe(true);
    expectTruth(result, truth);
  });

  it('رقمان متجاوران في عنصر نصي واحد يُفصلان إلى خانتيهما', () => {
    const items = buildFixtureItems();
    const count = findCells(items, { section: PAR_TITLE, row: 'مكتب ببا', label: '31-60', kind: 'count' })[0];
    const amount = findCells(items, { section: PAR_TITLE, row: 'مكتب ببا', label: '31-60', kind: 'amount' })[0];
    const merged: PdfTextItem = { page: count.page, x: amount.x, y: count.y, width: count.x + count.width - amount.x, height: 8, text: `${amount.text}      ${count.text}` };
    // في الملف يُكتب المبلغ يسار العدد؛ النص المدمج يبدأ من اليسار
    const result = parseParReport([...items.filter((item) => item !== count && item !== amount), merged]);
    const row = officeOf(result, 'مكتب ببا');
    const expected = truth.find((office) => office.name === 'مكتب ببا')!.par[1];
    expect(row.buckets.d31_60.clients.value).toBe(expected[0]);
    expect(row.buckets.d31_60.amount.value).toBe(amountOf(expected[1]));
    expect(result.unresolved).toBe(0);
  });
});

describe('لا تخمين: الخانات الناقصة أو غير المؤكدة تُترك فارغة وتُعلَّم', () => {
  const truth = fixtureOffices();

  it('خانة مفقودة لا تصبح صفرًا', () => {
    let items = buildFixtureItems();
    items = remove(items, { section: PAR_TITLE, row: 'مكتب سمسطا', label: '31-60', kind: 'amount' });
    items = remove(items, { section: PAR_TITLE, row: 'مكتب ناصر', label: '91-120', kind: 'count' });
    const result = parseParReport(items);

    const samasta = officeOf(result, 'مكتب سمسطا');
    expect(samasta.buckets.d31_60.amount).toEqual({ value: null, raw: null, issue: 'missing' });
    expect(samasta.buckets.d31_60.clients.value).toBe(truth[3].par[1][0]);
    expect(samasta.warnings.join(' ')).toContain('غير موجود في الملف');
    expect(officeOf(result, 'مكتب ناصر').buckets.d91_120.clients.value).toBeNull();
    expect(result.unresolved).toBe(2);
    expect(check(result, 'figures').ok).toBe(false);
    expect(check(result, 'office-totals').ok).toBe(false);
    expectTruth(result, truth, ['مكتب سمسطا', 'مكتب ناصر']);
  });

  it('قيمة غير مقروءة تُعرض كما هي ولا تُفسَّر', () => {
    const items = buildFixtureItems();
    setText(items, { section: PAR_TITLE, row: 'مكتب تلت', label: '61-90', kind: 'amount' }, '12,34.5');
    setText(items, { section: PAR_TITLE, row: 'مكتب سدس', label: '31-60', kind: 'count' }, '1O');
    const result = parseParReport(items);
    expect(officeOf(result, 'مكتب تلت').buckets.d61_90.amount).toEqual({ value: null, raw: '12,34.5', issue: 'unreadable' });
    expect(officeOf(result, 'مكتب سدس').buckets.d31_60.clients.value).toBeNull();
    expect(result.unresolved).toBeGreaterThanOrEqual(1);
    expectTruth(result, truth, ['مكتب تلت', 'مكتب سدس']);
  });

  it('لا يخلط بين العدد والمبلغ: مبلغ في خانة العدد مرفوض، والقيمتان المتبادلتان تُكشفان', () => {
    const items = buildFixtureItems();
    setText(items, { section: PAR_TITLE, row: 'مكتب الفنت', label: '61-90', kind: 'count' }, '4,321.5');
    const result = parseParReport(items);
    expect(officeOf(result, 'مكتب الفنت').buckets.d61_90.clients).toMatchObject({ value: null, issue: 'unreadable' });

    // تبديل موضعي العدد والمبلغ: مبلغ بكسور في خانة العدد مرفوض
    const swap = (label: string) => {
      const swapped = buildFixtureItems();
      const [count] = findCells(swapped, { section: PAR_TITLE, row: 'مكتب دنديل', label, kind: 'count' });
      const [amount] = findCells(swapped, { section: PAR_TITLE, row: 'مكتب دنديل', label, kind: 'amount' });
      [count.text, amount.text] = [amount.text, count.text];
      return { result: parseParReport(swapped), count: amount.text, amount: count.text };
    };
    const fractional = swap('91-120');
    expect(fractional.count).toMatch(/^\d+$/);
    expect(fractional.amount).toMatch(/\.\d{3}$/);
    expect(officeOf(fractional.result, 'مكتب دنديل').buckets.d91_120.clients).toMatchObject({ value: null, issue: 'unreadable' });

    // مبلغ بلا كسور في خانة العدد يبدو عددًا صحيحًا — يكشفه عدم تطابق إجمالي المكتب
    const whole = swap('61-90');
    expect(whole.amount).toMatch(/^[\d,]+$/);
    expect(check(whole.result, 'office-totals')).toMatchObject({ ok: false, detail: 'غير مطابق: مكتب دنديل' });
    expect(officeOf(whole.result, 'مكتب دنديل').warnings.join(' ')).toContain('لا يطابق إجمالي المكتب');
  });

  it('عمود مكرر بقيمتين مختلفتين: تعارض، ولا يُختار أحدهما', () => {
    const items = buildFixtureItems();
    const cells = findCells(items, { section: PAR_TITLE, row: 'مكتب طنسا', label: '121-99999', kind: 'count' });
    expect(cells).toHaveLength(4);
    cells[2].text = String(Number(cells[2].text.replace(/,/g, '')) + 1);
    const result = parseParReport(items);
    const figure = officeOf(result, 'مكتب طنسا').buckets.npl.clients;
    expect(figure.value).toBeNull();
    expect(figure.issue).toBe('conflict');
    expect(officeOf(result, 'مكتب طنسا').warnings.join(' ')).toContain('متعارضة');
  });

  it('مكتب مكرر في الجدول نفسه يُكشف ويُعلَّم', () => {
    const items = buildFixtureItems();
    const dup = findCells(items, { section: PAR_TITLE, row: 'مكتب سنورس' })
      .filter((item) => item.page === findCells(items, { section: PAR_TITLE, row: 'مكتب سنورس', label: '31-60' })[0].page)
      .map((item) => ({ ...item, y: item.y + 9, text: item.tag?.kind === 'count' ? '77' : item.text }));
    const result = parseParReport([...items, ...dup]);
    expect(check(result, 'duplicates').ok).toBe(false);
    expect(check(result, 'duplicates').detail).toContain('مكتب سنورس');
    const row = officeOf(result, 'مكتب سنورس');
    expect(row.warnings.join(' ')).toContain('مكرر');
    // القيم المتعارضة بين السجلين لا تُحسم
    expect(row.buckets.d1_30.clients.value).toBeNull();
    expect(row.buckets.d1_30.clients.issue).toBe('conflict');
  });

  it('مكتب غائب عن القسم يبقى في الجدول بخانات فارغة', () => {
    let items = buildFixtureItems();
    items = remove(items, { section: PAR_TITLE, row: 'مكتب طاميه' });
    const result = parseParReport(items);
    expect(result.offices).toHaveLength(19);
    const row = officeOf(result, 'مكتب طاميه');
    expect(row.found).toBe(false);
    for (const id of BUCKET_IDS) {
      expect(row.buckets[id].clients.value).toBeNull();
      expect(row.buckets[id].amount.value).toBeNull();
    }
    expect(result.unresolved).toBe(10);
    expect(check(result, 'offices')).toMatchObject({ ok: false, detail: 'غير موجود: مكتب طاميه' });
    // وجوده في «المتأخرات» لا يعوّض غيابه عن المحفظة
    expect(findCells(items, { section: ARREARS_TITLE, row: 'مكتب طاميه' }).length).toBeGreaterThan(0);
  });

  it('مكتب ناقص في أحد جزأي الجدول: الشرائح الغائبة فارغة والباقي كما هو', () => {
    // الجزء الثاني من جدول المحفظة يحمل 61-90 و91-120؛ نحذف صف المكتب منه كله
    const all = buildFixtureItems();
    const partTwoY = new Set(findCells(all, { section: PAR_TITLE, row: 'مكتب الفيوم', label: '61-90' }).map((item) => `${item.page}:${item.y}`));
    expect(partTwoY.size).toBe(1);
    const items = all.filter((item) => !(item.tag?.section === PAR_TITLE && item.tag.row === 'مكتب الفيوم' && partTwoY.has(`${item.page}:${item.y}`)));
    expect(all.length - items.length).toBe(11);

    const result = parseParReport(items);
    const row = officeOf(result, 'مكتب الفيوم');
    const expected = truth.find((office) => office.name === 'مكتب الفيوم')!.par;
    expect(row.found).toBe(true);
    expect(row.buckets.d1_30.clients.value).toBe(expected[0][0]);
    expect(row.buckets.d31_60.amount.value).toBe(amountOf(expected[1][1]));
    expect(row.buckets.npl.clients.value).toBe(expected[4][0]);
    expect(row.buckets.d61_90).toMatchObject({ clients: { value: null, issue: 'missing' }, amount: { value: null, issue: 'missing' } });
    expect(row.buckets.d91_120).toMatchObject({ clients: { value: null, issue: 'missing' }, amount: { value: null, issue: 'missing' } });
    expect(result.unresolved).toBe(4);
    expectTruth(result, truth, ['مكتب الفيوم']);
  });

  it('اسم غير مدرج في القائمة لا يُستورد ويُذكر في التنبيهات', () => {
    const offices = [...fixtureOffices(), ...fixtureOffices(['مكتب القاهرة الجديدة'])];
    const result = parseParReport(buildFixtureItems({ offices }));
    expect(result.offices).toHaveLength(19);
    expect(result.extraOffices).toEqual(['مكتب القاهرة الجديدة']);
    expect(result.warnings.join(' ')).toContain('مكتب القاهرة الجديدة');
    // صف «المجموع الكلي» يشمل المكتب الإضافي، والمقارنة تأخذه في الحساب
    expect(check(result, 'column-totals').ok).toBe(true);
  });

  it('مجموع الشرائح لا يطابق إجمالي المكتب: يُعلَّم المكتب للمراجعة', () => {
    const items = buildFixtureItems();
    setText(items, { section: PAR_TITLE, row: 'مكتب سدمنت', label: '31-60', kind: 'count' }, (old) => String(Number(old.replace(/,/g, '')) + 3));
    const result = parseParReport(items);
    expect(check(result, 'office-totals')).toMatchObject({ ok: false, detail: 'غير مطابق: مكتب سدمنت' });
    expect(officeOf(result, 'مكتب سدمنت').warnings.join(' ')).toContain('لا يطابق إجمالي المكتب');
    expect(check(result, 'column-totals').ok).toBe(false);
  });

  it('صف «المجموع الكلي» غير المتسق يُعرض كملاحظة ولا يغيّر أرقام المكاتب', () => {
    const items = buildFixtureItems();
    setText(items, { section: PAR_TITLE, row: GRAND_ROW, label: '1-30', kind: 'count' }, '5');
    const result = parseParReport(items);
    const totals = check(result, 'column-totals');
    expect(totals.ok).toBe(false);
    expect(totals.detail).toContain('1-30');
    expect(totals.detail).toContain('مطابق: 31-60، 61-90، 91-120');
    expect(check(result, 'office-totals').ok).toBe(true);
    expect(result.unresolved).toBe(0);
    expectTruth(result, truth);

    const none = parseParReport(buildFixtureItems({ noGrandRow: true }));
    expect(check(none, 'column-totals')).toMatchObject({ ok: false, detail: 'صف «المجموع الكلي» غير موجود في القسم' });
    expectTruth(none, truth);
  });

  it('شريحة بمبلغ دون عملاء (أو العكس) تُعلَّم', () => {
    const offices = fixtureOffices();
    offices[5].par[2] = [0, 5_000_000];
    const result = parseParReport(buildFixtureItems({ offices }));
    expect(officeOf(result, 'مكتب ناصر').warnings.join(' ')).toContain('مبلغ دون عملاء');
  });

  it('رأس جدول تالف: لا تُستخدم أرقام ذلك الجزء', () => {
    const items = buildFixtureItems();
    // حذف «العدد» الأولى من رأس أول جزء للمحفظة في أول صفحة يظهر فيها
    const title = items.find((item) => item.text === PAR_TITLE)!;
    const header = items.filter((item) => item.page === title.page && Math.abs(item.y - (title.y + 7.5)) < 1 && item.text === 'العدد');
    expect(header.length).toBe(6);
    const broken = items.filter((item) => item !== header[0]);
    const result = parseParReport(broken);
    expect(result.warnings.join(' ')).toContain('أرقام هذا الجزء لم تُستخدم');
    // لا قيمة خاطئة: كل ما قُرئ يطابق الأصل، والباقي فارغ
    for (const office of truth) {
      const row = officeOf(result, office.name);
      BUCKET_IDS.forEach((id, index) => {
        const { clients, amount } = row.buckets[id];
        expect(clients.value === null || clients.value === office.par[index][0]).toBe(true);
        expect(amount.value === null || amount.value === amountOf(office.par[index][1])).toBe(true);
      });
    }
    expect(result.unresolved).toBeGreaterThan(0);
  });
});
