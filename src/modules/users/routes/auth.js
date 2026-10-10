'use strict';
/** ورود، خروج و بازیابی رمز عبور */
const path = require('path');
const rateLimit = require('express-rate-limit');
const { db } = require('../../../core/db');
const settings = require('../../../core/settings');
const jalali = require('../../../core/jalali');
const events = require('../../../core/events');
const config = require('../../../core/config');
const { verifyPassword, hashPassword } = require('../../../core/auth');
const { audit } = require('../../../core/audit');
const { destroyUserSessions } = require('../../../core/session-store');
const { toEnDigits, normalizeMobile, randomCode, sha256, safeEqual } = require('../../../core/utils');
const { passwordPolicyError } = require('../service');

const v = (name) => path.join(__dirname, '..', 'views', name);

const limiter = (max, minutes) => rateLimit({
  windowMs: minutes * 60 * 1000,
  limit: max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.');
    res.go(req.path);
  },
});

let dummyHash = null;
const otpHash = (code) => sha256(`${config.secret()}:${code}`);

async function findByIdentifier(identifier) {
  const id = toEnDigits(identifier || '').trim().toLowerCase();
  if (!id) return null;
  const mode = settings.get('security.login_with', 'any');
  const mobile = normalizeMobile(id);
  const q = db('users');
  if (mode === 'username') q.where('username', id);
  else if (mode === 'mobile') q.where('mobile', mobile);
  else if (mode === 'national_code') q.where('national_code', id);
  else q.where('username', id).orWhere('mobile', mobile).orWhere('national_code', id);
  return q.first();
}

module.exports = (r) => {
  r.get('/login', (req, res) => {
    if (req.user) return res.go('/panel');
    res.page(v('auth/login'), { title: 'ورود به پنل' }, 'layouts/auth');
  });

  r.post('/login', limiter(20, 15), async (req, res) => {
    const { username, password } = req.body;
    const fail = (msg) => {
      req.session.oldInput = { username };
      req.flash('error', msg || 'نام کاربری یا رمز عبور اشتباه است.');
      return res.go('/login');
    };
    if (!username || !password) return fail('نام کاربری و رمز عبور را وارد کنید.');
    const user = await findByIdentifier(username);
    const now = jalali.now();
    if (!user) {
      if (!dummyHash) dummyHash = await hashPassword('timing-attack-protection');
      await verifyPassword(password, dummyHash); // جلوگیری از حمله زمانی (شناسایی نام‌های کاربری)
      return fail();
    }
    if (user.locked_until && String(user.locked_until) > now) {
      return fail('حساب شما به دلیل تلاش‌های ناموفق متعدد موقتاً قفل شده است. لطفاً بعداً تلاش کنید.');
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const max = Number(settings.get('security.max_login_attempts', 5));
      const failed = (user.failed_logins || 0) + 1;
      const upd = { failed_logins: failed };
      if (failed >= max) {
        upd.locked_until = jalali.later(Number(settings.get('security.lockout_minutes', 15)));
        upd.failed_logins = 0;
        await audit({ ip: req.ip, get: (h) => req.get(h), user: null }, 'auth.locked', 'user', user.id);
      }
      await db('users').where({ id: user.id }).update(upd);
      return fail();
    }
    if (!user.is_active) return fail('حساب کاربری شما غیرفعال است. با مدیریت تماس بگیرید.');

    const returnTo = req.session.returnTo;
    req.session.regenerate(async (err) => {
      if (err) return fail('خطا در ایجاد نشست');
      req.session.userId = user.id;
      req.session.authAt = now;
      await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null, last_login_at: now, last_login_ip: String(req.ip || '').slice(0, 45) });
      req.user = user;
      await audit(req, 'auth.login', 'user', user.id);
      req.flash('success', `${user.first_name} عزیز، خوش آمدید!`);
      req.session.save(() => {
        if (returnTo && returnTo.startsWith((res.locals.base || '') + '/panel')) return res.go(returnTo, true);
        res.go('/panel');
      });
    });
  });

  r.post('/logout', async (req, res) => {
    if (req.user) await audit(req, 'auth.logout', 'user', req.user.id);
    req.session.destroy(() => {
      res.clearCookie('myclass_sid', { path: res.locals.base || '/' });
      res.go('/login');
    });
  });

  /* --------------------------- بازیابی رمز عبور --------------------------- */
  r.get('/forgot', (req, res) => {
    if (!settings.get('security.forgot_password_sms', true)) return res.go('/login');
    res.page(v('auth/forgot'), { title: 'بازیابی رمز عبور' }, 'layouts/auth');
  });

  r.post('/forgot', limiter(5, 15), async (req, res) => {
    if (!settings.get('security.forgot_password_sms', true)) return res.go('/login');
    const ident = toEnDigits(req.body.identifier || '').trim();
    const mobile = normalizeMobile(ident);
    const user = await db('users').where('mobile', mobile).orWhere('national_code', ident).first();
    if (user && user.mobile && user.is_active) {
      const recent = await db('otp_codes').where({ user_id: user.id, purpose: 'reset' }).where('created_at', '>', jalali.today() + ' 00:00:00').count({ c: '*' }).first();
      if (Number(recent.c) < 10) {
        const code = randomCode(6);
        await db('otp_codes').where({ user_id: user.id, purpose: 'reset', used: false }).update({ used: true });
        await db('otp_codes').insert({
          user_id: user.id, purpose: 'reset', code_hash: otpHash(code),
          expires_at: jalali.later(5),
          attempts: 0, used: false, created_at: jalali.now(),
        });
        await events.emitAsync('auth.otp', { user, code });
      }
      req.session.resetUserId = user.id;
    } else {
      req.session.resetUserId = -1; // عدم افشای وجود حساب
    }
    req.flash('info', 'در صورت وجود حساب کاربری با این مشخصات، کد تأیید به شماره موبایل ثبت‌شده ارسال شد.');
    res.go('/reset');
  });

  r.get('/reset', (req, res) => {
    if (!req.session.resetUserId) return res.go('/forgot');
    res.page(v('auth/reset'), { title: 'تعیین رمز جدید' }, 'layouts/auth');
  });

  r.post('/reset', limiter(10, 15), async (req, res) => {
    const uid = req.session.resetUserId;
    if (!uid) return res.go('/forgot');
    const code = toEnDigits(req.body.code || '').trim();
    const { password, password_confirm: confirm } = req.body;
    const back = (msg) => { req.flash('error', msg); return res.go('/reset'); };
    const policy = passwordPolicyError(password);
    if (policy) return back(policy);
    if (password !== confirm) return back('تکرار رمز عبور مطابقت ندارد.');
    const otp = uid > 0 ? await db('otp_codes').where({ user_id: uid, purpose: 'reset', used: false }).orderBy('id', 'desc').first() : null;
    if (!otp || String(otp.expires_at) < jalali.now() || otp.attempts >= 5) return back('کد تأیید نامعتبر یا منقضی شده است.');
    if (!safeEqual(otpHash(code), otp.code_hash)) {
      await db('otp_codes').where({ id: otp.id }).update({ attempts: otp.attempts + 1 });
      return back('کد تأیید اشتباه است.');
    }
    const now = jalali.now();
    await db('otp_codes').where({ id: otp.id }).update({ used: true });
    await db('users').where({ id: uid }).update({ password_hash: await hashPassword(password), password_changed_at: now, must_change_password: false, failed_logins: 0, locked_until: null, updated_at: now });
    await destroyUserSessions(uid);
    delete req.session.resetUserId;
    await audit(Object.assign(req, { user: { id: uid } }), 'auth.password_reset', 'user', uid);
    req.user = null;
    req.flash('success', 'رمز عبور با موفقیت تغییر کرد. اکنون وارد شوید.');
    res.go('/login');
  });
};
