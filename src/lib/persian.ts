const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Converts Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII digits. */
export function toEnglishDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    const a = ARABIC_DIGITS.indexOf(ch);
    out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
  }
  return out;
}

/** Converts ASCII digits to Persian digits for display only. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Normalises Arabic letters commonly typed on Persian keyboards (ي ك → ی ک) and trims spaces. */
export function normalizeText(input: string): string {
  return input.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c+/g, '\u200c').replace(/\s+/g, ' ').trim();
}

/**
 * Canonical form of a username: Persian/Arabic digits folded to ASCII, Persian letters normalised,
 * whitespace trimmed and lowercased. Used for storage, login and lookups so they always agree.
 */
export function normalizeUsername(input: string): string {
  return toEnglishDigits(normalizeText(input)).toLowerCase();
}

/**
 * Normalises an Iranian mobile number to the canonical form 09XXXXXXXXX.
 * Accepts: 09121234567, 9121234567, +989121234567, 00989121234567, Persian/Arabic digits, spaces, dashes.
 * Returns null when the input is not a valid mobile number.
 */
export function normalizeIranMobile(input: string): string | null {
  const ascii = toEnglishDigits(input).replace(/[\s\-().]/g, '');
  let digits: string | null = null;
  if (/^\+98\d{10}$/.test(ascii)) digits = ascii.slice(3);
  else if (/^0098\d{10}$/.test(ascii)) digits = ascii.slice(4);
  else if (/^98\d{10}$/.test(ascii)) digits = ascii.slice(2);
  else if (/^09\d{9}$/.test(ascii)) digits = ascii.slice(1);
  else if (/^9\d{9}$/.test(ascii)) digits = ascii;
  if (digits === null || !/^9\d{9}$/.test(digits)) return null;
  return '0' + digits;
}
