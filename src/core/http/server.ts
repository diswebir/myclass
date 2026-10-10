/** App factory — مونتاژ اپلیکیشن Express (middlewareها + روترها + view engine + خطا). */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import nunjucks from 'nunjucks';
import type { AppContext } from './context';
import { loadSession, SESSION_COOKIE } from './middleware/auth';
import { csrfProtect } from './middleware/csrf';
import { createRateLimiter } from './middleware/rateLimit';
import { installGate } from './middleware/installGate';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRoutes } from '../../modules/auth/auth.routes';
import { usersRoutes } from '../../modules/users/users.routes';
import { settingsRoutes } from '../../modules/settings/settings.routes';
import { installerRoutes } from '../../modules/installer/installer.routes';
import { healthRoutes } from '../../modules/health/health.routes';
import { auditRoutes } from '../../modules/audit/audit.routes';
import { teachersRoutes } from '../../modules/teachers/teachers.routes';
import { studentsRoutes } from '../../modules/students/students.routes';
import { coursesRoutes } from '../../modules/courses/courses.routes';
import { classesRoutes } from '../../modules/classes/classes.routes';
import { preregRoutes } from '../../modules/preregistration/prereg.routes';
import { enrollmentRoutes } from '../../modules/enrollment/enrollment.routes';
import { attendanceRoutes } from '../../modules/attendance/attendance.routes';
import { filesRoutes } from '../../modules/files/files.routes';
import { financeRoutes } from '../../modules/finance/finance.routes';
import { certificatesRoutes, certificateVerifyRoutes } from '../../modules/certificates/certificates.routes';
import { smsRoutes, internalJobsRoutes } from '../../modules/sms/sms.routes';
import { teacherPanelRoutes } from '../../modules/panels/teacher-panel.routes';
import { studentPanelRoutes } from '../../modules/panels/student-panel.routes';
import { isSecureCookies } from '../config/env';
import { toPersianDigits } from '../security/normalize';
import { formatJalaali, dbDateToJalaali } from '../text/jalaali';
import { formatMoney } from '../security/money';

export function configureViews(app: express.Express, config: AppContext['config']): void {
  // کاندیدا: dev (src/ui/views) یا prod (dist → <root>/src/ui/views)
  const viewsCandidates = [
    path.join(__dirname, '..', '..', 'ui', 'views'), // dev: src/ui/views
    path.join(__dirname, '..', '..', '..', 'src', 'ui', 'views'), // prod: <root>/src/ui/views
    path.join(__dirname, '..', '..', 'ui', 'views'), // prod با کپی viewها داخل dist
  ];
  const viewsDir = viewsCandidates.find((c) => fs.existsSync(c)) ?? viewsCandidates[0];
  const env = nunjucks.configure(viewsDir, {
    autoescape: true,
    express: app,
    noCache: config.NODE_ENV !== 'production',
  });
  // فیلترهای فارسی
  env.addFilter('faDate', (s: string | null | undefined) => (s ? dbDateToJalaali(s) ?? s : ''));
  env.addFilter('faDateTime', (s: string | null | undefined) => {
    if (!s) return '';
    const d = new Date(s + (s.endsWith('Z') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return s;
    return `${formatJalaali(d)} ${toPersianDigits(d.toISOString().slice(11, 19))}`;
  });
  env.addFilter('faNum', (n: unknown) => (n === null || n === undefined ? '' : toPersianDigits(String(n))));
  env.addFilter('faMoney', (m: unknown) => formatMoney(String(m ?? '0'), { withUnit: true }));
  env.addFilter('json', (v: unknown) => JSON.stringify(v));
  env.addFilter('jsonParse', (v: string) => {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  });
  app.set('view engine', 'njk');
}

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  const { config } = ctx;

  // اعتماد به پروکسی (برای req.ip واقعی پشت Passenger/Apache)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // امنیت هدرها (helmet — per spec §۲)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'"], // htmx/Alpine inline — self-host
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      frameguard: { action: 'deny' },
    }),
  );

  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Method override — فرم‌های HTML فقط GET/POST می‌فرستند: فیلد _method (put/patch/delete)
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.body && typeof req.body._method === 'string') {
      const m = req.body._method.toUpperCase();
      if (m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
        req.method = m;
        delete req.body._method;
      }
    }
    next();
  });

  // Views
  configureViews(app, config);

  // فایل‌های استاتیک (public)
  app.use(
    '/public',
    express.static(path.join(__dirname, '..', '..', '..', 'public'), {
      maxAge: config.NODE_ENV === 'production' ? '7d' : 0,
      index: false,
    }),
  );

  // install gate — قبل از روترها
  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use(installGate);

  // نشست + کاربر
  app.use(loadSession);
  // CSRF
  app.use(csrfProtect);
  // Rate limit (DB store)
  app.use(createRateLimiter(ctx.db, config));

  // گلوبال برای ویوها
  app.use((req, res, next) => {
    res.locals.user = req.user ?? null;
    res.locals.csrfToken = req.session?.csrfToken ?? '';
    res.locals.currentPath = req.path;
    res.locals.isSecure = isSecureCookies(config);
    next();
  });

  // روترها
  app.use('/install', installerRoutes(ctx));
  app.use('/auth', authRoutes(ctx));
  app.get('/', (req, res) => {
    if (!req.user) {
      res.redirect('/auth/login');
      return;
    }
    res.render('dashboard', { user: req.user });
  });
  app.use('/users', usersRoutes(ctx));
  app.use('/settings', settingsRoutes(ctx));
  app.use('/audit', auditRoutes(ctx));
  app.use('/teachers', teachersRoutes(ctx));
  app.use('/students', studentsRoutes(ctx));
  app.use('/courses', coursesRoutes(ctx));
  app.use('/classes', classesRoutes(ctx));
  app.use('/prereg', preregRoutes(ctx));
  app.use('/enrollments', enrollmentRoutes(ctx));
  app.use('/attendance', attendanceRoutes(ctx));
  app.use('/files', filesRoutes(ctx));
  app.use('/finance', financeRoutes(ctx));
  app.use('/certificates', certificatesRoutes(ctx));
  app.use('/sms', smsRoutes(ctx));
  app.use('/', certificateVerifyRoutes(ctx));
  app.use('/', internalJobsRoutes(ctx));
  app.use('/panel/teacher', teacherPanelRoutes(ctx));
  app.use('/panel/student', studentPanelRoutes(ctx));
  app.use('/', healthRoutes(ctx));

  // خطاها
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { SESSION_COOKIE };
