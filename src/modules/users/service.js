'use strict';
/** سرویس کاربران: اعتبارسنجی، ساخت کاربر، رمز اولیه */
const { db, insertId } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { hashPassword } = require('../../core/auth');
const {
  str, text, normalizeMobile, isMobile, isNationalCode, isEmail, toEnDigits, randomPassword,
} = require('../../core/utils');

function passwordPolicyError(pw) {
  const min = Number(settings.get('security.password_min', 8));
  if (!pw || String(pw).length < min) return `رمز عبور باید حداقل ${min} کاراکتر باشد.`;
  if (settings.get('security.password_strong', true) && !(/[a-zA-Z\u0600-\u06FF]/.test(pw) && /\d/.test(pw))) {
    return 'رمز عبور باید شامل حروف و اعداد باشد.';
  }
  return null;
}

/** اعتبارسنجی و نرمال‌سازی ورودی فرم کاربر */
async function validateUser(body, { id = null, requireNationalCode = false } = {}) {
  const errors = {};
  const data = {
    first_name: str(body.first_name, 100),
    last_name: str(body.last_name, 100),
    father_name: str(body.father_name, 100) || null,
    gender: ['male', 'female'].includes(body.gender) ? body.gender : null,
    national_code: toEnDigits(body.national_code || '').replace(/\D/g, '') || null,
    mobile: body.mobile ? normalizeMobile(body.mobile) : null,
    email: str(body.email, 191).toLowerCase() || null,
    education: str(body.education, 100) || null,
    job: str(body.job, 100) || null,
    phone: toEnDigits(str(body.phone, 20)) || null,
    postal_code: toEnDigits(str(body.postal_code, 20)) || null,
    address: text(body.address, 1000) || null,
    notes: text(body.notes, 5000) || null,
    username: toEnDigits(str(body.username, 100)).toLowerCase().replace(/\s/g, '') || null,
    birth_date: null,
  };
  if (!data.first_name) errors.first_name = 'نام الزامی است.';
  if (!data.last_name) errors.last_name = 'نام خانوادگی الزامی است.';
  if (data.mobile && !isMobile(data.mobile)) errors.mobile = 'شماره موبایل معتبر نیست (مثال: 09121234567).';
  if (data.national_code && !isNationalCode(data.national_code)) errors.national_code = 'کد ملی معتبر نیست.';
  if (requireNationalCode && !data.national_code) errors.national_code = 'کد ملی الزامی است.';
  if (data.email && !isEmail(data.email)) errors.email = 'ایمیل معتبر نیست.';
  if (body.birth_date) {
    data.birth_date = jalali.fromJalali(body.birth_date);
    if (!data.birth_date) errors.birth_date = 'تاریخ تولد معتبر نیست.';
  }
  if (data.username && !/^[a-z0-9_.@-]{3,100}$/.test(data.username)) errors.username = 'نام کاربری فقط شامل حروف انگلیسی، اعداد و _ . - باشد (حداقل ۳ کاراکتر).';
  if (!data.username) data.username = data.mobile || data.national_code || null;
  if (!data.username) errors.username = 'نام کاربری، موبایل یا کد ملی الزامی است.';

  // بررسی تکراری نبودن
  const checks = [['username', 'این نام کاربری قبلاً ثبت شده است.'], ['mobile', 'این شماره موبایل برای کاربر دیگری ثبت شده است.'], ['national_code', 'این کد ملی برای کاربر دیگری ثبت شده است.']];
  for (const [field, msg] of checks) {
    if (!data[field] || errors[field]) continue;
    const q = db('users').where(field, data[field]);
    if (id) q.whereNot('id', id);
    if (await q.first()) errors[field] = msg;
  }
  return { data, errors };
}

function initialPassword(data) {
  const mode = settings.get('security.default_password', 'national_code');
  if (mode === 'national_code' && data.national_code) return data.national_code;
  if (mode === 'mobile' && data.mobile) return data.mobile;
  if (mode !== 'random' && (data.national_code || data.mobile)) return data.national_code || data.mobile;
  return randomPassword(8);
}

/** ساخت کاربر جدید */
async function createUser(data, { roleId, password, actorId = null, sendSms = false, trx = null, mustChange } = {}) {
  const plain = password || initialPassword(data);
  const now = jalali.now();
  const row = Object.assign({}, data, {
    role_id: roleId,
    password_hash: await hashPassword(plain),
    must_change_password: mustChange !== undefined ? !!mustChange : (!password && settings.get('security.force_change_initial', true)),
    is_active: data.is_active === undefined ? true : !!data.is_active,
    created_by: actorId,
    created_at: now,
    updated_at: now,
    password_changed_at: null,
  });
  const id = await insertId('users', row, trx);
  const user = Object.assign({ id }, row);
  delete user.password_hash;
  if (sendSms) events.emit('user.welcome', { user, password: plain });
  return { id, password: plain, user };
}

async function roleBySlug(slug) {
  return db('roles').where({ slug }).first();
}

async function studentRole() {
  return (await roleBySlug('student')) || db('roles').where({ kind: 'student' }).first();
}

module.exports = { validateUser, createUser, initialPassword, passwordPolicyError, roleBySlug, studentRole };
