import { describe, expect, it } from 'vitest';
import { BUCKET_IDS, bucketLabel, compareBranches, compareSnapshots, type Comparison } from '../src/lib/delinquency';
import {
  SHEET_BRANCHES,
  SHEET_COMPARISON,
  SHEET_DATA,
  SHEET_MIGRATION,
  SHEET_PERFORMANCE,
  SHEET_SUMMARY,
  buildDelinquencyXlsx,
  delinquencyFileName,
} from '../src/lib/delinquencyExcel';
import { FROM_STATES, TO_STATES, computeMigration, parseClientList, type MigrationResult } from '../src/lib/delinquencyMigration';
import { buildExecutiveSummary } from '../src/lib/delinquencySummary';
import { buildXlsx, crc32, zipStored } from '../src/lib/xlsx';
import {
  LIST_A,
  LIST_B,
  OCT,
  SEP,
  ZERO,
  closeTo,
  makeSnapshot,
  oct,
  openWorkbook,
  recalcWorkbook,
  sep,
  unzipStored,
  type ParsedCell,
} from './delinquency-helpers';

const exportedAt = new Date(2026, 10, 10, 9, 30);

function exportWorkbook(comparison: Comparison, migration: MigrationResult | null = null, extra: Partial<Parameters<typeof buildDelinquencyXlsx>[0]> = {}) {
  const bytes = buildDelinquencyXlsx({
    comparison,
    summary: buildExecutiveSummary(comparison, migration),
    migration,
    history: [comparison.a, comparison.b],
    exportedAt,
    ...extra,
  });
  return { bytes, ...openWorkbook(bytes) };
}

/** يعيد حساب كل الصيغ من القيم الخام ويقارنها بالقيم المخزنة في الملف */
function verifyFormulas(sheets: Map<string, Map<string, ParsedCell>>): number {
  const valueOf = recalcWorkbook(sheets);
  let formulas = 0;
  for (const [name, cells] of sheets) {
    for (const cell of cells.values()) {
      if (cell.formula === null) continue;
      formulas += 1;
      const computed = valueOf(name, cell.ref);
      const where = `${name}!${cell.ref} =${cell.formula}`;
      if (typeof computed === 'number') {
        expect(typeof cell.value, where).toBe('number');
        expect(closeTo(computed, cell.value as number), `${where}: ${computed} ≠ ${cell.value}`).toBe(true);
      } else {
        expect(cell.value, where).toBe(computed);
      }
    }
  }
  return formulas;
}

const cellValue = (cells: Map<string, ParsedCell>, ref: string) => cells.get(ref)?.value ?? null;

/** يبحث في العمود A عن أول صف يبدأ نصه بالتسمية ويعيد رقم الصف */
function rowOf(cells: Map<string, ParsedCell>, label: string): number {
  for (const cell of cells.values()) {
    if (/^A\d+$/.test(cell.ref) && typeof cell.value === 'string' && cell.value.startsWith(label)) return Number(cell.ref.slice(1));
  }
  throw new Error(`لا يوجد صف بعنوان: ${label}`);
}

describe('مولّد ملفات xlsx', () => {
  it('CRC-32 يطابق القيم المرجعية', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('ينتج ZIP صالحًا يُقرأ محتواه كما كُتب', () => {
    const zip = zipStored(
      [
        { name: 'a.txt', data: new TextEncoder().encode('مرحبا') },
        { name: 'dir/b.xml', data: new TextEncoder().encode('<x/>') },
      ],
      new Date(2026, 0, 2, 3, 4, 6),
    );
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const files = unzipStored(zip);
    expect(Array.from(files.keys())).toEqual(['a.txt', 'dir/b.xml']);
    expect(files.get('a.txt')).toBe('مرحبا');
    expect(files.get('dir/b.xml')).toBe('<x/>');
  });

  it('يهرّب النصوص الخاصة وينظّف أسماء الأوراق', () => {
    const bytes = buildXlsx([
      { name: 'ورقة/بها:رموز*ممنوعة؟ وطويلة جدًا جدًا جدًا', rows: [['نص <b> & "اقتباس"', 5, { v: 7, f: 'B1+2' }]] },
      { name: 'ورقة/بها:رموز*ممنوعة؟ وطويلة جدًا جدًا جدًا', rows: [[null, undefined, '']] },
    ]);
    const { order, sheets, files } = openWorkbook(bytes);
    expect(order).toHaveLength(2);
    expect(order[0].name).not.toBe(order[1].name);
    for (const sheet of order) {
      expect(sheet.name.length).toBeLessThanOrEqual(31);
      expect(sheet.name).not.toMatch(/[\\/?*[\]:]/);
    }
    const first = sheets.get(order[0].name)!;
    expect(first.get('A1')?.value).toBe('نص <b> & "اقتباس"');
    expect(first.get('B1')?.value).toBe(5);
    expect(first.get('C1')).toMatchObject({ formula: 'B1+2', value: 7 });
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('rightToLeft="1"');
  });

  it('يرفض مصنفًا بلا أوراق', () => {
    expect(() => buildXlsx([])).toThrow();
  });
});

describe('تصدير Excel — بيانات إجمالية (بدون قوائم عملاء)', () => {
  const comparison = compareSnapshots(sep(), oct());
  const workbook = exportWorkbook(comparison, null, { organization: 'إدارة المخاطر' });

  it('الملف حزمة xlsx مكتملة وكل أجزائها XML صالح', () => {
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'docProps/core.xml']) {
      expect(workbook.files.has(part), part).toBe(true);
    }
    for (const [name, xml] of workbook.files) {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, name).toBe(0);
    }
    const types = workbook.files.get('[Content_Types].xml')!;
    workbook.order.forEach((_sheet, index) => expect(types).toContain(`/xl/worksheets/sheet${index + 1}.xml`));
  });

  it('الأوراق المطلوبة بالترتيب وكلها من اليمين لليسار', () => {
    expect(workbook.order.map((sheet) => sheet.name)).toEqual([SHEET_SUMMARY, SHEET_COMPARISON, SHEET_PERFORMANCE, SHEET_MIGRATION, SHEET_DATA]);
    for (const sheet of workbook.order) expect(workbook.files.get(sheet.path)).toContain('rightToLeft="1"');
  });

  it('ورقة المقارنة: القيم المدخلة والتغيرات والنسب لكل شريحة والإجمالي', () => {
    const cells = workbook.sheets.get(SHEET_COMPARISON)!;
    comparison.rows.forEach((row, index) => {
      const r = 5 + index;
      expect(cellValue(cells, `A${r}`)).toBe(bucketLabel(row.bucket));
      expect(cellValue(cells, `B${r}`)).toBe(row.clientsA);
      expect(cellValue(cells, `C${r}`)).toBe(row.clientsB);
      expect(cellValue(cells, `D${r}`)).toBe(row.clientsDelta);
      expect(cellValue(cells, `E${r}`) as number).toBeCloseTo((row.clientsPct as number) / 100, 12);
      expect(cellValue(cells, `F${r}`)).toBe(row.amountA);
      expect(cellValue(cells, `G${r}`)).toBe(row.amountB);
      expect(cellValue(cells, `H${r}`)).toBe(row.amountDelta);
      expect(cellValue(cells, `I${r}`) as number).toBeCloseTo((row.amountPct as number) / 100, 12);
      expect(cellValue(cells, `J${r}`) as number).toBeCloseTo((row.amountShareA as number) / 100, 12);
      expect(cellValue(cells, `K${r}`) as number).toBeCloseTo((row.amountShareB as number) / 100, 12);
      // القيم المدخلة ثوابت، والمشتقات صيغ حية
      expect(cells.get(`B${r}`)?.formula).toBeNull();
      expect(cells.get(`F${r}`)?.formula).toBeNull();
      expect(cells.get(`D${r}`)?.formula).toBe(`C${r}-B${r}`);
      expect(cells.get(`H${r}`)?.formula).toBe(`G${r}-F${r}`);
    });
    expect(cellValue(cells, 'A10')).toBe('الإجمالي');
    expect(cells.get('B10')?.formula).toBe('SUM(B5:B9)');
    expect(cellValue(cells, 'B10')).toBe(335);
    expect(cellValue(cells, 'C10')).toBe(356);
    expect(cellValue(cells, 'D10')).toBe(21);
    expect(cellValue(cells, 'F10')).toBe(2050000.75);
    expect(cellValue(cells, 'G10')).toBe(2218251.35);
    expect(cellValue(cells, 'H10')).toBe(168250.6);
    expect(cellValue(cells, 'I10') as number).toBeCloseTo(168250.6 / 2050000.75, 12);
    expect(cellValue(cells, 'O6')).toBe('الأفضل أداءً');
    expect(cellValue(cells, 'O9')).toBe('الأسوأ أداءً');
  });

  it('ورقة أداء الفرع: النقص والزيادة والصافي بصيغ من ورقة المقارنة', () => {
    const cells = workbook.sheets.get(SHEET_PERFORMANCE)!;
    const value = (label: string) => cellValue(cells, `B${rowOf(cells, label)}`);
    expect(value('إجمالي النقص الصافي في مبالغ')).toBe(51000);
    expect(value('إجمالي الزيادة الصافية في مبالغ')).toBe(219250.6);
    expect(value('صافي التغير في إجمالي مبلغ المتأخرات')).toBe(168250.6);
    expect(value('إجمالي النقص الصافي في أعداد')).toBe(12);
    expect(value('إجمالي الزيادة الصافية في أعداد')).toBe(33);
    expect(value('صافي التغير في عدد العملاء')).toBe(21);
    expect(value('عدد الشرائح التي ارتفع مبلغها')).toBe(3);
    expect(value('عدد الشرائح التي انخفض مبلغها')).toBe(2);
    expect(value('أفضل شريحة')).toBe('31–60 يوم');
    expect(value('أسوأ شريحة')).toBe('أكثر من 120 يوم (NPL)');
    expect(cells.get(`B${rowOf(cells, 'إجمالي النقص الصافي في مبالغ')}`)?.formula).toContain('SUMIF');
    const all = Array.from(cells.values()).map((cell) => String(cell.value ?? '')).join('\n');
    expect(all).toContain('ليس تحصيلًا مؤكدًا');
    expect(all).toContain('لا يُعد تحصيلًا مؤكدًا');
  });

  it('ورقة الملخص: المؤشرات والملاحظات والتنبيهات المنهجية', () => {
    const cells = workbook.sheets.get(SHEET_SUMMARY)!;
    const texts = Array.from(cells.values()).map((cell) => String(cell.value ?? ''));
    const summary = buildExecutiveSummary(comparison, null);
    expect(texts).toContain(summary.headline);
    for (const observation of summary.observations) {
      expect(texts).toContain(observation.title);
      expect(texts).toContain(observation.text);
    }
    for (const caveat of summary.caveats) expect(texts).toContain(caveat);
    expect(texts.some((text) => text.includes('إدارة المخاطر'))).toBe(true);
    expect(texts.some((text) => text.includes('2026-11-10 09:30'))).toBe(true);
    const amountRow = rowOf(cells, 'إجمالي مبلغ المتأخرات');
    expect(cellValue(cells, `B${amountRow}`)).toBe(2050000.75);
    expect(cellValue(cells, `C${amountRow}`)).toBe(2218251.35);
    expect(cellValue(cells, `D${amountRow}`)).toBe(168250.6);
    const nplRow = rowOf(cells, 'حصة NPL');
    expect((cellValue(cells, `D${nplRow}`) as number)).toBeCloseTo(comparison.indicators.nplShareDelta as number, 9);
  });

  it('ورقة الترحيل: إطار بلا أرقام ترحيل — الخلايا الداخلية «غير متاح»', () => {
    const cells = workbook.sheets.get(SHEET_MIGRATION)!;
    const headerRow = rowOf(cells, 'من (شهر الأساس)');
    BUCKET_IDS.forEach((id, rowIndex) => {
      const r = headerRow + 1 + rowIndex;
      expect(cellValue(cells, `A${r}`)).toBe(bucketLabel(id));
      for (const col of ['B', 'C', 'D', 'E', 'F']) {
        expect(cellValue(cells, `${col}${r}`), `${col}${r}`).toBe('غير متاح');
        expect(cells.get(`${col}${r}`)?.formula).toBeNull();
      }
      // مجموع الصف = عدد عملاء شهر الأساس (معلوم من الإدخال)
      expect(cellValue(cells, `G${r}`)).toBe(comparison.rows[rowIndex].clientsA);
    });
    const totalRow = headerRow + 6;
    expect(['B', 'C', 'D', 'E', 'F'].map((col) => cellValue(cells, `${col}${totalRow}`))).toEqual([135, 70, 52, 28, 71]);
    expect(['B', 'C', 'D', 'E', 'F'].map((col) => cellValue(cells, `${col}${totalRow + 1}`))).toEqual([15, -10, 7, -2, 11]);
    expect(['B', 'C', 'D', 'E', 'F'].map((col) => cellValue(cells, `${col}${totalRow + 2}`))).toEqual([48500.25, -39000, 45500.25, -12000, 125250.1]);
    expect(String(cellValue(cells, 'A1'))).toContain('غير');
  });

  it('ورقة البيانات الشهرية: القيم الخام مع إجماليات بصيغ', () => {
    const cells = workbook.sheets.get(SHEET_DATA)!;
    expect(cellValue(cells, 'A5')).toBe('سبتمبر 2026');
    expect(cellValue(cells, 'B5')).toBe('فرع المنيا');
    expect(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((col) => cellValue(cells, `${col}5`))).toEqual(SEP.flat());
    expect(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((col) => cellValue(cells, `${col}6`))).toEqual(OCT.flat());
    expect(cells.get('M5')?.formula).toBe('C5+E5+G5+I5+K5');
    expect(cellValue(cells, 'M6')).toBe(356);
    expect(cellValue(cells, 'N6')).toBe(2218251.35);
  });

  it('كل الصيغ تعطي عند إعادة حسابها نفس القيم المخزنة', () => {
    expect(verifyFormulas(workbook.sheets)).toBeGreaterThan(80);
  });

  it('إعادة الحساب مستقلة فعلًا عن القيم المخزنة (تكشف قيمة مخزنة خاطئة)', () => {
    const tampered = new Map(Array.from(workbook.sheets, ([name, cells]) => [name, new Map(cells)]));
    const cells = tampered.get(SHEET_COMPARISON)!;
    cells.set('H10', { ...cells.get('H10')!, value: 999 });
    cells.set('B5', { ...cells.get('B5')!, value: 121 });
    const valueOf = recalcWorkbook(tampered);
    // H10 صيغة: تُحسب من المدخلات ولا تتأثر بالقيمة المخزنة المعدّلة
    expect(valueOf(SHEET_COMPARISON, 'H10') as number).toBeCloseTo(168250.6, 6);
    // B5 مُدخل خام: تغييره ينتشر إلى كل ما يعتمد عليه، حتى في الأوراق الأخرى
    expect(valueOf(SHEET_COMPARISON, 'D5')).toBe(14);
    expect(valueOf(SHEET_COMPARISON, 'B10')).toBe(336);
    const summary = tampered.get(SHEET_SUMMARY)!;
    expect(valueOf(SHEET_SUMMARY, `B${rowOf(summary, 'عدد العملاء المتأخرين')}`)).toBe(336);
  });

  it('لا توجد قيم NaN أو Infinity أو undefined في أي خلية', () => {
    for (const [name, xml] of workbook.files) expect(xml, name).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('اسم الملف يحمل الشهرين والفرع', () => {
    const name = delinquencyFileName(comparison);
    expect(name).toMatch(/^delinquency-2026-09-vs-2026-10.*\.xlsx$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(delinquencyFileName(compareSnapshots(makeSnapshot('', 2026, 1, SEP), makeSnapshot('', 2026, 2, OCT)))).toBe('delinquency-2026-01-vs-2026-02.xlsx');
  });
});

describe('تصدير Excel — مع الترحيل الفعلي ومقارنة الفروع', () => {
  const a = makeSnapshot('فرع أسيوط', 2026, 9, [[2, 1600], [1, 2000], [1, 3000], [1, 4000], [1, 5000]]);
  const b = makeSnapshot('فرع أسيوط', 2026, 10, [[2, 1800], [1, 1100], [1, 3000], [0, 0], [2, 5100]]);
  const comparison = compareSnapshots(a, b);
  const migration = computeMigration(parseClientList(LIST_A).clients, parseClientList(LIST_B).clients);
  const branches = compareBranches([a, b, sep(), oct()], '2026-09', '2026-10');
  const workbook = exportWorkbook(comparison, migration, { branches, savedTitle: 'مقارنة الربع', savedNote: 'ملاحظة للإدارة' });

  it('تضاف ورقة مقارنة الفروع', () => {
    expect(workbook.order.map((sheet) => sheet.name)).toEqual([SHEET_SUMMARY, SHEET_COMPARISON, SHEET_PERFORMANCE, SHEET_MIGRATION, SHEET_BRANCHES, SHEET_DATA]);
    const cells = workbook.sheets.get(SHEET_BRANCHES)!;
    const texts = Array.from(cells.values()).map((cell) => cell.value);
    expect(texts).toContain('فرع أسيوط');
    expect(texts).toContain('فرع المنيا');
    expect(texts).toContain(168250.6);
    expect(texts).toContain(-4600);
  });

  it('مصفوفة الأعداد تطابق نتيجة المطابقة بأرقام العملاء', () => {
    const cells = workbook.sheets.get(SHEET_MIGRATION)!;
    const headerRow = rowOf(cells, 'من (شهر الأساس)');
    const columns = ['B', 'C', 'D', 'E', 'F', 'G'];
    FROM_STATES.forEach((from, rowIndex) => {
      TO_STATES.forEach((to, colIndex) => {
        const ref = `${columns[colIndex]}${headerRow + 1 + rowIndex}`;
        if (from === 'new' && to === 'exit') expect(cellValue(cells, ref)).toBe('—');
        else expect(cellValue(cells, ref), ref).toBe(migration.matrix[from][to].clients);
      });
      expect(cellValue(cells, `H${headerRow + 1 + rowIndex}`)).toBe(migration.rowTotals[from].clients);
    });
    const totalRow = headerRow + 1 + FROM_STATES.length;
    TO_STATES.forEach((to, colIndex) => expect(cellValue(cells, `${columns[colIndex]}${totalRow}`)).toBe(migration.columnTotals[to].clients));
    expect(String(cellValue(cells, 'A1'))).toContain('الفعلية');
  });

  it('مصفوفة المبالغ وملخص الحركة', () => {
    const cells = workbook.sheets.get(SHEET_MIGRATION)!;
    const values = Array.from(cells.values()).map((cell) => cell.value);
    for (const amount of [1100, 600, 1500, 4200, 900, 5600, 1200]) expect(values).toContain(amount);
    const flowHeader = rowOf(cells, 'الشريحة في شهر الأساس');
    migration.flows.forEach((flow, index) => {
      const r = flowHeader + 1 + index;
      expect(cellValue(cells, `B${r}`)).toBe(flow.startClients);
      expect(cellValue(cells, `C${r}`)).toBe(flow.stayed);
      expect(cellValue(cells, `D${r}`)).toBe(flow.forward);
      expect(cellValue(cells, `E${r}`)).toBe(flow.backward);
      expect(cellValue(cells, `F${r}`)).toBe(flow.exited);
    });
    expect(cellValue(cells, `B${rowOf(cells, 'عملاء دخلوا قائمة المتأخرات')}`)).toBe(2);
    expect(cellValue(cells, `B${rowOf(cells, 'عملاء انتقلوا إلى شريحة NPL')}`)).toBe(2);
    const exitRow = rowOf(cells, 'رصيد العملاء الخارجين');
    expect(String(cellValue(cells, `A${exitRow}`))).toContain('ليس تحصيلًا مؤكدًا');
    expect(cellValue(cells, `B${exitRow}`)).toBe(5600);
  });

  it('عنوان وملاحظة المقارنة المحفوظة يظهران في الملخص', () => {
    const texts = Array.from(workbook.sheets.get(SHEET_SUMMARY)!.values()).map((cell) => String(cell.value ?? ''));
    expect(texts.some((text) => text.includes('مقارنة الربع'))).toBe(true);
    expect(texts.some((text) => text.includes('ملاحظة للإدارة'))).toBe(true);
  });

  it('كل الصيغ تعطي عند إعادة حسابها نفس القيم المخزنة', () => {
    expect(verifyFormulas(workbook.sheets)).toBeGreaterThan(100);
  });

  it('ترحيل بلا مبالغ: تُصدَّر مصفوفة الأعداد فقط دون أرقام مبالغ مختلقة', () => {
    const noAmounts = computeMigration(parseClientList('C1\t10\nC2\t40').clients, parseClientList('C1\t40\nC3\t200').clients);
    const result = exportWorkbook(comparison, noAmounts);
    const cells = result.sheets.get(SHEET_MIGRATION)!;
    const labels = Array.from(cells.values()).map((cell) => String(cell.value ?? ''));
    expect(labels.some((text) => text.startsWith('رصيد العملاء الخارجين'))).toBe(false);
    verifyFormulas(result.sheets);
  });
});

describe('تصدير Excel — حالات حدّية', () => {
  it('أساس صفري: النسب «—» والصيغ لا تقسم على صفر', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, ZERO), makeSnapshot('', 2026, 2, [[5, 1000], [0, 0], [0, 0], [0, 0], [2, 500]]));
    const workbook = exportWorkbook(comparison);
    const cells = workbook.sheets.get(SHEET_COMPARISON)!;
    expect(cellValue(cells, 'E5')).toBe('—');
    expect(cellValue(cells, 'I5')).toBe('—');
    expect(cellValue(cells, 'E6')).toBe(0);
    expect(cellValue(cells, 'J5')).toBe('—');
    expect(cellValue(cells, 'K5') as number).toBeCloseTo(1000 / 1500, 12);
    expect(cellValue(cells, 'I10')).toBe('—');
    expect(cellValue(cells, 'M10')).toBe('—');
    expect(cellValue(cells, 'H10')).toBe(1500);
    expect(verifyFormulas(workbook.sheets)).toBeGreaterThan(60);
    for (const xml of workbook.files.values()) expect(xml).not.toMatch(/NaN|Infinity|#DIV/);
  });

  it('الوصول إلى صفر: −100% وحصص شهر المقارنة «—»', () => {
    const comparison = compareSnapshots(makeSnapshot('', 2026, 1, [[5, 1000], [0, 0], [0, 0], [0, 0], [2, 500]]), makeSnapshot('', 2026, 2, ZERO));
    const workbook = exportWorkbook(comparison);
    const cells = workbook.sheets.get(SHEET_COMPARISON)!;
    expect(cellValue(cells, 'I5')).toBe(-1);
    expect(cellValue(cells, 'I10')).toBe(-1);
    expect(cellValue(cells, 'K5')).toBe('—');
    expect(cellValue(cells, 'L5')).toBe('—');
    expect(cellValue(cells, 'N10')).toBe('—');
    verifyFormulas(workbook.sheets);
  });

  it('شهران كلاهما أصفار وشهران متطابقان', () => {
    for (const comparison of [
      compareSnapshots(makeSnapshot('', 2026, 1, ZERO), makeSnapshot('', 2026, 2, ZERO)),
      compareSnapshots(makeSnapshot('', 2026, 1, SEP), makeSnapshot('', 2026, 2, SEP)),
    ]) {
      const workbook = exportWorkbook(comparison);
      verifyFormulas(workbook.sheets);
      expect(cellValue(workbook.sheets.get(SHEET_COMPARISON)!, 'H10')).toBe(0);
      expect(cellValue(workbook.sheets.get(SHEET_COMPARISON)!, 'I10')).toBe(0);
    }
  });

  it('قروش: القيم المخزنة للصيغ تطابق إعادة الحساب حتى مع كسور عائمة', () => {
    const comparison = compareSnapshots(
      makeSnapshot('', 2026, 1, [[1, 0.1], [1, 0.2], [1, 0.3], [1, 0.7], [1, 1.1]]),
      makeSnapshot('', 2026, 2, [[1, 0.3], [1, 0.1], [1, 0.6], [1, 0.8], [1, 1.4]]),
    );
    const workbook = exportWorkbook(comparison);
    verifyFormulas(workbook.sheets);
    expect(cellValue(workbook.sheets.get(SHEET_COMPARISON)!, 'H10')).toBe(0.8);
  });

  it('اسم فرع برموز خاصة لا يفسد XML ولا اسم الملف', () => {
    const comparison = compareSnapshots(makeSnapshot('فرع <A&B> "1"/2', 2026, 1, SEP), makeSnapshot('فرع <A&B> "1"/2', 2026, 2, OCT));
    const workbook = exportWorkbook(comparison);
    for (const [name, xml] of workbook.files) {
      expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length, name).toBe(0);
    }
    expect(cellValue(workbook.sheets.get(SHEET_DATA)!, 'B5')).toBe('فرع <A&B> "1"/2');
    expect(delinquencyFileName(comparison)).not.toMatch(/[\\/:*?"<>|]/);
  });
});
