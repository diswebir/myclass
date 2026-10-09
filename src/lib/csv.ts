const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * RFC 4180 cell escaping plus CSV/Formula-injection protection:
 * cells starting with = + - @ tab or CR are prefixed with a single quote so spreadsheets treat them as text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || s.startsWith("'")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
