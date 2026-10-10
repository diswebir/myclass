import { Router } from 'express';
import type { AppServices } from '../http/context';
import { AppError } from '../lib/errors';
import { bodyOf, renderPage } from './render';
import { installBody } from '../views/pages';
import { errorBody } from '../views/pages';

export function installRoutes(s: AppServices): Router {
  const r = Router();

  r.get('/install', async (req, res) => {
    if (s.install.isInstalled()) {
      return renderPage(s, req, res, { title: 'صفحه پیدا نشد', status: 404, body: errorBody(404, 'صفحه پیدا نشد.') });
    }
    const checks = await s.install.checks();
    await renderPage(s, req, res, {
      title: 'نصب',
      body: installBody({ csrf: req.csrfToken!, checks, errors: {}, values: { driver: s.install.defaultDriver() }, canInstall: true }),
    });
  });

  r.post('/install', async (req, res) => {
    if (s.install.isInstalled()) {
      return renderPage(s, req, res, { title: 'صفحه پیدا نشد', status: 404, body: errorBody(404, 'صفحه پیدا نشد.') });
    }
    const b = bodyOf(req);
    const values = { driver: b.driver ?? '', instituteName: b.instituteName ?? '', fullName: b.fullName ?? '', username: b.username ?? '', email: b.email ?? '' };
    try {
      await s.install.install(
        {
          driver: b.driver === 'mysql' || b.driver === 'sqlite' ? b.driver : undefined,
          token: b.token ?? '',
          fullName: b.fullName ?? '',
          username: b.username ?? '',
          email: b.email,
          password: b.password ?? '',
          passwordConfirm: b.passwordConfirm ?? '',
          instituteName: b.instituteName ?? '',
        },
        req.clientIp ?? null,
      );
      res.redirect(303, '/login?msg=installed');
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) {
        // Internal details are logged by the global error handler; the user sees a generic, Persian message.
        throw err;
      }
      const checks = await s.install.checks();
      await renderPage(s, req, res, {
        title: 'نصب',
        status: err.status,
        body: installBody({ csrf: req.csrfToken!, checks, errors: err.fieldErrors, values, formError: err.message, canInstall: true }),
      });
    }
  });

  return r;
}
