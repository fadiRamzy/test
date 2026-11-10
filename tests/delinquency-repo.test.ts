import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup, validateBackup } from '../src/db/backup';
import { clearStore, useDatabase } from '../src/db/database';
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
} from '../src/db/delinquencyDb';
import { listEmployees, nextEmployeeNo, saveEmployee } from '../src/db/repo';
import { STORE_NAMES } from '../src/db/schema';
import { compareSnapshots } from '../src/lib/delinquency';
import { computeMigration, parseClientList } from '../src/lib/delinquencyMigration';
import { LIST_A, LIST_B, OCT, SEP, ZERO, toInput } from './delinquency-helpers';

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2);
  await useDatabase(`test-dq-main-${suffix}`);
  for (const store of STORE_NAMES) await clearStore(store);
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

  it('النسخة الاحتياطية العامة تتضمن قسم المتأخرات وتستعيده كاملًا', async () => {
    await seedAll();
    await saveEmployee({
      employeeNo: await nextEmployeeNo(),
      name: 'منى حسن',
      code: 'RO-D1',
      sector: 'قطاع الصعيد',
      governorate: 'المنيا',
      jobTitle: 'ضابط مخاطر',
      employmentDate: '2025-01-01',
      branches: '',
      status: 'active',
      notes: '',
    });
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    expect(validateBackup(backup).ok).toBe(true);
    expect(backup.delinquency.months).toHaveLength(2);

    await clearDelinquencyData();
    for (const store of STORE_NAMES) await clearStore(store);
    expect(await delinquencyCounts()).toEqual({ months: 0, clientLists: 0, comparisons: 0 });

    const result = await restoreBackup(backup, 'replace');
    expect(result.imported.delinquencyMonths).toBe(2);
    expect(result.imported.delinquencyClientLists).toBe(1);
    expect(result.imported.delinquencyComparisons).toBe(1);
    expect(await delinquencyCounts()).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
    expect((await getSnapshot('2026-10|فرع المنيا'))?.buckets.npl).toEqual({ clients: 71, amount: 845250.1 });
    expect((await listEmployees()).map((employee) => employee.name)).toEqual(['منى حسن']);
  });

  it('نسخة قديمة بلا قسم المتأخرات تُستعاد دون المساس ببيانات المتأخرات', async () => {
    const legacy = JSON.parse(JSON.stringify(await createBackup()));
    delete legacy.delinquency;
    expect(validateBackup(legacy).ok).toBe(true);

    await seedAll();
    await restoreBackup(legacy, 'replace');
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

    const backup = JSON.parse(JSON.stringify(await createBackup()));
    backup.delinquency.months = [{ id: '' }];
    expect(validateBackup(backup).ok).toBe(false);
    await expect(restoreBackup(backup, 'replace')).rejects.toThrow();
    expect(await delinquencyCounts()).toEqual({ months: 2, clientLists: 1, comparisons: 1 });
  });
});
