/**
 * تقویم شمسی (جلالی) — تبدیل فقط در لایه نمایش/ورودی (per spec §۶-ب).
 * بر اساس jalaali-js (JS خالص).
 */
import jalaali from 'jalaali-js';
import { toPersianDigits, normalizeDigits } from '../security/normalize';
import { fromDbDate } from '../db/time';

export interface JalaaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

export function toJalaali(date: Date): JalaaliDate {
  return jalaali.toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function fromJalaali(jy: number, jm: number, jd: number): Date {
  const g = jalaali.toGregorian(jy, jm, jd);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
}

export function isJalaaliLeap(jy: number): boolean {
  return jalaali.isLeapJalaaliYear(jy);
}

export function jalaaliMonthLength(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm);
}

/** Date → رشته شمسی 'YYYY/MM/DD' (رقم فارسی) */
export function formatJalaali(date: Date, sep = '/'): string {
  const j = toJalaali(date);
  return toPersianDigits(`${j.jy}${sep}${String(j.jm).padStart(2, '0')}${sep}${String(j.jd).padStart(2, '0')}`);
}

/** رشته شمسی (رقم فارسی/انگلیسی) → Date (UTC) — null یعنی نامعتبر */
export function parseJalaali(input: string): Date | null {
  const s = normalizeDigits(input.trim()).replace(/[./-]/g, '/');
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1];
  const jm = +m[2];
  const jd = +m[3];
  if (jm < 1 || jm > 12) return null;
  if (jd < 1 || jd > jalaaliMonthLength(jy, jm)) return null;
  return fromJalaali(jy, jm, jd);
}

/** رشته تاریخ DB (DATE) → شمسی نمایشی */
export function dbDateToJalaali(s: string | null | undefined): string | null {
  const d = fromDbDate(s);
  if (!d) return null;
  return formatJalaali(d);
}

export { toPersianDigits };
