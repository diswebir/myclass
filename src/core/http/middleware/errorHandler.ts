/** Error handler — خطاها فارسی و بدون افشای جزئیات سرور (per spec §۶-الف). */
import type { NextFunction, Request, Response } from 'express';
import { AppError, isAppError } from '../../errors/AppError';
import { logger } from '../../logger/logger';
import { wantsHtml } from '../context';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404);
  if (wantsHtml(req)) {
    res.render('error', { statusCode: 404, title: 'یافت نشد', message: 'صفحه مورد نظر یافت نشد.' });
    return;
  }
  res.json({ error: { code: 'NOT_FOUND', message: 'صفحه مورد نظر یافت نشد.' } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  // خطای multer (مثلاً سقف حجم فایل) — خطای کلاینت است نه سرور
  if (err instanceof Error && err.name === 'MulterError') {
    const e = err as Error & { code?: string };
    const message =
      e.code === 'LIMIT_FILE_SIZE'
        ? 'حجم فایل بیشتر از حد مجاز است.'
        : e.code === 'LIMIT_FILE_COUNT'
          ? 'تعداد فایل‌ها بیشتر از حد مجاز است.'
          : 'فایل ارسال‌شده نامعتبر است.';
    res.status(400);
    if (wantsHtml(req)) {
      res.render('error', { statusCode: 400, title: 'خطا', message });
      return;
    }
    res.json({ error: { code: 'BAD_REQUEST', message } });
    return;
  }
  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error('خطای سرور:', err.message, { path: req.path, details: err.details });
    }
    res.status(err.statusCode);
    if (wantsHtml(req) && err.statusCode >= 400) {
      res.render('error', { statusCode: err.statusCode, title: 'خطا', message: err.message });
      return;
    }
    res.json({ error: { code: err.code, message: err.message } });
    return;
  }
  // خطای ناشناخته — جزئیات داخلی در پاسخ افشا نمی‌شود
  logger.error('خطای پیش‌بینی‌نشده:', err);
  res.status(500);
  if (wantsHtml(req)) {
    res.render('error', { statusCode: 500, title: 'خطای سرور', message: 'خطای داخلی سرور. لطفاً بعداً تلاش کنید.' });
    return;
  }
  res.json({ error: { code: 'INTERNAL', message: 'خطای داخلی سرور.' } });
}
