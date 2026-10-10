/** CSRF — synchronizer token داخلی (per spec §۲: csurf منسوخ است). */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../errors/AppError';
import { safeEqual } from '../../security/tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** مسیرهایی که از CSRF مستثنی هستند (مانند: بدون نشست یا با محافظ دیگر) */
const EXEMPT_PATHS = [
  /^\/auth\/login$/,
  /^\/install(\/|$)/,
  /^\/internal\/jobs\/run$/,
  /^\/healthz$/,
  /^\/verify\//, // صفحه عمومی اعتبارسنجی مدرک
  /^\/prereg\/public\//, // فرم عمومی پیش‌ثبت‌نام (rate limit + honeypot)
];

export function csrfProtect(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.session) return next(); // صفحات مستثنی بدون نشست
  if (EXEMPT_PATHS.some((re) => re.test(req.path))) return next();
  const sent = (req.headers['x-csrf-token'] as string | undefined) ?? (req.body?._csrf as string | undefined) ?? (req.query?._csrf as string | undefined);
  if (!sent || !safeEqual(String(sent), req.session.csrfToken)) {
    throw AppError.forbidden('توکن CSRF نامعتبر است. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.');
  }
  next();
}
