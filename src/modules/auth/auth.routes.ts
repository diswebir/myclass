/** Routes — auth: login/logout/change-password + صفحات HTML. */
import { Router } from 'express';
import { wantsHtml, type AppContext } from '../../core/http/context';
import { AuthService } from './auth.service';
import { loginSchema, changePasswordSchema } from './auth.schemas';
import { SESSION_COOKIE, sessionCookieOptions, requireAuth, getAuthUser } from '../../core/http/middleware/auth';
import { createLoginRateLimiter } from '../../core/http/middleware/rateLimit';
import { AppError } from '../../core/errors/AppError';

export function authRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new AuthService(ctx.db, ctx.config);
  const loginLimiter = createLoginRateLimiter(ctx.db, ctx.config);

  router.get('/login', (req, res) => {
    if (req.user) {
      res.redirect('/');
      return;
    }
    res.render('login', { next: req.query.next ?? '', error: null });
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await service.login(
        input.username,
        input.password,
        req.ip ?? null,
        req.headers['user-agent'] ?? null,
      );
      res.cookie(SESSION_COOKIE, result.session.token, sessionCookieOptions(ctx));
      const nextUrl = typeof req.body?.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/';
      if (wantsHtml(req)) {
        res.redirect(result.user.mustChangePassword ? '/change-password?force=1' : nextUrl);
        return;
      }
      res.json({ ok: true, mustChangePassword: result.user.mustChangePassword });
    } catch (err) {
      if (wantsHtml(req)) {
        // خطای فرم — نمایش در صفحه ورود (با کد وضعیت واقعی)
        const status = err instanceof AppError ? err.statusCode : 401;
        res.status(status).render('login', { next: req.body?.next ?? '', error: (err as Error).message });
        return;
      }
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      await service.logout(token, req.user?.id);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      if (wantsHtml(req)) {
        res.redirect('/auth/login');
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/change-password', requireAuth, (req, res) => {
    res.render('change-password', { forced: req.query.force === '1', error: null, success: null });
  });

  router.post('/change-password', requireAuth, async (req, res, next) => {
    try {
      const input = changePasswordSchema.parse(req.body);
      if (input.newPassword !== input.confirmPassword) {
        throw AppError.badRequest('تکرار رمز عبور با رمز عبور جدید یکسان نیست.');
      }
      const user = getAuthUser(req);
      await service.changePassword(user.id, input.currentPassword, input.newPassword);
      // خروج از دیگر نشست‌ها
      const token = req.cookies?.[SESSION_COOKIE];
      await service.sessions.revokeAllForUser(user.id, token);
      if (wantsHtml(req)) {
        res.render('change-password', { forced: false, error: null, success: 'رمز عبور با موفقیت تغییر کرد.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      if (wantsHtml(req)) {
        res.status(400).render('change-password', { forced: req.body?.force === '1', error: (err as Error).message, success: null });
        return;
      }
      next(err);
    }
  });

  return router;
}
