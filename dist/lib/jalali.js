"use strict";
/**
 * Solar Hijri (Jalali/Persian) calendar conversion.
 * Storage policy: dates are persisted as Gregorian DATE values (YYYY-MM-DD) in the database.
 * Conversion to Jalali happens only in the presentation layer (see formatJalali).
 * Algorithm: arithmetic 33-year-cycle based breaks table; verified in tests against Intl 'fa-IR-u-ca-persian'.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JALALI_MONTH_NAMES = void 0;
exports.isLeapJalaliYear = isLeapJalaliYear;
exports.jalaliMonthLength = jalaliMonthLength;
exports.gregorianToJalali = gregorianToJalali;
exports.jalaliToGregorian = jalaliToGregorian;
exports.parseIsoDate = parseIsoDate;
exports.toIsoDate = toIsoDate;
exports.formatJalali = formatJalali;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a, b) => Math.trunc(a / b);
const mod = (a, b) => a - Math.trunc(a / b) * b;
function jalCal(jy) {
    const bl = BREAKS.length;
    const gy = jy + 621;
    let leapJ = -14;
    let jp = BREAKS[0];
    let jump = 0;
    if (jy < jp || jy >= BREAKS[bl - 1])
        throw new RangeError(`Jalali year out of supported range: ${jy}`);
    let n = 0;
    for (let i = 1; i < bl; i++) {
        const jm = BREAKS[i];
        jump = jm - jp;
        if (jy < jm)
            break;
        leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
        jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4)
        leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (jump - n < 6)
        n = n - jump + div(jump + 4, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1)
        leap = 4;
    return { leap, gy, march };
}
function gregorianToJdn(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
}
function jdnToGregorian(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308;
    const gd = div(mod(i, 153), 5) + 1;
    const gm = mod(div(i, 153), 12) + 1;
    const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy, gm, gd };
}
function jalaliToJdn(jy, jm, jd) {
    const r = jalCal(jy);
    return gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function jdnToJalali(jdn) {
    const g = jdnToGregorian(jdn);
    let jy = g.gy - 621;
    const r = jalCal(jy);
    const jdn1f = gregorianToJdn(g.gy, 3, r.march);
    let k = jdn - jdn1f;
    if (k >= 0) {
        if (k <= 185) {
            return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
        }
        k -= 186;
    }
    else {
        jy -= 1;
        k += 179;
        if (r.leap === 1)
            k += 1;
    }
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}
function isLeapJalaliYear(jy) {
    return jalCal(jy).leap === 0;
}
function jalaliMonthLength(jy, jm) {
    if (jm < 1 || jm > 12)
        throw new RangeError('invalid jalali month');
    if (jm <= 6)
        return 31;
    if (jm <= 11)
        return 30;
    return isLeapJalaliYear(jy) ? 30 : 29;
}
/** Converts a Gregorian calendar date (YYYY-MM-DD) to Jalali. */
function gregorianToJalali(gy, gm, gd) {
    return jdnToJalali(gregorianToJdn(gy, gm, gd));
}
/** Converts a Jalali date to Gregorian. Validates the day of month. */
function jalaliToGregorian(jy, jm, jd) {
    if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd))
        throw new RangeError('non-integer date');
    if (jm < 1 || jm > 12)
        throw new RangeError('invalid jalali month');
    if (jd < 1 || jd > jalaliMonthLength(jy, jm))
        throw new RangeError('invalid jalali day');
    return jdnToGregorian(jalaliToJdn(jy, jm, jd));
}
/** Parses 'YYYY-MM-DD' (Gregorian, ASCII digits) — the database storage format. */
function parseIsoDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m)
        return null;
    const gy = Number(m[1]);
    const gm = Number(m[2]);
    const gd = Number(m[3]);
    const back = jdnToGregorian(gregorianToJdn(gy, gm, gd));
    if (back.gy !== gy || back.gm !== gm || back.gd !== gd)
        return null;
    return { gy, gm, gd };
}
function toIsoDate(g) {
    return `${String(g.gy).padStart(4, '0')}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}
const JALALI_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
/** Display helper: "۱۴۰۵/۰۷/۱۷" style (Persian digits, zero-padded). */
function formatJalali(iso, options = {}) {
    const g = parseIsoDate(iso.slice(0, 10));
    if (!g)
        return '';
    const j = gregorianToJalali(g.gy, g.gm, g.gd);
    const pad = (n) => String(n).padStart(2, '0');
    const text = options.monthName
        ? `${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`
        : `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
    if (options.persianDigits === false)
        return text;
    return text.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}
exports.JALALI_MONTH_NAMES = JALALI_MONTHS;
