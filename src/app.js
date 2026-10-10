/**
 * ساخت اپلیکیشن Express — ماژولار، امن، RTL فارسی
 */
const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const methodOverride = require('method-override');

const config = require('./core/config');
const db = require('./core/db');
const { securityHeaders, generalLimiter } = require('./core/security');
const { csrfProtection } = require('./core/csrf');
const { loadUser } = require('./core/auth');
const { viewLocals, flash } = require('./core/viewHelpers');
const DbSessionStore = require('./core/sessionStore');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('layout', 'layouts/panel');
  app.use(expressLayouts);
  app.set('layout extractScripts', true);
  app.set('layout extractMetas', true);

  if (!config.isProd) app.use(morgan('dev'));
  app.use(compression());
  app.use(securityHeaders());
  app.use(generalLimiter);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(methodOverride('_method'));

  // فایل‌های استاتیک
  const publicDir = path.join(__dirname, 'public');
  app.use(
    express.static(publicDir, {
      maxAge: config.isProd ? '7d' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  // جلسات
  app.use(
    session({
      store: new DbSessionStore({ ttlMinutes: config.sessionTtlMinutes }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'myclass.sid',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: config.sessionTtlMinutes * 60000,
      },
    })
  );

  app.use(loadUser);
  app.use(csrfProtection);
  app.use(viewLocals);

  // مسیر ریشه BASE_PATH (نصب در زیرپوشه)
  const bp = config.basePath;
  const router = express.Router();
  app.use(bp || '/', router);

  // ── ماژول‌های سیستم ────────────────────────────────
  const installer = require('./modules/installer');
  const auth = require('./modules/auth');
  const home = require('./modules/home');
  const dashboard = require('./modules/dashboard');
  const classes = require('./modules/classes');
  const attendance = require('./modules/attendance');
  const students = require('./modules/students');
  const teachers = require('./modules/teachers');
  const enrollments = require('./modules/enrollments');
  const payments = require('./modules/payments');
  const certificates = require('./modules/certificates');
  const sms = require('./modules/sms');
  const reports = require('./modules/reports');
  const users = require('./modules/users');
  const roles = require('./modules/roles');
  const settingsModule = require('./modules/settings');
  const systemModules = require('./modules/system-modules');
  const auditLogs = require('./modules/audit');
  const portal = require('./modules/portal');

  router.use('/', installer);
  router.use('/', home);
  router.use('/', auth);
  router.use('/panel', dashboard);
  router.use('/panel/classes', classes);
  router.use('/panel/attendance', attendance);
  router.use('/panel/students', students);
  router.use('/panel/teachers', teachers);
  router.use('/panel/enrollments', enrollments);
  router.use('/panel/payments', payments);
  router.use('/panel/certificates', certificates);
  router.use('/panel/sms', sms);
  router.use('/panel/reports', reports);
  router.use('/panel/users', users);
  router.use('/panel/roles', roles);
  router.use('/panel/settings', settingsModule);
  router.use('/panel/modules', systemModules);
  router.use('/panel/audit', auditLogs);
  router.use('/portal', portal);

  // ── خطاها ──────────────────────────────────────────
  app.use((req, res) => {
    viewLocals(req, res, () => {
      res.status(404).render('errors/404', { title: 'صفحه یافت نشد', layout: 'layouts/auth' });
    });
  });

  app.use((err, req, res, next) => {
    const fail = () => {
      const status = err && err.status ? err.status : 500;
      if (req.accepts && req.accepts('html')) {
        res.status(status).render('errors/500', {
          title: 'خطای سرور',
          message: config.isProd ? 'خطایی رخ داد.' : (err && err.message) || 'خطا',
          layout: 'layouts/auth',
        });
      } else {
        res.status(status).json({ error: 'internal error' });
      }
    };
    if (err && err.code === 'EBADCSRFTOKEN') {
      return viewLocals(req, res, () => {
        res.status(403).render('errors/403', {
          title: 'درخواست نامعتبر',
          message: 'توکن امنیتی نامعتبر است.',
          layout: 'layouts/auth',
        });
      });
    }
    console.error('[error]', err);
    viewLocals(req, res, fail);
  });

  return app;
}

module.exports = { createApp };
