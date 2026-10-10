/**
 * احراز هویت — ورود، خروج، هش رمز عبور و محافظت از مسیرها
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');
const audit = require('./audit');

const BCRYPT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash || '');
  } catch {
    return false;
  }
}

/** تولید رمز عبور تصادفی خوانا */
function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = require('crypto').randomBytes(length);
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}

/** بررسی قفل بودن اکانت بعد از تلاش‌های ناموفق */
async function isLocked(username) {
  const since = new Date(Date.now() - config.loginLockMinutes * 60000);
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')} ${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}:${String(since.getSeconds()).padStart(2, '0')}`;
  const row = await db.one(
    `SELECT COUNT(*) AS c FROM login_attempts WHERE username = ? AND success = 0 AND created_at >= ?`,
    [username, sinceStr]
  );
  return Number(row.c) >= config.loginMaxAttempts;
}

async function recordAttempt(username, ip, success) {
  await db.insert('login_attempts', {
    username,
    ip: ip || '',
    success: success ? 1 : 0,
    created_at: db.now(),
  });
}

/** تلاش برای ورود — در صورت موفقیت کاربر را برمی‌گرداند */
async function attemptLogin(username, password, ip) {
  const uname = normalizeUsername(username);
  if (!uname || !password) return { ok: false, error: 'نام کاربری و رمز عبور را وارد کنید' };

  if (await isLocked(uname)) {
    return {
      ok: false,
      error: `به دلیل تلاش‌های ناموفق، ورود موقتاً قفل شد. ${config.loginLockMinutes} دقیقه دیگر تلاش کنید`,
    };
  }

  const user = await db.one('SELECT * FROM users WHERE username = ?', [uname]);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;

  if (!valid) {
    await recordAttempt(uname, ip, false);
    return { ok: false, error: 'نام کاربری یا رمز عبور اشتباه است' };
  }
  if (!user.is_active) {
    await recordAttempt(uname, ip, false);
    return { ok: false, error: 'حساب کاربری شما غیرفعال شده است' };
  }

  await recordAttempt(uname, ip, true);
  await db.update('users', { last_login_at: db.now() }, 'id = ?', [user.id]);
  return { ok: true, user };
}

/** بارگذاری کاربر جاری روی req (همراه نقش و دسترسی‌ها) */
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.userPerms = new Set();
  if (!req.session || !req.session.userId) return next();
  try {
    const user = await db.one(
      `SELECT u.*, r.title AS role_title, r.id AS role_id_real
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      [req.session.userId]
    );
    if (!user || !user.is_active) {
      req.session.destroy(() => {});
      return next();
    }
    const perms = await db.query(
      `SELECT p.code FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`,
      [user.role_id]
    );
    req.user = user;
    req.userPerms = new Set(perms.map((p) => p.code));
    res.locals.currentUser = user;
    res.locals.userPerms = req.userPerms;
  } catch (e) {
    // بدون کاربر ادامه بده
  }
  next();
}

/** فقط کاربران وارد شده */
function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

/** فقط کاربران وارد نشده (صفحه ورود) */
function guestOnly(req, res, next) {
  if (req.user) return res.redirect('/');
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  generatePassword,
  normalizeUsername,
  attemptLogin,
  isLocked,
  loadUser,
  requireAuth,
  guestOnly,
  BCRYPT_ROUNDS,
};
