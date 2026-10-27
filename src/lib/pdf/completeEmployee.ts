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
  navy: '0.141 0.231 0.325', // #243B53
  section: '0.259 0.416 0.541', // #426A8A
  headerFill: '0.863 0.906 0.941', // #DCE7F0
  headerText: '0.141 0.231 0.325',
  body: '0.133 0.133 0.133',
  muted: '0.39 0.43 0.48',
  border: '0.78 0.83 0.88',
  alt: '0.961 0.973 0.984', // #F5F8FB
  white: '1 1 1',
  note: '0.925 0.953 0.977',
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
  const tables = employeeTables(data);
  const pages: PdfPage[] = [];
  const reportHeading = `ملف الموظف / ${val(data.employee.name)}`;
  let page!: PdfPage;
  let y = TOP;
  const contentBottom = FOOTER_TOP - 9;
  const newPage = () => {
    page = doc.newPage();
    pages.push(page);
    const continued = pages.length > 1;
    const heading = continued ? `${reportHeading} — تابع` : reportHeading;
    const size = continued ? 11.5 : 16;
    const lines = wrapText(heading, size, CONTENT_W, fonts.bold.metrics);
    lines.forEach((line,index) => page.text(line,{x:MARGIN,top:13+index*(continued?14:18),font:'bold',size,color:C.navy,align:'right',maxWidth:CONTENT_W}));
    y = Math.max(TOP, 15 + lines.length*(continued?14:18));
  };
  newPage();

  const sectionTitle = (title: string, continued = false) => {
    page.text(continued ? `${title} — تابع` : title,{x:MARGIN,top:y,font:'bold',size:11.2,color:C.section,align:'right',maxWidth:CONTENT_W});
    page.line(MARGIN,y+13.2,PAGE_W-MARGIN,y+13.2,C.border,.55);
    y += 18;
  };
  const startSection = (title: string, firstBlockHeight = 20) => {
    if (y + 18 + firstBlockHeight > contentBottom) newPage();
    sectionTitle(title);
  };
  const rowLines = (row: Record<string,string>, columns: Column[], size = BODY_SIZE) =>
    columns.map(col => row[col.value] ? wrapText(row[col.value],size,col.width-CELL_PAD_X*2,fonts.regular.metrics) : ['']);
  const rowLineCount = (wrapped: string[][]) => Math.max(1,...wrapped.map(lines=>lines.length));
  const columnsFor = (table: TableData, keep = false) => (keep ? table.columns : usableColumns(table.columns,table.rows)).map(col=>({...col}));
  const normalizedColumns = (columns: Column[], width: number) => {
    const total=columns.reduce((sum,col)=>sum+col.width,0);
    if(total>0 && Math.abs(total-width)>.5) columns.forEach(col=>{col.width=col.width*width/total;});
    return columns;
  };
  const drawHeader = (columns: Column[], x: number, width: number, height = 17) => {
    let right=x+width;
    for(const col of columns){
      const cx=right-col.width;
      page.rect(cx,y,col.width,height,{fill:C.headerFill});
      page.rect(cx,y,col.width,height,{stroke:C.border,lineWidth:.45});
      page.text(col.label,{x:cx+CELL_PAD_X,top:y+4,font:'bold',size:9,color:C.headerText,align:'right',maxWidth:col.width-CELL_PAD_X*2});
      right=cx;
    }
    y+=height;
  };
  const drawTitleBandAt = (title: string, x: number, width: number, top: number) => {
    page.rect(x,top,width,14,{fill:C.headerFill});
    page.rect(x,top,width,14,{stroke:C.border,lineWidth:.45});
    page.text(title,{x:x+4,top:top+1.6,font:'bold',size:9.2,color:C.headerText,align:'right',maxWidth:width-8});
  };
  const drawTitleBand = (title: string, x: number, width: number) => {
    drawTitleBandAt(title,x,width,y);
    y+=15;
  };
  const drawRowPart = (wrapped: string[][], columns: Column[], x: number, width: number,
    firstLine: number, takeLines: number, index: number, size = BODY_SIZE) => {
    const visible=Math.max(1,...wrapped.map(lines=>Math.min(takeLines,Math.max(0,lines.length-firstLine))));
    const height=Math.max(15,visible*LINE_H+CELL_PAD_Y*2);
    page.rect(x,y,width,height,{fill:index%2?C.alt:C.white});
    page.rect(x,y,width,height,{stroke:C.border,lineWidth:.4});
    let right=x+width;
    columns.forEach((col,i)=>{
      const cx=right-col.width;
      if(i>0) page.line(cx,y,cx,y+height,C.border,.35);
      const subset=wrapped[i].slice(firstLine,firstLine+takeLines);
      subset.forEach((line,lineIndex)=>page.text(line,{x:cx+CELL_PAD_X,top:y+CELL_PAD_Y+lineIndex*LINE_H,font:'regular',size,color:C.body,align:'right',maxWidth:col.width-CELL_PAD_X*2}));
      right=cx;
    });
    y+=height;
  };
  const drawPaginatedTable = (title: string, table: TableData, x: number, width: number, options: { titleBand?: boolean; keepColumns?: boolean; bodySize?: number; headerHeight?: number } = {}) => {
    if(!table.rows.length) return;
    const cols=normalizedColumns(columnsFor(table,options.keepColumns),width);
    if(!cols.length) return;
    const size=options.bodySize??BODY_SIZE;
    const headerH=options.headerHeight??17;
    const bandH=options.titleBand&&table.title?15:0;
    const wrappedRows=table.rows.map(row=>rowLines(row,cols,size));
    const firstLines=wrappedRows.length?rowLineCount(wrappedRows[0]):1;
    const firstH=Math.max(15,firstLines*LINE_H+CELL_PAD_Y*2);
    startSection(title,bandH+headerH+Math.min(firstH,contentBottom-TOP));
    const openPart=(continued:boolean)=>{
      if(continued){newPage();sectionTitle(title,true);}
      if(options.titleBand&&table.title)drawTitleBand(table.title,x,width);
      drawHeader(cols,x,width,headerH);
    };
    openPart(false);
    for(let index=0;index<table.rows.length;index++){
      const wrapped=wrappedRows[index];
      const totalLines=rowLineCount(wrapped);
      const wholeHeight=Math.max(15,totalLines*LINE_H+CELL_PAD_Y*2);
      const fullPageLines=Math.floor((contentBottom-(TOP+18+bandH+headerH)-2*CELL_PAD_Y)/LINE_H);
      if(totalLines<=fullPageLines && y+wholeHeight>contentBottom)openPart(true);
      let firstLine=0;
      while(firstLine<totalLines){
        let capacity=Math.floor((contentBottom-y-2*CELL_PAD_Y)/LINE_H);
        if(capacity<1){openPart(true);capacity=Math.floor((contentBottom-y-2*CELL_PAD_Y)/LINE_H);}
        const take=Math.min(totalLines-firstLine,capacity);
        drawRowPart(wrapped,cols,x,width,firstLine,take,index,size);
        firstLine+=take;
        if(firstLine<totalLines)openPart(true);
      }
    }
    y+=3;
  };
  const drawPaginatedTwoTables = (title:string,rightTable:TableData,leftTable:TableData,options:{titleBand?:boolean;oneFullIfSolo?:boolean;bodySize?:number;keepColumns?:boolean}={})=>{
    if(!rightTable.rows.length&&!leftTable.rows.length)return;
    const gap=8, half=(CONTENT_W-gap)/2;
    if(options.oneFullIfSolo&&(!rightTable.rows.length||!leftTable.rows.length)){
      const table=rightTable.rows.length?rightTable:leftTable;
      drawPaginatedTable(title,table,MARGIN,CONTENT_W,{titleBand:options.titleBand,bodySize:options.bodySize,keepColumns:options.keepColumns});
      return;
    }
    const rightCols=normalizedColumns(columnsFor(rightTable,options.keepColumns),half);
    const leftCols=normalizedColumns(columnsFor(leftTable,options.keepColumns),half);
    const rightLines=rightTable.rows.map(row=>rowLineCount(rowLines(row,rightCols,options.bodySize??BODY_SIZE)));
    const leftLines=leftTable.rows.map(row=>rowLineCount(rowLines(row,leftCols,options.bodySize??BODY_SIZE)));
    const count=Math.max(rightTable.rows.length,leftTable.rows.length);
    const headerH=17, bandH=options.titleBand?15:0;
    const firstLines=Math.max(rightLines[0]??0,leftLines[0]??0,1);
    startSection(title,bandH+headerH+Math.min(Math.max(15,firstLines*LINE_H+CELL_PAD_Y*2),contentBottom-TOP));
    const openPart=(continued:boolean)=>{
      if(continued){newPage();sectionTitle(title,true);}
      if(options.titleBand&&(rightTable.title||leftTable.title)){
        const bandY=y;
        if(rightTable.title)drawTitleBandAt(rightTable.title,MARGIN+half+gap,half,bandY);
        if(leftTable.title)drawTitleBandAt(leftTable.title,MARGIN,half,bandY);
        y=bandY+15;
      }
      const headerTop=y;
      drawHeader(rightCols,MARGIN+half+gap,half,headerH);
      y=headerTop;
      drawHeader(leftCols,MARGIN,half,headerH);
      y=headerTop+headerH;
    };
    openPart(false);
    for(let index=0;index<count;index++){
      const rightRow=rightTable.rows[index], leftRow=leftTable.rows[index];
      const rightWrapped=rightRow?rowLines(rightRow,rightCols,options.bodySize??BODY_SIZE):[];
      const leftWrapped=leftRow?rowLines(leftRow,leftCols,options.bodySize??BODY_SIZE):[];
      const lines=Math.max(rightRow?rowLineCount(rightWrapped):0,leftRow?rowLineCount(leftWrapped):0,1);
      const wholeHeight=Math.max(15,lines*LINE_H+CELL_PAD_Y*2);
      const maxLines=Math.floor((contentBottom-(TOP+18+headerH+bandH)-CELL_PAD_Y*2)/LINE_H);
      if(lines<=maxLines&&y+wholeHeight>contentBottom)openPart(true);
      let firstLine=0;
      while(firstLine<lines){
        let capacity=Math.floor((contentBottom-y-2*CELL_PAD_Y)/LINE_H);
        if(capacity<1){openPart(true);capacity=Math.floor((contentBottom-y-2*CELL_PAD_Y)/LINE_H);}
        const take=Math.min(lines-firstLine,capacity);
        const rowStart=y;
        if(rightRow)drawRowPart(rightWrapped,rightCols,MARGIN+half+gap,half,firstLine,take,index,options.bodySize??BODY_SIZE);
        const rightY=y;
        y=rowStart;
        if(leftRow)drawRowPart(leftWrapped,leftCols,MARGIN,half,firstLine,take,index,options.bodySize??BODY_SIZE);
        const leftY=y;
        y=Math.max(rightY,leftY);
        firstLine+=take;
        if(firstLine<lines)openPart(true);
      }
    }
    y+=3;
  };

  // Compact identity grid follows the one report heading already placed by newPage().
  const employee=data.employee;
  const infoPairs=([
    ['كود الموظف',val(employee.code)],['رقم الموظف',val(employee.employeeNo)],['تاريخ التعيين',d(employee.employmentDate)],['الوظيفة',val(employee.jobTitle)],
    ['القطاع',val(employee.sector)],['الفروع المكلف بها',val(employee.branches)],['المحافظة',val(employee.governorate)],['الحالة',`${EMPLOYEE_STATUS_LABELS[employee.status]??val(employee.status)}${employee.archived?' (مؤرشف)':''}`],
  ] as [string,string][]).filter(([,value])=>Boolean(value));
  if(infoPairs.length){
    const rowRecords:Record<string,string>[]=[];
    for(let i=0;i<infoPairs.length;i+=2)rowRecords.push({label1:infoPairs[i][0],value1:infoPairs[i][1],label2:infoPairs[i+1]?.[0]??'',value2:infoPairs[i+1]?.[1]??''});
    const cols:Column[]=[{label:'البيان',width:60,value:'label1'},{label:'القيمة',width:CONTENT_W/2-60,value:'value1'},{label:'البيان',width:60,value:'label2'},{label:'القيمة',width:CONTENT_W/2-60,value:'value2'}];
    startSection('بيانات الموظف',rowRecords.length*18);
    rowRecords.forEach((row,index)=>{
      let right=PAGE_W-MARGIN;
      cols.forEach(col=>{
        const cx=right-col.width,isLabel=col.value.startsWith('label'),text=row[col.value];
        page.rect(cx,y,col.width,18,{fill:isLabel?C.headerFill:index%2?C.alt:C.white});
        page.rect(cx,y,col.width,18,{stroke:C.border,lineWidth:.4});
        if(text)page.text(text,{x:cx+3,top:y+4,font:isLabel?'bold':'regular',size:9,color:isLabel?C.headerText:C.body,align:'right',maxWidth:col.width-6});
        right=cx;
      });
      y+=18;
    });
    y+=3;
  }

  if(val(employee.notes)){
    const noteLines=val(employee.notes).split(/\r?\n/).flatMap(line=>line?wrapText(line,9.5,CONTENT_W-12,fonts.regular.metrics):['']);
    const title='ملاحظات على الموظف';
    startSection(title,Math.min(noteLines.length*11.4+8,contentBottom-TOP));
    let first=0;
    while(first<noteLines.length){
      const capacity=Math.max(1,Math.floor((contentBottom-y-8)/11.4));
      const take=Math.min(noteLines.length-first,capacity);
      const h=take*11.4+8;
      page.rect(MARGIN,y,CONTENT_W,h,{fill:C.note});page.rect(MARGIN,y,CONTENT_W,h,{stroke:C.border,lineWidth:.5});
      noteLines.slice(first,first+take).forEach((line,index)=>{if(line)page.text(line,{x:MARGIN+6,top:y+3+index*11.4,font:'regular',size:9.5,color:C.body,align:'right',maxWidth:CONTENT_W-12});});
      y+=h;first+=take;
      if(first<noteLines.length){newPage();sectionTitle(title,true);}
    }
    y+=3;
  }

  if(tables.visits.length){
    const sorted=tables.visits,cut=Math.ceil(sorted.length/2);
    const rightRows=sorted.slice(0,cut).map(row=>({date:row.date,branch:row.branch,customer:row.customer}));
    const leftRows=sorted.slice(cut).map(row=>({date:row.date,branch:row.branch,customer:row.customer}));
    const gap=8,half=(CONTENT_W-gap)/2;
    const cols=(w:number):Column[]=>[{label:'تاريخ الزيارة',width:w*.29,value:'date'},{label:'الفرع',width:w*.27,value:'branch'},{label:'اسم العميل',width:w*.44,value:'customer'}];
    const rightTable:TableData={columns:cols(half),rows:rightRows},leftTable:TableData={columns:cols(half),rows:leftRows};
    if(!leftRows.length)drawPaginatedTable('الزيارات الميدانية',rightTable,MARGIN,CONTENT_W,{bodySize:9.1,keepColumns:true});
    else drawPaginatedTwoTables('الزيارات الميدانية',rightTable,leftTable,{bodySize:9.1,keepColumns:true});
  }

  if(tables.leaves.length||tables.permissions.length){
    const half=(CONTENT_W-8)/2;
    const makeLeaveTable=(rows:typeof tables.leaves,title:string):TableData=>({title,columns:[
      {label:'التاريخ',width:half*.28,value:'date'},{label:'النوع',width:half*.35,value:'type'},{label:'المدة',width:half*.18,value:'duration'},{label:'الملاحظات',width:half*.19,value:'notes'},
    ],rows});
    drawPaginatedTwoTables('الإجازات والأذونات',makeLeaveTable(tables.leaves,'الإجازات'),makeLeaveTable(tables.permissions,'الأذونات'),{titleBand:true,oneFullIfSolo:true,bodySize:8.9});
  }

  if(tables.minutes.length){
    const definitions:Column[]=[
      {label:'التاريخ',width:52,value:'date'},{label:'طلب الملف',width:53,value:'request'},{label:'استلام الملف',width:58,value:'received'},
      {label:'الرد على الملف',width:58,value:'response'},{label:'نتيجة الفحص',width:72,value:'result'},{label:'مدة الفحص',width:58,value:'duration'},
      {label:'حالة التأخير',width:58,value:'delay'},{label:'بيانات أخرى',width:170,value:'extra'},
    ];
    const columns=usableColumns(definitions,tables.minutes);
    drawPaginatedTable('محاضر يومية',{columns,rows:tables.minutes},MARGIN,CONTENT_W,{bodySize:8.9,headerHeight:17});
  }

  if(tables.late.length||tables.early.length){
    const half=(CONTENT_W-8)/2;
    const makeAttendance=(rows:typeof tables.late,title:string,w:number):TableData=>({title,columns:[
      {label:'التاريخ',width:w*.23,value:'date'},{label:'الوقت',width:w*.21,value:'time'},{label:'المدة',width:w*.22,value:'duration'},{label:'ملاحظات',width:w*.34,value:'notes'},
    ],rows});
    drawPaginatedTwoTables('التأخيرات',makeAttendance(tables.late,'تأخر الحضور',half),makeAttendance(tables.early,'الانصراف المبكر',half),{titleBand:true,oneFullIfSolo:true,bodySize:8.9});
  }

  if(tables.observations.length){
    const columns:Column[]=[{label:'التاريخ',width:54,value:'date'},{label:'التفاصيل',width:CONTENT_W-54,value:'details'}];
    drawPaginatedTable('الملاحظات والمتابعات',{columns,rows:tables.observations},MARGIN,CONTENT_W,{bodySize:8.8,headerHeight:16});
  }
  if(tables.annual.length){
    const columns:Column[]=[{label:'السنة',width:55,value:'year'},{label:'الملاحظة السنوية',width:CONTENT_W-55,value:'note'}];
    drawPaginatedTable('الملاحظات السنوية',{columns,rows:tables.annual},MARGIN,CONTENT_W,{bodySize:8.8,headerHeight:16});
  }

  pages.forEach((current,index)=>{
    current.line(MARGIN,FOOTER_TOP-5,PAGE_W-MARGIN,FOOTER_TOP-5,C.border,.6);
    current.text('كاش للتمويل متناهي الصغر — ملف الموظف',{x:MARGIN,top:FOOTER_TOP,font:'regular',size:7.2,color:C.muted,align:'right',maxWidth:CONTENT_W*.7});
    current.text(`صفحة ${index+1} من ${pages.length}`,{x:MARGIN,top:FOOTER_TOP,font:'regular',size:7.2,color:C.muted,align:'left',maxWidth:CONTENT_W});
    doc.addPage(current);
  });
  return doc.build();
}

export function employeePdfFileName(employee: Employee): string {
  const safe = `${employee.employeeNo}-${employee.name}`.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/[^\w\u0600-\u06FF.-]+/g, '');
  return `employee-${safe || employee.id}.pdf`;
}
