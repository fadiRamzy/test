/**
 * تشكيل النص العربي وترتيب الاتجاه (RTL) لتقارير PDF.
 * الخطوط المضمّنة لا تدعم GSUB، لذلك تُستخدم أشكال الحروف العربية (Presentation Forms)
 * مع خوارزمية وصل قياسية وترتيب بصري RTL — النتيجة نصّ حقيقي قابل للبحث والنسخ.
 */
import type { FontMetrics } from '../pdf-times-fonts';
import { ARABIC_FORMS, ARABIC_JOINING, ARABIC_MARKS, LAM_ALEF, type ArabicForm } from '../pdf-arabic';

export interface PlacedGlyph {
  /** معرّف الشكل داخل الخط */
  gid: number;
  /** رمز المحرف الأصلي — لخريطة ToUnicode */
  code: number;
}

const isArabicLetter = (code: number) => ARABIC_JOINING[code] !== undefined;
const isMark = (code: number) => ARABIC_MARKS.has(code);
const isArabicPunct = (code: number) =>
  code === 0x060c || code === 0x061b || code === 0x061f || code === 0x00ab || code === 0x00bb;
const isDigit = (code: number) => (code >= 0x30 && code <= 0x39) || (code >= 0x660 && code <= 0x669) || (code >= 0x6f0 && code <= 0x6f9);
const isLatin = (code: number) => (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
const isNeutral = (code: number) => !isArabicLetter(code) && !isMark(code) && !isLatin(code) && !isDigit(code) && !isArabicPunct(code);

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
    out.push({ gid: metrics.chars[String(presentation)] ?? metrics.chars[String(code)] ?? 0, code: presentation });
    previousJoins = ARABIC_JOINING[code] === 'D';
  }

  return out;
}

type Direction = 'ltr' | 'rtl' | 'neutral';

interface Run {
  direction: Direction;
  chars: number[];
}

function classify(code: number): Direction {
  if (isArabicLetter(code) || isArabicPunct(code)) return 'rtl';
  if (isLatin(code) || isDigit(code)) return 'ltr';
  if (isNeutral(code)) return 'neutral';
  return 'rtl';
}

function splitRuns(text: string): Run[] {
  const chars = Array.from(text).map((char) => char.codePointAt(0) ?? 0);
  const runs: Run[] = [];
  for (const code of chars) {
    const direction = classify(code);
    const last = runs[runs.length - 1];
    if (last && last.direction === direction) {
      last.chars.push(code);
    } else {
      runs.push({ direction, chars: [code] });
    }
  }
  return runs;
}

/** يحلّ المحايدات: تتبع اتجاه الجار إن وُجد وإلا RTL (الأساس عربي) */
function resolveNeutrals(input: Run[]): Run[] {
  const runs = input.map((run, index) => {
    if (run.direction !== 'neutral') return run;
    const before = input[index - 1];
    const after = input[index + 1];
    if (before?.direction === 'ltr' && after?.direction === 'ltr') return { ...run, direction: 'ltr' as Direction };
    if (before?.direction === 'ltr' && !after) return { ...run, direction: 'ltr' as Direction };
    return { ...run, direction: 'rtl' as Direction };
  });

  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.direction === run.direction) last.chars.push(...run.chars);
    else merged.push({ ...run, chars: [...run.chars] });
  }
  return merged;
}

/**
 * يحوّل نصًا منطقيًا إلى Glyphs بترتيب بصري من اليسار إلى اليمين.
 * (الاتجاه الأساسي عربي RTL)
 */
export function shapeText(text: string, metrics: FontMetrics): PlacedGlyph[] {
  if (!text) return [];
  const runs = resolveNeutrals(splitRuns(text));
  const visual: PlacedGlyph[] = [];

  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run.direction === 'rtl') {
      const shaped = shapeArabicRun(run.chars, metrics);
      for (let i = shaped.length - 1; i >= 0; i -= 1) visual.push(shaped[i]);
    } else {
      for (const code of run.chars) {
        visual.push({ gid: metrics.chars[String(code)] ?? metrics.chars[String(0x20)] ?? 0, code });
      }
    }
  }

  return visual;
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
