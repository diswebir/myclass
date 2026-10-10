/**
 * پول — تمام مبالغ به‌صورت عدد صحیح BIGINT (کوچک‌ترین واحد پول) ذخیره می‌شوند.
 * هیچ‌گاه FLOAT. کوچک‌ترین واحد پیش‌فرض: ۱ تومان (قابل تغییر با CURRENCY_MINOR_PER_MAJOR).
 * per spec §۶-ب.
 *
 * نوع Money = رشته اعشاری بدون signo (minor units) — برای حفظ دقت BIGINT.
 */
import { normalizeDigits } from './normalize';

export type Money = string;

export const ZERO: Money = '0';

const GROUP_SEP = '٬'; // U+066C Arabic thousands separator

/** تحلیل مبلغ ورودی (تومان/ریال per cents) → رشته minor units. null یعنی نامعتبر. */
export function parseMoneyInput(input: string | number, minorPerMajor = 1): Money | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  let s = normalizeDigits(String(input)).trim();
  // حذف جداکننده‌های هزارگان و فاصله
  s = s.replace(/[٬, \s]/g, '');
  if (!/^\d+$/.test(s)) return null;
  let major = BigInt(s);
  major *= BigInt(minorPerMajor);
  return major.toString();
}

export function toMoney(value: bigint | number | string): Money {
  return BigInt(value).toString();
}

export function addMoney(a: Money, b: Money): Money {
  return (BigInt(a) + BigInt(b)).toString();
}

export function subMoney(a: Money, b: Money): Money {
  return (BigInt(a) - BigInt(b)).toString();
}

export function mulMoney(a: Money, factor: bigint | number): Money {
  return (BigInt(a) * BigInt(factor)).toString();
}

export function divMoney(a: Money, divisor: bigint | number): Money {
  return (BigInt(a) / BigInt(divisor)).toString();
}

export function compareMoney(a: Money, b: Money): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZeroMoney(a: Money): boolean {
  return BigInt(a) === 0n;
}

export function isNegativeMoney(a: Money): boolean {
  return BigInt(a) < 0n;
}

export function maxMoney(a: Money, b: Money): Money {
  return compareMoney(a, b) >= 0 ? a : b;
}

export function minMoney(a: Money, b: Money): Money {
  return compareMoney(a, b) <= 0 ? a : b;
}

/** تبدیل — amount (minor) → major (number) — فقط برای نمایش/گزارش. */
export function toMajor(amount: Money, minorPerMajor = 1): number {
  return Number(BigInt(amount) / BigInt(minorPerMajor));
}

/** قالب نمایشی: ۱۲٬۳۴۵ (با رقم فارسی و جداکننده هزارگان) */
export function formatMoney(
  amount: Money,
  opts: { faDigits?: boolean; withUnit?: boolean; unit?: string; minorPerMajor?: number } = {},
): string {
  const { faDigits = true, withUnit = false, unit = 'تومان', minorPerMajor = 1 } = opts;
  const negative = isNegativeMoney(amount);
  let digits = (negative ? BigInt(amount) * -1n : BigInt(amount)).toString();
  // جداکننده هزارگان
  digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP);
  if (faDigits) {
    digits = digits.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  }
  void minorPerMajor;
  const sign = negative ? '−' : '';
  return withUnit ? `${sign}${digits} ${unit}` : `${sign}${digits}`;
}
