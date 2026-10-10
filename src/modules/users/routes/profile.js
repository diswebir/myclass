'use strict';
/** پروفایل کاربر جاری */
const path = require('path');
const { db } = require('../../../core/db');
const jalali = require('../../../core/jalali');
const { verifyPassword, hashPassword } = require('../../../core/auth');
const { uploader, removeFile } = require('../../../core/upload');
const { audit } = require('../../../core/audit');
const { destroyUserSessions } = require('../../../core/session-store');
const { str, text, isEmail, toEnDigits } = require('../../../core/utils');
const { passwordPolicyError } = require('../service');

const v = (name) => path.join(__dirname, '..', 'views', name);

module.exports = (r) => {
  r.get('/profile', async (req, res) => {
    const sessions = await db('sessions').where({ user_id: req.user.id }).count({ c: '*' }).first();
    const logs = await db('audit_logs').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(10);
    res.page(v('profile'), {
      title: 'پروفایل من',
      breadcrumbs: [{ label: 'پروفایل من' }],
      sessionsCount: Number(sessions.c),
      logs,
    });
  });

  r.post('/profile', async (req, res) => {
    if (req.user.kind === 'student' && !require('../../../core/settings').get('portal.allow_profile_edit', true)) {
      req.flash('error', 'امکان ویرایش اطلاعات غیرفعال است.');
      return res.go('/panel/profile');
    }
    const email = str(req.body.email, 191).toLowerCase();
    if (email && !isEmail(email)) return req.backWithErrors({ email: 'ایمیل معتبر نیست.' });
    await db('users').where({ id: req.user.id }).update({
      email: email || null,
      phone: toEnDigits(str(req.body.phone, 20)) || null,
      address: text(req.body.address, 1000) || null,
      postal_code: toEnDigits(str(req.body.postal_code, 20)) || null,
      job: str(req.body.job, 100) || null,
      education: str(req.body.education, 100) || null,
      updated_at: jalali.now(),
    });
    await audit(req, 'profile.update', 'user', req.user.id);
    req.flash('success', 'اطلاعات شما به‌روزرسانی شد.');
    res.go('/panel/profile');
  });

  r.post('/profile/password', async (req, res) => {
    const { current_password: cur, password, password_confirm: confirm } = req.body;
    const row = await db('users').where({ id: req.user.id }).first();
    if (!(await verifyPassword(cur || '', row.password_hash))) return req.backWithErrors({ current_password: 'رمز عبور فعلی اشتباه است.' }, '/panel/profile#password');
    const policy = passwordPolicyError(password);
    if (policy) return req.backWithErrors({ password: policy }, '/panel/profile#password');
    if (password !== confirm) return req.backWithErrors({ password_confirm: 'تکرار رمز عبور مطابقت ندارد.' }, '/panel/profile#password');
    if (await verifyPassword(password, row.password_hash)) return req.backWithErrors({ password: 'رمز جدید نباید با رمز فعلی یکسان باشد.' }, '/panel/profile#password');
    const now = jalali.now();
    await db('users').where({ id: req.user.id }).update({ password_hash: await hashPassword(password), password_changed_at: now, must_change_password: false, updated_at: now });
    req.session.authAt = now;
    await destroyUserSessions(req.user.id, req.sessionID);
    await audit(req, 'profile.password_changed', 'user', req.user.id);
    req.flash('success', 'رمز عبور با موفقیت تغییر کرد. سایر نشست‌های شما خاتمه یافت.');
    res.go('/panel/profile');
  });

  r.post('/profile/avatar', ...uploader('public/avatars', { types: ['jpg', 'png', 'webp'], maxMB: 2, field: 'avatar' }), async (req, res) => {
    if (!req.file) {
      req.flash('error', 'فایلی انتخاب نشده است.');
      return res.go('/panel/profile');
    }
    if (req.user.avatar) removeFile(req.user.avatar);
    await db('users').where({ id: req.user.id }).update({ avatar: req.file.relPath, updated_at: jalali.now() });
    req.flash('success', 'تصویر پروفایل به‌روزرسانی شد.');
    res.go('/panel/profile');
  });

  r.post('/profile/sessions', async (req, res) => {
    const n = await destroyUserSessions(req.user.id, req.sessionID);
    await audit(req, 'profile.sessions_cleared', 'user', req.user.id);
    req.flash('success', `${n} نشست دیگر خاتمه یافت.`);
    res.go('/panel/profile');
  });
};
