"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_LABELS = void 0;
exports.formatDateTime = formatDateTime;
exports.formatDateOnly = formatDateOnly;
exports.num = num;
const jalali_1 = require("../lib/jalali");
const persian_1 = require("../lib/persian");
const TEHRAN = 'Asia/Tehran';
// Gregorian parts in Tehran time; conversion to Jalali is done explicitly by formatJalali (single source of truth).
const dateTimeFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TEHRAN,
    numberingSystem: 'latn',
});
/** Presentation-only conversion: database stores UTC; users see Tehran local time in Persian digits. */
function formatDateTime(value) {
    if (!value)
        return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime()))
        return '—';
    const parts = Object.fromEntries(dateTimeFormatter.formatToParts(d).map((p) => [p.type, p.value]));
    const gy = Number(parts.year);
    const gm = Number(parts.month);
    const gd = Number(parts.day);
    const iso = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
    return `${(0, jalali_1.formatJalali)(iso)} ${(0, persian_1.toPersianDigits)(`${parts.hour}:${parts.minute}`)}`;
}
function formatDateOnly(value) {
    if (!value)
        return '—';
    return (0, jalali_1.formatJalali)(value);
}
function num(value) {
    return (0, persian_1.toPersianDigits)(String(value));
}
exports.ROLE_LABELS = {
    active: 'فعال',
    disabled: 'غیرفعال',
};
