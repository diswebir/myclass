'use strict';
/**
 * نصب‌کننده تحت وب (بدون نیاز به SSH)
 * - بررسی پیش‌نیازها
 * - اتصال به پایگاه داده (MySQL/MariaDB یا SQLite) و تست اتصال
 * - ساخت جداول، نقش‌های پیش‌فرض، حساب مدیر کل و اطلاعات موسسه
 * فرم نصب بدون وابستگی به نشست سرور (Stateless) کار می‌کند تا روی Passenger چندپردازه‌ای هم مشکلی نداشته باشد.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('../core/config');
const dbm = require('../core/db');
const { str, isMobile, normalizeMobile, toEnDigits, safeEqual } = require('../core/utils');

const router = express.Router();
const COOKIE = 'myclass_install_csrf';

function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}

function ensureCsrf(req, res) {
  let t = cookieToken(req);
  if (!/^[a-f0-9]{48}$/.test(t)) {
    t = crypto.randomBytes(24).toString('hex');
    res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'strict', path: (res.locals.base || '') + '/install' });
  }
  return t;
}

function checkCsrf(req) {
  const t = cookieToken(req);
  return t && req.body && req.body._token && safeEqual(String(req.body._token), t);
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `.w${Date.now()}`);
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
    return true;
  } catch (e) {
    return false;
  }
}

function requirements() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  const sqlite = dbm.sqliteDriver();
  let mysql = true;
  try { require.resolve('mysql2'); } catch (e) { mysql = false; }
  return [
    { label: `نسخه Node.js (فعلی: ${process.versions.node})`, ok: maj > 18 || (maj === 18 && min >= 17), required: true, help: 'حداقل نسخه 18.17 لازم است؛ نسخه 20 یا 22 پیشنهاد می‌شود.' },
    { label: 'امکان نوشتن در پوشه config', ok: writable(config.paths.configDir), required: true, help: 'دسترسی پوشه config را روی 755 قرار دهید.' },
    { label: 'امکان نوشتن در پوشه storage', ok: writable(config.paths.storage) && writable(config.paths.uploads) && writable(config.paths.logs), required: true, help: 'دسترسی پوشه storage و زیرپوشه‌های آن را روی 755 قرار دهید.' },
    { label: 'درایور MySQL / MariaDB (mysql2)', ok: mysql, required: false, help: 'دکمه «Run NPM Install» را در بخش Setup Node.js App بزنید.' },
    { label: `درایور SQLite ${sqlite ? '(' + sqlite + ')' : ''}`, ok: !!sqlite, required: false, help: 'برای SQLite نسخه Node.js 22.5 به بالا یا بسته better-sqlite3 لازم است. استفاده از MySQL پیشنهاد می‌شود.' },
    { label: 'پشتیبانی از fetch (برای ارسال پیامک)', ok: typeof fetch === 'function', required: false, help: 'Node.js 18 به بالا' },
  ];
}

function dbConfigFrom(b) {
  if (b.db_client === 'sqlite') {
    const name = str(b.sqlite_file, 100).replace(/[^\w.-]/g, '') || 'database.sqlite';
    return { client: 'sqlite', filename: name };
  }
  return {
    client: 'mysql',
    host: str(b.db_host, 191) || 'localhost',
    port: Number(toEnDigits(b.db_port || '3306')) || 3306,
    database: str(b.db_name, 191),
    user: str(b.db_user, 191),
    password: String(b.db_pass || ''),
  };
}

function render(res, view, data) {
  res.render(path.join(__dirname, 'views', view), Object.assign({ title: 'نصب سامانه' }, data));
}

router.get('/', (req, res) => {
  const token = ensureCsrf(req, res);
  const reqs = requirements();
  render(res, 'install', {
    token, reqs, canInstall: reqs.filter((r) => r.required).every((r) => r.ok), errors: {}, old: {},
    sqliteAvailable: !!dbm.sqliteDriver(), timezones: ['Asia/Tehran', 'Asia/Kabul', 'Asia/Dubai', 'Europe/Istanbul'],
  });
});

router.post('/test-db', async (req, res) => {
  if (!checkCsrf(req)) return res.status(419).json({ ok: false, error: 'توکن امنیتی نامعتبر است؛ صفحه را بازخوانی کنید.' });
  try {
    const cfg = dbConfigFrom(req.body);
    if (cfg.client === 'mysql' && (!cfg.database || !cfg.user)) return res.json({ ok: false, error: 'نام پایگاه داده و نام کاربری را وارد کنید.' });
    const r = await dbm.testConnection(cfg);
    res.json({ ok: true, message: `اتصال با موفقیت برقرار شد (${r.version || ''}).` });
  } catch (e) {
    res.json({ ok: false, error: friendlyDbError(e) });
  }
});

function friendlyDbError(e) {
  const m = String(e && e.message || e);
  if (/ER_ACCESS_DENIED|Access denied/i.test(m)) return 'نام کاربری یا رمز عبور پایگاه داده اشتباه است، یا کاربر به این پایگاه داده دسترسی ندارد (در cPanel کاربر را به دیتابیس Add کنید و ALL PRIVILEGES بدهید).';
  if (/ER_BAD_DB_ERROR|Unknown database/i.test(m)) return 'پایگاه داده‌ای با این نام یافت نشد. نام کامل (همراه با پیشوند حساب cPanel) را وارد کنید.';
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(m)) return 'اتصال به سرور پایگاه داده برقرار نشد. معمولاً آدرس سرور در cPanel «localhost» است.';
  return m;
}

router.post('/', async (req, res) => {
  const b = req.body || {};
  const token = ensureCsrf(req, res);
  const reqs = requirements();
  const view = (errors, extra = {}) => render(res, 'install', Object.assign({
    token, reqs, canInstall: reqs.filter((r) => r.required).every((r) => r.ok), errors, old: Object.assign({}, b, { db_pass: '', admin_password: '', admin_password2: '' }),
    sqliteAvailable: !!dbm.sqliteDriver(), timezones: ['Asia/Tehran', 'Asia/Kabul', 'Asia/Dubai', 'Europe/Istanbul'],
  }, extra));

  if (config.isInstalled()) return res.status(404).send('Not found');
  if (!checkCsrf(req)) return view({ _form: 'توکن امنیتی فرم نامعتبر است. صفحه را بازخوانی کرده و مجدداً تلاش کنید.' });

  // اعتبارسنجی
  const errors = {};
  const dbCfg = dbConfigFrom(b);
  if (dbCfg.client === 'mysql') {
    if (!dbCfg.database) errors.db_name = 'نام پایگاه داده الزامی است.';
    if (!dbCfg.user) errors.db_user = 'نام کاربری پایگاه داده الزامی است.';
  }
  const institute = str(b.institute_name, 150);
  if (!institute) errors.institute_name = 'نام موسسه را وارد کنید.';
  const first = str(b.admin_first_name, 100);
  const last = str(b.admin_last_name, 100);
  if (!first) errors.admin_first_name = 'نام مدیر را وارد کنید.';
  if (!last) errors.admin_last_name = 'نام خانوادگی مدیر را وارد کنید.';
  const mobile = normalizeMobile(b.admin_mobile || '');
  if (b.admin_mobile && !isMobile(mobile)) errors.admin_mobile = 'شماره موبایل معتبر نیست.';
  const username = str(toEnDigits(b.admin_username || ''), 100).toLowerCase();
  if (!/^[a-z0-9_.-]{3,50}$/.test(username)) errors.admin_username = 'نام کاربری باید حداقل ۳ کاراکتر و فقط شامل حروف انگلیسی، عدد، نقطه یا خط تیره باشد.';
  const pw = String(b.admin_password || '');
  if (pw.length < 8) errors.admin_password = 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
  else if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) errors.admin_password = 'رمز عبور باید شامل حرف و عدد باشد.';
  if (pw !== String(b.admin_password2 || '')) errors.admin_password2 = 'تکرار رمز عبور مطابقت ندارد.';
  if (Object.keys(errors).length) return view(errors);

  // تست اتصال
  try {
    await dbm.testConnection(dbCfg);
  } catch (e) {
    return view({ _form: friendlyDbError(e) });
  }

  const steps = [];
  try {
    const cfg = { installed: false, secret: config.generateSecret(), db: dbCfg, basePath: config.basePath() || undefined, installedAt: new Date().toISOString() };
    dbm.init(dbCfg);
    const registry = require('../core/modules');
    registry.load();
    const migrator = require('../core/migrator');
    const mr = await migrator.latest();
    steps.push(`ساخت جداول پایگاه داده (${mr.log.length} مرحله)`);

    const settings = require('../core/settings');
    await settings.loadAll(true);
    const jalali = require('../core/jalali');
    const tz = str(b.timezone, 50) || 'Asia/Tehran';
    jalali.setTimezone(tz);

    const { seedRoles } = require('./seed');
    await seedRoles();
    steps.push('ایجاد نقش‌های پیش‌فرض (مدیر کل، مدیر آموزش، حسابدار، استاد، دانشجو)');

    const values = {
      'general.institute_name': institute,
      'general.phone': str(toEnDigits(b.institute_phone || ''), 30),
      'general.manager_name': `${first} ${last}`,
      'general.timezone': tz,
      'system.cron_key': crypto.randomBytes(16).toString('hex'),
    };
    if (b.base_url) values['system.base_url'] = str(b.base_url, 255).replace(/\/+$/, '');
    await settings.set(values);
    steps.push('ذخیره اطلاعات موسسه');

    const { db, insertId } = dbm;
    const { hashPassword } = require('../core/auth');
    const superRole = await db('roles').where({ slug: 'super_admin' }).first();
    const now = jalali.now();
    const existing = await db('users').where({ username }).first();
    let adminId;
    const row = {
      role_id: superRole.id, first_name: first, last_name: last, username, mobile: mobile || null,
      password_hash: await hashPassword(pw), is_active: true, must_change_password: false, password_changed_at: now, updated_at: now,
    };
    if (existing) {
      await db('users').where({ id: existing.id }).update(row);
      adminId = existing.id;
    } else {
      if (mobile && (await db('users').where({ mobile }).first())) row.mobile = null;
      adminId = await insertId('users', Object.assign(row, { created_at: now }));
    }
    steps.push('ایجاد حساب مدیر کل');

    for (const m of registry.all()) if (typeof m.init === 'function') { try { await m.init(); } catch (e) { /* ignore */ } }

    if (b.sample_data === '1' && !existing) {
      try {
        await require('./sample').run(adminId);
        steps.push('ایجاد داده‌های نمونه (کلاس‌ها، دانشجویان، حضور و غیاب، اقساط و مدارک)');
      } catch (e) {
        console.error('[install] sample data failed:', e);
        steps.push(`ایجاد داده‌های نمونه ناموفق بود: ${e.message}`);
      }
    }

    cfg.installed = true;
    config.save(cfg);
    steps.push('ذخیره فایل پیکربندی');
    try { await req.app.locals.reboot(); } catch (e) { console.error('[install] boot failed', e); }

    const base = res.locals.base || '';
    const host = `${req.protocol}://${req.get('host')}${base}`;
    render(res, 'done', { steps, username, loginUrl: `${base}/login`, cronUrl: `${host}/cron/${values['system.cron_key']}` });
  } catch (e) {
    console.error('[install] failed:', e);
    return view({ _form: `خطا در نصب: ${friendlyDbError(e)}` });
  }
});

module.exports = router;
