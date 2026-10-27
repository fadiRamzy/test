import type { AnnualNote, AttendanceRecord, DailyMinute, Employee, FieldVisit, Leave, LeavePermissionRecord, MonthlyEvaluation, Observation, VisitTiming } from '../../db/schema';
import { EMPLOYEE_STATUS_LABELS, INSPECTION_RESULT_LABELS, OBSERVATION_STATUS_LABELS, SEVERITY_LABELS } from '../../db/schema';
import { attendanceDelayMinutes, earlyDepartureMinutes } from '../attendance';
import { minuteTiming } from '../calc';
import { fmtDate, fmtDurationWords, fmtTime, fmtNumber } from '../format';
import type { PdfFontSource } from './writer';
import { PdfDocument, type PdfPage } from './writer';
import { wrapText } from './shape';

export interface CompleteEmployeeData {
  employee: Employee;
  visits: VisitTiming[];
  minutes: DailyMinute[];
  legacyLeaves: Leave[];
  leavePermissions: LeavePermissionRecord[];
  attendance: AttendanceRecord[];
  fieldVisits: FieldVisit[];
  evaluations: MonthlyEvaluation[];
  annualNotes: AnnualNote[];
  observations: Observation[];
}

type Column = { label: string; width: number };
type TableSection = { title: string; columns: Column[]; rows: string[][] };

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 54;
const BOTTOM = 42;
const BODY_SIZE = 11;
const LINE_H = 13.8;
const C = { navy: '0.043 0.165 0.29', muted: '0.31 0.36 0.41', border: '0.72 0.76 0.80', head: '0.91 0.93 0.95', alt: '0.965 0.975 0.982', teal: '0.08 0.43 0.48', white: '1 1 1' };
const present = (v: unknown): string => v === null || v === undefined || String(v).trim() === '' ? '' : String(v);
const date = (v?: string | null) => v ? fmtDate(v) : '';
const time = (v?: string | null) => v ? fmtTime(v) : '';
const duration = (v: number | null) => v === null ? '' : fmtDurationWords(v);
const pair = (label: string, v: unknown) => { const text = present(v); return text ? `${label}: ${text}` : ''; };

function collectSections(input: CompleteEmployeeData): TableSection[] {
  const id = input.employee.id;
  const visits: string[][] = [
    ...input.visits.filter(x => x.employeeId === id).filter(x => present(x.branch) || present(x.clientName)).map(x => [present(x.branch), present(x.clientName)]),
    ...input.fieldVisits.filter(x => x.employeeId === id && present(x.branch)).map(x => [present(x.branch), '']),
  ];
  const minutes = input.minutes.filter(x => x.employeeId === id).sort((a,b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .map(x => {
      const calc = minuteTiming(x);
      return [date(x.date), time(x.fileRequestTime), time(x.fileReceivedTime), time(x.responseTime), x.inspectionResult ? INSPECTION_RESULT_LABELS[x.inspectionResult] : '', duration(calc.minutes), calc.invalid ? 'بيانات غير مكتملة' : calc.delayed ? 'متأخر' : calc.minutes === null ? '' : 'في الوقت'];
    }).filter(r => r.some(Boolean));
  const oldLeaves = input.legacyLeaves.filter(x => x.employeeId === id);
  const newRows = input.leavePermissions.filter(x => x.employeeId === id);
  const leaves = [
    ...oldLeaves.filter(x => !x.type.includes('إذن')).map(x => [x.endDate && x.endDate !== x.startDate ? `${date(x.startDate)} – ${date(x.endDate)}` : date(x.startDate), present(x.type), x.unit === 'days' ? (x.days == null ? '' : `${fmtNumber(x.days)} يوم`) : (x.hours == null ? '' : `${fmtNumber(x.hours)} ساعة`), present(x.notes)]),
    ...newRows.filter(x => x.requestType === 'leave').map(x => [date(x.date), present(x.category), '', present(x.notes)]),
  ].filter(r => r.some(Boolean));
  const permissions = [
    ...oldLeaves.filter(x => x.type.includes('إذن')).map(x => [x.endDate && x.endDate !== x.startDate ? `${date(x.startDate)} – ${date(x.endDate)}` : date(x.startDate), present(x.type), x.unit === 'days' ? (x.days == null ? '' : `${fmtNumber(x.days)} يوم`) : (x.hours == null ? '' : `${fmtNumber(x.hours)} ساعة`), present(x.notes)]),
    ...newRows.filter(x => x.requestType === 'permission').map(x => [date(x.date), present(x.category), x.durationHours ? `${fmtNumber(x.durationHours)} ساعة` : '', present(x.notes)]),
  ].filter(r => r.some(Boolean));
  const attendance = input.attendance.filter(x => x.employeeId === id).sort((a,b) => a.date.localeCompare(b.date));
  const late = attendance.filter(x => attendanceDelayMinutes(x.arrivalTime) > 0).map(x => [date(x.date), time(x.arrivalTime), duration(attendanceDelayMinutes(x.arrivalTime)), present(x.notes)]);
  const early = attendance.filter(x => earlyDepartureMinutes(x.departureTime) > 0).map(x => [date(x.date), time(x.departureTime), duration(earlyDepartureMinutes(x.departureTime)), present(x.notes)]);
  const observationRows = input.observations.filter(x => x.employeeId === id).sort((a,b) => (a.date || '').localeCompare(b.date || '')).map(x => [date(x.date), pair('المصدر',x.source), pair('الفرع',x.branch), pair('المرجع',x.reference), pair('التصنيف',x.category), pair('الخطورة',SEVERITY_LABELS[x.severity] ?? x.severity), pair('التفاصيل',x.details), pair('الإجراء',x.correctiveAction), pair('الحالة',OBSERVATION_STATUS_LABELS[x.status] ?? x.status), pair('متابعة',x.followUpNotes)].filter(Boolean).join(' | ')).filter(Boolean).map(x => [x]);
  const annual = input.annualNotes.filter(x => x.employeeId === id).sort((a,b) => a.year-b.year).map(x => [String(x.year),present(x.notes)]).filter(r => r.some(Boolean));
  return [
    { title: 'الزيارات الميدانية', columns: [{label:'الفرع',width:CONTENT_W*.44},{label:'اسم العميل',width:CONTENT_W*.56}], rows: visits },
    { title: 'الدقائق اليومية', columns: [
      {label:'التاريخ',width:66},{label:'طلب الملف',width:61},{label:'استلام الملف',width:68},{label:'الرد',width:52},{label:'نتيجة الفحص',width:92},{label:'المدة',width:77},{label:'حالة التأخير',width:CONTENT_W-416},
    ], rows: minutes },
    { title: 'الإجازات', columns: [{label:'التاريخ',width:112},{label:'النوع',width:120},{label:'المدة',width:88},{label:'السبب / الملاحظات',width:CONTENT_W-320}], rows: leaves },
    { title: 'الأذونات', columns: [{label:'التاريخ',width:112},{label:'النوع',width:120},{label:'المدة',width:88},{label:'السبب / الملاحظات',width:CONTENT_W-320}], rows: permissions },
    { title: 'تأخيرات الحضور', columns: [{label:'التاريخ',width:130},{label:'وقت الحضور',width:118},{label:'مدة التأخير',width:116},{label:'ملاحظات',width:CONTENT_W-364}], rows: late },
    { title: 'الانصراف المبكر', columns: [{label:'التاريخ',width:130},{label:'وقت الانصراف',width:118},{label:'مدة التبكير',width:116},{label:'ملاحظات',width:CONTENT_W-364}], rows: early },
    { title: 'الملاحظات والمتابعات', columns: [{label:'التاريخ والتفاصيل',width:CONTENT_W}], rows: observationRows },
    { title: 'الملاحظات السنوية', columns: [{label:'السنة',width:90},{label:'الملاحظة',width:CONTENT_W-90}], rows: annual },
  ];
}

export async function buildCompleteEmployeePdf(data: CompleteEmployeeData, fonts: { regular: PdfFontSource; bold: PdfFontSource }): Promise<Uint8Array> {
  const doc = new PdfDocument(PAGE_W, PAGE_H);
  doc.addFont('TimesNewRomanPSMT', 'F1', fonts.regular);
  doc.addFont('TimesNewRomanPS-BoldMT', 'F2', fonts.bold);
  const pages: PdfPage[] = [];
  let page!: PdfPage;
  let y = TOP;
  const newPage = () => {
    page = doc.newPage(); pages.push(page); y = TOP;
    page.text(data.employee.name, { x:MARGIN, top:16, font:'bold', size:pages.length === 1 ? 20 : 13, color:C.navy, align:'right', maxWidth:CONTENT_W });
    if (pages.length === 1) page.text('الملف الوظيفي', {x:MARGIN,top:39,font:'regular',size:10,color:C.muted,align:'right',maxWidth:CONTENT_W});
  };
  newPage();
  const ensure = (height: number, section?: TableSection) => {
    if (y + height <= PAGE_H - BOTTOM) return;
    newPage();
    if (section) drawSectionTitle(section.title, true);
  };
  const drawSectionTitle = (title: string, continuation = false) => {
    ensure(29);
    page.rect(MARGIN,y,CONTENT_W,25,{fill:C.navy});
    page.text(continuation ? `${title} — تابع` : title,{x:MARGIN+8,top:y+4,font:'bold',size:14,color:C.white,align:'right',maxWidth:CONTENT_W-16});
    y+=30;
  };
  const drawTableHeader = (section: TableSection) => {
    const h=24; ensure(h,section);
    page.rect(MARGIN,y,CONTENT_W,h,{fill:C.head});
    let right=MARGIN+CONTENT_W;
    for(const col of section.columns){
      const x=right-col.width;
      page.rect(x,y,col.width,h,{stroke:C.border,lineWidth:.45});
      page.text(col.label,{x:x+3,top:y+5,font:'bold',size:9.3,color:C.navy,align:'right',maxWidth:col.width-6});
      right=x;
    }
    y+=h;
  };
  const drawSection = (section: TableSection) => {
    if (!section.rows.length) return;
    const rowHeight = (row: string[]) => Math.max(25, Math.max(...row.map((text,i)=> text ? wrapText(text,BODY_SIZE,section.columns[i].width-10,fonts.regular.metrics).length : 1))*LINE_H+8);
    if (y + 30 + 24 + rowHeight(section.rows[0]) > PAGE_H - BOTTOM) newPage();
    drawSectionTitle(section.title);
    drawTableHeader(section);
    let alternate=false;
    for (const row of section.rows) {
      const cellLines = row.map((text,i)=> text ? wrapText(text,BODY_SIZE,section.columns[i].width-10,fonts.regular.metrics) : ['']);
      const h=Math.max(25,Math.max(...cellLines.map(x=>x.length))*LINE_H+8);
      if(h>PAGE_H-TOP-BOTTOM-55) throw new Error(`تعذر عرض سجل طويل دون تقسيمه: ${section.title}`);
      if(y+h>PAGE_H-BOTTOM){ newPage(); drawSectionTitle(section.title,true); drawTableHeader(section); alternate=false; }
      page.rect(MARGIN,y,CONTENT_W,h,{fill:alternate?C.alt:C.white});
      page.rect(MARGIN,y,CONTENT_W,h,{stroke:C.border,lineWidth:.4});
      let right=MARGIN+CONTENT_W;
      row.forEach((_,i)=>{
        const col=section.columns[i], x=right-col.width;
        if(i>0) page.line(x,y,x,y+h,C.border,.35);
        cellLines[i].forEach((line,j)=>page.text(line,{x:x+4,top:y+4+j*LINE_H,font:'regular',size:BODY_SIZE,color:C.navy,align:'right',maxWidth:col.width-8}));
        right=x;
      });
      y+=h; alternate=!alternate;
    }
  };
  const e=data.employee;
  const details=[
    ['رقم الموظف',present(e.employeeNo)],['الكود',present(e.code)],['الحالة',`${EMPLOYEE_STATUS_LABELS[e.status] ?? e.status}${e.archived?' (مؤرشف)':''}`],['القطاع',present(e.sector)],['المحافظة',present(e.governorate)],['المسمى الوظيفي',present(e.jobTitle)],['تاريخ التعيين',date(e.employmentDate)],['الفروع',present(e.branches)],
  ].filter(x=>x[1]);
  drawSectionTitle('البيانات الأساسية');
  const factCols=[{label:'البيان',width:110},{label:'التفاصيل',width:CONTENT_W-110}];
  drawTableHeader({title:'البيانات الأساسية',columns:factCols,rows:[]});
  for(let i=0;i<details.length;i+=2){
    const row=[details[i],details[i+1]].filter(Boolean) as string[][];
    const text=row.map(pair=>pair.join(': ')).join('   |   ');
    const lines=wrapText(text,BODY_SIZE,CONTENT_W-16,fonts.regular.metrics);
    const h=Math.max(26,lines.length*LINE_H+8); ensure(h);
    page.rect(MARGIN,y,CONTENT_W,h,{fill:i%4===0?C.alt:C.white}); page.rect(MARGIN,y,CONTENT_W,h,{stroke:C.border,lineWidth:.4});
    lines.forEach((line,j)=>page.text(line,{x:MARGIN+7,top:y+5+j*LINE_H,font:'regular',size:BODY_SIZE,color:C.navy,align:'right',maxWidth:CONTENT_W-14})); y+=h;
  }
  if (present(e.notes)) {
    drawSectionTitle('ملاحظات الموظف');
    const noteLines=wrapText(e.notes,11,CONTENT_W-22,fonts.regular.metrics);
    let idx=0;
    while(idx<noteLines.length){
      const maxLines=Math.max(1,Math.floor((PAGE_H-BOTTOM-y-46)/14));
      if(maxLines<1 || y+34>PAGE_H-BOTTOM){newPage(); drawSectionTitle('ملاحظات الموظف');}
      const count=Math.max(1,Math.floor((PAGE_H-BOTTOM-y-36)/14));
      const chunk=noteLines.slice(idx,idx+count);
      const h=chunk.length*14+20; ensure(h);
      page.rect(MARGIN,y,CONTENT_W,h,{fill:'0.93 0.97 0.97'}); page.rect(MARGIN,y,CONTENT_W,h,{stroke:'0.58 0.76 0.77',lineWidth:.7});
      chunk.forEach((line,j)=>page.text(line,{x:MARGIN+11,top:y+9+j*14,font:'regular',size:10.5,color:C.navy,align:'right',maxWidth:CONTENT_W-22}));
      y+=h; idx+=chunk.length;
    }
  }
  for(const section of collectSections(data)) drawSection(section);
  if(pages.length>5) throw new Error(`يتطلب التقرير ${pages.length} صفحات، والحد الأقصى خمسة؛ لم يتم إسقاط أي سجلات.`);
  pages.forEach((p,i)=>p.text(`صفحة ${i+1} من ${pages.length}`,{x:MARGIN,top:PAGE_H-28,font:'regular',size:8.5,color:C.muted,align:'center',maxWidth:CONTENT_W}));
  pages.forEach(p=>doc.addPage(p));
  return doc.build();
}

export function employeePdfFileName(employee: Employee): string {
  const safe = `${employee.employeeNo}-${employee.name}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^\w\u0600-\u06FF.-]+/g, '');
  return `employee-${safe || employee.id}.pdf`;
}
