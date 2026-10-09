"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AMOUNT = void 0;
exports.parseMoney = parseMoney;
exports.formatMoney = formatMoney;
exports.sumMoney = sumMoney;
/**
 * Money is stored as an integer count of the base currency unit (IRR rial) in BIGINT columns.
 * Never use floating point for stored amounts.
 */
const persian_1 = require("./persian");
exports.MAX_AMOUNT = 10n ** 15n; // one quadrillion rials: far above any tuition, guards overflow.
function parseMoney(input) {
    if (typeof input === 'bigint')
        return input >= 0n && input <= exports.MAX_AMOUNT ? input : null;
    if (typeof input === 'number') {
        if (!Number.isSafeInteger(input))
            return null;
        return parseMoney(BigInt(input));
    }
    const cleaned = (0, persian_1.toEnglishDigits)(input).replace(/[,\s٬]/g, '');
    if (!/^\d{1,16}$/.test(cleaned))
        return null;
    const value = BigInt(cleaned);
    return value <= exports.MAX_AMOUNT ? value : null;
}
/** Formats an integer amount with thousands separators (ASCII digits; locale-free). */
function formatMoney(amount) {
    const s = amount.toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
/** Sums amounts exactly. */
function sumMoney(values) {
    return values.reduce((acc, v) => acc + v, 0n);
}
