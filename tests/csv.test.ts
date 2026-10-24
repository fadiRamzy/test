import { describe, expect, it } from 'vitest';
import { csvToObjects, exportEntityCsv, parseCsv, parseEntityCsv, toCsv } from '../src/db/csv';
import type { Employee } from '../src/db/schema';

const employee: Employee = {
  id: 'e1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  employeeCode: 'CSV-1',
  fullName: 'سارة «اختبار» أحمد',
  jobTitle: 'ضابط مخاطر',
  branchId: 'b1',
  governorate: 'القاهرة',
  hireDate: '2024-03-01',
  status: 'active',
  phone: '01000000000',
  email: 'csv@example.com',
  notes: 'ملاحظة بها فاصلة، وسطر جديد\nسطر ثانٍ',
};

const ctx = {
  employees: [employee],
  branches: [{ id: 'b1', code: 'BR1', name: 'فرع الاختبار', governorate: 'القاهرة', createdAt: '', updatedAt: '' }],
  categories: [{ id: 'cat1', name: 'نقص مستندات' }],
};

describe('CSV', () => {
  it('يهرّب علامات التنصيص والفواصل والأسطر الجديدة', () => {
    const csv = toCsv(['الاسم', 'الملاحظات'], [['أحمد، علي', 'سطر\nثانٍ']]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['الاسم', 'الملاحظات']);
    expect(rows[1]).toEqual(['أحمد، علي', 'سطر\nثانٍ']);
  });

  it('يدعم BOM في بداية الملف', () => {
    const rows = parseCsv('\ufeffالعمود\r\nقيمة');
    expect(rows[0][0]).toBe('العمود');
  });

  it('يصدّر الموظفين بأعمدة عربية قابلة للقراءة', () => {
    const csv = exportEntityCsv('employees', [employee], ctx);
    const { headers, rows } = csvToObjects(csv);
    expect(headers).toContain('الرقم الوظيفي');
    expect(headers).toContain('الاسم');
    expect(rows[0]['الاسم']).toContain('سارة');
    expect(rows[0]['الفرع']).toBe('فرع الاختبار');
    expect(rows[0]['الحالة']).toBe('على رأس العمل');
  });

  it('يستورد الموظفين ويعيد تعيين الفرع بالاسم', () => {
    const csv = exportEntityCsv('employees', [employee], ctx);
    const result = parseEntityCsv('employees', csv, ctx);
    expect(result.errors).toHaveLength(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].branchId).toBe('b1');
    expect(result.accepted[0].employeeCode).toBe('CSV-1');
  });

  it('يبلّغ عن الأعمدة المطلوبة المفقودة', () => {
    const result = parseEntityCsv('employees', 'الاسم\nأحمد', ctx);
    expect(result.errors.some((error) => error.message.includes('الرقم الوظيفي'))).toBe(true);
    expect(result.accepted).toHaveLength(0);
  });

  it('يرفض صفوف دقائق الصرف لموظف غير موجود', () => {
    const csv = toCsv(
      ['ضابط المخاطر', 'مرجع العميل', 'وقت الاستلام'],
      [['موظف غير مسجل', 'CL-1', '2026-01-01T09:00:00.000Z']],
    );
    const result = parseEntityCsv('minutes', csv, ctx);
    expect(result.accepted).toHaveLength(0);
    expect(result.errors[0].message).toContain('غير موجود');
  });

  it('يستورد دقائق الصرف لموظف موجود', () => {
    const csv = toCsv(
      ['ضابط المخاطر', 'مرجع العميل', 'نوع التمويل', 'وقت الاستلام'],
      [['CSV-1', 'CL-2', 'تمويل قائمة', '2026-01-01T09:00:00.000Z']],
    );
    const result = parseEntityCsv('minutes', csv, ctx);
    expect(result.errors).toHaveLength(0);
    expect(result.accepted[0].employeeId).toBe('e1');
    expect(result.accepted[0].clientRef).toBe('CL-2');
  });

  it('يستبعد السجلات التجريبية من التصدير افتراضيًا', () => {
    const demoEmployee = { ...employee, id: 'e2', employeeCode: 'CSV-2', isDemo: true };
    const csv = exportEntityCsv('employees', [employee, demoEmployee], ctx);
    const { rows } = csvToObjects(csv);
    expect(rows).toHaveLength(1);
  });
});
