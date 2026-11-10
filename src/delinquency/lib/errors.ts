/** أخطاء نظام تحليل ترحيل المتأخرات */

/** خطأ تحقق يحمل رسالة لكل حقل (المفتاح = اسم الحقل) */
export class ValidationError extends Error {
  errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? 'بيانات غير صحيحة');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** أول رسالة مفهومة من أي خطأ */
export function errorMessage(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'errors' in cause) {
    const first = Object.values((cause as { errors: Record<string, string> }).errors)[0];
    if (first) return first;
  }
  return cause instanceof Error && cause.message ? cause.message : 'حدث خطأ غير متوقع.';
}
