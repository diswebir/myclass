"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDbUnavailable = isDbUnavailable;
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const errors_1 = require("../lib/errors");
const sanitize_1 = require("../lib/sanitize");
const render_1 = require("../routes/render");
const pages_1 = require("../views/pages");
/** MySQL, SQLite and driver error codes that mean the database is unreachable or misconfigured (not an app bug). */
const DB_UNAVAILABLE_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'EPIPE',
    'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'PROTOCOL_SEQUENCE_TIMEOUT',
    'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS',
    'ER_USER_LIMIT_REACHED',
    // SQLite: the file cannot be opened or is locked / corrupt (sql.js reports these as SQLITE_* codes).
    'SQLITE_CANTOPEN', 'SQLITE_BUSY', 'SQLITE_IOERR', 'SQLITE_READONLY', 'SQLITE_CORRUPT', 'SQLITE_NOTADB',
    // No engine has been chosen yet (fresh install before the installer ran).
    'DB_NOT_CONFIGURED',
]);
/** True when an error means the database cannot be used right now (exported for tests). */
function isDbUnavailable(err) {
    const code = err?.code;
    return typeof code === 'string' && DB_UNAVAILABLE_CODES.has(code);
}
/** Writes a sanitised, single-line log entry (no request bodies, cookies or secrets). */
function logError(req, err) {
    const e = err;
    const entry = {
        t: new Date().toISOString(),
        level: 'error',
        method: req.method,
        path: req.path,
        name: e?.name ?? 'Error',
        code: e?.code,
        message: typeof e?.message === 'string' ? e.message.slice(0, 300) : 'unknown',
    };
    console.error(JSON.stringify((0, sanitize_1.sanitizeForLog)(entry)));
}
function notFoundHandler(s) {
    return async (req, res, next) => {
        if (req.path.startsWith('/api/')) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'مسیر یافت نشد.' } });
            return;
        }
        try {
            await (0, render_1.renderPage)(s, req, res, { title: 'صفحه پیدا نشد', status: 404, body: (0, pages_1.errorBody)(404, 'صفحه پیدا نشد.') });
        }
        catch (err) {
            next(err);
        }
    };
}
/**
 * Global error boundary. Known AppErrors return their safe message; everything else becomes a generic
 * message. Stack traces and database details are logged server-side only.
 */
function errorHandler(s) {
    return async (err, req, res, _next) => {
        const appErr = err instanceof errors_1.AppError ? err : null;
        const dbDown = !appErr && isDbUnavailable(err);
        const status = appErr?.status ?? (dbDown ? 503 : 500);
        if (status >= 500)
            logError(req, err);
        const safe = appErr ?? errors_1.errors.badRequest('درخواست نامعتبر است.');
        const publicMessage = dbDown
            ? 'پایگاه داده در دسترس نیست. لطفاً چند دقیقه بعد دوباره تلاش کنید.'
            : status >= 500 ? 'خطای داخلی سامانه رخ داده است. لطفاً بعداً دوباره تلاش کنید.' : safe.message;
        if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
            res.status(status).json({ error: { code: appErr?.code ?? (dbDown ? 'DB_UNAVAILABLE' : 'INTERNAL'), message: publicMessage, fields: appErr?.fieldErrors ?? {} } });
            return;
        }
        if (status === 401) {
            res.redirect(302, '/login');
            return;
        }
        try {
            await (0, render_1.renderPage)(s, req, res, { title: 'خطا', status, body: (0, pages_1.errorBody)(status, publicMessage) });
        }
        catch {
            res.status(status).type('text/plain; charset=utf-8').send(publicMessage);
        }
    };
}
