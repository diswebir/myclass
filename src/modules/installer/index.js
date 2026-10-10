/**
 * نصب‌کننده وب‌محور — بدون نیاز به SSH
 * مراحل: بررسی پیش‌نیازها → پایگاه‌داده → اطلاعات موسسه و مدیر → پایان
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const router = express.Router();
const config = require('../../core/config');
const db = require('../../core/db');
const { hashPassword } = require('../../core/auth');

function alreadyInstalled(req, res, next) {
  if (config.isInstalled()) return res.redirect('/login');
  next();
}

function ensureNotInstalled(req, res, next) {
  if (config.isInstalled()) {
    return res.status(403).render('errors/403', {
      title: 'نصب انجام شده',
      message: 'سامانه قبلاً نصب شده است.',
      layout: 'layouts/auth',
    });
  }
  next();
}

// ── مرحله ۱: بررسی پیش‌نیازها ─────────────────────────
router.get('/install', alreadyInstalled, (req, res) => {
  const nodeOk = parseInt(process.version.slice(1), 10) >= 18;
  const checks = [
    { label: 'نسخه Node.js (حداقل 18)', value: process.version, ok: nodeOk },
    {
      label: 'دسترسی نوشتن در پوشه برنامه',
      value: path.join(config.root),
      ok: fs.existsSync(config.root) && testWrite(config.root),
    },
    { label: 'حافظه سرور', value: `${Math.round(os.totalmem() / 1048576)} MB`, ok: true },
    {
      label: 'درایور SQLite (بدون نیاز به دیتابیس خارجی)',
      value: 'node-sqlite3-wasm / node:sqlite',
      ok: true,
    },
    {
      label: 'درایور MySQL (اختیاری)',
      value: 'mysql2',
      ok: true,
    },
  ];
  res.render('installer/step1', {
    title: 'نصب سامانه مدیریت کلاس‌ها',
    checks,
    layout: 'layouts/auth',
  });
});

function testWrite(dir) {
  const f = path.join(dir, `.write-test-${Date.now()}`);
  try {
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
    return true;
  } catch {
    return false;
  }
}

// ── مرحله ۲: پیکربندی پایگاه‌داده ──────────────────────
router.get('/install/database', alreadyInstalled, (req, res) => {
  res.render('installer/step2', {
    title: 'پیکربندی پایگاه‌داده',
    values: { db_client: 'sqlite', db_file: './data/myclass.sqlite', db_host: 'localhost', db_port: '3306' },
    error: null,
    layout: 'layouts/auth',
  });
});

router.post('/install/database', ensureNotInstalled, async (req, res) => {
  const body = req.body || {};
  const client = body.db_client === 'mysql' ? 'mysql' : 'sqlite';
  const renderErr = (msg) =>
    res.render('installer/step2', {
      title: 'پیکربندی پایگاه‌داده',
      values: body,
      error: msg,
      layout: 'layouts/auth',
    });

  try {
    let envExtras = '';
    if (client === 'mysql') {
      const { host, port, name, user, password, charset } = {
        host: String(body.db_host || 'localhost').trim(),
        port: parseInt(body.db_port || '3306', 10),
        name: String(body.db_name || '').trim(),
        user: String(body.db_user || '').trim(),
        password: String(body.db_password || ''),
        charset: 'utf8mb4',
      };
      if (!name || !user) return renderErr('نام پایگاه‌داده و نام کاربری الزامی است');

      // تست اتصال
      const MysqlDriver = require('../../core/db/dialects/mysql');
      const test = new MysqlDriver({ host, port, name, user, password, charset });
      try {
        await test.query('SELECT 1');
      } finally {
        await test.close();
      }
      envExtras = `DB_CLIENT=mysql\nDB_HOST=${host}\nDB_PORT=${port}\nDB_NAME=${name}\nDB_USER=${user}\nDB_PASSWORD=${password}\nDB_CHARSET=utf8mb4\n`;
    } else {
      const file = String(body.db_file || './data/myclass.sqlite').trim() || './data/myclass.sqlite';
      envExtras = `DB_CLIENT=sqlite\nDB_FILE=${file}\n`;
    }

    writeEnv(envExtras);
    // راه‌اندازی مجدد اتصال با تنظیمات جدید
    await db.close();
    const { runMigrations } = require('../../core/db/migrate');
    const { runSeeds } = require('../../../seeds');
    await runMigrations(db);
    await runSeeds(db);

    req.session.installStep = 'admin';
    return res.redirect('/install/admin');
  } catch (e) {
    console.error('[install]', e);
    return renderErr(`خطا در اتصال یا راه‌اندازی پایگاه‌داده: ${e.message}`);
  }
});

// ── مرحله ۳: اطلاعات موسسه و مدیر ──────────────────────
router.get('/install/admin', alreadyInstalled, (req, res) => {
  if (req.session.installStep !== 'admin') return res.redirect('/install/database');
  res.render('installer/step3', {
    title: 'اطلاعات موسسه و مدیر',
    error: null,
    layout: 'layouts/auth',
  });
});

router.post('/install/admin', ensureNotInstalled, async (req, res) => {
  if (req.session.installStep !== 'admin') return res.redirect('/install/database');
  const b = req.body || {};
  const instituteName = String(b.institute_name || '').trim();
  const firstName = String(b.first_name || '').trim();
  const lastName = String(b.last_name || '').trim();
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  const phone = String(b.phone || '').trim();

  const err = (msg) =>
    res.render('installer/step3', { title: 'اطلاعات موسسه و مدیر', error: msg, layout: 'layouts/auth', values: b });

  if (!instituteName || !firstName || !lastName || !username || !password) {
    return err('تمام فیلدهای الزامی را تکمیل کنید');
  }
  if (password.length < 8) return err('رمز عبور باید حداقل ۸ کاراکتر باشد');
  if (!/^[a-z0-9_.]{3,50}$/i.test(username)) {
    return err('نام کاربری فقط شامل حروف انگلیسی، عدد، نقطه و زیرخط باشد');
  }

  try {
    const dbi = require('../../core/db');
    const exists = await dbi.one('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) return err('این نام کاربری قبلاً ثبت شده است');

    const role = await dbi.one('SELECT id FROM roles WHERE title = ?', ['ناظر کل']);
    const roleId = role ? role.id : null;

    const hash = await hashPassword(password);
    const now = dbi.now();
    const userId = await dbi.insert('users', {
      role_id: roleId,
      user_type: 'admin',
      first_name: firstName,
      last_name: lastName,
      username,
      phone,
      password_hash: hash,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });

    const settings = require('../../core/settings');
    await settings.set('institute_name', instituteName, 'institute');
    if (b.institute_phone) await settings.set('institute_phone', b.institute_phone, 'institute');

    // تنظیمات اختیاری پیامک
    if (b.sms_api_key) {
      await settings.set('sms_api_key', b.sms_api_key, 'sms');
      await settings.set('sms_from_number', b.sms_from_number || '+983000505', 'sms');
      await settings.set('sms_enabled', b.sms_enabled === '1' ? '1' : '0', 'sms');
    }

    await dbi.insert('audit_logs', {
      user_id: userId,
      action: 'install.complete',
      entity_type: 'system',
      entity_id: '',
      details: `نصب سامانه برای ${instituteName}`,
      ip: (req.ip || '').replace('::ffff:', ''),
      user_agent: (req.get('user-agent') || '').slice(0, 255),
      created_at: now,
    });

    fs.writeFileSync(config.installedFlag, new Date().toISOString(), 'utf8');
    delete req.session.installStep;

    return res.render('installer/step4', {
      title: 'نصب با موفقیت انجام شد',
      username,
      layout: 'layouts/auth',
    });
  } catch (e) {
    console.error('[install]', e);
    return err(`خطا در ساخت حساب مدیر: ${e.message}`);
  }
});

function writeEnv(extra) {
  const secret = require('crypto').randomBytes(32).toString('hex');
  const content = `# ساخته‌شده توسط نصب‌کننده MyClass Platform — ${new Date().toISOString()}
NODE_ENV=production
PORT=${process.env.PORT || 3000}
APP_URL=${process.env.APP_URL || ''}
BASE_PATH=${process.env.BASE_PATH || ''}
SESSION_SECRET=${secret}
SESSION_TTL_MINUTES=720
LOGIN_MAX_ATTEMPTS=8
LOGIN_LOCK_MINUTES=15
COOKIE_SECURE=${process.env.COOKIE_SECURE || 'false'}
UPLOAD_DIR=./public/uploads
MAX_UPLOAD_MB=8
${extra}`;
  fs.writeFileSync(config.envFile, content, 'utf8');
  // به‌روزرسانی کانفیگ در حافظه
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2];
  }
  config.sessionSecret = process.env.SESSION_SECRET;
  config.db.client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();
  config.db.file = path.isAbsolute(process.env.DB_FILE || '')
    ? process.env.DB_FILE
    : path.join(config.root, process.env.DB_FILE || './data/myclass.sqlite');
  config.db.host = process.env.DB_HOST || 'localhost';
  config.db.port = parseInt(process.env.DB_PORT || '3306', 10);
  config.db.name = process.env.DB_NAME || '';
  config.db.user = process.env.DB_USER || '';
  config.db.password = process.env.DB_PASSWORD || '';
}

module.exports = router;
