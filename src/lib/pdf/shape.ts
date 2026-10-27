/**
 * تشكيل النص العربي وترتيب الاتجاه (RTL) لتقارير PDF.
 * الخطوط المضمّنة لا تدعم GSUB، لذلك تُستخدم أشكال الحروف العربية (Presentation Forms)
 * مع خوارزمية وصل قياسية وترتيب بصري RTL — النتيجة نصّ حقيقي قابل للبحث والنسخ.
 */
import bidiFactory from 'bidi-js';
import type { FontMetrics } from '../pdf-times-fonts';
import { ARABIC_FORMS, ARABIC_JOINING, ARABIC_MARKS, LAM_ALEF, type ArabicForm } from '../pdf-arabic';

const bidi = bidiFactory();

export interface PlacedGlyph {
  /** معرّف الشكل داخل الخط */
  gid: number;
  /** رمز المحرف الأصلي — لخريطة ToUnicode */
  code: number;
}

const isArabicLetter = (code: number) => ARABIC_JOINING[code] !== undefined;
const isMark = (code: number) => ARABIC_MARKS.has(code);

/** أنواع تشكيل الحروف */
function letterForm(chars: number[], index: number, previousJoins: boolean): ArabicForm {
  const code = chars[index];
  const forms = ARABIC_FORMS[code];
  const joining = ARABIC_JOINING[code];
  if (!forms || !joining || joining === 'U') return 'isolated';

  let nextIndex = index + 1;
  while (nextIndex < chars.length && isMark(chars[nextIndex])) nextIndex += 1;
  const nextCode = nextIndex < chars.length ? chars[nextIndex] : -1;
  const nextJoining = nextCode === -1 ? undefined : ARABIC_JOINING[nextCode];
  const connectsNext = nextJoining === 'D' || nextJoining === 'R';

  if (previousJoins && connectsNext && forms.medial) return 'medial';
  if (previousJoins && forms.final) return 'final';
  if (connectsNext && forms.initial) return 'initial';
  return 'isolated';
}

/** يشكّل مقطعًا عربيًا (ترتيب منطقي) ويعيد الأشكال بترتيب منطقي */
function shapeArabicRun(chars: number[], metrics: FontMetrics): PlacedGlyph[] {
  const out: PlacedGlyph[] = [];
  let previousJoins = false;

  for (let index = 0; index < chars.length; index += 1) {
    const code = chars[index];

    if (isMark(code)) {
      out.push({ gid: metrics.chars[String(code)] ?? 0, code });
      continue;
    }
    if (!isArabicLetter(code)) {
      out.push({ gid: metrics.chars[String(code)] ?? metrics.chars[String(0x3f)] ?? 0, code });
      previousJoins = false;
      continue;
    }

    const nextIsAlef = index + 1 < chars.length && LAM_ALEF[chars[index + 1]] !== undefined;
    if (code === 0x0644 && nextIsAlef) {
      const [isolated, final] = LAM_ALEF[chars[index + 1]];
      const ligature = previousJoins ? final : isolated;
      out.push({ gid: metrics.chars[String(ligature)] ?? 0, code: ligature });
      index += 1;
      previousJoins = false;
      continue;
    }

    const form = letterForm(chars, index, previousJoins);
    const presentation = ARABIC_FORMS[code][form] ?? code;
    // Draw the contextual presentation glyph, but map it back to the logical Unicode character.
    out.push({ gid: metrics.chars[String(presentation)] ?? metrics.chars[String(code)] ?? 0, code });
    previousJoins = ARABIC_JOINING[code] === 'D';
  }

  return out;
}

/** Apply the Unicode Bidirectional Algorithm, then shape Arabic joining runs in logical order. */
export function shapeText(text: string, metrics: FontMetrics): PlacedGlyph[] {
  if (!text) return [];
  const levels = bidi.getEmbeddingLevels(text, 'rtl');
  const visualText = bidi.getReorderedString(text, levels);
  const chars = Array.from(visualText).map(char => char.codePointAt(0) ?? 0);
  const result: PlacedGlyph[] = [];
  let index = 0;
  while (index < chars.length) {
    const code = chars[index];
    const type = bidi.getBidiCharTypeName(String.fromCodePoint(code));
    const isRtlArabic = isArabicLetter(code) || (isMark(code) && index > 0 && isArabicLetter(chars[index - 1]));
    if (isRtlArabic && (type === 'R' || type === 'AL' || type === 'NSM')) {
      const visualRun: number[] = [];
      while (index < chars.length) {
        const current = chars[index];
        const currentType = bidi.getBidiCharTypeName(String.fromCodePoint(current));
        if (!(isArabicLetter(current) || isMark(current)) || !(currentType === 'R' || currentType === 'AL' || currentType === 'NSM')) break;
        visualRun.push(current);
        index += 1;
      }
      const shaped = shapeArabicRun(visualRun.reverse(), metrics);
      result.push(...shaped.reverse());
      continue;
    }
    result.push({ gid: metrics.chars[String(code)] ?? metrics.chars[String(0x20)] ?? 0, code });
    index += 1;
  }
  return result;
}

/** عرض Glyphs بوحدات النص (مقياس 1/1000) */
export function measureGlyphs(glyphs: PlacedGlyph[], metrics: FontMetrics): number {
  let total = 0;
  for (const glyph of glyphs) total += metrics.widths[glyph.gid] ?? 0;
  return (total * 1000) / metrics.unitsPerEm;
}

/** عرض نص عند حجم خط معيّن */
export function measureText(text: string, size: number, metrics: FontMetrics): number {
  return (measureGlyphs(shapeText(text, metrics), metrics) * size) / 1000;
}

/** تقسيم نص إلى أسطر بحسب العرض المتاح بالنقاط */
export function wrapText(text: string, size: number, maxWidth: number, metrics: FontMetrics): string[] {
  const words = (text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measureText(candidate, size, metrics) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  // كلمة واحدة أطول من العرض: تُقصَّ إلى مقاطع بحسب الحروف
  const final: string[] = [];
  for (const line of lines) {
    if (measureText(line, size, metrics) <= maxWidth || line.length <= 1) {
      final.push(line);
      continue;
    }
    let buffer = '';
    for (const char of Array.from(line)) {
      if (buffer && measureText(buffer + char, size, metrics) > maxWidth) {
        final.push(buffer);
        buffer = char;
      } else {
        buffer += char;
      }
    }
    if (buffer) final.push(buffer);
  }
  return final.length ? final : [''];
}
