"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const persian_1 = require("../../lib/persian");
const money_1 = require("../../lib/money");
(0, node_test_1.default)('Persian and Arabic digits convert to ASCII and back', () => {
    strict_1.default.equal((0, persian_1.toEnglishDigits)('۰۹۱۲-۱۲۳٤'.replace('٤', '4')), '0912-1234');
    strict_1.default.equal((0, persian_1.toEnglishDigits)('٠١٢٣٤٥٦٧٨٩'), '0123456789');
    strict_1.default.equal((0, persian_1.toPersianDigits)(1404), '۱۴۰۴');
});
(0, node_test_1.default)('mobile numbers normalise to 09XXXXXXXXX', () => {
    strict_1.default.equal((0, persian_1.normalizeIranMobile)('09121234567'), '09121234567');
    strict_1.default.equal((0, persian_1.normalizeIranMobile)('۰۹۱۲ ۱۲۳ ۴۵۶۷'), '09121234567');
    strict_1.default.equal((0, persian_1.normalizeIranMobile)('+989121234567'), '09121234567');
    strict_1.default.equal((0, persian_1.normalizeIranMobile)('00989121234567'), '09121234567');
    strict_1.default.equal((0, persian_1.normalizeIranMobile)('9121234567'), '09121234567');
    strict_1.default.equal((0, persian_1.normalizeIranMobile)('0912-123-4567'), '09121234567');
});
(0, node_test_1.default)('invalid mobile numbers are rejected', () => {
    for (const v of ['0812123456', '091212345', '09121234567890', 'abc', '+981212345678', '']) {
        strict_1.default.equal((0, persian_1.normalizeIranMobile)(v), null, v);
    }
});
(0, node_test_1.default)('Persian keyboard letters are normalised', () => {
    strict_1.default.equal((0, persian_1.normalizeText)('  علي   كريمي  '), 'علی کریمی');
});
(0, node_test_1.default)('money parses exact integers and rejects decimals or negatives', () => {
    strict_1.default.equal((0, money_1.parseMoney)('۱,۲۵۰,۰۰۰'), 1250000n);
    strict_1.default.equal((0, money_1.parseMoney)('1 000 000'), 1000000n);
    strict_1.default.equal((0, money_1.parseMoney)('1.5'), null);
    strict_1.default.equal((0, money_1.parseMoney)('-10'), null);
    strict_1.default.equal((0, money_1.parseMoney)('abc'), null);
    strict_1.default.equal((0, money_1.parseMoney)(1.5), null);
    strict_1.default.equal((0, money_1.parseMoney)(2n ** 60n), null);
});
(0, node_test_1.default)('money sums are exact (no floating-point drift)', () => {
    const values = Array.from({ length: 10 }, () => (0, money_1.parseMoney)('100000'));
    strict_1.default.equal((0, money_1.sumMoney)(values), 1000000n);
    strict_1.default.equal((0, money_1.formatMoney)(1234567890n), '1,234,567,890');
    strict_1.default.equal((0, money_1.formatMoney)(0n), '0');
});
