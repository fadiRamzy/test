import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  isWorkingDay,
  workingDaysBetween,
  type WorkCalendar,
} from '../src/lib/businessTime';

const calendar: WorkCalendar = {
  workingHours: { start: '09:00', end: '17:00' },
  workingDays: [0, 1, 2, 3, 4], // الأحد إلى الخميس
  holidays: [{ date: '2026-01-01', name: 'عطلة رسمية' }],
};

const at = (iso: string) => new Date(iso);

describe('أوقات العمل وحساب المهل', () => {
  it('يحسب دقائق العمل داخل اليوم نفسه', () => {
    expect(businessMinutesBetween(at('2026-01-04T09:00:00'), at('2026-01-04T10:00:00'), calendar)).toBe(60);
  });

  it('يتجاهل الوقت خارج ساعات العمل', () => {
    // من 08:00 إلى 18:00 = 8 ساعات عمل فقط (09:00–17:00)
    expect(businessMinutesBetween(at('2026-01-04T08:00:00'), at('2026-01-04T18:00:00'), calendar)).toBe(480);
  });

  it('يستبعد أيام الراحة (الجمعة والسبت)', () => {
    // الجمعة 2026-01-02 والسبت 2026-01-03
    expect(isWorkingDay(at('2026-01-02T10:00:00'), calendar)).toBe(false);
    expect(isWorkingDay(at('2026-01-03T10:00:00'), calendar)).toBe(false);
    // من خميس 16:00 إلى أحد 10:00 = ساعة الخميس + ساعة الأحد = 120
    expect(businessMinutesBetween(at('2026-01-01T16:00:00'), at('2026-01-04T10:00:00'), calendar)).toBe(60);
  });

  it('يستبعد العطلات الرسمية', () => {
    // 2026-01-01 عطلة رسمية → لا تُحسب أي دقائق عمل داخلها
    expect(businessMinutesBetween(at('2026-01-01T09:00:00'), at('2026-01-01T17:00:00'), calendar)).toBe(0);
    // من خميس 2026-01-01 16:00 (عطلة) إلى أحد 2026-01-04 10:00 = ساعة الأحد فقط
    expect(businessMinutesBetween(at('2026-01-01T16:00:00'), at('2026-01-04T10:00:00'), calendar)).toBe(60);
    // خميس عادي 2026-01-08 16:00 → أحد 2026-01-11 10:00 = ساعة + ساعة
    expect(businessMinutesBetween(at('2026-01-08T16:00:00'), at('2026-01-11T10:00:00'), calendar)).toBe(120);
  });

  it('يعيد صفرًا عند ترتيب زمني معكوس', () => {
    expect(businessMinutesBetween(at('2026-01-04T12:00:00'), at('2026-01-04T10:00:00'), calendar)).toBe(0);
  });

  it('يضيف دقائق عمل مع تخطي العطلات وأيام الراحة', () => {
    // 60 دقيقة عمل من خميس 16:30 → ساعة الخميس ثم 30 دقيقة من الأحد
    const due = addBusinessMinutes(at('2026-01-08T16:30:00'), 60, calendar);
    const dueDate = new Date(due);
    expect(dueDate.getDay()).toBe(0); // الأحد
    expect(dueDate.getHours()).toBe(9);
    expect(dueDate.getMinutes()).toBe(30);
    expect(businessMinutesBetween(at('2026-01-08T16:30:00'), dueDate, calendar)).toBe(60);
  });

  it('يزيح البداية إلى أول وقت عمل إن كانت خارج الدوام', () => {
    const due = new Date(addBusinessMinutes(at('2026-01-04T06:00:00'), 30, calendar));
    expect(due.getHours()).toBe(9);
    expect(due.getMinutes()).toBe(30);
  });

  it('يعيد البداية نفسها عند صفر دقائق', () => {
    const start = at('2026-01-04T10:15:00').toISOString();
    expect(addBusinessMinutes(start, 0, calendar)).toBe(start);
  });

  it('يحسب عدد أيام العمل بين تاريخين', () => {
    // من الأحد إلى الخميس = 5 أيام
    expect(workingDaysBetween(at('2026-01-04T10:00:00'), at('2026-01-08T10:00:00'), calendar)).toBe(5);
    // يشمل عطلة 1 يناير
    expect(workingDaysBetween(at('2026-01-01T10:00:00'), at('2026-01-01T12:00:00'), calendar)).toBe(0);
  });
});
