// @vitest-environment node
/**
 * قراءة ملف PDF فعلي عبر pdf.js ثم استخراج قسم «المحفظة في ظل المخاطر».
 * الملف يُولَّد داخل الاختبار بأرقام مختلَقة وبنفس خصائص التقرير الحقيقي:
 * صفحات مدوَّرة 90°، نص عربي بترتيب بصري، وأقسام مقسَّمة على عدة صفحات.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUCKET_IDS, moneySum } from '../src/delinquency/lib/delinquency';
import { OFFICES } from '../src/delinquency/lib/offices';
import { parseParReport } from '../src/delinquency/lib/parReport';
import { PdfReadError, readPdfText } from '../src/delinquency/lib/pdfText';
import { ARREARS_TITLE, PAR_TITLE, amountOf, buildFixtureItems, buildFixturePdf, fixtureOffices } from './par-fixture';

async function readError(bytes: Uint8Array): Promise<PdfReadError> {
  try {
    await readPdfText(bytes);
  } catch (cause) {
    expect(cause).toBeInstanceOf(PdfReadError);
    return cause as PdfReadError;
  }
  throw new Error('كان يجب أن تفشل القراءة');
}

describe('قراءة ملف PDF', () => {
  const items = buildFixtureItems();
  const truth = fixtureOffices();

  it('يستخرج النص بمواضعه الصحيحة من صفحات مدوَّرة ويعيد العربية إلى ترتيبها المنطقي', async () => {
    const text = await readPdfText(buildFixturePdf(items));
    expect(text.pageCount).toBe(6);
    expect(text.emptyPages).toEqual([]);
    expect(text.items).toHaveLength(items.length);

    const title = text.items.find((item) => item.text === PAR_TITLE)!;
    const source = items.find((item) => item.text === PAR_TITLE)!;
    expect(title.page).toBe(source.page);
    expect(title.x).toBeCloseTo(source.x, 1);
    expect(title.y).toBeCloseTo(source.y, 1);
    expect(title.width).toBeCloseTo(source.width, 1);
    expect(text.items.some((item) => item.text === 'مكتب بني سويف شرق')).toBe(true);
  });

  it('من الملف إلى الجدول: كل خانة للمكاتب التسعة عشر مطابقة للأصل', async () => {
    const result = parseParReport((await readPdfText(buildFixturePdf(items))).items);
    expect(result.sectionTitle).toBe(PAR_TITLE);
    expect(result.ignoredSections).toEqual([ARREARS_TITLE]);
    expect(result.pages).toEqual([3, 4, 5, 6]);
    expect(result.asOf).toMatchObject({ year: 2031, month: 9 });
    expect(result.offices.map((office) => office.office)).toEqual([...OFFICES]);
    expect(result.unresolved).toBe(0);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    truth.forEach((office, index) => {
      const row = result.offices[index];
      expect(BUCKET_IDS.map((id) => row.buckets[id].clients.value)).toEqual(office.par.map(([count]) => count));
      expect(BUCKET_IDS.map((id) => row.buckets[id].amount.value)).toEqual(office.par.map(([, mills]) => amountOf(mills)));
    });
  });

  it('ملف ممسوح ضوئيًا (بلا نص): رسالة واضحة بالحاجة إلى OCR', async () => {
    const error = await readError(buildFixturePdf([], { pages: 3 }));
    expect(error.code).toBe('scanned');
    expect(error.message).toContain('OCR');
  });

  it('صفحة بلا نص وسط ملف نصي تُذكر ولا تُتجاهل بصمت', async () => {
    const text = await readPdfText(buildFixturePdf(items.filter((item) => item.page !== 4)));
    expect(text.pageCount).toBe(6);
    expect(text.emptyPages).toEqual([4]);
    // مكاتب الصفحة الغائبة تبقى خاناتها فارغة — لا أصفار
    const result = parseParReport(text.items);
    expect(result.unresolved).toBeGreaterThan(0);
    for (const office of result.offices) {
      for (const id of BUCKET_IDS) {
        const expected = truth.find((item) => item.name === office.office)!.par[BUCKET_IDS.indexOf(id)];
        expect(office.buckets[id].clients.value === null || office.buckets[id].clients.value === expected[0]).toBe(true);
        expect(office.buckets[id].amount.value === null || office.buckets[id].amount.value === amountOf(expected[1])).toBe(true);
      }
    }
  });

  it('ملف محمي بكلمة مرور', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures/encrypted-fixture.pdf')));
    const error = await readError(bytes);
    expect(error.code).toBe('password');
    expect(error.message).toContain('كلمة مرور');
  });

  it('ملف ليس PDF أو تالف', async () => {
    expect((await readError(new TextEncoder().encode('ليس ملف PDF'))).code).toBe('invalid');
    expect((await readError(new Uint8Array())).code).toBe('invalid');
    expect((await readError(new TextEncoder().encode(`%PDF-1.4\n${'x'.repeat(400)}`))).code).toBe('invalid');
    expect((await readError(buildFixturePdf(items).slice(0, 2500))).code).toBe('invalid');
  });

  it('لا يغيّر بايتات الملف الأصلية', async () => {
    const pdf = buildFixturePdf(items.filter((item) => item.page === 3));
    const copy = pdf.slice();
    await readPdfText(pdf);
    expect(pdf).toEqual(copy);
  });
});

/**
 * تحقق اختياري على تقرير حقيقي محلي (لا يُحفظ في المستودع):
 *   PAR_SAMPLE_PDF=/path/to/report.pdf npx vitest run tests/delinquency-pdf.test.ts
 * يتحقق من الثوابت البنيوية فقط، دون أي أرقام من التقرير داخل الكود.
 */
const samplePath = process.env.PAR_SAMPLE_PDF ?? '';

describe.skipIf(!samplePath || !existsSync(samplePath))('تقرير حقيقي محلي (اختياري)', () => {
  it('المكاتب التسعة عشر كاملة، بلا خانات معلّقة، ومجموع الشرائح = إجمالي كل مكتب', async () => {
    const text = await readPdfText(new Uint8Array(readFileSync(samplePath)));
    const result = parseParReport(text.items);
    expect(text.emptyPages).toEqual([]);
    expect(result.offices.map((office) => office.office)).toEqual([...OFFICES]);
    expect(result.offices.every((office) => office.found)).toBe(true);
    expect(result.unresolved).toBe(0);
    expect(result.ignoredSections).toContain(ARREARS_TITLE);
    expect(result.asOf).not.toBeNull();
    for (const id of ['section', 'offices', 'duplicates', 'figures', 'office-totals'] as const) {
      expect(result.checks.find((check) => check.id === id)?.ok, id).toBe(true);
    }
    for (const office of result.offices) {
      expect(BUCKET_IDS.reduce((sum, id) => sum + (office.buckets[id].clients.value as number), 0)).toBe(office.reportTotal.clients);
      expect(moneySum(BUCKET_IDS.map((id) => office.buckets[id].amount.value as number))).toBe(office.reportTotal.amount);
    }
  });
});
