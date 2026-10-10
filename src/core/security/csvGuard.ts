/**
 * خروجی CSV — جلوگیری از Formula Injection (per spec §۶-پ):
 * سلول‌هایی که با `= + - @` (یا tab/CR) شروع می‌شوند، با پیشوند `'` بی‌اثر می‌شوند.
 */
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (DANGEROUS_PREFIX.test(s)) return `'${s}`;
  return s;
}

export function sanitizeCsvRow(row: unknown[]): unknown[] {
  return row.map(sanitizeCsvCell);
}
