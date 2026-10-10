/**
 * زمان — ذخیره‌سازی UTC (per spec §۶-ب):
 * - DATETIME → رشته 'YYYY-MM-DD HH:MM:SS' (UTC) — قابل حمل بین MySQL و SQLite
 * - DATE → رشته 'YYYY-MM-DD'
 * تبدیل شمسی فقط در لایه نمایش/ورودی (src/core/text/jalaali.ts).
 */

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** Date → رشته DATETIME ذخیره‌سازی (UTC) */
export function toDbDateTime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** رشته DATETIME (UTC) → Date */
export function fromDbDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  // 'YYYY-MM-DD HH:MM:SS' → Date (UTC)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
}

/** Date → رشته DATE (UTC) */
export function toDbDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** رشته DATE → Date (UTC، نیمه‌شب) */
export function fromDbDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function nowDb(d: Date = new Date()): string {
  return toDbDateTime(d);
}

/** offset minutes → رشته DATETIME (برای next_attempt_at) */
export function minutesFromNow(minutes: number): string {
  return toDbDateTime(new Date(Date.now() + minutes * 60 * 1000));
}
