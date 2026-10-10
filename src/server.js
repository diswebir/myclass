'use strict';
/**
 * راه‌اندازی سرور Express
 * سازگار با Phusion Passenger (سی‌پنل) - پورت از متغیر محیطی PORT خوانده می‌شود.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');

const config = require('./core/config');
const dbm = require('./core/db');
const settings = require('./core/settings');
const registry = require('./core/modules');
const jalali = require('./core/jalali');
const { csrfProtection, flash, renderer } = require('./core/http');
const { locals, panelLocals } = require('./core/view');
const { loadUser, requireAuth } = require('./core/auth');
const { KnexSessionStore } = require('./core/session-store');
const { httpError } = require('./core/utils');

const BASE = config.basePath();
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views'), path.join(__dirname, 'modules'), path.join(__dirname, 'installer', 'views')]);
if (process.env.NODE_ENV === 'production') app.set('view cache', true);

/* ----------------------------- امنیت هدرها ----------------------------- */
const allowIframe = process.env.ALLOW_IFRAME === '1';
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': allowIframe ? ['*'] : ["'self'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': null,
    },
  },
  frameguard: allowIframe ? false : { action: 'sameorigin' },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'same-origin' },
  hsts: false,
}));
app.use(compression());

/* ----------------------------- فایل‌های ایستا ----------------------------- */
app.use('/public', express.static(path.join(config.paths.public), { maxAge: '7d', index: false }));
app.use('/media', express.static(path.join(config.paths.uploads, 'public'), { maxAge: '7d', index: false, dotfiles: 'deny' }));
app.get('/favicon.ico', (req, res) => {
  const f = settings.get('general.favicon') || settings.get('general.logo');
  if (f && config.isInstalled()) return res.redirect(`${BASE}/media/${path.basename(f)}`);
  res.sendFile(path.join(config.paths.public, 'img', 'favicon.svg'));
});

app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 5000 }));
app.use(express.json({ limit: '1mb' }));

/* ------------------------------ راه‌اندازی ------------------------------ */
let bootPromise = null;
let booted = false;
let bootError = null;

async function boot() {
  const cfg = config.load(true);
  dbm.init(cfg.db);
  registry.load();
  const migrator = require('./core/migrator');
  if (cfg.autoMigrate !== false) {
    const r = await migrator.latest();
    if (r.log && r.log.length) console.log('[migrate] applied:', r.log.join(', '));
  }
  await settings.loadAll(true);
  jalali.setTimezone(settings.get('general.timezone', 'Asia/Tehran'));
  for (const m of registry.all()) if (typeof m.init === 'function') await m.init();
  require('./core/scheduler').start();
  booted = true;
}

function ensureBoot() {
  if (booted) return Promise.resolve();
  if (!bootPromise) {
    bootPromise = boot().catch((e) => {
      bootError = e;
      bootPromise = null;
      throw e;
    });
  }
  return bootPromise;
}
app.locals.reboot = () => { booted = false; bootPromise = null; return ensureBoot(); };

/* ------------------------------- نشست ------------------------------- */
const sessionSecret = () => config.secret();
const memorySession = session({
  name: 'myclass_install', secret: 'installer-' + config.generateSecret(), resave: false, saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: 'lax', path: BASE || '/' },
});
let dbSession = null;
function getDbSession() {
  if (!dbSession) {
    dbSession = session({
      name: 'myclass_sid',
      secret: sessionSecret(),
      store: new KnexSessionStore(),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        path: BASE || '/',
        maxAge: Number(settings.get('security.session_minutes', 240)) * 60 * 1000,
      },
    });
  }
  return dbSession;
}

/* -------------------------- مسیرها پیش از نصب -------------------------- */
const installer = require('./installer/routes');

app.use(async (req, res, next) => {
  if (!config.isInstalled()) {
    return memorySession(req, res, next);
  }
  try {
    await ensureBoot();
  } catch (e) {
    return next(e);
  }
  getDbSession()(req, res, next);
});

app.use(async (req, res, next) => {
  if (config.isInstalled()) await settings.loadAll();
  next();
});
app.use(locals(BASE));
app.use(renderer(app));
app.use(flash);
app.use(csrfProtection);

app.use('/install', (req, res, next) => {
  if (config.isInstalled() && !(req.session && req.session.justInstalled)) return next(httpError(404));
  installer(req, res, next);
});

app.use((req, res, next) => {
  if (!config.isInstalled()) return res.go('/install');
  next();
});

app.use(loadUser);
app.use((req, res, next) => { require('./core/site').remember(req); next(); });

/* ------------------------------ حالت تعمیر ------------------------------ */
app.use((req, res, next) => {
  if (!settings.get('system.maintenance', false)) return next();
  if (req.user && req.user.isSuper) return next();
  if (req.path === '/login' || req.path.startsWith('/public')) return next();
  res.status(503);
  res.render('errors/maintenance', { message: settings.get('system.maintenance_message', '') });
});

/* -------------------------- مسیرهای ماژول‌ها -------------------------- */
function gate(key, router) {
  return (req, res, next) => (registry.isEnabled(key) ? router(req, res, next) : next());
}

registry.load();
const panel = express.Router();
panel.use(requireAuth, panelLocals);
/** پارامترهای شناسه فقط عددی هستند؛ در غیر این صورت مسیر بعدی بررسی می‌شود (مثلاً /users/import) */
const numericParam = (req, res, next, val) => (/^\d+$/.test(String(val)) ? next() : next('route'));
const newRouter = () => {
  const r = express.Router();
  for (const p of ['id', 'sid', 'eid', 'iid', 'pid']) r.param(p, numericParam);
  return r;
};
for (const m of registry.all()) {
  if (typeof m.publicRoutes === 'function') {
    const r = newRouter();
    m.publicRoutes(r);
    app.use(gate(m.key, r));
  }
  if (typeof m.routes === 'function') {
    const r = newRouter();
    m.routes(r);
    panel.use(gate(m.key, r));
  }
}
app.use('/panel', panel);
app.get('/', (req, res) => res.go(req.user ? '/panel' : '/login'));

/* ------------------------------ خطاها ------------------------------ */
app.use((req, res, next) => next(httpError(404, 'صفحه مورد نظر یافت نشد.')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(err);
    try {
      fs.appendFileSync(path.join(config.paths.logs, 'error.log'), `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}\n${err.stack}\n\n`);
    } catch (e) { /* ignore */ }
  }
  const message = status >= 500 && process.env.NODE_ENV === 'production' ? 'خطای داخلی سرور رخ داد.' : err.message;
  if (req.xhr || (req.get('accept') || '').includes('application/json') || req.path.startsWith('/panel/api/')) {
    return res.status(status).json({ error: message });
  }
  // خطای اعتبارسنجی فرم: بازگشت به صفحه قبل با پیام
  if ((status === 422 || status === 419) && req.method === 'POST' && req.flash && req.get('referer')) {
    req.flash('error', message);
    return res.go(req.get('referer'), true);
  }
  res.status(status);
  try {
    res.render('errors/error', { status, message, bootError: bootError && bootError.message }, (e, html) => {
      if (e) return res.send(`<h1>${status}</h1><p>${message}</p>`);
      res.send(html);
    });
  } catch (e) {
    res.send(`<h1>${status}</h1>`);
  }
});

/* ------------------------------ اجرا ------------------------------ */
const server = express();
server.disable('x-powered-by');
server.set('trust proxy', 1);
if (BASE) {
  server.use(BASE, app);
  server.get('/', (req, res) => res.redirect(BASE + '/'));
} else server.use(app);

const port = process.env.PORT || 3000;
server.listen(port, process.env.HOST || undefined, () => {
  console.log(`[myclass] running on port ${port}${BASE ? ' (base: ' + BASE + ')' : ''}`);
  if (config.isInstalled()) ensureBoot().catch((e) => console.error('[boot] failed:', e.message));
});

module.exports = { app, server };
