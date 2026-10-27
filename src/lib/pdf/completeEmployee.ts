import type { AnnualNote, AttendanceRecord, DailyMinute, Employee, FieldVisit, Leave, LeavePermissionRecord, MonthlyEvaluation, Observation, VisitTiming } from '../../db/schema';
import { EMPLOYEE_STATUS_LABELS, INSPECTION_RESULT_LABELS, MINUTE_RESULT_LABELS, MINUTE_STATUS_LABELS, OBSERVATION_STATUS_LABELS, SEVERITY_LABELS } from '../../db/schema';
import { attendanceDelayMinutes, earlyDepartureMinutes } from '../attendance';
import { minuteTiming } from '../calc';
import { fmtDurationWords, fmtNumber, fmtTime } from '../format';
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

type Column = { label: string; width: number; value: string };
type TableData = { title?: string; columns: Column[]; rows: Record<string, string>[]; compact?: boolean };

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 20; // 7.1 mm
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 48;
const FOOTER_TOP = PAGE_H - 28;
const BODY_SIZE = 9.4;
const LINE_H = 11.1;
const CELL_PAD_X = 3.4;
const CELL_PAD_Y = 3;
const C = {
  navy: '0.122 0.227 0.373', // #1F3A5F
  body: '0.133 0.133 0.133',
  muted: '0.39 0.43 0.48',
  border: '0.78 0.83 0.88',
  alt: '0.957 0.969 0.980',
  white: '1 1 1',
  note: '0.945 0.965 0.980',
};
const val = (value: unknown): string => value === null || value === undefined ? '' : String(value).trim();
const d = (value?: string | null) => value ? value.slice(0,10) : '';
const t = (value?: string | null) => value ? fmtTime(value) : '';
const mins = (value: number | null) => value === null ? '' : fmtDurationWords(value);
const recordDate = (start?: string, end?: string) => start ? `${d(start)}${end && end !== start ? ` – ${d(end)}` : ''}` : '';
const pair = (label: string, value: unknown) => val(value) ? `${label}: ${val(value)}` : '';
const notEmpty = (record: Record<string, string>) => Object.values(record).some(Boolean);

function employeeTables(input: CompleteEmployeeData) {
  const employeeId = input.employee.id;
  const visits = [
    ...input.visits.filter(x => x.employeeId === employeeId).map(x => ({ sortDate: val(x.visitDate), date: d(x.visitDate), branch: val(x.branch), customer: val(x.clientName) })),
    ...input.fieldVisits.filter(x => x.employeeId === employeeId).map(x => ({ sortDate: val(x.visitDate), date: d(x.visitDate), branch: val(x.branch), customer: '' })),
  ].filter(notEmpty).sort((a,b) => a.sortDate.localeCompare(b.sortDate)).map(({date,branch,customer})=>({date,branch,customer}));

  const minutes = input.minutes.filter(x => x.employeeId === employeeId).sort((a,b) => (a.date ?? '').localeCompare(b.date ?? '')).map(row => {
    const timing = minuteTiming(row);
    const request = val(row.fileRequestTime);
    const received = val(row.fileReceivedTime) || val(row.minuteReceivedTime);
    const response = val(row.responseTime) || val(row.finalResponseTime);
    const result = row.inspectionResult ? INSPECTION_RESULT_LABELS[row.inspectionResult] : row.result ? MINUTE_RESULT_LABELS[row.result] : '';
    const extra = [
      pair('الفرع', row.branch), pair('المرجع', row.clientRef), pair('نوع التمويل', row.financingType),
      row.amount !== null && row.amount !== undefined ? pair('المبلغ', fmtNumber(row.amount)) : '',
      pair('الحالة', row.status ? MINUTE_STATUS_LABELS[row.status] : ''), pair('ملاحظات', row.notes),
    ].filter(Boolean).join(' | ');
    return {
      date: d(row.date), request: t(request), received: t(received), response: t(response), result,
      duration: mins(timing.minutes), delay: timing.invalid ? 'غير مكتمل' : timing.delayed ? 'متأخر' : timing.minutes !== null ? 'في الوقت' : '',
      extra,
    };
  }).filter(notEmpty);

  const old = input.legacyLeaves.filter(x => x.employeeId === employeeId);
  const saved = input.leavePermissions.filter(x => x.employeeId === employeeId);
  const leaves = [
    ...old.filter(x => !x.type.includes('إذن')).map(x => ({ sortDate:val(x.startDate), date: recordDate(x.startDate,x.endDate), type: val(x.type), duration: x.unit === 'days' && x.days !== null ? `${fmtNumber(x.days)} يوم` : x.unit === 'hours' && x.hours !== null ? `${fmtNumber(x.hours)} ساعة` : '', notes: val(x.notes) })),
    ...saved.filter(x => x.requestType === 'leave').map(x => ({ sortDate:val(x.date), date: d(x.date), type: val(x.category), duration: '', notes: val(x.notes) })),
  ].filter(notEmpty).sort((a,b) => a.sortDate.localeCompare(b.sortDate)).map(({date,type,duration,notes})=>({date,type,duration,notes}));
  const permissions = [
    ...old.filter(x => x.type.includes('إذن')).map(x => ({ sortDate:val(x.startDate), date: recordDate(x.startDate,x.endDate), type: val(x.type), duration: x.unit === 'days' && x.days !== null ? `${fmtNumber(x.days)} يوم` : x.unit === 'hours' && x.hours !== null ? `${fmtNumber(x.hours)} ساعة` : '', notes: val(x.notes) })),
    ...saved.filter(x => x.requestType === 'permission').map(x => ({ sortDate:val(x.date), date: d(x.date), type: val(x.category), duration: x.durationHours ? `${fmtNumber(x.durationHours)} ساعة` : '', notes: val(x.notes) })),
  ].filter(notEmpty).sort((a,b) => a.sortDate.localeCompare(b.sortDate)).map(({date,type,duration,notes})=>({date,type,duration,notes}));

  const ownAttendance = input.attendance.filter(x => x.employeeId === employeeId).sort((a,b) => a.date.localeCompare(b.date));
  const late = ownAttendance.filter(x => attendanceDelayMinutes(x.arrivalTime) > 0).map(x => ({ date: d(x.date), time: t(x.arrivalTime), duration: mins(attendanceDelayMinutes(x.arrivalTime)), notes: val(x.notes) }));
  const early = ownAttendance.filter(x => earlyDepartureMinutes(x.departureTime) > 0).map(x => ({ date: d(x.date), time: t(x.departureTime), duration: mins(earlyDepartureMinutes(x.departureTime)), notes: val(x.notes) }));

  const observations = input.observations.filter(x => x.employeeId === employeeId).sort((a,b) => (a.date ?? '').localeCompare(b.date ?? '')).map(x => ({
    date: d(x.date), details: [pair('المصدر',x.source), pair('الفرع',x.branch), pair('المرجع',x.reference), pair('التصنيف',x.category), pair('الخطورة',SEVERITY_LABELS[x.severity] ?? x.severity), pair('التفاصيل',x.details), pair('الإجراء',x.correctiveAction), pair('تاريخ الإخطار',d(x.notificationDate)), pair('الحالة',OBSERVATION_STATUS_LABELS[x.status] ?? x.status), pair('تاريخ الإغلاق',d(x.resolutionDate)), pair('متكررة',typeof x.recurrence === 'boolean' ? (x.recurrence ? 'نعم' : 'لا') : ''), pair('المتابعة',x.followUpNotes)].filter(Boolean).join(' | '),
  })).filter(notEmpty);
  const annual = input.annualNotes.filter(x => x.employeeId === employeeId).sort((a,b) => a.year-b.year).map(x => ({ year: String(x.year), note: val(x.notes) })).filter(notEmpty);

  return { visits, minutes, leaves, permissions, late, early, observations, annual };
}

function usableColumns(columns: Column[], rows: Record<string, string>[]): Column[] {
  return columns.filter(column => rows.some(row => Boolean(row[column.value])));
}

export async function buildCompleteEmployeePdf(data: CompleteEmployeeData, fonts: { regular: PdfFontSource; bold: PdfFontSource }): Promise<Uint8Array> {
  const doc = new PdfDocument(PAGE_W, PAGE_H);
  doc.addFont('TimesNewRomanPSMT', 'F1', fonts.regular);
  doc.addFont('TimesNewRomanPS-BoldMT', 'F2', fonts.bold);
  const page: PdfPage = doc.newPage();
  const records = employeeTables(data);
  let y = TOP;
  const contentBottom = FOOTER_TOP - 9;

  const failOverflow = (section: string): never => {
    const totalRecords = Object.values(records).reduce((sum, value) => sum + value.length, 0);
    throw new Error(`تعذّر احتواء تقرير «${section}» على صفحة A4 واحدة مع الاحتفاظ بكل السجلات (${totalRecords} سجلًا إجمالًا). لم يُحذف أي سجل؛ اختصر الملاحظات أو قلّل عدد السجلات ثم أعد التصدير.`);
  };
  const ensure = (height: number, section: string) => {
    if (y + height > contentBottom) failOverflow(section);
  };
  const sectionTitle = (title: string, gapAfter = 3) => {
    ensure(16 + gapAfter, title);
    page.text(title, { x:MARGIN, top:y, font:'bold', size:11.2, color:C.navy, align:'right', maxWidth:CONTENT_W });
    page.line(MARGIN, y+13.2, PAGE_W-MARGIN, y+13.2, C.border, .55);
    y += 16 + gapAfter;
  };
  const rowLines = (row: Record<string,string>, columns: Column[], size = BODY_SIZE) => columns.map(col => row[col.value] ? wrapText(row[col.value], size, col.width-CELL_PAD_X*2, fonts.regular.metrics) : ['']);
  const tableHeight = (table: TableData, width: number, headerHeight = 17, keepColumns = false) => {
    const cols = keepColumns ? [...table.columns] : usableColumns(table.columns, table.rows);
    const available = width - (table.title ? 0 : 0);
    const widths = cols.map(col => col.width);
    const total = widths.reduce((a,b)=>a+b,0);
    if (total && Math.abs(total-available) > 0.5) cols.forEach(col => { col.width = col.width * available / total; });
    return (table.title ? 14 : 0) + headerHeight + table.rows.reduce((sum,row) => sum + Math.max(15, Math.max(...rowLines(row,cols).map(lines=>lines.length))*LINE_H + CELL_PAD_Y*2),0);
  };
  const drawTable = (table: TableData, x: number, width: number, section: string, options: { titleBand?: boolean; headerHeight?: number; bodySize?: number; keepColumns?: boolean } = {}) => {
    const cols = options.keepColumns ? [...table.columns] : usableColumns(table.columns, table.rows);
    if (!table.rows.length || !cols.length) return 0;
    const headerHeight = options.headerHeight ?? 17;
    const bodySize = options.bodySize ?? BODY_SIZE;
    let available = width;
    if (options.titleBand && table.title) {
      ensure(15, section);
      page.rect(x,y,width,14,{fill:C.navy});
      page.text(table.title,{x:x+4,top:y+1.6,font:'bold',size:9.2,color:C.white,align:'right',maxWidth:width-8});
      y += 15; available = width;
    }
    const total = cols.reduce((sum,col)=>sum+col.width,0);
    if (Math.abs(total-available) > 0.5) cols.forEach(col => { col.width = col.width * available / total; });
    ensure(headerHeight,section);
    let right=x+width;
    for (const col of cols) {
      const cx=right-col.width;
      page.rect(cx,y,col.width,headerHeight,{fill:C.navy});
      page.rect(cx,y,col.width,headerHeight,{stroke:C.border,lineWidth:.45});
      page.text(col.label,{x:cx+CELL_PAD_X,top:y+4,font:'bold',size:9.0,color:C.white,align:'right',maxWidth:col.width-CELL_PAD_X*2});
      right=cx;
    }
    y += headerHeight;
    table.rows.forEach((row,index)=>{
      const wrapped=rowLines(row,cols,bodySize);
      const h=Math.max(15,Math.max(...wrapped.map(lines=>lines.length))*LINE_H+CELL_PAD_Y*2);
      ensure(h,section);
      page.rect(x,y,width,h,{fill:index%2 ? C.alt : C.white});
      page.rect(x,y,width,h,{stroke:C.border,lineWidth:.4});
      right=x+width;
      cols.forEach((col,i)=>{
        const cx=right-col.width;
        if(i>0) page.line(cx,y,cx,y+h,C.border,.35);
        wrapped[i].forEach((line,lineIndex)=>page.text(line,{x:cx+CELL_PAD_X,top:y+CELL_PAD_Y+lineIndex*LINE_H,font:'regular',size:bodySize,color:C.body,align:'right',maxWidth:col.width-CELL_PAD_X*2}));
        right=cx;
      });
      y+=h;
    });
    return y;
  };
  const drawTwoTables = (title: string, rightTable: TableData, leftTable: TableData, options: { titleBand?: boolean; oneFullIfSolo?: boolean; bodySize?: number } = {}) => {
    if (!rightTable.rows.length && !leftTable.rows.length) return;
    sectionTitle(title);
    const gap=8;
    if (options.oneFullIfSolo && (!rightTable.rows.length || !leftTable.rows.length)) {
      const table=rightTable.rows.length ? rightTable : leftTable;
      const total=table.columns.reduce((a,c)=>a+c.width,0) || CONTENT_W;
      table.columns.forEach(col=>col.width=col.width*CONTENT_W/total);
      drawTable(table,MARGIN,CONTENT_W,title,{titleBand:options.titleBand,bodySize:options.bodySize});
      y+=3;
      return;
    }
    const half=(CONTENT_W-gap)/2;
    // Arabic reading order: right-hand table first, then left-hand table.
    const leftStartY=y;
    const rightHeight=tableHeight(rightTable,half) + (options.titleBand && rightTable.title ? 15 : 0);
    const leftHeight=tableHeight(leftTable,half) + (options.titleBand && leftTable.title ? 15 : 0);
    ensure(Math.max(rightHeight,leftHeight),title);
    y=leftStartY;
    drawTable(rightTable,MARGIN+half+gap,half,title,{titleBand:options.titleBand,bodySize:options.bodySize});
    const rightEndY=y;
    y=leftStartY;
    drawTable(leftTable,MARGIN,half,title,{titleBand:options.titleBand,bodySize:options.bodySize});
    y=Math.max(rightEndY,y)+3;
  };
  // Name and dossier identifier.
  const heading=`ملف الموظف / ${val(data.employee.name)}`;
  const headingLines=wrapText(heading,16,CONTENT_W,fonts.bold.metrics);
  ensure(headingLines.length*18+4,'العنوان');
  headingLines.forEach((line,index)=>page.text(line,{x:MARGIN,top:13+index*18,font:'bold',size:16,color:C.navy,align:'right',maxWidth:CONTENT_W}));
  y=TOP;
  const employee=data.employee;
  const infoPairs = ([
    ['كود الموظف',val(employee.code)],['رقم الموظف',val(employee.employeeNo)],['تاريخ التعيين',d(employee.employmentDate)],['الوظيفة',val(employee.jobTitle)],
    ['القطاع',val(employee.sector)],['الفروع المكلف بها',val(employee.branches)],['المحافظة',val(employee.governorate)],['الحالة',`${EMPLOYEE_STATUS_LABELS[employee.status] ?? val(employee.status)}${employee.archived?' (مؤرشف)':''}`],
  ] as [string,string][]).filter(([,value])=>Boolean(value));
  if(infoPairs.length){
    sectionTitle('بيانات الموظف');
    const rowRecords:Record<string,string>[]=[];
    for(let i=0;i<infoPairs.length;i+=2){
      rowRecords.push({label1:infoPairs[i][0],value1:infoPairs[i][1],label2:infoPairs[i+1]?.[0]??'',value2:infoPairs[i+1]?.[1]??''});
    }
    const cols:Column[]=[{label:'البيان',width:60,value:'label1'},{label:'القيمة',width:CONTENT_W/2-60,value:'value1'},{label:'البيان',width:60,value:'label2'},{label:'القيمة',width:CONTENT_W/2-60,value:'value2'}];
    const rows=rowRecords;
    ensure(rows.length*18,'بيانات الموظف');
    rows.forEach((row,index)=>{
      const totalWidth=cols.reduce((s,c)=>s+c.width,0); cols.forEach(c=>c.width=c.width*CONTENT_W/totalWidth);
      const h=18;
      let right=PAGE_W-MARGIN;
      cols.forEach(col=>{
        const cx=right-col.width;
        const isLabel=col.value.startsWith('label');
        page.rect(cx,y,col.width,h,{fill:isLabel?C.navy:index%2?C.alt:C.white});
        page.rect(cx,y,col.width,h,{stroke:C.border,lineWidth:.4});
        const text=row[col.value];
        if(text) page.text(text,{x:cx+3,top:y+4,font:isLabel?'bold':'regular',size:9.0,color:isLabel?C.white:C.body,align:'right',maxWidth:col.width-6});
        right=cx;
      });
      y+=h;
    });
    y+=3;
  }

  // Employee notes: preserve user-entered line breaks, and wrap every line.
  if(val(employee.notes)){
    sectionTitle('ملاحظات على الموظف');
    const noteLines=val(employee.notes).split(/\r?\n/).flatMap(line=>line ? wrapText(line,9.5,CONTENT_W-12,fonts.regular.metrics) : ['']);
    const h=noteLines.reduce((sum,line)=>sum+(line?11.4:5),0)+7;
    ensure(h,'ملاحظات على الموظف');
    page.rect(MARGIN,y,CONTENT_W,h,{fill:C.note}); page.rect(MARGIN,y,CONTENT_W,h,{stroke:C.border,lineWidth:.5});
    let noteY=y+3.5;
    noteLines.forEach(line=>{if(line)page.text(line,{x:MARGIN+6,top:noteY,font:'regular',size:9.5,color:C.body,align:'right',maxWidth:CONTENT_W-12});noteY+=line?11.4:5;});
    y+=h+3;
  }

  const tables=employeeTables(data);
  if(tables.visits.length){
    sectionTitle('الزيارات الميدانية');
    const sorted=tables.visits;
    const cut=Math.ceil(sorted.length/2);
    const rightRows=sorted.slice(0,cut).map(row=>({date:row.date,branch:row.branch,customer:row.customer}));
    const leftRows=sorted.slice(cut).map(row=>({date:row.date,branch:row.branch,customer:row.customer}));
    const cols=(w:number):Column[]=>[{label:'تاريخ الزيارة',width:w*.29,value:'date'},{label:'الفرع',width:w*.27,value:'branch'},{label:'اسم العميل',width:w*.44,value:'customer'}];
    const gap=8, half=(CONTENT_W-gap)/2;
    const rightTable:TableData={columns:cols(half),rows:rightRows};
    const leftTable:TableData={columns:cols(half),rows:leftRows};
    const height=Math.max(tableHeight(rightTable,half,17,true),leftRows.length?tableHeight(leftTable,half,17,true):0); ensure(height,'الزيارات الميدانية');
    const startY=y;
    drawTable(rightTable,MARGIN+half+gap,half,'الزيارات الميدانية',{bodySize:9.1,keepColumns:true}); const endY=y;
    y=startY;
    if(leftRows.length) drawTable(leftTable,MARGIN,half,'الزيارات الميدانية',{bodySize:9.1,keepColumns:true});
    y=Math.max(endY,y)+3;
  }

  if(tables.leaves.length || tables.permissions.length){
    const gap=8, half=(CONTENT_W-gap)/2;
    const makeLeaveTable=(rows:typeof tables.leaves,title:string):TableData=>({title,columns:[
      {label:'التاريخ',width:half*.28,value:'date'},{label:'النوع',width:half*.35,value:'type'},{label:'المدة',width:half*.18,value:'duration'},{label:'الملاحظات',width:half*.19,value:'notes'},
    ],rows});
    drawTwoTables('الإجازات والأذونات',makeLeaveTable(tables.leaves,'الإجازات'),makeLeaveTable(tables.permissions,'الأذونات'),{titleBand:true,oneFullIfSolo:true,bodySize:8.9});
  }

  if(tables.minutes.length){
    sectionTitle('محاضر يومية');
    const rows=tables.minutes;
    const definitions:Column[]=[
      {label:'التاريخ',width:52,value:'date'}, {label:'طلب الملف',width:53,value:'request'}, {label:'استلام الملف',width:58,value:'received'},
      {label:'الرد على الملف',width:58,value:'response'}, {label:'نتيجة الفحص',width:72,value:'result'}, {label:'مدة الفحص',width:58,value:'duration'},
      {label:'حالة التأخير',width:58,value:'delay'}, {label:'بيانات أخرى',width:170,value:'extra'},
    ];
    const columns=usableColumns(definitions,rows);
    const total=columns.reduce((sum,c)=>sum+c.width,0); columns.forEach(c=>c.width=c.width*CONTENT_W/total);
    drawTable({columns,rows},MARGIN,CONTENT_W,'محاضر يومية',{bodySize:8.9,headerHeight:17});
    y+=3;
  }

  if(tables.late.length || tables.early.length){
    const makeAttendance=(rows:typeof tables.late,title:string,w:number):TableData=>({title,columns:[
      {label:'التاريخ',width:w*.23,value:'date'},{label:'الوقت',width:w*.21,value:'time'},{label:'المدة',width:w*.22,value:'duration'},{label:'ملاحظات',width:w*.34,value:'notes'},
    ],rows});
    const gap=8, half=(CONTENT_W-gap)/2;
    drawTwoTables('التأخيرات',makeAttendance(tables.late,'تأخر الحضور',half),makeAttendance(tables.early,'الانصراف المبكر',half),{titleBand:true,oneFullIfSolo:true,bodySize:8.9});
  }

  if(tables.observations.length){
    sectionTitle('الملاحظات والمتابعات');
    const rows=tables.observations;
    const cols:Column[]=[{label:'التاريخ',width:54,value:'date'},{label:'التفاصيل',width:CONTENT_W-54,value:'details'}];
    drawTable({columns:cols,rows},MARGIN,CONTENT_W,'الملاحظات والمتابعات',{bodySize:8.8,headerHeight:16}); y+=2;
  }
  if(tables.annual.length){
    const gap=8, half=(CONTENT_W-gap)/2;
    const annualTable:TableData={columns:[{label:'السنة',width:55,value:'year'},{label:'الملاحظة السنوية',width:half-55,value:'note'}],rows:tables.annual};
    drawTwoTables('الملاحظات السنوية',annualTable,{columns:[],rows:[]},{oneFullIfSolo:true,bodySize:8.8});
  }

  // A single-page report is an explicit invariant; refuse export rather than silently omit records.
  if(y>contentBottom) failOverflow('المحتوى الكامل');
  page.line(MARGIN,FOOTER_TOP-5,PAGE_W-MARGIN,FOOTER_TOP-5,C.border,.6);
  page.text('كاش للتمويل متناهي الصغر — ملف الموظف',{x:MARGIN,top:FOOTER_TOP,font:'regular',size:7.2,color:C.muted,align:'right',maxWidth:CONTENT_W*.7});
  page.text('صفحة 1 من 1',{x:MARGIN,top:FOOTER_TOP,font:'regular',size:7.2,color:C.muted,align:'left',maxWidth:CONTENT_W});
  doc.addPage(page);
  return doc.build();
}

export function employeePdfFileName(employee: Employee): string {
  const safe = `${employee.employeeNo}-${employee.name}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^\w\u0600-\u06FF.-]+/g, '');
  return `employee-${safe || employee.id}.pdf`;
}
