'use strict';
/**
 * میان‌افزارهای HTTP: CSRF، پیام‌های فلش، فرم‌ها، رندر صفحات
 */
const crypto = require('crypto');
const { safeEqual, httpError } = require('./utils');

/* ------------------------------- CSRF ------------------------------- */
function ensureToken(req) {
  if (!req.session) return '';
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function verifyCsrf(req, res, next) {
  const isMultipart = (req.get('content-type') || '').startsWith('multipart/form-data');
  // در فرم‌های multipart (آپلود فایل) توکن در آدرس فرم ارسال می‌شود تا پیش از پردازش فایل بررسی شود
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token') || (isMultipart ? req.query._csrf : undefined);
  const expected = req.session && req.session.csrf;
  if (!expected || !token || !safeEqual(token, expected)) {
    return next(httpError(419, 'نشست شما منقضی شده یا درخواست نامعتبر است. لطفاً صفحه را بازخوانی کنید.'));
  }
  next();
}

/** بررسی خودکار CSRF برای همه درخواست‌های تغییر دهنده */
function csrfProtection(req, res, next) {
  if (req.body === undefined) req.body = {};
  res.locals.csrfToken = ensureToken(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // نصب‌کننده توکن مستقل (کوکی) دارد
  if (!require('./config').isInstalled() && req.path.startsWith('/install')) return next();
  return verifyCsrf(req, res, next);
}

/* ------------------------------- Flash ------------------------------ */
function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session) return;
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };
  res.locals.flashes = (req.session && req.session.flash) || [];
  if (req.session && req.method === 'GET') req.session.flash = [];
  // ورودی‌های قبلی و خطاهای فرم
  res.locals.oldInput = (req.session && req.session.oldInput) || {};
  res.locals.formErrors = (req.session && req.session.formErrors) || {};
  if (req.session && req.method === 'GET') {
    delete req.session.oldInput;
    delete req.session.formErrors;
  }
  /** بازگشت به فرم با خطا */
  req.backWithErrors = (errors, to) => {
    const body = Object.assign({}, req.body || {});
    for (const k of Object.keys(body)) if (/password|_csrf/i.test(k)) delete body[k];
    req.session.oldInput = body;
    req.session.formErrors = errors;
    const first = Object.values(errors)[0];
    if (first) req.flash('error', first);
    return res.go(to || req.get('referer') || '/panel', true);
  };
  next();
}

/* ------------------------------ Render ------------------------------ */
function renderer(app) {
  return (req, res, next) => {
    /** هدایت با در نظر گرفتن مسیر پایه */
    res.go = (to, raw = false) => {
      if (raw && /^https?:\/\//.test(to)) {
        // فقط ارجاع داخلی
        try {
          const u = new URL(to);
          if (u.host !== req.get('host')) return res.redirect(res.locals.url('/panel'));
          return res.redirect(u.pathname + u.search);
        } catch (e) { return res.redirect(res.locals.url('/panel')); }
      }
      if (raw && to.startsWith('/') && res.locals.base && to.startsWith(res.locals.base + '/')) return res.redirect(to);
      return res.redirect(res.locals.url(to));
    };
    res.back = (fallback = '/panel') => {
      const ref = req.get('referer');
      if (ref) return res.go(ref, true);
      return res.go(fallback);
    };
    /** رندر صفحه داخل قالب اصلی */
    res.page = (view, locals = {}, layout = 'layouts/main') => {
      res.render(view, locals, (err, body) => {
        if (err) return next(err);
        res.render(layout, Object.assign({}, locals, { body }), (err2, html) => {
          if (err2) return next(err2);
          res.send(html);
        });
      });
    };
    next();
  };
}

module.exports = { csrfProtection, verifyCsrf, flash, renderer, ensureToken };
