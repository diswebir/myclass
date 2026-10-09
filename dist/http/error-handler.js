"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const errors_1 = require("../lib/errors");
const sanitize_1 = require("../lib/sanitize");
const render_1 = require("../routes/render");
const pages_1 = require("../views/pages");
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
        const status = appErr?.status ?? 500;
        if (status >= 500)
            logError(req, err);
        const safe = appErr ?? errors_1.errors.badRequest('درخواست نامعتبر است.');
        const publicMessage = status >= 500 ? 'خطای داخلی سامانه رخ داده است. لطفاً بعداً دوباره تلاش کنید.' : safe.message;
        if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
            res.status(status).json({ error: { code: appErr?.code ?? 'INTERNAL', message: publicMessage, fields: appErr?.fieldErrors ?? {} } });
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
