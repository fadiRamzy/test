/** تحميل الخطوط المضمّنة لتقارير PDF (مرة واحدة ثم تُحفظ في الذاكرة) */
import { FONT_BOLD, FONT_REGULAR } from '../pdf-fonts';
import type { PdfFontSource } from './writer';

let cached: { regular: PdfFontSource; bold: PdfFontSource } | null = null;

async function fetchFont(file: string): Promise<Uint8Array> {
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base.endsWith('/') ? base : `${base}/`}fonts/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`تعذّر تحميل خط التقرير (${file}).`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadReportFonts(): Promise<{ regular: PdfFontSource; bold: PdfFontSource }> {
  if (cached) return cached;
  const [regular, bold] = await Promise.all([
    fetchFont('cash-arabic-regular.ttf'),
    fetchFont('cash-arabic-bold.ttf'),
  ]);
  cached = {
    regular: { metrics: FONT_REGULAR, bytes: regular },
    bold: { metrics: FONT_BOLD, bytes: bold },
  };
  return cached;
}

/** تنزيل ملف PDF */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
