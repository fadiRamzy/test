/**
 * قراءة نص ملف PDF داخل المتصفح (pdf.js) وإعادته كعناصر نصية بمواضعها على الصفحة.
 * المكتبة تُحمَّل عند الحاجة فقط (عند رفع ملف)، ولا يُرسل الملف إلى أي خادم.
 */
import type { PdfTextItem } from './parReport';

export type PdfReadErrorCode = 'invalid' | 'password' | 'scanned' | 'failed';

export class PdfReadError extends Error {
  code: PdfReadErrorCode;
  constructor(code: PdfReadErrorCode, message: string) {
    super(message);
    this.name = 'PdfReadError';
    this.code = code;
  }
}

export interface PdfText {
  items: PdfTextItem[];
  pageCount: number;
  /** صفحات بلا أي نص (صور ممسوحة ضوئيًا على الأرجح) */
  emptyPages: number[];
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // في المتصفح يعمل التحليل في Worker مستقل؛ خارج المتصفح (الاختبارات) تتولى المكتبة ذلك بنفسها
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      // يُبنى الـ Worker كملف ‎.js ضمن ملفات الموقع نفسها (لا تحميل من أي خادم خارجي)
      const { default: PdfWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker');
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    }
    return pdfjs;
  })();
  pdfjsPromise.catch(() => {
    pdfjsPromise = null;
  });
  return pdfjsPromise;
}

const isPdfHeader = (bytes: Uint8Array): boolean => {
  // «%PDF-» ضمن أول 1024 بايت (بعض الملفات تبدأ ببايتات إضافية)
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
};

/**
 * يقرأ كل صفحات الملف ويعيد عناصر النص بإحداثيات الصفحة كما تُعرض (بعد تطبيق دوران الصفحة).
 * يرمي PdfReadError برسالة واضحة: ملف غير صالح، محمي بكلمة مرور، أو ممسوح ضوئيًا بلا نص.
 */
export async function readPdfText(data: Uint8Array): Promise<PdfText> {
  if (!isPdfHeader(data)) throw new PdfReadError('invalid', 'الملف ليس PDF صالحًا.');

  let pdfjs: PdfJs;
  try {
    pdfjs = await loadPdfJs();
  } catch {
    throw new PdfReadError('failed', 'تعذّر تحميل قارئ PDF. تحقق من الاتصال ثم أعد المحاولة.');
  }

  // نسخة مستقلة: المكتبة تنقل ملكية المصفوفة إلى الـ Worker
  const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (cause) {
    const name = (cause as { name?: string } | null)?.name ?? '';
    if (name === 'PasswordException') throw new PdfReadError('password', 'الملف محمي بكلمة مرور. أزل الحماية ثم ارفعه من جديد.');
    if (name === 'InvalidPDFException') throw new PdfReadError('invalid', 'الملف ليس PDF صالحًا أو أنه تالف.');
    throw new PdfReadError('failed', 'تعذّرت قراءة ملف PDF.');
  }

  try {
    const items: PdfTextItem[] = [];
    const emptyPages: number[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let characters = 0;
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [, , , , x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        characters += item.str.trim().length;
        items.push({ page: number, x, y, width: item.width, height: item.height, text: item.str });
      }
      if (!characters) emptyPages.push(number);
      page.cleanup();
    }
    if (!items.length) {
      throw new PdfReadError(
        'scanned',
        'الملف لا يحتوي نصًا قابلًا للقراءة — يبدو أنه صور ممسوحة ضوئيًا ويحتاج إلى OCR. استخدم ملف PDF الأصلي المُصدَّر من النظام، أو أدخل البيانات يدويًا.',
      );
    }
    return { items, pageCount: doc.numPages, emptyPages };
  } catch (cause) {
    if (cause instanceof PdfReadError) throw cause;
    throw new PdfReadError('failed', 'تعذّرت قراءة نص ملف PDF.');
  } finally {
    void task.destroy();
  }
}
