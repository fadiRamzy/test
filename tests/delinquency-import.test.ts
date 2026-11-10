/**
 * مراجعة بيانات PDF قبل الحفظ، الحفظ الجماعي الآمن، وتصدير Excel للمكاتب التسعة عشر.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ExistingSnapshotsError,
  clearDelinquencyData,
  getClientList,
  getSnapshot,
  listSnapshots,
  saveClientList,
  saveSnapshot,
  saveSnapshotsBatch,
} from '../src/delinquency/db/delinquencyDb';
import { BUCKET_IDS, snapshotId, sortSnapshots } from '../src/delinquency/lib/delinquency';
import { REPORT_HEADERS, SHEET_REPORT, buildDelinquencyReport, buildDelinquencyXlsx } from '../src/delinquency/lib/delinquencyExcel';
import { OFFICES } from '../src/delinquency/lib/offices';
import { parseParReport } from '../src/delinquency/lib/parReport';
import { assessReview, reviewTableFrom, reviewToInputs, reviewToSnapshots, type ReviewTable } from '../src/delinquency/lib/pdfImport';
import { resolveSelection } from '../src/delinquency/lib/selection';
import { colName } from '../src/delinquency/lib/xlsx';
import { LIST_A, OCT, SEP, clientsOf, makeSnapshot, openWorkbook, toInput } from './delinquency-helpers';
import { PAR_TITLE, amountOf, buildFixtureItems, findCells, fixtureOffices, fmtAmount, fmtCount } from './par-fixture';

beforeEach(async () => {
  await clearDelinquencyData();
});

const truth = fixtureOffices();
const PERIOD = { year: 2031, month: 9 };

function withMissing() {
  const items = buildFixtureItems();
  const drop = new Set([
    ...findCells(items, { section: PAR_TITLE, row: 'مكتب سمسطا', label: '31-60', kind: 'amount' }),
    ...findCells(items, { section: PAR_TITLE, row: 'مكتب طاميه' }),
  ]);
  return parseParReport(items.filter((item) => !drop.has(item)));
}

const edit = (table: ReviewTable, office: (typeof OFFICES)[number], bucket: (typeof BUCKET_IDS)[number], field: 'clients' | 'amount', value: string): ReviewTable => ({
  ...table,
  [office]: { ...table[office], [bucket]: { ...table[office][bucket], [field]: value } },
});

describe('جدول المراجعة', () => {
  it('الخانات تبدأ بالنص كما كُتب في الملف، والخانات غير المقروءة تبدأ فارغة لا صفرًا', () => {
    const extraction = withMissing();
    const table = reviewTableFrom(extraction);
    expect(Object.keys(table)).toEqual([...OFFICES]);
    expect(table['مكتب الفشن'].d1_30).toEqual({ clients: fmtCount(truth[0].par[0][0]), amount: fmtAmount(truth[0].par[0][1]) });
    expect(table['مكتب ببا'].npl.clients).toBe('1,122');
    expect(table['مكتب سمسطا'].d31_60.amount).toBe('');
    for (const id of BUCKET_IDS) expect(table['مكتب طاميه'][id]).toEqual({ clients: '', amount: '' });
  });

  it('يصنّف الصفوف: مكتمل / ناقص / بلا بيانات، ولا يسمح بالحفظ مع صف ناقص', () => {
    const extraction = withMissing();
    const summary = assessReview(reviewTableFrom(extraction), extraction);
    expect(summary.rows.map((row) => row.office)).toEqual([...OFFICES]);
    expect(summary.incomplete).toEqual(['مكتب سمسطا']);
    expect(summary.empty).toEqual(['مكتب طاميه']);
    expect(summary.complete).toHaveLength(17);
    expect(summary.ready).toBe(false);

    const samasta = summary.rows[3];
    expect(samasta.pending).toBe(1);
    expect(samasta.cells.d31_60.amount.state).toBe('empty');
    expect(samasta.totalClients).toBeNull();
    expect(samasta.totalAmount).toBeNull();

    const first = summary.rows[0];
    expect(first.status).toBe('complete');
    expect(first.matchesReport).toBe(true);
    expect(first.edited).toBe(false);
    expect(first.totalClients).toBe(truth[0].par.reduce((sum, [count]) => sum + count, 0));
    expect(first.totalAmount).toBe(amountOf(truth[0].par.reduce((sum, [, mills]) => sum + mills, 0)));

    // الإجماليات تشمل الصفوف المكتملة فقط
    const complete = truth.filter((office) => !['مكتب سمسطا', 'مكتب طاميه'].includes(office.name));
    expect(summary.totals.clients).toEqual([0, 1, 2, 3, 4].map((b) => complete.reduce((sum, office) => sum + office.par[b][0], 0)));
    expect(summary.totals.amounts).toEqual([0, 1, 2, 3, 4].map((b) => amountOf(complete.reduce((sum, office) => sum + office.par[b][1], 0))));
  });

  it('التصحيح اليدوي يكمل الصف ويُتحقق منه مقابل إجمالي المكتب في التقرير', () => {
    const extraction = withMissing();
    let table = reviewTableFrom(extraction);

    // قيمة خاطئة: الصف مكتمل لكنه لا يطابق إجمالي التقرير
    table = edit(table, 'مكتب سمسطا', 'd31_60', 'amount', '1');
    let summary = assessReview(table, extraction);
    expect(summary.rows[3]).toMatchObject({ status: 'complete', matchesReport: false, edited: true });
    expect(summary.mismatched).toEqual(['مكتب سمسطا']);
    expect(summary.rows[3].notes.join(' ')).toContain('لا يطابق إجمالي المكتب');

    // القيمة الصحيحة (بأرقام عربية وفواصل): مطابق
    const correct = fmtAmount(truth[3].par[1][1]);
    table = edit(table, 'مكتب سمسطا', 'd31_60', 'amount', correct.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]));
    summary = assessReview(table, extraction);
    expect(summary.rows[3]).toMatchObject({ status: 'complete', matchesReport: true, edited: true });
    expect(summary.rows[3].cells.d31_60.amount).toMatchObject({ state: 'ok', value: amountOf(truth[3].par[1][1]), fromPdf: false });
    expect(summary.mismatched).toEqual([]);
    expect(summary.ready).toBe(true);
    expect(summary.empty).toEqual(['مكتب طاميه']);
  });

  it('يرفض القيم غير الصحيحة في الخانات ولا يقرّب المبالغ', () => {
    const extraction = parseParReport(buildFixtureItems());
    const base = reviewTableFrom(extraction);
    const stateOf = (field: 'clients' | 'amount', value: string) =>
      assessReview(edit(base, 'مكتب الفشن', 'd1_30', field, value), extraction).rows[0].cells.d1_30[field];

    expect(stateOf('clients', '2.5')).toMatchObject({ state: 'invalid' });
    expect(stateOf('clients', '-1')).toMatchObject({ state: 'invalid' });
    expect(stateOf('clients', 'abc')).toMatchObject({ state: 'invalid' });
    expect(stateOf('clients', '')).toMatchObject({ state: 'empty', value: null });
    expect(stateOf('clients', '  ')).toMatchObject({ state: 'empty' });
    expect(stateOf('amount', '10.1234')).toMatchObject({ state: 'invalid', message: 'المبلغ بثلاث خانات عشرية على الأكثر' });
    expect(stateOf('amount', '-5')).toMatchObject({ state: 'invalid' });
    expect(stateOf('amount', '12x')).toMatchObject({ state: 'invalid' });
    expect(stateOf('amount', '10.123')).toMatchObject({ state: 'ok', value: 10.123 });
    expect(stateOf('clients', '0')).toMatchObject({ state: 'ok', value: 0 });

    const invalid = assessReview(edit(base, 'مكتب الفشن', 'd1_30', 'clients', 'abc'), extraction);
    expect(invalid.rows[0].status).toBe('incomplete');
    expect(invalid.ready).toBe(false);
    // تفريغ خانة مقروءة يجعل الصف ناقصًا ومعدَّلًا
    const cleared = assessReview(edit(base, 'مكتب الفشن', 'd1_30', 'clients', ''), extraction).rows[0];
    expect(cleared).toMatchObject({ status: 'incomplete', edited: true, pending: 1 });
  });

  it('مدخلات الحفظ: المكاتب المكتملة فقط، بالترتيب، وبالقيم كما رُوجعت', () => {
    const extraction = withMissing();
    const summary = assessReview(edit(reviewTableFrom(extraction), 'مكتب سمسطا', 'd31_60', 'amount', fmtAmount(truth[3].par[1][1])), extraction);
    const inputs = reviewToInputs(summary, PERIOD, 'ملاحظة');
    expect(inputs.map((input) => input.branch)).toEqual(OFFICES.filter((name) => name !== 'مكتب طاميه'));
    expect(inputs.every((input) => input.year === 2031 && input.month === 9 && input.notes === 'ملاحظة')).toBe(true);
    truth
      .filter((office) => office.name !== 'مكتب طاميه')
      .forEach((office, index) => {
        BUCKET_IDS.forEach((id, b) => {
          expect(inputs[index].buckets?.[id]).toEqual({ clients: office.par[b][0], amount: amountOf(office.par[b][1]) });
        });
      });
  });
});

describe('الحفظ الجماعي لمكاتب الشهر', () => {
  const inputsOf = () => {
    const extraction = parseParReport(buildFixtureItems());
    return reviewToInputs(assessReview(reviewTableFrom(extraction), extraction), PERIOD, 'مستورد من PDF');
  };

  it('يحفظ المكاتب التسعة عشر بأرقامها كما هي (ثلاث خانات عشرية)', async () => {
    const saved = await saveSnapshotsBatch(inputsOf());
    expect(saved).toHaveLength(19);
    const stored = await listSnapshots();
    expect(stored.map((row) => row.branch)).toEqual([...OFFICES]);
    truth.forEach((office, index) => {
      BUCKET_IDS.forEach((id, b) => {
        expect(stored[index].buckets[id]).toEqual({ clients: office.par[b][0], amount: amountOf(office.par[b][1]) });
      });
      expect(stored[index]).toMatchObject({ year: 2031, month: 9, notes: 'مستورد من PDF', id: snapshotId(office.name, 2031, 9) });
    });
  });

  it('لا يستبدل بيانات محفوظة دون تأكيد، ولا يحفظ شيئًا عند الرفض', async () => {
    await saveSnapshot(toInput('مكتب ببا', 2031, 9, SEP));
    await saveSnapshot(toInput('مكتب سدس', 2031, 9, OCT));
    await saveSnapshot(toInput('مكتب ببا', 2031, 8, OCT));
    const before = await listSnapshots();

    let error: unknown;
    try {
      await saveSnapshotsBatch(inputsOf());
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ExistingSnapshotsError);
    expect((error as ExistingSnapshotsError).existing.map((row) => row.branch)).toEqual(['مكتب ببا', 'مكتب سدس']);
    expect((error as ExistingSnapshotsError).message).toContain('مكتب ببا');
    // لم يتغير أي شيء: لا المكاتب الموجودة ولا أي مكتب جديد
    expect(await listSnapshots()).toEqual(before);
  });

  it('مع التأكيد يستبدل سجلات الشهر نفسه فقط ويحافظ على باقي البيانات', async () => {
    const original = await saveSnapshot(toInput('مكتب ببا', 2031, 9, SEP));
    await saveClientList(original.id, clientsOf(LIST_A));
    const otherMonth = await saveSnapshot(toInput('مكتب ببا', 2031, 8, OCT));
    const otherBranch = await saveSnapshot(toInput('فرع المنيا', 2031, 9, SEP));

    await saveSnapshotsBatch(inputsOf(), { overwrite: true });
    const stored = await listSnapshots();
    expect(stored).toHaveLength(21);
    const beba = await getSnapshot(original.id);
    expect(beba?.buckets.d1_30).toEqual({ clients: truth[1].par[0][0], amount: amountOf(truth[1].par[0][1]) });
    expect(beba?.createdAt).toBe(original.createdAt);
    expect(await getSnapshot(otherMonth.id)).toEqual(otherMonth);
    expect(await getSnapshot(otherBranch.id)).toEqual(otherBranch);
    expect((await getClientList(original.id))?.clients).toHaveLength(6);
  });

  it('يرفض المجموعة كلها إذا كان أحد السجلات غير صالح أو مكررًا', async () => {
    const inputs = inputsOf();
    await expect(saveSnapshotsBatch([...inputs, inputs[4]])).rejects.toThrow(/مكرر/);
    await expect(saveSnapshotsBatch([inputs[0], { ...inputs[1], month: 13 }])).rejects.toThrow();
    await expect(saveSnapshotsBatch([inputs[0], { ...inputs[1], buckets: { d1_30: { clients: -1, amount: 5 } } }])).rejects.toThrow();
    await expect(saveSnapshotsBatch([])).rejects.toThrow(/لا توجد بيانات/);
    expect(await listSnapshots()).toEqual([]);
  });
});

describe('ترتيب المكاتب في النظام', () => {
  it('السجلات تُرتَّب زمنيًا ثم بترتيب المكاتب المعتمد ثم الفروع الأخرى أبجديًا', () => {
    const rows = sortSnapshots([
      makeSnapshot('فرع المنيا', 2031, 9, SEP),
      makeSnapshot('مكتب اطسا الفيوم', 2031, 9, SEP),
      makeSnapshot('مكتب ببا', 2031, 9, SEP),
      makeSnapshot('مكتب الفشن', 2031, 9, SEP),
      makeSnapshot('مكتب الواسطى', 2031, 8, SEP),
      makeSnapshot('فرع أسيوط', 2031, 9, SEP),
    ]);
    expect(rows.map((row) => `${row.month}:${row.branch}`)).toEqual(['8:مكتب الواسطى', '9:مكتب الفشن', '9:مكتب ببا', '9:مكتب اطسا الفيوم', '9:فرع أسيوط', '9:فرع المنيا']);
  });

  it('الفرع الافتراضي في لوحة المقارنة: أول مكتب معتمد في أحدث شهر', () => {
    const offices = sortSnapshots(OFFICES.flatMap((name) => [makeSnapshot(name, 2031, 8, SEP), makeSnapshot(name, 2031, 9, OCT)]));
    const picked = resolveSelection(offices, { branch: null, aId: null, bId: null });
    expect(picked.branches).toEqual([...OFFICES]);
    expect(picked.branch).toBe('مكتب الفشن');
    expect(picked.ready).toBe(true);
    // بدون مكاتب معتمدة يبقى السلوك السابق
    const legacy = sortSnapshots([makeSnapshot('فرع أسيوط', 2031, 9, SEP), makeSnapshot('فرع المنيا', 2031, 9, SEP)]);
    expect(resolveSelection(legacy, { branch: null, aId: null, bId: null }).branch).toBe('فرع المنيا');
  });
});

describe('تصدير Excel لبيانات PDF', () => {
  const sheetOf = (bytes: Uint8Array) => {
    const cells = openWorkbook(bytes).sheets.get(SHEET_REPORT)!;
    const rowOf = (label: string) => {
      const cell = Array.from(cells.values()).find((item) => /^A\d+$/.test(item.ref) && item.value === label);
      if (!cell) return null;
      const row = Number(cell.ref.slice(1));
      return REPORT_HEADERS.map((_, col) => cells.get(`${colName(col)}${row}`)).slice(1);
    };
    const branchColumn = Array.from(cells.values())
      .filter((cell) => /^A\d+$/.test(cell.ref))
      .sort((x, y) => Number(x.ref.slice(1)) - Number(y.ref.slice(1)))
      .map((cell) => cell.value);
    return { cells, rowOf, branchColumn };
  };

  it('المكاتب التسعة عشر بالترتيب وبنفس الأعمدة، والأرقام مطابقة للجدول المراجَع تمامًا', () => {
    const extraction = parseParReport(buildFixtureItems());
    const summary = assessReview(reviewTableFrom(extraction), extraction);
    const bytes = buildDelinquencyXlsx({ snapshots: reviewToSnapshots(summary, PERIOD), current: PERIOD, branches: OFFICES, exportedAt: new Date(2031, 9, 5) });
    const { rowOf, branchColumn } = sheetOf(bytes);

    expect(rowOf('الفرع')?.map((cell) => cell?.value)).toEqual(REPORT_HEADERS.slice(1));
    const start = branchColumn.indexOf('الفرع');
    expect(branchColumn.slice(start + 1, start + 21)).toEqual([...OFFICES, 'الإجمالي']);

    truth.forEach((office) => {
      const row = rowOf(office.name)!;
      const clients = office.par.map(([count]) => count);
      const amounts = office.par.map(([, mills]) => amountOf(mills));
      expect(row.map((cell) => cell?.value)).toEqual([
        ...clients,
        ...amounts,
        clients.reduce((sum, value) => sum + value, 0),
        amountOf(office.par.reduce((sum, [, mills]) => sum + mills, 0)),
      ]);
      // الإجماليان صيغتان حيّتان
      expect(row[10]?.formula).toMatch(/^SUM\(B\d+:F\d+\)$/);
      expect(row[11]?.formula).toMatch(/^SUM\(G\d+:K\d+\)$/);
    });
    const total = rowOf('الإجمالي')!;
    expect(total.map((cell) => cell?.value)).toEqual([
      ...summary.totals.clients,
      ...summary.totals.amounts,
      summary.totals.totalClients,
      summary.totals.totalAmount,
    ]);
  });

  it('المكتب الذي لم تُدخل بياناته يظهر في موضعه بعلامة «—» لا بأصفار', () => {
    const extraction = withMissing();
    const summary = assessReview(edit(reviewTableFrom(extraction), 'مكتب سمسطا', 'd31_60', 'amount', fmtAmount(truth[3].par[1][1])), extraction);
    const report = buildDelinquencyReport({ snapshots: reviewToSnapshots(summary, PERIOD), current: PERIOD, branches: OFFICES });
    expect(report.branches).toEqual([...OFFICES]);
    expect(report.sections[0].rows[12]).toEqual({ branch: 'مكتب طاميه', figures: null });
    expect(report.hasMissing).toBe(true);

    const { rowOf } = sheetOf(buildDelinquencyXlsx({ snapshots: reviewToSnapshots(summary, PERIOD), current: PERIOD, branches: OFFICES }));
    expect(rowOf('مكتب طاميه')?.map((cell) => cell?.value)).toEqual(Array.from({ length: 12 }, () => '—'));
  });

  it('التقرير العادي يرتّب المكاتب المعتمدة بترتيبها ثم الفروع الأخرى أبجديًا، ولا يضيف مكاتب غير محفوظة', () => {
    const snapshots = [
      makeSnapshot('فرع المنيا', 2031, 9, SEP),
      makeSnapshot('مكتب اطسا الفيوم', 2031, 9, SEP),
      makeSnapshot('مكتب الفشن', 2031, 9, OCT),
      makeSnapshot('فرع أسيوط', 2031, 9, SEP),
    ];
    expect(buildDelinquencyReport({ snapshots, current: PERIOD }).branches).toEqual(['مكتب الفشن', 'مكتب اطسا الفيوم', 'فرع أسيوط', 'فرع المنيا']);
  });
});
