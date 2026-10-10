import { Router } from 'express';
import { SESSION_COOKIE, cookieOptions, requireAuth } from '../http/middleware';
import type { AppServices } from '../http/context';
import { AppError, errors } from '../lib/errors';
import { bodyOf, renderPage } from './render';
import { loginBody, passwordBody } from '../views/pages';

export function authRoutes(s: AppServices): Router {
  const r = Router();

  r.get('/login', async (req, res) => {
    if (req.auth) return res.redirect(302, '/admin');
    const msg = typeof req.query.msg === 'string' ? req.query.msg : undefined;
    await renderPage(s, req, res, {
      title: 'ورود',
      body: loginBody({ csrf: req.csrfToken!, instituteName: await s.settings.get<string>('institute.name_official'), notice: undefined }),
      flash: msg,
    });
  });

  r.post('/login', async (req, res) => {
    const b = bodyOf(req);
    const username = (b.username ?? '').slice(0, 190);
    const password = b.password ?? '';
    try {
      if (!username || !password) throw errors.badRequest('نام کاربری و رمز عبور را وارد کنید.');
      const token = await s.auth.login({ username, password, ip: req.clientIp ?? null, userAgent: req.headers['user-agent'] ?? null });
      const maxAge = s.cfg.sessionTtlHours * 3600 * 1000;
      res.cookie(SESSION_COOKIE, token, cookieOptions(s.cfg, maxAge));
      res.redirect(303, '/admin');
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      await renderPage(s, req, res, {
        title: 'ورود',
        status: err.status,
        body: loginBody({ csrf: req.csrfToken!, error: err.message, username, instituteName: await s.settings.get<string>('institute.name_official') }),
      });
    }
  });

  r.post('/logout', requireAuth({ allowPasswordChange: true }), async (req, res) => {
    await s.auth.logout(req.auth!.token, req.auth!.user.id);
    res.clearCookie(SESSION_COOKIE, cookieOptions(s.cfg));
    res.redirect(303, '/login?msg=logged_out');
  });

  r.get('/account/password', requireAuth({ allowPasswordChange: true }), async (req, res) => {
    await renderPage(s, req, res, {
      title: 'تغییر رمز عبور',
      body: passwordBody({
        csrf: req.csrfToken!,
        mustChange: req.auth!.user.must_change_password === 1,
        minLength: await s.settings.get<number>('security.password_min_length'),
        fieldErrors: {},
      }),
      flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
    });
  });

  r.post('/account/password', requireAuth({ allowPasswordChange: true }), async (req, res) => {
    const b = bodyOf(req);
    const minLength = await s.settings.get<number>('security.password_min_length');
    const fieldErrors: Record<string, string> = {};
    if (!b.currentPassword) fieldErrors.currentPassword = 'رمز عبور فعلی را وارد کنید.';
    if (!b.newPassword || b.newPassword.length < minLength) fieldErrors.newPassword = `رمز عبور جدید باید حداقل ${minLength} نویسه باشد.`;
    if (b.newPassword !== b.newPasswordConfirm) fieldErrors.newPasswordConfirm = 'تکرار رمز عبور با رمز جدید یکسان نیست.';
    if (Object.keys(fieldErrors).length) {
      return renderPage(s, req, res, {
        title: 'تغییر رمز عبور',
        status: 400,
        body: passwordBody({ csrf: req.csrfToken!, mustChange: req.auth!.user.must_change_password === 1, minLength, fieldErrors, error: 'لطفاً خطاهای فرم را برطرف کنید.' }),
      });
    }
    try {
      await s.auth.changeOwnPassword({
        userId: req.auth!.user.id,
        currentSessionId: req.auth!.sessionId,
        currentPassword: b.currentPassword,
        newPassword: b.newPassword,
        minLength,
        ip: req.clientIp ?? null,
      });
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      return renderPage(s, req, res, {
        title: 'تغییر رمز عبور',
        status: err.status,
        body: passwordBody({ csrf: req.csrfToken!, mustChange: req.auth!.user.must_change_password === 1, minLength, fieldErrors: err.fieldErrors, error: err.message }),
      });
    }
    res.redirect(303, '/admin?msg=password_changed');
  });

  return r;
}
