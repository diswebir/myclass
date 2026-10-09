import type { NextFunction, Request, Response } from 'express';
import { AppError, errors } from '../lib/errors';
import { sanitizeForLog } from '../lib/sanitize';
import type { AppServices } from './context';
import { renderPage } from '../routes/render';
import { errorBody } from '../views/pages';

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
    const status = appErr?.status ?? 500;
    if (status >= 500) logError(req, err);
    const safe = appErr ?? errors.badRequest('درخواست نامعتبر است.');
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
      await renderPage(s, req, res, { title: 'خطا', status, body: errorBody(status, publicMessage) });
    } catch {
      res.status(status).type('text/plain; charset=utf-8').send(publicMessage);
    }
  };
}
