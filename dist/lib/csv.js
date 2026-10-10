"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.csvCell = csvCell;
exports.csvLine = csvLine;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/**
 * RFC 4180 cell escaping plus CSV/Formula-injection protection:
 * cells starting with = + - @ tab or CR are prefixed with a single quote so spreadsheets treat them as text.
 */
function csvCell(value) {
    if (value === null || value === undefined)
        return '';
    let s = value instanceof Date ? value.toISOString() : String(value);
    if (FORMULA_PREFIX.test(s))
        s = `'${s}`;
    if (/[",\r\n]/.test(s) || s.startsWith("'")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
function csvLine(values) {
    return values.map(csvCell).join(',');
}
