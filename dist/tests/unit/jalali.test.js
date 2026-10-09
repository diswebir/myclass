"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const jalali_1 = require("../../lib/jalali");
(0, node_test_1.default)('known Nowruz dates convert correctly', () => {
    strict_1.default.deepEqual((0, jalali_1.gregorianToJalali)(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 });
    strict_1.default.deepEqual((0, jalali_1.gregorianToJalali)(2025, 3, 21), { jy: 1404, jm: 1, jd: 1 });
    strict_1.default.deepEqual((0, jalali_1.gregorianToJalali)(1978, 3, 21), { jy: 1357, jm: 1, jd: 1 });
});
(0, node_test_1.default)('leap-year rules match the arithmetic calendar', () => {
    strict_1.default.equal((0, jalali_1.isLeapJalaliYear)(1403), true);
    strict_1.default.equal((0, jalali_1.isLeapJalaliYear)(1404), false);
    strict_1.default.equal((0, jalali_1.isLeapJalaliYear)(1399), true);
    strict_1.default.equal((0, jalali_1.jalaliMonthLength)(1403, 12), 30);
    strict_1.default.equal((0, jalali_1.jalaliMonthLength)(1404, 12), 29);
    strict_1.default.equal((0, jalali_1.jalaliMonthLength)(1404, 7), 30);
});
(0, node_test_1.default)('Esfand 30 exists only in leap years (boundary)', () => {
    strict_1.default.deepEqual((0, jalali_1.jalaliToGregorian)(1403, 12, 30), { gy: 2025, gm: 3, gd: 20 });
    strict_1.default.throws(() => (0, jalali_1.jalaliToGregorian)(1404, 12, 30), RangeError);
    strict_1.default.throws(() => (0, jalali_1.jalaliToGregorian)(1404, 13, 1), RangeError);
    strict_1.default.throws(() => (0, jalali_1.jalaliToGregorian)(1404, 1, 0), RangeError);
});
(0, node_test_1.default)('round trip and Intl cross-check for 1925..2100 (sampled every 3 days)', () => {
    const fmt = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    let checked = 0;
    for (let t = Date.UTC(1925, 0, 1); t < Date.UTC(2100, 0, 1); t += 3 * 86400000) {
        const d = new Date(t);
        const gy = d.getUTCFullYear();
        const gm = d.getUTCMonth() + 1;
        const gd = d.getUTCDate();
        const j = (0, jalali_1.gregorianToJalali)(gy, gm, gd);
        const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
        strict_1.default.deepEqual(j, { jy: Number(parts.year), jm: Number(parts.month), jd: Number(parts.day) }, `${gy}-${gm}-${gd}`);
        strict_1.default.deepEqual((0, jalali_1.jalaliToGregorian)(j.jy, j.jm, j.jd), { gy, gm, gd });
        checked++;
    }
    strict_1.default.ok(checked > 10000);
});
(0, node_test_1.default)('ISO date parsing rejects impossible dates and storage format is stable', () => {
    strict_1.default.equal((0, jalali_1.parseIsoDate)('2025-02-30'), null);
    strict_1.default.equal((0, jalali_1.parseIsoDate)('2025-3-1'), null);
    strict_1.default.deepEqual((0, jalali_1.parseIsoDate)('2024-02-29'), { gy: 2024, gm: 2, gd: 29 });
    strict_1.default.equal((0, jalali_1.toIsoDate)({ gy: 2025, gm: 3, gd: 1 }), '2025-03-01');
});
(0, node_test_1.default)('display formatting uses Persian digits and Jalali calendar', () => {
    strict_1.default.equal((0, jalali_1.formatJalali)('2025-03-21'), '۱۴۰۴/۰۱/۰۱');
    strict_1.default.equal((0, jalali_1.formatJalali)('2025-03-21', { persianDigits: false }), '1404/01/01');
    strict_1.default.equal((0, jalali_1.formatJalali)('2025-03-21', { monthName: true, persianDigits: false }), '1 فروردین 1404');
    strict_1.default.equal((0, jalali_1.formatJalali)('not-a-date'), '');
});
