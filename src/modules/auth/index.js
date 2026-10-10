/**
 * ماژول احراز هویت — ورود / خروج / تغییر رمز عبور
 */
const express = require('express');
const router = express.Router();
const { attemptLogin, guestOnly, requireAuth, hashPassword, verifyPassword } = require('../../core/auth');
const { loginLimiter } = require('../../core/security');
const audit = require('../../core/audit');
const db = require('../../core/db');
const { flash } = require('../../core/viewHelpers');
const settings = require('../../core/settings');

router.get('/login', guestOnly, async (req, res) => {
  res.render('auth/login', {
    title: 'ورود به سامانه',
    error: null,
    layout: 'layouts/auth',
  });
});

router.post('/login', loginLimiter, guestOnly, async (req, res) => {
  const { username, password } = req.body || {};
  const ip = (req.ip || '').replace('::ffff:', '');
  const result = await attemptLogin(username, password, ip);

  if (!result.ok) {
    return res.status(401).render('auth/login', {
      title: 'ورود به سامانه',
      error: result.error,
      username,
      layout: 'layouts/auth',
    });
  }

  req.session.userId = result.user.id;
  req.session.loginAt = Date.now();
  await audit.log(req, 'auth.login', 'user', result.user.id, `ورود موفق: ${result.user.username}`);

  const returnTo = req.session.returnTo;
  delete req.session.returnTo;

  if (result.user.must_change_password) {
    flash(req, 'warning', 'برای ادامه باید رمز عبور خود را تغییر دهید');
    return res.redirect('/panel/profile');
  }
  return res.redirect(returnTo && returnTo.startsWith('/') ? returnTo : '/panel');
});

router.post('/logout', requireAuth, async (req, res) => {
  await audit.log(req, 'auth.logout', 'user', req.user.id, '');
  req.session.destroy(() => {
    res.clearCookie('myclass.sid');
    res.redirect('/login');
  });
});

router.get('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('myclass.sid');
    res.redirect('/login');
  });
});

/** پروفایل و تغییر رمز عبور */
router.get('/panel/profile', requireAuth, async (req, res) => {
  res.render('auth/profile', {
    title: 'پروفایل من',
    page: 'profile',
  });
});

router.post('/panel/profile', requireAuth, async (req, res) => {
  const { first_name, last_name, email, phone, current_password, new_password, confirm_password } = req.body || {};
  try {
    const updates = {
      first_name: String(first_name || '').trim(),
      last_name: String(last_name || '').trim(),
      email: String(email || '').trim(),
      phone: String(phone || '').trim(),
      updated_at: db.now(),
    };
    if (!updates.first_name || !updates.last_name) {
      flash(req, 'danger', 'نام و نام خانوادگی الزامی است');
      return res.redirect('/panel/profile');
    }

    if (new_password) {
      const minLen = parseInt(await settings.get('security_password_min', '8'), 10) || 8;
      if (new_password.length < minLen) {
        flash(req, 'danger', `رمز عبور جدید باید حداقل ${minLen} کاراکتر باشد`);
        return res.redirect('/panel/profile');
      }
      if (new_password !== confirm_password) {
        flash(req, 'danger', 'تکرار رمز عبور مطابقت ندارد');
        return res.redirect('/panel/profile');
      }
      const ok = await verifyPassword(current_password || '', req.user.password_hash);
      if (!ok) {
        flash(req, 'danger', 'رمز عبور فعلی اشتباه است');
        return res.redirect('/panel/profile');
      }
      updates.password_hash = await hashPassword(new_password);
      updates.must_change_password = 0;
    }

    await db.update('users', updates, 'id = ?', [req.user.id]);
    await audit.log(req, 'auth.profile_update', 'user', req.user.id, '');
    flash(req, 'success', 'پروفایل با موفقیت به‌روزرسانی شد');
  } catch (e) {
    flash(req, 'danger', 'خطا در ذخیره اطلاعات: ' + e.message);
  }
  res.redirect('/panel/profile');
});

module.exports = router;
