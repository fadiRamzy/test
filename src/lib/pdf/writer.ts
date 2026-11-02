/**
 * كاتب PDF صغير بلا اعتماديات خارجية.
 * - نص حقيقي (vector) بخط TrueType مضمّن بصيغة Type0/Identity-H.
 * - ضغط Flate عند توفّر CompressionStream (وإلا تُكتب البيانات غير مضغوطة).
 */
import type { FontMetrics } from '../pdf-times-fonts';
import { measureGlyphs, shapeText } from './shape';

const encoder = new TextEncoder();

export interface PdfFontSource {
  metrics: FontMetrics;
  /** ملف TTF المضمّن (مُجزَّأ مسبقًا) */
  bytes: Uint8Array;
}

interface FontHandle {
  name: string;
  metrics: FontMetrics;
  bytes: Uint8Array;
  resourceName: string;
  type0Id: number;
  cidId: number;
  descriptorId: number;
  fileId: number;
  toUnicodeId: number;
}

const hex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

const utf8 = (text: string): Uint8Array => encoder.encode(text);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!Stream) return null;
  try {
    const stream = new Stream('deflate');
    const writer = stream.writable.getWriter();
    void writer.write(bytes as unknown as BufferSource);
    void writer.close();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
    }
    return concat(chunks);
  } catch {
    return null;
  }
}

export class PdfPage {
  readonly ops: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly fonts: Map<string, FontMetrics>,
  ) {}

  /** إحداثيات PDF من أعلى الصفحة (y للأسفل) */
  rect(x: number, top: number, width: number, height: number, options: { fill?: string; stroke?: string; lineWidth?: number } = {}) {
    const y = this.height - top - height;
    if (options.fill) this.ops.push(`${options.fill} rg ${x} ${y} ${width} ${height} re f`);
    if (options.stroke) {
      this.ops.push(`${options.stroke} RG ${options.lineWidth ?? 0.5} w ${x} ${y} ${width} ${height} re S`);
    }
  }

  line(x1: number, top1: number, x2: number, top2: number, color = '0.616 0.616 0.616', lineWidth = 0.5) {
    this.ops.push(
      `${color} RG ${lineWidth} w ${x1} ${this.height - top1} m ${x2} ${this.height - top2} l S`,
    );
  }

  /** مثلث/شكل مملوء بمسار */
  path(commands: string, fill: string) {
    this.ops.push(`${fill} rg ${commands} f`);
  }

  /**
   * يرسم نصًا (منطقيًا) في مستطيل: x يسار، top أعلى، width العرض المتاح.
   * الاتجاه الأساسي عربي — النص يُشكَّل ويُرتب بصريًا.
   */
  text(text: string, options: {
    x: number;
    top: number;
    font: 'regular' | 'bold';
    size: number;
    color?: string;
    align?: 'right' | 'left' | 'center';
    maxWidth?: number;
  }) {
    const metrics = this.fonts.get(options.font);
    if (!metrics) return;
    const glyphText = text ?? '';
    const size = options.size;
    const glyphs = shapeText(glyphText, metrics);
    if (!glyphs.length) return;

    const textWidth = (measureGlyphs(glyphs, metrics) * size) / 1000;
    const maxWidth = options.maxWidth ?? textWidth;
    let x = options.x;
    if (options.align === 'right') x = options.x + maxWidth - textWidth;
    else if (options.align === 'center') x = options.x + (maxWidth - textWidth) / 2;

    const bytes = new Uint8Array(glyphs.length * 2);
    glyphs.forEach((glyph, index) => {
      bytes[index * 2] = (glyph.gid >> 8) & 0xff;
      bytes[index * 2 + 1] = glyph.gid & 0xff;
    });

    const resourceName = options.font === 'bold' ? 'F2' : 'F1';
    const baseline = this.height - options.top - size * 0.82;
    this.ops.push(
      `BT ${options.color ?? '0.1 0.1 0.1'} rg /${resourceName} ${size} Tf 1 0 0 1 ${x.toFixed(3)} ${baseline.toFixed(3)} Tm <${hex(bytes)}> Tj ET`,
    );
  }
}

export class PdfDocument {
  private readonly objects: Array<Uint8Array | null> = [];
  private readonly pages: Array<{ content: string; pageId: number }> = [];
  private readonly fonts: FontHandle[] = [];
  private pageWidth: number;
  private pageHeight: number;
  private readonly metricsByName = new Map<string, FontMetrics>();

  constructor(pageWidth = 612, pageHeight = 792) {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
  }

  private reserve(): number {
    this.objects.push(null);
    return this.objects.length;
  }

  private set(id: number, body: Uint8Array) {
    this.objects[id - 1] = body;
  }

  get metrics() {
    return this.metricsByName;
  }

  newPage(): PdfPage {
    return new PdfPage(this.pageWidth, this.pageHeight, this.metricsByName);
  }

  addFont(name: string, resourceName: string, source: PdfFontSource): FontHandle {
    const type0Id = this.reserve();
    const cidId = this.reserve();
    const descriptorId = this.reserve();
    const fileId = this.reserve();
    const toUnicodeId = this.reserve();
    const handle: FontHandle = {
      name,
      metrics: source.metrics,
      bytes: source.bytes,
      resourceName,
      type0Id,
      cidId,
      descriptorId,
      fileId,
      toUnicodeId,
    };
    this.fonts.push(handle);
    this.metricsByName.set(resourceName === 'F2' ? 'bold' : 'regular', source.metrics);
    return handle;
  }

  /** ينهي المستند ويعيد البايتات */
  async build(): Promise<Uint8Array> {
    // الخطوط
    for (const font of this.fonts) {
      const upm = font.metrics.unitsPerEm;
      const scale = (value: number) => Math.round((value * 1000) / upm);
      const widthsEntries = Object.entries(font.metrics.widths)
        .map(([gid, width]) => `${gid} [${scale(width)}]`)
        .join(' ');
      const bold = font.name.includes('Bold') ? 700 : 400;

      const compressedFont = await deflate(font.bytes);
      const fontStream = compressedFont ?? font.bytes;
      this.set(
        font.fileId,
        concat([
          utf8(
            `<< /Length ${fontStream.length} /Length1 ${font.bytes.length}${compressedFont ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
          ),
          fontStream,
          utf8('\nendstream'),
        ]),
      );

      const bbox = font.metrics.bbox.map(scale).join(' ');
      this.set(
        font.descriptorId,
        utf8(
          `<< /Type /FontDescriptor /FontName /${font.name} /Flags 4 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${scale(
            font.metrics.ascent,
          )} /Descent ${scale(font.metrics.descent)} /CapHeight ${scale(font.metrics.ascent)} /StemV ${
            bold === 700 ? 120 : 80
          } /FontWeight ${bold} /FontFile2 ${font.fileId} 0 R >>`,
        ),
      );

      this.set(
        font.cidId,
        utf8(
          `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${font.descriptorId} 0 R /DW 1000 /W [${widthsEntries}] /CIDToGIDMap /Identity >>`,
        ),
      );

      this.set(font.toUnicodeId, utf8(this.toUnicodeCMap(font)));

      this.set(
        font.type0Id,
        utf8(
          `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H /DescendantFonts [${font.cidId} 0 R] /ToUnicode ${font.toUnicodeId} 0 R >>`,
        ),
      );
    }

    // محتوى الصفحات
    const pagesId = this.reserve();
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const contentId = this.reserve();
      const compressed = await deflate(utf8(page.content));
      const data = compressed ?? utf8(page.content);
      this.set(
        contentId,
        concat([
          utf8(`<< /Length ${data.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
          data,
          utf8('\nendstream'),
        ]),
      );
      const pageId = this.reserve();
      const resources = this.fonts.map((font) => `/${font.resourceName} ${font.type0Id} 0 R`).join(' ');
      this.set(
        pageId,
        utf8(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << ${resources} >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
      pageIds.push(pageId);
    }

    this.set(
      pagesId,
      utf8(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`),
    );
    const catalogId = this.reserve();
    this.set(catalogId, utf8(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));

    // التجميع
    const parts: Uint8Array[] = [];
    let length = 0;
    const push = (data: Uint8Array) => {
      parts.push(data);
      length += data.length;
    };
    push(utf8('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'));
    const offsets: number[] = [];
    this.objects.forEach((body, index) => {
      offsets[index] = length;
      push(utf8(`${index + 1} 0 obj\n`));
      push(body ?? utf8('<< >>'));
      push(utf8('\nendobj\n'));
    });

    const xrefOffset = length;
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${this.objects.length + 1} /Root ${catalogId} 0 R /Producer (CASH Risk Reports) >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    push(utf8(xref));

    return concat(parts);
  }

  /** يضيف صفحة بمحتواها */
  addPage(page: PdfPage) {
    const content = page.ops.join('\n');
    this.pages.push({ content, pageId: 0 });
  }

  private toUnicodeCMap(font: FontHandle): string {
    const reverse = new Map<number, number>();
    for (const [code, gid] of Object.entries(font.metrics.chars)) {
      if (!reverse.has(gid)) reverse.set(gid, Number(code));
    }
    const entries = [...reverse.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([gid, code]) => `<${gid.toString(16).padStart(4, '0')}> <${code.toString(16).padStart(4, '0')}>`)
      .join('\n');
    const body = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunkPairs(entries)}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
    const data = utf8(body);
    return `<< /Length ${data.length} >>\nstream\n${body}\nendstream`;
  }
}

/** تقسيم أزواج ToUnicode إلى مجموعات من 100 */
function chunkPairs(entries: string): string {
  const lines = entries.split('\n').filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < lines.length; index += 100) {
    const slice = lines.slice(index, index + 100);
    chunks.push(`${slice.length} beginbfchar\n${slice.join('\n')}\nendbfchar`);
  }
  return chunks.join('\n');
}
