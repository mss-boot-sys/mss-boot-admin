export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

// Cells starting with these characters are interpreted as formulas by
// spreadsheet apps (CSV/formula injection). Prefix them with a quote.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(raw: string | number | null | undefined): string {
  let value = raw === null || raw === undefined ? '' : String(raw);
  if (FORMULA_PREFIX.test(value)) value = `'${value}`;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => escapeCsvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvCell(column.value(row))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Downloads CSV with a UTF-8 BOM so Excel renders CJK text correctly. */
export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
