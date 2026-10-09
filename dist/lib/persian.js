"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toEnglishDigits = toEnglishDigits;
exports.toPersianDigits = toPersianDigits;
exports.normalizeText = normalizeText;
exports.normalizeIranMobile = normalizeIranMobile;
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Converts Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII digits. */
function toEnglishDigits(input) {
    let out = '';
    for (const ch of input) {
        const p = PERSIAN_DIGITS.indexOf(ch);
        const a = ARABIC_DIGITS.indexOf(ch);
        out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
    }
    return out;
}
/** Converts ASCII digits to Persian digits for display only. */
function toPersianDigits(input) {
    return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}
/** Normalises Arabic letters commonly typed on Persian keyboards (ي ك → ی ک) and trims spaces. */
function normalizeText(input) {
    return input.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c+/g, '\u200c').replace(/\s+/g, ' ').trim();
}
/**
 * Normalises an Iranian mobile number to the canonical form 09XXXXXXXXX.
 * Accepts: 09121234567, 9121234567, +989121234567, 00989121234567, Persian/Arabic digits, spaces, dashes.
 * Returns null when the input is not a valid mobile number.
 */
function normalizeIranMobile(input) {
    const ascii = toEnglishDigits(input).replace(/[\s\-().]/g, '');
    let digits = null;
    if (/^\+98\d{10}$/.test(ascii))
        digits = ascii.slice(3);
    else if (/^0098\d{10}$/.test(ascii))
        digits = ascii.slice(4);
    else if (/^98\d{10}$/.test(ascii))
        digits = ascii.slice(2);
    else if (/^09\d{9}$/.test(ascii))
        digits = ascii.slice(1);
    else if (/^9\d{9}$/.test(ascii))
        digits = ascii;
    if (digits === null || !/^9\d{9}$/.test(digits))
        return null;
    return '0' + digits;
}
