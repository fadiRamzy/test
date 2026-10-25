import { downloadFile } from './utils';

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** يبني CSV بترميز UTF-8 مع BOM حتى يفتحه Excel العربي بشكل صحيح */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(escapeCell).join(','), ...rows.map((row) => row.map(escapeCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function downloadCsv(fileName: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  downloadFile(fileName.endsWith('.csv') ? fileName : `${fileName}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
}

export function csvFileName(prefix: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.csv`;
}
