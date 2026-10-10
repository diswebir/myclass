import type { NextFunction, Request, Response } from 'express';
import { AppError, errors } from '../lib/errors';
import { sanitizeForLog } from '../lib/sanitize';
import type { AppServices } from './context';
import { renderPage } from '../routes/render';
import { errorBody } from '../views/pages';

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
export function isDbUnavailable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DB_UNAVAILABLE_CODES.has(code);
}

/** Writes a sanitised, single-line log entry (no request bodies, cookies or secrets). */
function logError(req: Request, err: unknown): void {
  const e = err as { name?: string; message?: string; code?: string };
  const entry = {
    t: new Date().toISOString(),
    level: 'error',
    method: req.method,
    path: req.path,
    name: e?.name ?? 'Error',
    code: e?.code,
    message: typeof e?.message === 'string' ? e.message.slice(0, 300) : 'unknown',
  };
  console.error(JSON.stringify(sanitizeForLog(entry)));
}

export function notFoundHandler(s: AppServices) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'مسیر یافت نشد.' } });
      return;
    }
    try {
      await renderPage(s, req, res, { title: 'صفحه پیدا نشد', status: 404, body: errorBody(404, 'صفحه پیدا نشد.') });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Global error boundary. Known AppErrors return their safe message; everything else becomes a generic
 * message. Stack traces and database details are logged server-side only.
 */
export function errorHandler(s: AppServices) {
  return async (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const appErr = err instanceof AppError ? err : null;
    const dbDown = !appErr && isDbUnavailable(err);
    const status = appErr?.status ?? (dbDown ? 503 : 500);
    if (status >= 500) logError(req, err);
    const safe = appErr ?? errors.badRequest('درخواست نامعتبر است.');
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
      await renderPage(s, req, res, { title: 'خطا', status, body: errorBody(status, publicMessage) });
    } catch {
      res.status(status).type('text/plain; charset=utf-8').send(publicMessage);
    }
  };
}
