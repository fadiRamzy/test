import { describe, expect, it } from 'vitest';
import { BUCKET_IDS, compareSnapshots, emptyBuckets } from '../src/lib/delinquency';
import {
  FROM_STATES,
  TO_STATES,
  aggregateClientList,
  buildNetChangeFrame,
  computeMigration,
  parseClientList,
  reconcileWithList,
  serializeClientList,
  type ClientRecord,
} from '../src/lib/delinquencyMigration';
import { buildExecutiveSummary } from '../src/lib/delinquencySummary';
import { LIST_A, LIST_B, oct, sep } from './delinquency-helpers';

const listA = () => parseClientList(LIST_A).clients;
const listB = () => parseClientList(LIST_B).clients;

describe('قراءة قائمة العملاء', () => {
  it('تقرأ الأعمدة المفصولة بـ Tab (لصق من Excel)', () => {
    const parsed = parseClientList(LIST_A);
    expect(parsed.errors).toEqual([]);
    expect(parsed.clients).toHaveLength(6);
    expect(parsed.hasAmounts).toBe(true);
    expect(parsed.clients[0]).toEqual({ id: 'C1', bucket: 'd1_30', days: 10, amount: 1000 });
    expect(parsed.clients[4]).toEqual({ id: 'C5', bucket: 'npl', days: 200, amount: 5000 });
  });

  it('تتخطى سطر العناوين وتقبل CSV وBOM ونهايات CRLF', () => {
    const parsed = parseClientList('\ufeffرقم العميل,أيام التأخير,المبلغ\r\nA-1,45,2500.50\r\n\r\nA-2,121,100\r\n');
    expect(parsed.headerSkipped).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toBe(2);
    expect(parsed.clients).toEqual([
      { id: 'A-1', bucket: 'd31_60', days: 45, amount: 2500.5 },
      { id: 'A-2', bucket: 'npl', days: 121, amount: 100 },
    ]);
  });

  it('تقبل فواصل الآلاف داخل المبلغ في CSV', () => {
    const parsed = parseClientList('C1,45,1,250.50\nC2,10,"12,000"');
    expect(parsed.errors).toEqual([]);
    expect(parsed.clients.map((client) => client.amount)).toEqual([1250.5, 12000]);
  });

  it('تقبل الأرقام العربية والفاصلة العربية والفاصلة المنقوطة', () => {
    const parsed = parseClientList('١٢٣٤،٤٥،٢٠٠٠\n٥٦٧٨;٩٥;٣٠٠٫٥\n9|7|1');
    expect(parsed.errors).toEqual([]);
    expect(parsed.clients).toEqual([
      { id: '1234', bucket: 'd31_60', days: 45, amount: 2000 },
      { id: '5678', bucket: 'd91_120', days: 95, amount: 300.5 },
      { id: '9', bucket: 'd1_30', days: 7, amount: 1 },
    ]);
  });

  it('تقبل اسم الشريحة بدل الأيام', () => {
    const parsed = parseClientList('a\t1-30\nb\t31–60\nc\t61-90 يوم\nd\t91 - 120\ne\tNPL\nf\t+120\ng\tأكثر من 120\nh\tمتعثر\ni\t120+\nj\t45 يوم');
    expect(parsed.errors).toEqual([]);
    expect(parsed.clients.map((client) => client.bucket)).toEqual([
      'd1_30',
      'd31_60',
      'd61_90',
      'd91_120',
      'npl',
      'npl',
      'npl',
      'npl',
      'npl',
      'd31_60',
    ]);
    expect(parsed.clients[0].days).toBeNull();
    expect(parsed.clients[9].days).toBe(45);
    expect(parsed.hasAmounts).toBe(false);
  });

  it('العميل بصفر يوم غير متأخر: يُحصى ولا يدخل القائمة', () => {
    const parsed = parseClientList('x\t0\t500\ny\t3\t100');
    expect(parsed.errors).toEqual([]);
    expect(parsed.notOverdue).toBe(1);
    expect(parsed.clients.map((client) => client.id)).toEqual(['y']);
  });

  it('تبلّغ عن الأخطاء برقم السطر: تكرار، رقم مفقود، أيام أو مبلغ غير صالح', () => {
    const parsed = parseClientList(['C1\t10\t100', 'C1\t40\t200', '\t15\t50', 'C3\tabc\t10', 'C4\t20\t-5', 'C5\t10-20\t1', 'C6', 'C7\t-4'].join('\n'));
    expect(parsed.clients.map((client) => client.id)).toEqual(['C1']);
    expect(parsed.errors.map((issue) => issue.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(parsed.errors[0].message).toContain('مكرر');
    expect(parsed.errors[0].message).toContain('السطر 1');
    expect(parsed.errors[1].message).toContain('مفقود');
    expect(parsed.errors[2].message).toContain('أيام التأخير');
    expect(parsed.errors[3].message).toContain('مبلغ غير صالح');
    expect(parsed.errors[4].message).toContain('أيام التأخير');
    expect(parsed.errors[5].message).toContain('أيام التأخير');
    expect(parsed.errors[6].message).toContain('أيام التأخير');
  });

  it('أرقام العملاء تُطابَق بعد توحيد الأرقام العربية والمسافات', () => {
    const parsed = parseClientList('١٠٠\t5\n100\t9');
    expect(parsed.clients).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toContain('مكرر');
  });

  it('نص فارغ ← قائمة فارغة بلا أخطاء', () => {
    const parsed = parseClientList('  \n\n');
    expect(parsed).toMatchObject({ clients: [], errors: [], lines: 0, notOverdue: 0, hasAmounts: false });
  });

  it('التحويل إلى نص ثم القراءة يعيد نفس القائمة', () => {
    const clients: ClientRecord[] = [
      ...listA(),
      { id: 'L1', bucket: 'npl', days: null, amount: null },
      { id: 'L2', bucket: 'd1_30', days: null, amount: 12.5 },
      { id: 'L3', bucket: 'd91_120', days: null, amount: null },
    ];
    const reparsed = parseClientList(serializeClientList(clients));
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.clients).toEqual(clients);
  });
});

describe('تجميع القائمة ومطابقتها مع الإجماليات المدخلة', () => {
  it('تجمع الأعداد والمبالغ لكل شريحة', () => {
    const buckets = aggregateClientList(listA());
    expect(buckets.d1_30).toEqual({ clients: 2, amount: 1600 });
    expect(buckets.d31_60).toEqual({ clients: 1, amount: 2000 });
    expect(buckets.d61_90).toEqual({ clients: 1, amount: 3000 });
    expect(buckets.d91_120).toEqual({ clients: 1, amount: 4000 });
    expect(buckets.npl).toEqual({ clients: 1, amount: 5000 });
  });

  it('تطابق عند تساوي الأعداد والمبالغ وتكشف الفروق', () => {
    const buckets = aggregateClientList(listA());
    expect(reconcileWithList(buckets, listA()).matches).toBe(true);

    const altered = { ...buckets, npl: { clients: 2, amount: 5000.5 } };
    const result = reconcileWithList(altered, listA());
    expect(result.matches).toBe(false);
    const npl = result.rows.find((row) => row.bucket === 'npl')!;
    expect(npl.clientsDiff).toBe(-1);
    expect(npl.amountDiff).toBe(-0.5);
  });

  it('قائمة بلا مبالغ تُطابَق بالأعداد فقط', () => {
    const clients = parseClientList('a\t5\nb\t200').clients;
    const buckets = emptyBuckets();
    buckets.d1_30 = { clients: 1, amount: 999 };
    buckets.npl = { clients: 1, amount: 123 };
    const result = reconcileWithList(buckets, clients);
    expect(result.matches).toBe(true);
    expect(result.rows.every((row) => row.amountDiff === null && row.listAmount === null)).toBe(true);
  });
});

describe('مصفوفة الترحيل الفعلية (بأرقام العملاء)', () => {
  const migration = computeMigration(listA(), listB());

  it('تضع كل عميل في خلية واحدة صحيحة', () => {
    const expected: Record<string, number> = {
      'd1_30>d31_60': 1,
      'd1_30>exit': 1,
      'd31_60>d1_30': 1,
      'd61_90>d61_90': 1,
      'd91_120>npl': 1,
      'npl>exit': 1,
      'new>d1_30': 1,
      'new>npl': 1,
    };
    for (const from of FROM_STATES)
      for (const to of TO_STATES) expect(migration.matrix[from][to].clients, `${from}>${to}`).toBe(expected[`${from}>${to}`] ?? 0);
    expect(migration.kind).toBe('actual');
  });

  it('تلخص الحركة: أسوأ، ثبات، تحسن، خروج، دخول', () => {
    expect(migration.clientsA).toBe(6);
    expect(migration.clientsB).toBe(6);
    expect(migration.forward).toBe(2);
    expect(migration.stayed).toBe(1);
    expect(migration.backward).toBe(1);
    expect(migration.exited).toBe(2);
    expect(migration.entered).toBe(2);
    expect(migration.intoNpl).toBe(2);
    expect(migration.forward + migration.stayed + migration.backward + migration.exited).toBe(migration.clientsA);
    expect(migration.forwardRate).toBeCloseTo(33.3333333, 6);
    expect(migration.stayedRate).toBeCloseTo(16.6666667, 6);
    expect(migration.exitRate).toBeCloseTo(33.3333333, 6);
  });

  it('المبالغ: رصيد شهر المقارنة للباقين ورصيد شهر الأساس للخارجين', () => {
    expect(migration.hasAmounts).toBe(true);
    expect(migration.matrix.d1_30.d31_60.amount).toBe(1100);
    expect(migration.matrix.d31_60.d1_30.amount).toBe(1500);
    expect(migration.matrix.d91_120.npl.amount).toBe(4200);
    expect(migration.matrix.d1_30.exit.amount).toBe(600);
    expect(migration.matrix.npl.exit.amount).toBe(5000);
    expect(migration.matrix.new.npl.amount).toBe(900);
    expect(migration.exitedAmount).toBe(5600);
    expect(migration.enteredAmount).toBe(1200);
  });

  it('مجاميع الصفوف = قائمة شهر الأساس ومجاميع الأعمدة = قائمة شهر المقارنة', () => {
    const fromA = aggregateClientList(listA());
    const fromB = aggregateClientList(listB());
    for (const id of BUCKET_IDS) {
      expect(migration.rowTotals[id].clients).toBe(fromA[id].clients);
      expect(migration.columnTotals[id].clients).toBe(fromB[id].clients);
      expect(migration.columnTotals[id].amount).toBe(fromB[id].amount);
    }
    expect(migration.rowTotals.new.clients).toBe(2);
    expect(migration.columnTotals.exit.clients).toBe(2);
  });

  it('حركة كل شريحة', () => {
    const flow = (id: string) => migration.flows.find((item) => item.bucket === id)!;
    expect(flow('d1_30')).toMatchObject({ startClients: 2, stayed: 0, forward: 1, backward: 0, exited: 1, forwardRate: 50, exitRate: 50 });
    expect(flow('d31_60')).toMatchObject({ startClients: 1, backward: 1, backwardRate: 100 });
    expect(flow('d61_90')).toMatchObject({ startClients: 1, stayed: 1, stayedRate: 100 });
    expect(flow('d91_120')).toMatchObject({ startClients: 1, forward: 1 });
    expect(flow('npl')).toMatchObject({ startClients: 1, exited: 1, forward: 0 });
  });

  it('بلا مبالغ: الأعداد تُحسب والمبالغ تبقى غير متاحة', () => {
    const a = parseClientList('C1\t10\nC2\t40').clients;
    const b = parseClientList('C1\t40\nC2\t40').clients;
    const result = computeMigration(a, b);
    expect(result.hasAmounts).toBe(false);
    expect(result.matrix.d1_30.d31_60).toEqual({ clients: 1, amount: null });
    expect(result.exitedAmount).toBeNull();
    expect(result.enteredAmount).toBeNull();
    expect(result.forward).toBe(1);
    expect(result.stayed).toBe(1);
  });

  it('قائمة أساس فارغة: كل العملاء دخول جديد والنسب غير محددة', () => {
    const result = computeMigration([], listB());
    expect(result.clientsA).toBe(0);
    expect(result.entered).toBe(6);
    expect(result.forwardRate).toBeNull();
    expect(result.exitRate).toBeNull();
    expect(result.flows.every((flow) => flow.forwardRate === null)).toBe(true);
  });

  it('قائمة مقارنة فارغة: كل العملاء خرجوا', () => {
    const result = computeMigration(listA(), []);
    expect(result.exited).toBe(6);
    expect(result.exitRate).toBe(100);
    expect(result.entered).toBe(0);
    expect(result.exitedAmount).toBe(15600);
  });

  it('قروش المبالغ تُجمع بلا أخطاء عائمة', () => {
    const a = parseClientList('a\t5\t0.1\nb\t6\t0.2\nc\t7\t0.3').clients;
    const b = parseClientList('a\t5\t0.1\nb\t6\t0.2\nc\t7\t0.4').clients;
    const result = computeMigration(a, b);
    expect(result.matrix.d1_30.d1_30).toEqual({ clients: 3, amount: 0.7 });
    expect(result.columnTotals.d1_30.amount).toBe(0.7);
  });

  it('الملخص التنفيذي يذكر الترحيل الفعلي ويصف الخروج بأن سببه غير محدد', () => {
    const summary = buildExecutiveSummary(compareSnapshots(sep(), oct()), migration);
    const observation = summary.observations.find((item) => item.id === 'migration')!;
    expect(observation.title).toContain('الترحيل الفعلي');
    expect(observation.tone).toBe('danger');
    expect(observation.text).toContain('سبب الخروج غير محدد');
    expect(observation.text).not.toContain('تحصيل');
  });
});

describe('إطار المصفوفة من البيانات الإجمالية', () => {
  const frame = buildNetChangeFrame(sep().buckets, oct().buckets);

  it('يعطي المجاميع الطرفية وصافي التغير فقط', () => {
    expect(frame.kind).toBe('aggregate');
    expect(frame.cellsKnown).toBe(false);
    expect(frame.rowTotals.d1_30).toEqual({ clients: 120, amount: 450000.5 });
    expect(frame.columnTotals.d1_30).toEqual({ clients: 135, amount: 498500.75 });
    expect(BUCKET_IDS.map((id) => frame.netClients[id])).toEqual([15, -10, 7, -2, 11]);
    expect(BUCKET_IDS.map((id) => frame.netAmount[id])).toEqual([48500.25, -39000, 45500.25, -12000, 125250.1]);
  });

  it('لا يحتوي أي خلايا ترحيل مُستنتَجة من الإجماليات', () => {
    expect(Object.keys(frame).sort()).toEqual(['cellsKnown', 'columnTotals', 'kind', 'netAmount', 'netClients', 'rowTotals']);
    expect(frame).not.toHaveProperty('matrix');
    expect(frame).not.toHaveProperty('cells');
    expect(frame).not.toHaveProperty('forward');
  });
});
