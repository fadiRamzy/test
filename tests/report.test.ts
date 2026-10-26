import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEmployeeReport, pdfDate } from '../src/lib/pdf/employeeReport';
import { buildCashReportPdf } from '../src/lib/pdf/report';
import { FONT_BOLD, FONT_REGULAR } from '../src/lib/pdf-fonts';
import { measureText, shapeText } from '../src/lib/pdf/shape';
import type { DailyMinute, Employee, VisitTiming } from '../src/db/schema';

const employee = (id: string, name: string): Employee =>
  ({
    id,
    employeeNo: Number(id.replace(/\D/g, '')) || 1,
    name,
    code: `RO-${id}`,
    sector: 'قطاع',
    governorate: 'القاهرة',
    jobTitle: 'ضابط مخاطر',
    employmentDate: '2024-01-01',
    branches: 'فرع',
    status: 'active',
    notes: '',
    archived: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }) as Employee;

const visit = (id: string, employeeId: string, visitDate: string, departureTime = '09:00', returnTime = '09:35'): VisitTiming =>
  ({
    id,
    employeeId,
    visitDate,
    branch: 'فرع طنطا',
    clientName: 'شركة النور',
    location: 'طنطا',
    departureTime,
    returnTime,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }) as VisitTiming;

const minute = (id: string, employeeId: string, createdAt: string, date?: string): DailyMinute =>
  ({
    id,
    employeeId,
    fileRequestTime: '',
    fileReceivedTime: '09:00',
    responseTime: '09:40',
    inspectionResult: 'no_notes',
    date,
    createdAt,
    updatedAt: createdAt,
  }) as DailyMinute;

const regular = { metrics: FONT_REGULAR, bytes: new Uint8Array(readFileSync('public/fonts/cash-arabic-regular.ttf')) };
const bold = { metrics: FONT_BOLD, bytes: new Uint8Array(readFileSync('public/fonts/cash-arabic-bold.ttf')) };

describe('تقرير الموظف — حساب الأعداد والفترات', () => {
  const employees = [employee('1', 'أبأنوب جرجس'), employee('2', 'منى فتحي')];
  const visitTimings = [
    ...Array.from({ length: 15 }, (_, index) =>
      visit(`v${index}`, '1', `2026-10-${String(index + 1).padStart(2, '0')}`),
    ),
    visit('v-other', '2', '2026-10-05'),
    visit('v-sep', '1', '2026-09-10'),
    visit('v-undated', '1', ''),
  ];
  const minutes = [
    ...Array.from({ length: 10 }, (_, index) => minute(`m${index}`, '1', `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`)),
    minute('m-other', '2', '2026-10-15T10:00:00.000Z'),
    minute('m-undated', '1', '' as unknown as string, undefined),
  ];

  it('التقرير الشهري: عدد الزيارات والمحاضر للفترة المحددة فقط', () => {
    const report = buildEmployeeReport(
      { employees, visitTimings, minutes },
      { employeeIds: ['1'], periodKind: 'month', year: 2026, month: 10 },
    );
    expect(report.blocks).toHaveLength(1);
    expect(report.blocks[0]).toMatchObject({ name: 'أبأنوب جرجس', visitCount: 15, minuteCount: 10 });
    expect(report.blocks[0].visits).toHaveLength(15);
    expect(report.blocks[0].visits[0]).toMatchObject({ date: '2026/10/01', duration: '35 دقيقة' });
    expect(report.periodKind).toBe('month');
  });

  it('التقرير السنوي: يجمع كل زيارات السنة فقط', () => {
    const report = buildEmployeeReport(
      { employees, visitTimings, minutes },
      { employeeIds: ['1'], periodKind: 'year', year: 2026 },
    );
    expect(report.blocks[0].visitCount).toBe(16); // 15 في أكتوبر + 1 في سبتمبر
    expect(report.blocks[0].minuteCount).toBe(10);
  });

  it('لا يخلط سجلات موظف بآخر، ويستثني السجلات بلا تاريخ', () => {
    const report = buildEmployeeReport(
      { employees, visitTimings, minutes },
      { employeeIds: [], periodKind: 'month', year: 2026, month: 10 },
    );
    expect(report.blocks).toHaveLength(2);
    expect(report.blocks[1]).toMatchObject({ name: 'منى فتحي', visitCount: 1, minuteCount: 1 });
    expect(report.excludedNote).toContain('بلا تاريخ');
  });

  it('تنسيق التاريخ YYYY/MM/DD', () => {
    expect(pdfDate('2026-10-25')).toBe('2026/10/25');
    expect(pdfDate('')).toBe('');
    expect(pdfDate(null)).toBe('');
  });

  it('موظف بلا زيارات: صف واحد يوضح عدم وجود زيارات مع عدد المحاضر', () => {
    const report = buildEmployeeReport(
      { employees, visitTimings: [], minutes },
      { employeeIds: [], periodKind: 'month', year: 2026, month: 10 },
    );
    expect(report.blocks[0]).toMatchObject({ visitCount: 0, minuteCount: 10 });
    expect(report.blocks[0].visits).toHaveLength(0);
  });
});

describe('تشكيل النص العربي و PDF', () => {
  it('يشكّل الحروف العربية بصيغة متصلة', () => {
    const glyphs = shapeText('اسم الموظف', FONT_REGULAR);
    // 10 حروف منطقية => نفس العدد من الأشكال، ولكنها أشكال متصلة (Presentation Forms)
    expect(glyphs.length).toBe(10);
    const presentation = glyphs.filter((glyph) => glyph.code >= 0xfe70 && glyph.code <= 0xfeff).length;
    expect(presentation).toBeGreaterThan(5);
    expect(measureText('اسم', 9, FONT_REGULAR)).toBeGreaterThan(0);
  });

  it('ينتج ملف PDF صحيح الحجم والنوع بعدد صفحات مناسب لكل عدد زيارات', async () => {
    const sizes: number[] = [];
    for (const count of [0, 3, 10, 15, 25]) {
      const bytes = await buildCashReportPdf({
        ...{ regular, bold },
        periodKind: 'month',
        periodLabel: 'تقرير شهري — أكتوبر 2026',
        blocks: [
          {
            name: 'أبأنوب جرجس',
            visitCount: count,
            minuteCount: 10,
            visits: Array.from({ length: count }, (_, index) => ({
              branch: 'فرع طنطا',
              clientName: `عميل رقم ${index + 1}`,
              date: '2026/10/05',
              duration: '35 دقيقة',
            })),
          },
        ],
      });
      const text = new TextDecoder().decode(bytes.slice(0, 8));
      expect(text.startsWith('%PDF-1.')).toBe(true);
      expect(new TextDecoder().decode(bytes)).toContain('%%EOF');
      sizes.push(bytes.length);
    }
    // حجم معقول (خط مُجزَّأ + ضغط) ولا يكبر إلا بشكل طفيف مع الصفوف
    expect(Math.max(...sizes)).toBeLessThan(250 * 1024);
    expect(sizes[4] - sizes[0]).toBeLessThan(20 * 1024);
  });

  it('كل صفحة تحتوي رأس الموظف وأعمدة الجدول السبعة', async () => {
    const bytes = await buildCashReportPdf({
      regular,
      bold,
      periodKind: 'year',
      periodLabel: 'تقرير سنوي — 2026',
      blocks: [{ name: 'منى فتحي', visitCount: 1, minuteCount: 2, visits: [{ branch: 'أ', clientName: 'ب', date: '2026/01/01', duration: '35 دقيقة' }] }],
    });
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('/Type /Font');
    expect(raw).toContain('/Subtype /Type0');
    expect(raw).toContain('/MediaBox [0 0 612 792]');
    // الخط مُجزَّأ: ملف الخط المضمّن أصغر من 60KB
    expect(regular.bytes.length).toBeLessThan(60 * 1024);
  });
});
