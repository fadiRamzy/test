import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDelinquencyData,
  delinquencyCounts,
  deleteSavedComparison,
  deleteSnapshot,
  exportDelinquencyData,
  getClientList,
  getSavedComparison,
  getSnapshot,
  listClientLists,
  listSavedComparisons,
  listSnapshots,
  restoreDelinquencyData,
  saveClientList,
  saveComparison,
  saveSnapshot,
  useDelinquencyDatabase,
  validateDelinquencyBackup,
} from '../src/delinquency/db/delinquencyDb';
import { BACKUP_APP_ID, backupFileName, createBackupFile, parseBackupFile } from '../src/delinquency/lib/backupFile';
import { compareSnapshots } from '../src/delinquency/lib/delinquency';
import { aggregateClientList, computeMigration, parseClientList } from '../src/delinquency/lib/delinquencyMigration';
import {
  SAMPLE_BRANCH_A,
  SAMPLE_BRANCH_B,
  SAMPLE_NOTE,
  buildSampleClientLists,
  isSampleSnapshot,
  loadSampleData,
  removeSampleData,
  samplePeriods,
} from '../src/delinquency/lib/sampleData';
import { LIST_A, LIST_B, OCT, SEP, ZERO, toInput } from './delinquency-helpers';

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2);
  await useDelinquencyDatabase(`test-dq-${suffix}`);
  await clearDelinquencyData();
});

const errorsOf = async (promise: Promise<unknown>): Promise<Record<string, string>> => {
  try {
    await promise;
  } catch (error) {
    return (error as { errors?: Record<string, string> }).errors ?? { thrown: String(error) };
  }
  return {};
};

describe('حفظ البيانات الشهرية', () => {
  it('يحفظ شهرًا ويسترجعه كما أُدخل', async () => {
    const saved = await saveSnapshot({ ...toInput('  فرع   المنيا ', 2026, 9, SEP), notes: ' إقفال سبتمبر ' });
    expect(saved.id).toBe('2026-09|فرع المنيا');
    expect(saved.branch).toBe('فرع المنيا');
    expect(saved.notes).toBe('إقفال سبتمبر');
    expect(saved.createdAt).toBe(saved.updatedAt);

    const stored = await getSnapshot(saved.id);
    expect(stored).toEqual(saved);
    expect(stored?.buckets.d1_30).toEqual({ clients: 120, amount: 450000.5 });
    expect(stored?.buckets.npl).toEqual({ clients: 60, amount: 720000 });
  });

  it('يرتب الشهور زمنيًا ثم بحسب الفرع', async () => {
    await saveSnapshot(toInput('ب', 2026, 10, OCT));
    await saveSnapshot(toInput('أ', 2026, 10, OCT));
    await saveSnapshot(toInput('ب', 2025, 12, SEP));
    expect((await listSnapshots()).map((row) => row.id)).toEqual(['2025-12|ب', '2026-10|أ', '2026-10|ب']);
  });

  it('يرفض الإدخال غير الصالح ولا يحفظ شيئًا', async () => {
    const errors = await errorsOf(saveSnapshot({ year: 2026, month: 9, buckets: { d1_30: { clients: -1, amount: 'x' } } }));
    expect(Object.keys(errors).sort()).toEqual(['d1_30.amount', 'd1_30.clients']);
    expect(await listSnapshots()).toEqual([]);
  });

  it('الحفظ على شهر موجود يحدّث السجل نفسه ويحافظ على تاريخ الإنشاء', async () => {
    const first = await saveSnapshot(toInput('', 2026, 9, SEP));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await saveSnapshot(toInput('', 2026, 9, OCT));
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(await listSnapshots()).toHaveLength(1);
    expect((await getSnapshot(first.id))?.buckets.d1_30.clients).toBe(135);
  });

  it('مع overwrite=false لا يكتب فوق شهر محفوظ', async () => {
    await saveSnapshot(toInput('', 2026, 9, SEP));
    const errors = await errorsOf(saveSnapshot(toInput('', 2026, 9, OCT), { overwrite: false }));
    expect(errors.month).toContain('سبتمبر 2026');
    expect((await getSnapshot('2026-09|'))?.buckets.d1_30.clients).toBe(120);
  });

  it('تعديل الشهر أو الفرع ينقل السجل وقائمة عملائه', async () => {
    const original = await saveSnapshot(toInput('فرع أ', 2026, 9, SEP));
    await saveClientList(original.id, parseClientList(LIST_A).clients);

    const moved = await saveSnapshot(toInput('فرع أ', 2026, 8, SEP), { editingId: original.id });
    expect(moved.id).toBe('2026-08|فرع أ');
    expect(moved.createdAt).toBe(original.createdAt);
    expect(await getSnapshot(original.id)).toBeUndefined();
    expect(await getClientList(original.id)).toBeUndefined();
    expect((await getClientList(moved.id))?.clients).toHaveLength(6);
    expect(await listSnapshots()).toHaveLength(1);
  });

  it('لا ينقل سجلًا إلى شهر مشغول', async () => {
    const sep = await saveSnapshot(toInput('', 2026, 9, SEP));
    await saveSnapshot(toInput('', 2026, 10, OCT));
    const errors = await errorsOf(saveSnapshot(toInput('', 2026, 10, SEP), { editingId: sep.id }));
    expect(errors.month).toContain('أكتوبر 2026');
    expect(await listSnapshots()).toHaveLength(2);
    expect((await getSnapshot('2026-10|'))?.buckets.d1_30.clients).toBe(135);
    expect((await getSnapshot('2026-09|'))?.buckets.d1_30.clients).toBe(120);
  });

  it('التعديل دون تغيير الفترة يحدّث القيم في مكانها', async () => {
    const saved = await saveSnapshot(toInput('', 2026, 9, SEP));
    const edited = await saveSnapshot(toInput('', 2026, 9, ZERO), { editingId: saved.id, overwrite: false });
    expect(edited.id).toBe(saved.id);
    expect((await getSnapshot(saved.id))?.buckets.npl).toEqual({ clients: 0, amount: 0 });
  });

  it('حذف الشهر يحذف قائمة عملائه فقط', async () => {
    const sep = await saveSnapshot(toInput('', 2026, 9, SEP));
    const oct = await saveSnapshot(toInput('', 2026, 10, OCT));
    await saveClientList(sep.id, parseClientList(LIST_A).clients);
    await saveClientList(oct.id, parseClientList(LIST_B).clients);
    await deleteSnapshot(sep.id);
    expect((await listSnapshots()).map((row) => row.id)).toEqual([oct.id]);
    expect((await listClientLists()).map((row) => row.id)).toEqual([oct.id]);
  });
});

describe('قوائم العملاء', () => {
  it('تحفظ القائمة وتستبدلها، والقائمة الفارغة تحذفها', async () => {
    const sep = await saveSnapshot(toInput('', 2026, 9, SEP));
    await saveClientList(sep.id, parseClientList(LIST_A).clients);
    expect((await getClientList(sep.id))?.clients[0]).toEqual({ id: 'C1', bucket: 'd1_30', days: 10, amount: 1000 });

    await saveClientList(sep.id, parseClientList(LIST_B).clients);
    expect((await getClientList(sep.id))?.clients.map((client) => client.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C7', 'C8']);
    expect(await listClientLists()).toHaveLength(1);

    await saveClientList(sep.id, []);
    expect(await getClientList(sep.id)).toBeUndefined();
  });
});

describe('المقارنات المحفوظة', () => {
  async function seedPair() {
    const a = await saveSnapshot(toInput('فرع المنيا', 2026, 9, SEP));
    const b = await saveSnapshot(toInput('فرع المنيا', 2026, 10, OCT));
    return { a, b };
  }

  it('تحفظ نسخة مجمّدة لا تتغير بتعديل أو حذف بيانات الشهر', async () => {
    const { a, b } = await seedPair();
    const migration = computeMigration(parseClientList(LIST_A).clients, parseClientList(LIST_B).clients);
    const saved = await saveComparison({ title: '  مقارنة الربع ', note: ' للعرض ', a, b, migration });
    expect(saved.title).toBe('مقارنة الربع');
    expect(saved.note).toBe('للعرض');
    expect(saved.branch).toBe('فرع المنيا');

    await saveSnapshot(toInput('فرع المنيا', 2026, 10, ZERO));
    await deleteSnapshot(a.id);

    const reopened = await getSavedComparison(saved.id);
    expect(reopened?.a.buckets).toEqual(a.buckets);
    expect(reopened?.b.buckets).toEqual(b.buckets);
    expect(reopened?.migration?.forward).toBe(2);
    const comparison = compareSnapshots(reopened!.a, reopened!.b);
    expect(comparison.totals.amountDelta).toBe(168250.6);
  });

  it('تُسرد الأحدث أولًا وتُحذف منفردة', async () => {
    const { a, b } = await seedPair();
    const first = await saveComparison({ title: 'الأولى', a, b });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await saveComparison({ title: 'الثانية', a: b, b: a });
    expect((await listSavedComparisons()).map((row) => row.title)).toEqual(['الثانية', 'الأولى']);
    expect(second.migration).toBeNull();

    await deleteSavedComparison(first.id);
    expect((await listSavedComparisons()).map((row) => row.id)).toEqual([second.id]);
    expect(await listSnapshots()).toHaveLength(2);
  });

  it('تتطلب عنوانًا وشهرين مختلفين', async () => {
    const { a, b } = await seedPair();
    expect((await errorsOf(saveComparison({ title: '   ', a, b }))).title).toBeTruthy();
    expect((await errorsOf(saveComparison({ title: 'س', a, b: a }))).title).toContain('مختلفين');
    expect(await listSavedComparisons()).toEqual([]);
  });

  it('إعادة الحفظ بنفس المعرّف تحدّث العنوان وتبقي تاريخ الإنشاء', async () => {
    const { a, b } = await seedPair();
    const saved = await saveComparison({ title: 'قديم', a, b });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await saveComparison({ id: saved.id, title: 'جديد', a, b });
    expect(updated.id).toBe(saved.id);
    expect(updated.createdAt).toBe(saved.createdAt);
    expect((await listSavedComparisons()).map((row) => row.title)).toEqual(['جديد']);
  });
});

describe('النسخ الاحتياطي لبيانات المتأخرات', () => {
  async function seedAll() {
    const a = await saveSnapshot(toInput('فرع المنيا', 2026, 9, SEP));
    const b = await saveSnapshot(toInput('فرع المنيا', 2026, 10, OCT));
    await saveClientList(a.id, parseClientList(LIST_A).clients);
    await saveComparison({ title: 'مقارنة محفوظة', a, b });
    return { a, b };
  }

  it('العدّ والتصدير يشملان الجداول الثلاثة', async () => {
    await seedAll();
    expect(await delinquencyCounts()).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
    const data = await exportDelinquencyData();
    expect(data.months).toHaveLength(2);
    expect(data.clientLists[0].clients).toHaveLength(6);
    expect(data.comparisons[0].title).toBe('مقارنة محفوظة');
  });

  it('ملف النسخة الاحتياطية للنظام يحمل كل البيانات ويُستعاد كاملًا', async () => {
    await seedAll();
    const file = await createBackupFile('إدارة المخاطر');
    expect(file.app).toBe(BACKUP_APP_ID);
    expect(file.formatVersion).toBe(1);
    expect(file.organization).toBe('إدارة المخاطر');
    expect(file.counts).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
    expect(backupFileName(new Date(2026, 10, 10, 9, 5))).toBe('نسخة-احتياطية-تحليل-المتأخرات_2026-11-10_0905.json');

    const parsed = parseBackupFile(JSON.stringify(file));
    if (!parsed.ok) throw new Error(parsed.errors.join(' | '));
    expect(parsed.organization).toBe('إدارة المخاطر');
    expect(parsed.exportedAt).toBe(file.exportedAt);

    await clearDelinquencyData();
    expect(await delinquencyCounts()).toEqual({ months: 0, clientLists: 0, comparisons: 0 });

    expect(await restoreDelinquencyData(parsed.data, 'replace')).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
    expect((await getSnapshot('2026-10|فرع المنيا'))?.buckets.npl).toEqual({ clients: 71, amount: 845250.1 });
    expect((await listSavedComparisons())[0].title).toBe('مقارنة محفوظة');
  });

  it('يقبل النسخة الشاملة السابقة التي كانت تحمل قسم delinquency', async () => {
    await seedAll();
    const section = await exportDelinquencyData();
    const parsed = parseBackupFile(JSON.stringify({ app: 'risk-officer-management-system', employees: [], delinquency: section }));
    if (!parsed.ok) throw new Error(parsed.errors.join(' | '));
    expect(parsed.data.months).toHaveLength(2);
    expect(parsed.data.clientLists).toHaveLength(1);
    expect(parsed.exportedAt).toBeNull();
  });

  it('يرفض الملفات الغريبة أو التالفة برسالة واضحة ودون أي كتابة', async () => {
    await seedAll();
    const errorsOfFile = (text: string) => {
      const parsed = parseBackupFile(text);
      return parsed.ok ? [] : parsed.errors;
    };
    expect(errorsOfFile('ليس JSON')[0]).toContain('JSON');
    expect(errorsOfFile('[1,2]')[0]).toContain('غير صالح');
    expect(errorsOfFile(JSON.stringify({ employees: [] }))[0]).toContain('ليس نسخة احتياطية لنظام تحليل ترحيل المتأخرات');
    expect(errorsOfFile(JSON.stringify({ app: BACKUP_APP_ID, formatVersion: 99, data: {} }))[0]).toContain('إصدار أحدث');
    expect(errorsOfFile(JSON.stringify({ app: BACKUP_APP_ID, formatVersion: 1, data: { months: [{ id: '' }] } }))).toHaveLength(1);

    // شهر بمعرّف صحيح لكن بيانات شرائحه ناقصة أو سالبة
    const file = JSON.parse(JSON.stringify(await createBackupFile()));
    delete file.data.months[0].buckets.npl;
    expect(errorsOfFile(JSON.stringify(file))[0]).toContain('إحدى الشرائح');
    const negative = JSON.parse(JSON.stringify(await createBackupFile()));
    negative.data.months[1].buckets.d1_30.clients = -3;
    expect(errorsOfFile(JSON.stringify(negative))[0]).toContain('إحدى الشرائح');
    const noPeriod = JSON.parse(JSON.stringify(await createBackupFile()));
    noPeriod.data.months[0].month = 13;
    expect(errorsOfFile(JSON.stringify(noPeriod))[0]).toContain('شهر أو سنة');

    expect(await delinquencyCounts()).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
  });

  it('الاستبدال يمحو ما ليس في النسخة، والدمج يبقيه ويأخذ الأحدث', async () => {
    const { a } = await seedAll();
    const backup = JSON.parse(JSON.stringify(await exportDelinquencyData()));

    // بعد النسخة: شهر جديد + تعديل لاحق على سبتمبر
    await saveSnapshot(toInput('فرع المنيا', 2026, 11, SEP));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveSnapshot(toInput('فرع المنيا', 2026, 9, ZERO));

    const merged = await restoreDelinquencyData(backup, 'merge');
    expect(merged.months).toBe(0);
    expect((await listSnapshots()).map((row) => row.id)).toEqual(['2026-09|فرع المنيا', '2026-10|فرع المنيا', '2026-11|فرع المنيا']);
    expect((await getSnapshot(a.id))?.buckets.d1_30.clients).toBe(0);

    // نسخة أحدث من الموجود تفوز عند الدمج
    const newer = JSON.parse(JSON.stringify(backup));
    newer.months[0].updatedAt = '2999-01-01T00:00:00.000Z';
    newer.months[0].buckets.d1_30.clients = 777;
    expect((await restoreDelinquencyData(newer, 'merge')).months).toBe(1);
    expect((await getSnapshot(newer.months[0].id))?.buckets.d1_30.clients).toBe(777);

    const replaced = await restoreDelinquencyData(backup, 'replace');
    expect(replaced).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
    expect((await listSnapshots()).map((row) => row.id)).toEqual(['2026-09|فرع المنيا', '2026-10|فرع المنيا']);
    expect((await getSnapshot(a.id))?.buckets.d1_30.clients).toBe(120);
  });

  it('يرفض قسم متأخرات تالفًا قبل أي كتابة', async () => {
    await seedAll();
    expect(validateDelinquencyBackup('x')).toHaveLength(1);
    expect(validateDelinquencyBackup({ months: {} })).toHaveLength(1);
    expect(validateDelinquencyBackup({ months: [{ id: 'a' }, { id: 'a' }] })[0]).toContain('مكرر');
    expect(validateDelinquencyBackup({ months: [{ nope: 1 }] })).toHaveLength(1);
    expect(validateDelinquencyBackup({})).toEqual([]);

    await expect(restoreDelinquencyData({ months: [{ id: '' }] } as never, 'replace')).rejects.toThrow();
    expect(await delinquencyCounts()).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
  });
});

describe('البيانات التجريبية', () => {
  it('تُحمَّل لآخر ثلاثة أشهر مكتملة، مميّزة بملاحظة، وقوائمها تطابق الإجماليات', async () => {
    expect(samplePeriods(new Date(2026, 10, 10))).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ]);
    expect(samplePeriods(new Date(2027, 0, 15)).map((period) => `${period.year}-${period.month}`)).toEqual(['2026-10', '2026-11', '2026-12']);

    expect(await loadSampleData(new Date(2026, 10, 10))).toEqual({ months: 5, clientLists: 2 });
    const months = await listSnapshots();
    expect(months.map((row) => row.id)).toEqual([
      `2026-08|${SAMPLE_BRANCH_A}`,
      `2026-09|${SAMPLE_BRANCH_A}`,
      `2026-09|${SAMPLE_BRANCH_B}`,
      `2026-10|${SAMPLE_BRANCH_A}`,
      `2026-10|${SAMPLE_BRANCH_B}`,
    ]);
    expect(months.every(isSampleSnapshot)).toBe(true);
    expect(months.every((row) => row.notes === SAMPLE_NOTE)).toBe(true);

    for (const id of [`2026-09|${SAMPLE_BRANCH_B}`, `2026-10|${SAMPLE_BRANCH_B}`]) {
      const snapshot = await getSnapshot(id);
      const list = await getClientList(id);
      expect(aggregateClientList(list!.clients)).toEqual(snapshot!.buckets);
    }

    // القائمتان تنتجان ترحيلًا فعليًا متنوعًا: تراجع، تحسّن، بقاء، خروج، دخول
    const lists = buildSampleClientLists();
    const migration = computeMigration(lists.previous, lists.current);
    expect(migration.forward).toBeGreaterThan(0);
    expect(migration.backward).toBeGreaterThan(0);
    expect(migration.stayed).toBeGreaterThan(0);
    expect(migration.exited).toBeGreaterThan(0);
    expect(migration.entered).toBe(6);
    expect(new Set(lists.previous.map((client) => client.id)).size).toBe(40);
  });

  it('لا تستبدل شهرًا أدخله المستخدم، وحذفها لا يمس البيانات الفعلية', async () => {
    await saveSnapshot(toInput(SAMPLE_BRANCH_A, 2026, 9, SEP));
    await expect(loadSampleData(new Date(2026, 10, 10))).rejects.toThrow();
    expect((await getSnapshot(`2026-09|${SAMPLE_BRANCH_A}`))?.notes).not.toBe(SAMPLE_NOTE);

    await clearDelinquencyData();
    await saveSnapshot(toInput('فرع المنيا', 2026, 9, SEP));
    await loadSampleData(new Date(2026, 10, 10));
    expect(await removeSampleData()).toBe(5);
    expect((await listSnapshots()).map((row) => row.id)).toEqual(['2026-09|فرع المنيا']);
    expect(await delinquencyCounts()).toEqual({ months: 1, clientLists: 0, comparisons: 0 });
  });
});
