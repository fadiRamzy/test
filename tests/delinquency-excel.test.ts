import { describe, expect, it } from 'vitest';
import { BUCKET_IDS, compareSnapshots, moneySum, snapshotTotals, type MonthlySnapshot } from '../src/delinquency/lib/delinquency';
import {
  REPORT_HEADERS,
  SHEET_REPORT,
  buildDelinquencyReport,
  buildDelinquencyXlsx,
  buildReportSheet,
  delinquencyFileName,
  type DelinquencyReportInput,
  type ReportSectionLayout,
} from '../src/delinquency/lib/delinquencyExcel';
import { buildXlsx, colName, crc32, zipStored } from '../src/delinquency/lib/xlsx';
import { OCT, SEP, ZERO, closeTo, makeSnapshot, openWorkbook, recalcWorkbook, unzipStored, type BucketPairs, type ParsedCell } from './delinquency-helpers';

const exportedAt = new Date(2026, 10, 10, 9, 30);

const SEPT = { year: 2026, month: 9 };
const OCTO = { year: 2026, month: 10 };

/** فرع ثانٍ وثالث بأرقام مختلفة تمامًا حتى لا يتطابق عمود مع آخر بالصدفة */
const BS_SEP: BucketPairs = [[210, 612300.4], [95, 401250.75], [61, 318900], [33, 256410.05], [88, 990120.6]];
const BS_OCT: BucketPairs = [[198, 590110.15], [102, 433000], [58, 301775.5], [41, 300250.25], [93, 1045800.9]];
const FY_SEP: BucketPairs = [[75, 198400], [40, 152350.5], [22, 97120.25], [11, 61000], [19, 204600.8]];
const FY_OCT: BucketPairs = [[69, 181250.35], [44, 166900], [25, 110480.75], [9, 52300.1], [24, 251975.45]];

const BRANCHES: Array<{ name: string; sep: BucketPairs; oct: BucketPairs }> = [
  { name: 'فرع المنيا', sep: SEP, oct: OCT },
  { name: 'فرع بني سويف', sep: BS_SEP, oct: BS_OCT },
  { name: 'فرع الفيوم', sep: FY_SEP, oct: FY_OCT },
];

const threeBranches = (): MonthlySnapshot[] =>
  BRANCHES.flatMap((branch) => [makeSnapshot(branch.name, 2026, 9, branch.sep), makeSnapshot(branch.name, 2026, 10, branch.oct)]);

/** يبني الملف ويفتحه، مع مواضع الأقسام داخل الورقة */
function exportReport(input: Omit<DelinquencyReportInput, 'exportedAt'>) {
  const bytes = buildDelinquencyXlsx({ ...input, exportedAt });
  const workbook = openWorkbook(bytes);
  const report = buildDelinquencyReport(input);
  const { layout } = buildReportSheet(report, { organization: input.organization, exportedAt });
  const cells = workbook.sheets.get(SHEET_REPORT) as Map<string, ParsedCell>;
  const section = (kind: ReportSectionLayout['kind']) => {
    const found = layout.find((item) => item.kind === kind);
    if (!found) throw new Error(`لا يوجد قسم: ${kind}`);
    return found;
  };
  /** قيم صف كامل (13 خلية) بفهرس صف يبدأ من 0 */
  const rowValues = (row: number) => REPORT_HEADERS.map((_, col) => cells.get(`${colName(col)}${row + 1}`)?.value ?? null);
  return { bytes, ...workbook, cells, report, layout, section, rowValues };
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
      expect(typeof computed, where).toBe('number');
      expect(typeof cell.value, where).toBe('number');
      expect(closeTo(computed as number, cell.value as number), `${where}: ${computed} ≠ ${cell.value}`).toBe(true);
    }
  }
  return formulas;
}

/** الصف المتوقع لفرع في شهر: 5 أعداد، 5 مبالغ، إجمالي العملاء، إجمالي المبلغ */
const expectedRow = (name: string, pairs: BucketPairs) => [
  name,
  ...pairs.map(([clients]) => clients),
  ...pairs.map(([, amount]) => amount),
  pairs.reduce((sum, [clients]) => sum + clients, 0),
  moneySum(pairs.map(([, amount]) => amount)),
];

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

describe('تقرير Excel — البنية المطلوبة', () => {
  it('ورقة واحدة من اليمين لليسار، وعناوين الأعمدة بالترتيب المطلوب حرفيًا', () => {
    const { order, files, rowValues, section } = exportReport({ snapshots: threeBranches(), current: OCTO, previous: SEPT });
    expect(order.map((sheet) => sheet.name)).toEqual([SHEET_REPORT]);
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('rightToLeft="1"');
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('fitToWidth="1"');

    const expected = [
      'الفرع',
      '1-30',
      '31-60',
      '61-90',
      '91-120',
      'NPL',
      'مبلغ 1-30',
      'مبلغ 31-60',
      'مبلغ 61-90',
      'مبلغ 91-120',
      'مبلغ NPL',
      'إجمالي العملاء',
      'إجمالي المبلغ',
    ];
    expect([...REPORT_HEADERS]).toEqual(expected);
    for (const kind of ['previous', 'current', 'difference'] as const) {
      expect(rowValues(section(kind).headerRow), kind).toEqual(expected);
    }
  });

  it('ثلاثة أقسام بالترتيب: الشهر السابق ثم الحالي ثم الفرق', () => {
    const { cells, layout, report } = exportReport({ snapshots: threeBranches(), current: OCTO, previous: SEPT });
    expect(layout.map((item) => item.kind)).toEqual(['previous', 'current', 'difference']);
    expect(layout.map((item) => cells.get(`A${item.titleRow + 1}`)?.value)).toEqual([
      'الشهر السابق — سبتمبر 2026',
      'الشهر الحالي — أكتوبر 2026',
      'الفرق (أكتوبر 2026 − سبتمبر 2026)',
    ]);
    expect(cells.get('A1')?.value).toBe('تقرير المتأخرات الشهري — سبتمبر 2026 مقابل أكتوبر 2026');
    expect(cells.get('A2')?.value).toBe('تاريخ التصدير: 2026-11-10');
    expect(report.hasMissing).toBe(false);
    // الأقسام لا تتداخل: كل قسم يبدأ بعد نهاية السابق
    for (let index = 1; index < layout.length; index += 1) {
      expect(layout[index].titleRow).toBeGreaterThan(layout[index - 1].totalRow as number);
    }
  });

  it('كل صف فرع واحد، والفروع تحت بعضها بالترتيب نفسه في الأقسام الثلاثة', () => {
    const { report, layout, cells } = exportReport({ snapshots: threeBranches(), current: OCTO, previous: SEPT });
    expect(report.branches).toHaveLength(3);
    expect([...report.branches].sort((x, y) => x.localeCompare(y, 'ar'))).toEqual(report.branches);
    for (const item of layout) {
      expect(item.branchRows).toHaveLength(3);
      expect(item.branchRows.map((row) => cells.get(`A${row + 1}`)?.value)).toEqual(report.branches);
      // صفوف متتالية ثم صف الإجمالي مباشرة
      expect(item.branchRows).toEqual([item.headerRow + 1, item.headerRow + 2, item.headerRow + 3]);
      expect(item.totalRow).toBe(item.headerRow + 4);
      expect(cells.get(`A${(item.totalRow as number) + 1}`)?.value).toBe('الإجمالي');
    }
  });
});

describe('تقرير Excel — الأرقام الفعلية لكل شريحة', () => {
  const setup = () => exportReport({ snapshots: threeBranches(), current: OCTO, previous: SEPT });

  it('الشهر السابق والحالي: عدد العملاء والمبلغ الفعليان لكل شريحة ولكل فرع', () => {
    const { report, section, rowValues } = setup();
    for (const branch of BRANCHES) {
      const index = report.branches.indexOf(branch.name);
      expect(index, branch.name).toBeGreaterThanOrEqual(0);
      expect(rowValues(section('previous').branchRows[index]), `${branch.name} سبتمبر`).toEqual(expectedRow(branch.name, branch.sep));
      expect(rowValues(section('current').branchRows[index]), `${branch.name} أكتوبر`).toEqual(expectedRow(branch.name, branch.oct));
    }
  });

  it('أرقام فرع المنيا المرجعية: 335 عميلًا و2,050,000.75 ثم 356 عميلًا و2,218,251.35', () => {
    const { report, section, rowValues } = setup();
    const index = report.branches.indexOf('فرع المنيا');
    const previous = rowValues(section('previous').branchRows[index]);
    const current = rowValues(section('current').branchRows[index]);
    expect(previous.slice(1, 6)).toEqual([120, 80, 45, 30, 60]);
    expect(previous.slice(6, 11)).toEqual([450000.5, 380000, 290000.25, 210000, 720000]);
    expect(previous.slice(11)).toEqual([335, 2050000.75]);
    expect(current.slice(1, 6)).toEqual([135, 70, 52, 28, 71]);
    expect(current.slice(6, 11)).toEqual([498500.75, 341000, 335500.5, 198000, 845250.1]);
    expect(current.slice(11)).toEqual([356, 2218251.35]);
  });

  it('الفرق = الحالي − السابق لكل شريحة، ويطابق محرك المقارنة', () => {
    const { report, section, rowValues } = setup();
    for (const branch of BRANCHES) {
      const index = report.branches.indexOf(branch.name);
      const comparison = compareSnapshots(makeSnapshot(branch.name, 2026, 9, branch.sep), makeSnapshot(branch.name, 2026, 10, branch.oct));
      const row = rowValues(section('difference').branchRows[index]);
      expect(row[0]).toBe(branch.name);
      expect(row.slice(1, 6), `${branch.name} فرق العملاء`).toEqual(comparison.rows.map((item) => item.clientsDelta));
      expect(row.slice(6, 11), `${branch.name} فرق المبالغ`).toEqual(comparison.rows.map((item) => item.amountDelta));
      expect(row[11]).toBe(comparison.totals.clientsDelta);
      expect(row[12]).toBe(comparison.totals.amountDelta);
    }
    // فرع المنيا: +21 عميلًا و+168,250.60
    const minya = rowValues(section('difference').branchRows[report.branches.indexOf('فرع المنيا')]);
    expect(minya.slice(1, 6)).toEqual([15, -10, 7, -2, 11]);
    expect(minya.slice(6, 11)).toEqual([48500.25, -39000, 45500.25, -12000, 125250.1]);
    expect(minya.slice(11)).toEqual([21, 168250.6]);
  });

  it('إجمالي العملاء وإجمالي المبلغ لكل صف = مجموع شرائحه', () => {
    const { layout, rowValues } = setup();
    for (const item of layout) {
      for (const row of [...item.branchRows, item.totalRow as number]) {
        const values = rowValues(row) as number[];
        expect(values[11], `صف ${row + 1}`).toBe(values.slice(1, 6).reduce((sum, value) => sum + value, 0));
        expect(closeTo(values[12], values.slice(6, 11).reduce((sum, value) => sum + value, 0)), `صف ${row + 1}`).toBe(true);
      }
    }
  });

  it('صف الإجمالي = مجموع الفروع في كل عمود، في الأقسام الثلاثة', () => {
    const { layout, rowValues } = setup();
    for (const item of layout) {
      const total = rowValues(item.totalRow as number) as number[];
      const rows = item.branchRows.map((row) => rowValues(row) as number[]);
      for (let col = 1; col <= 12; col += 1) {
        const sum = rows.reduce((acc, row) => acc + row[col], 0);
        expect(closeTo(total[col], sum), `${item.kind} عمود ${colName(col)}: ${total[col]} ≠ ${sum}`).toBe(true);
      }
    }
    // إجمالي الفروع الثلاثة: سبتمبر 335+487+167 = 989 عميلًا، أكتوبر 356+492+171 = 1,019 عميلًا، الفرق +30
    const totals = layout.map((item) => rowValues(item.totalRow as number) as number[]);
    expect(totals.map((row) => row[11])).toEqual([989, 1019, 30]);
    const sepAmount = moneySum(BRANCHES.flatMap((branch) => branch.sep.map(([, amount]) => amount)));
    const octAmount = moneySum(BRANCHES.flatMap((branch) => branch.oct.map(([, amount]) => amount)));
    expect(totals[0][12]).toBe(sepAmount);
    expect(totals[1][12]).toBe(octAmount);
    expect(totals[2][12]).toBe(Math.round((octAmount - sepAmount) * 100) / 100);
  });

  it('الأعداد والمبالغ قيم فعلية (لا صيغ)، والإجماليات والفروق صيغ حية', () => {
    const { cells, section } = setup();
    for (const kind of ['previous', 'current'] as const) {
      for (const row of section(kind).branchRows) {
        for (let col = 1; col <= 10; col += 1) expect(cells.get(`${colName(col)}${row + 1}`)?.formula, `${kind} ${colName(col)}${row + 1}`).toBeNull();
        expect(cells.get(`L${row + 1}`)?.formula).toBe(`SUM(B${row + 1}:F${row + 1})`);
        expect(cells.get(`M${row + 1}`)?.formula).toBe(`SUM(G${row + 1}:K${row + 1})`);
      }
    }
    const previous = section('previous');
    const current = section('current');
    section('difference').branchRows.forEach((row, index) => {
      expect(cells.get(`B${row + 1}`)?.formula).toBe(`B${current.branchRows[index] + 1}-B${previous.branchRows[index] + 1}`);
      expect(cells.get(`K${row + 1}`)?.formula).toBe(`K${current.branchRows[index] + 1}-K${previous.branchRows[index] + 1}`);
    });
  });

  it('إعادة حساب كل الصيغ داخل الملف تعطي القيم المخزنة نفسها', () => {
    const { sheets } = setup();
    // 3 أقسام × (3 فروع × صيغتا إجمالي + 12 صيغة إجمالي) + 3 فروع × 10 صيغ فرق
    expect(verifyFormulas(sheets)).toBe(3 * (3 * 2 + 12) + 3 * 10);
  });

  it('لا توجد قيم NaN أو Infinity أو undefined في أي خلية', () => {
    const { files } = setup();
    expect(files.get('xl/worksheets/sheet1.xml')).not.toMatch(/NaN|Infinity|undefined|null/);
  });
});

describe('تقرير Excel — حالات خاصة', () => {
  it('فرع واحد: صف واحد في كل قسم دون صف إجمالي مكرر', () => {
    const snapshots = [makeSnapshot('فرع المنيا', 2026, 9, SEP), makeSnapshot('فرع المنيا', 2026, 10, OCT)];
    const { layout, rowValues, sheets, cells } = exportReport({ snapshots, current: OCTO, previous: SEPT });
    expect(layout.map((item) => item.branchRows.length)).toEqual([1, 1, 1]);
    expect(layout.map((item) => item.totalRow)).toEqual([null, null, null]);
    expect(rowValues(layout[0].branchRows[0])).toEqual(expectedRow('فرع المنيا', SEP));
    expect(rowValues(layout[1].branchRows[0])).toEqual(expectedRow('فرع المنيا', OCT));
    expect(Array.from(cells.values()).some((cell) => cell.value === 'الإجمالي')).toBe(false);
    expect(verifyFormulas(sheets)).toBe(2 + 2 + 12);
  });

  it('شهر واحد فقط: قسم واحد بالأرقام الفعلية دون سابق أو فرق', () => {
    const snapshots = threeBranches().filter((snapshot) => snapshot.month === 10);
    const { layout, cells, report, rowValues } = exportReport({ snapshots, current: OCTO, previous: null });
    expect(layout.map((item) => item.kind)).toEqual(['current']);
    expect(cells.get('A1')?.value).toBe('تقرير المتأخرات الشهري — أكتوبر 2026');
    expect(cells.get(`A${layout[0].titleRow + 1}`)?.value).toBe('أكتوبر 2026');
    for (const branch of BRANCHES) {
      expect(rowValues(layout[0].branchRows[report.branches.indexOf(branch.name)])).toEqual(expectedRow(branch.name, branch.oct));
    }
  });

  it('فرع بلا بيانات في أحد الشهرين: «—» بدل أصفار مضللة، والفرق للفروع المكتملة فقط', () => {
    const snapshots = threeBranches().filter((snapshot) => !(snapshot.branch === 'فرع الفيوم' && snapshot.month === 9));
    const { report, section, rowValues, sheets, cells } = exportReport({ snapshots, current: OCTO, previous: SEPT });
    const index = report.branches.indexOf('فرع الفيوم');
    expect(report.hasMissing).toBe(true);

    expect(rowValues(section('previous').branchRows[index])).toEqual(['فرع الفيوم', ...Array.from({ length: 12 }, () => '—')]);
    expect(rowValues(section('current').branchRows[index])).toEqual(expectedRow('فرع الفيوم', FY_OCT));
    expect(rowValues(section('difference').branchRows[index])).toEqual(['فرع الفيوم', ...Array.from({ length: 12 }, () => '—')]);

    // إجمالي السابق = فرعان، إجمالي الحالي = ثلاثة فروع، إجمالي الفرق = الفرعان المكتملان
    expect((rowValues(section('previous').totalRow as number) as number[])[11]).toBe(335 + 487);
    expect((rowValues(section('current').totalRow as number) as number[])[11]).toBe(356 + 492 + 171);
    expect((rowValues(section('difference').totalRow as number) as number[])[11]).toBe(21 + 5);
    expect(Array.from(cells.values()).some((cell) => typeof cell.value === 'string' && cell.value.includes('لا توجد بيانات للفرع في هذا الشهر'))).toBe(true);
    verifyFormulas(sheets);
  });

  it('فرع بلا اسم يظهر باسم «الفرع الرئيسي»، واسم الجهة يظهر تحت العنوان', () => {
    const snapshots = [makeSnapshot('', 2026, 9, SEP), makeSnapshot('', 2026, 10, OCT)];
    const { report, cells } = exportReport({ snapshots, current: OCTO, previous: SEPT, organization: ' إدارة المخاطر ' });
    expect(report.branches).toEqual(['الفرع الرئيسي']);
    expect(cells.get('A2')?.value).toBe('إدارة المخاطر · تاريخ التصدير: 2026-11-10');
  });

  it('أشهر أخرى في النظام لا تدخل التقرير', () => {
    const snapshots = [...threeBranches(), makeSnapshot('فرع المنيا', 2026, 8, ZERO), makeSnapshot('فرع أسيوط', 2026, 7, SEP)];
    const { report } = exportReport({ snapshots, current: OCTO, previous: SEPT });
    expect(report.branches).toHaveLength(3);
    expect(report.branches).not.toContain('فرع أسيوط');
  });

  it('اختيار غير زمني (السابق أحدث): تسميات «شهر الأساس/المقارنة» والفرق بالاتجاه المختار', () => {
    const { cells, layout, rowValues, report } = exportReport({ snapshots: threeBranches(), current: SEPT, previous: OCTO });
    expect(layout.map((item) => cells.get(`A${item.titleRow + 1}`)?.value)).toEqual([
      'شهر الأساس — أكتوبر 2026',
      'شهر المقارنة — سبتمبر 2026',
      'الفرق (سبتمبر 2026 − أكتوبر 2026)',
    ]);
    const minya = rowValues(layout[2].branchRows[report.branches.indexOf('فرع المنيا')]);
    expect(minya.slice(11)).toEqual([-21, -168250.6]);
  });

  it('نفس الشهر مرتين يُعامل كشهر واحد، ولا تقرير بلا بيانات', () => {
    const { layout } = exportReport({ snapshots: threeBranches(), current: OCTO, previous: OCTO });
    expect(layout.map((item) => item.kind)).toEqual(['current']);
    expect(() => buildDelinquencyXlsx({ snapshots: threeBranches(), current: { year: 2025, month: 1 } })).toThrow('لا توجد بيانات للتصدير');
    expect(() => buildDelinquencyXlsx({ snapshots: [], current: OCTO, previous: SEPT })).toThrow();
  });

  it('قروش: الإجماليات والفروق دقيقة دون كسور عائمة', () => {
    const a: BucketPairs = [[1, 0.1], [1, 0.2], [1, 0.3], [1, 1000000.07], [1, 0.01]];
    const b: BucketPairs = [[2, 0.3], [1, 0.1], [1, 0.7], [1, 1000000.05], [3, 0.02]];
    const snapshots = [makeSnapshot('أ', 2026, 9, a), makeSnapshot('أ', 2026, 10, b), makeSnapshot('ب', 2026, 9, b), makeSnapshot('ب', 2026, 10, a)];
    const { layout, rowValues, sheets } = exportReport({ snapshots, current: OCTO, previous: SEPT });
    const [previous, current, difference] = layout;
    expect((rowValues(previous.branchRows[0]) as number[])[12]).toBe(1000000.68);
    expect((rowValues(current.branchRows[0]) as number[])[12]).toBe(1000001.17);
    expect(rowValues(difference.branchRows[0]).slice(6)).toEqual([0.2, -0.1, 0.4, -0.02, 0.01, 3, 0.49]);
    expect(rowValues(difference.branchRows[1]).slice(6)).toEqual([-0.2, 0.1, -0.4, 0.02, -0.01, -3, -0.49]);
    expect((rowValues(difference.totalRow as number) as number[]).slice(1)).toEqual(Array.from({ length: 12 }, () => 0));
    verifyFormulas(sheets);
  });

  it('شهر كله أصفار يُصدَّر أصفارًا فعلية لا خانات فارغة', () => {
    const snapshots = [makeSnapshot('فرع المنيا', 2026, 9, ZERO), makeSnapshot('فرع المنيا', 2026, 10, OCT)];
    const { layout, rowValues } = exportReport({ snapshots, current: OCTO, previous: SEPT });
    expect(rowValues(layout[0].branchRows[0])).toEqual(['فرع المنيا', ...Array.from({ length: 12 }, () => 0)]);
    expect(rowValues(layout[2].branchRows[0])).toEqual(expectedRow('فرع المنيا', OCT));
  });

  it('أسماء فروع برموز خاصة لا تفسد الملف', () => {
    const name = 'فرع <أ> & "ب"';
    const snapshots = [makeSnapshot(name, 2026, 9, SEP), makeSnapshot(name, 2026, 10, OCT)];
    const { files, report, cells, layout } = exportReport({ snapshots, current: OCTO, previous: SEPT });
    for (const [path, xml] of files) {
      if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue;
      expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length, path).toBe(0);
    }
    expect(report.branches).toEqual([name]);
    expect(cells.get(`A${layout[0].branchRows[0] + 1}`)?.value).toBe(name);
  });

  it('الملف حزمة xlsx مكتملة يطابق كل جزء فيها مجموعه الاختباري', () => {
    const { bytes, files } = exportReport({ snapshots: threeBranches(), current: OCTO, previous: SEPT });
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(unzipStored(bytes).keys()).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    expect(files.get('xl/workbook.xml')).toContain('fullCalcOnLoad="1"');
  });

  it('اسم الملف يحمل الشهرين', () => {
    expect(delinquencyFileName(OCTO, SEPT)).toBe('delinquency-report-2026-09-vs-2026-10.xlsx');
    expect(delinquencyFileName(OCTO, null)).toBe('delinquency-report-2026-10.xlsx');
    expect(delinquencyFileName(OCTO, OCTO)).toBe('delinquency-report-2026-10.xlsx');
  });

  it('أرقام التقرير تطابق إجماليات كل سجل كما يحسبها النظام', () => {
    const snapshots = threeBranches();
    const report = buildDelinquencyReport({ snapshots, current: OCTO, previous: SEPT });
    for (const snapshot of snapshots) {
      const section = report.sections.find((item) => item.kind === (snapshot.month === 9 ? 'previous' : 'current'));
      const row = section?.rows.find((item) => item.branch === snapshot.branch);
      const totals = snapshotTotals(snapshot.buckets);
      expect(row?.figures?.clients).toEqual(BUCKET_IDS.map((id) => snapshot.buckets[id].clients));
      expect(row?.figures?.amounts).toEqual(BUCKET_IDS.map((id) => snapshot.buckets[id].amount));
      expect(row?.figures?.totalClients).toBe(totals.clients);
      expect(row?.figures?.totalAmount).toBe(totals.amount);
    }
  });
});
