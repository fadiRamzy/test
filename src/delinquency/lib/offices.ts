/**
 * المكاتب التسعة عشر المطلوبة في تقرير «المحفظة في ظل المخاطر»، بالترتيب المعتمد للجداول والتصدير.
 */

export const OFFICES = [
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
] as const;

export type OfficeName = (typeof OFFICES)[number];

/**
 * يوحّد النص العربي للمطابقة فقط (لا يُستخدم للعرض):
 * أشكال العرض (Presentation Forms) ← الحروف الأساسية، حذف التشكيل والتطويل وعلامات الاتجاه،
 * توحيد الألف والياء والتاء المربوطة والهمزات، وضغط المسافات.
 */
export function normalizeArabic(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

const reverseText = (text: string): string => Array.from(text).reverse().join('');

const OFFICE_KEYS = new Map<string, OfficeName>(OFFICES.map((name) => [normalizeArabic(name), name]));

/**
 * يطابق اسم مكتب كما ورد في الملف مع القائمة المعتمدة مطابقة تامة بعد التوحيد
 * («مكتب بني سويف» لا يطابق «مكتب بني سويف شرق»). بعض ملفات PDF تخزّن النص العربي
 * معكوسًا (ترتيب بصري) فيُجرَّب العكس أيضًا. يعيد null إن لم يكن الاسم من القائمة.
 */
export function matchOffice(text: string): OfficeName | null {
  const key = normalizeArabic(text);
  return OFFICE_KEYS.get(key) ?? OFFICE_KEYS.get(normalizeArabic(reverseText(text.normalize('NFKC')))) ?? null;
}

/** ترتيب المكتب في القائمة المعتمدة (−1 لغير المدرج) */
export function officeRank(name: string): number {
  const match = matchOffice(name);
  return match ? OFFICES.indexOf(match) : -1;
}

/**
 * مقارنة أسماء الفروع للترتيب: المكاتب المعتمدة أولًا بترتيبها، ثم باقي الفروع أبجديًا.
 */
export function compareBranchNames(a: string, b: string): number {
  const ra = officeRank(a);
  const rb = officeRank(b);
  if (ra !== -1 && rb !== -1) return ra - rb;
  if (ra !== -1) return -1;
  if (rb !== -1) return 1;
  return a.localeCompare(b, 'ar');
}
