"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDbDateText = toDbDateText;
exports.fromDbDateText = fromDbDateText;
/**
 * SQLite stores instants as TEXT in the form `YYYY-MM-DD HH:MM:SS.mmm` (UTC). The format sorts
 * lexicographically, so `>=` comparisons against bound dates behave like DATETIME comparisons.
 */
const SQLITE_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;
function toDbDateText(d) {
    return d.toISOString().replace('T', ' ').replace('Z', '');
}
/** Converts a stored SQLite date string to a Date (UTC). Returns the input unchanged if it is not a date. */
function fromDbDateText(value) {
    if (typeof value === 'string' && SQLITE_DATE_RE.test(value)) {
        const d = new Date(`${value.replace(' ', 'T')}Z`);
        if (!Number.isNaN(d.getTime()))
            return d;
    }
    return value;
}
