/**
 * بيانات تجريبية اختيارية لاستكشاف النظام قبل إدخال البيانات الفعلية.
 *
 * - تُحمَّل فقط بطلب صريح من المستخدم، وتُميَّز بملاحظة ثابتة (SAMPLE_NOTE)
 *   حتى تظهر عليها علامة «تجريبية» ويمكن حذفها كلها بضغطة واحدة.
 * - ليست بيانات أي فرع حقيقي.
 */
import { BUCKET_IDS, bucketForDays, round2, type BucketId, type SnapshotInput } from './delinquency';
import { aggregateClientList, type ClientRecord } from './delinquencyMigration';
import { deleteSnapshot, listSnapshots, saveClientList, saveSnapshot } from '../db/delinquencyDb';

export const SAMPLE_NOTE = 'بيانات تجريبية — للاستكشاف فقط، احذفها قبل إدخال بياناتك الفعلية.';
export const SAMPLE_BRANCH_A = 'فرع تجريبي (أ)';
export const SAMPLE_BRANCH_B = 'فرع تجريبي (ب)';

type Pairs = Array<[clients: number, amount: number]>;

/** فرع (أ): إجماليات شهرية فقط — بدون قوائم عملاء */
const BRANCH_A: Pairs[] = [
  [[100, 400000], [70, 300000], [40, 250000], [25, 180000], [55, 650000]],
  [[120, 480000.5], [80, 320000], [45, 270000.25], [30, 210000], [60, 770000]],
  [[135, 528500.75], [70, 281000], [52, 315500.5], [28, 198000], [71, 895250.1]],
];

function toInput(branch: string, year: number, month: number, pairs: Pairs): SnapshotInput {
  const buckets = {} as Record<BucketId, { clients: number; amount: number }>;
  BUCKET_IDS.forEach((id, index) => {
    buckets[id] = { clients: pairs[index][0], amount: pairs[index][1] };
  });
  return { branch, year, month, buckets, notes: SAMPLE_NOTE };
}

const DAYS = [4, 9, 15, 22, 27, 33, 41, 48, 56, 63, 70, 77, 85, 93, 101, 110, 118, 135, 160, 210];

/** فرع (ب): قائمتا عملاء لشهرين متتاليين — تسمح بعرض الترحيل الفعلي بين الشرائح */
export function buildSampleClientLists(): { previous: ClientRecord[]; current: ClientRecord[] } {
  const previous: ClientRecord[] = [];
  const current: ClientRecord[] = [];
  const make = (id: string, days: number, amount: number): ClientRecord => ({
    id,
    days,
    bucket: bucketForDays(days) as BucketId,
    amount: round2(amount),
  });

  for (let i = 0; i < 40; i += 1) {
    const id = `C-${1001 + i}`;
    const days = DAYS[i % DAYS.length];
    const amount = 900 + ((i * 370) % 4200) + days * 12;
    previous.push(make(id, days, amount));

    const pattern = i % 8;
    if (pattern === 3) continue; // خرج من المتأخرات (السبب غير معروف من البيانات)
    if (pattern === 6 && days > 30) {
      current.push(make(id, days - 30, amount * 0.7)); // تحسّن شريحة واحدة
    } else if (pattern === 0 || pattern === 1 || pattern === 5) {
      current.push(make(id, days + 30, amount * 1.25)); // تراجع شريحة واحدة
    } else {
      current.push(make(id, days, amount)); // بقي في شريحته
    }
  }
  // عملاء جدد دخلوا المتأخرات في الشهر الأحدث
  [6, 11, 17, 24, 29, 8].forEach((days, index) => current.push(make(`C-${2001 + index}`, days, 700 + index * 180)));
  return { previous, current };
}

/** آخر ثلاثة أشهر مكتملة قبل التاريخ المعطى (الأقدم أولًا) */
export function samplePeriods(today = new Date()): Array<{ year: number; month: number }> {
  const periods: Array<{ year: number; month: number }> = [];
  for (let back = 3; back >= 1; back -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - back, 1);
    periods.push({ year: date.getFullYear(), month: date.getMonth() + 1 });
  }
  return periods;
}

/** يحمّل البيانات التجريبية. لا يستبدل أي شهر موجود (يتوقف بخطأ إن وُجد تعارض). */
export async function loadSampleData(today = new Date()): Promise<{ months: number; clientLists: number }> {
  const periods = samplePeriods(today);
  let months = 0;
  for (let index = 0; index < periods.length; index += 1) {
    await saveSnapshot(toInput(SAMPLE_BRANCH_A, periods[index].year, periods[index].month, BRANCH_A[index]), { overwrite: false });
    months += 1;
  }

  const lists = buildSampleClientLists();
  const pairsOf = (clients: ClientRecord[]): Pairs => {
    const totals = aggregateClientList(clients);
    return BUCKET_IDS.map((id) => [totals[id].clients, totals[id].amount]);
  };
  const previous = await saveSnapshot(toInput(SAMPLE_BRANCH_B, periods[1].year, periods[1].month, pairsOf(lists.previous)), { overwrite: false });
  const current = await saveSnapshot(toInput(SAMPLE_BRANCH_B, periods[2].year, periods[2].month, pairsOf(lists.current)), { overwrite: false });
  await saveClientList(previous.id, lists.previous);
  await saveClientList(current.id, lists.current);
  return { months: months + 2, clientLists: 2 };
}

export const isSampleSnapshot = (snapshot: { notes: string }): boolean => snapshot.notes === SAMPLE_NOTE;

/** يحذف الأشهر التجريبية فقط (وقوائم عملائها) ولا يمس أي بيانات أدخلها المستخدم */
export async function removeSampleData(): Promise<number> {
  const samples = (await listSnapshots()).filter(isSampleSnapshot);
  for (const snapshot of samples) await deleteSnapshot(snapshot.id);
  return samples.length;
}
