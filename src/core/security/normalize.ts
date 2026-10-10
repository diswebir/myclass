/**
 * نرمال‌سازی ورودی — ارقام فارسی/عربی → انگلیسی، موبایل به قالب استاندارد.
 * per spec §۶-ب: ارقام فارسی/عربی در ورودی (تلفن، مبلغ، عدد) پیش از اعتبارسنجی نرمال‌سازی می‌شوند.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'; // ۰-۹
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'; // ٠-٩

/** تبدیل ارقام فارسی/عربی به انگلیسی. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const fa = FA_DIGITS.indexOf(ch);
    if (fa !== -1) {
      out += String(fa);
      continue;
    }
    const ar = AR_DIGITS.indexOf(ch);
    if (ar !== -1) {
      out += String(ar);
      continue;
    }
    out += ch;
  }
  return out;
}

/** تبدیل ارقام انگلیسی به فارسی. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** تبدیل ارقام انگلیسی به عربی. */
export function toArabicDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

export const MOBILE_REGEX = /^09\d{9}$/;

/**
 * نرمال‌سازی شماره موبایل به قالب استاندارد `09xxxxxxxxxx`.
 *formatهای قابل قبول: 09xxxxxxxxxx، +989xxxxxxxxx، 00989xxxxxxxxx، 989xxxxxxxxx
 * خروجی null یعنی نامعتبر.
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null;
  let digits = normalizeDigits(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0098')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('98')) digits = '0' + digits.slice(2);
  if (!MOBILE_REGEX.test(digits)) return null;
  return digits;
}

/** trim + نرمال‌سازی فاصله (ZWNJ و NBSP → فاصله معمولی) */
export function normalizeText(input: string): string {
  return input
    .replace(/\u200c/g, ' ') // ZWNJ
    .replace(/\u00a0/g, ' ') // NBSP
    .replace(/\s+/g, ' ')
    .trim();
}
