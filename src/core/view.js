'use strict';
/**
 * توابع کمکی قالب‌ها (EJS) و ساخت منوی پویا بر اساس ماژول‌ها و مجوزها
 */
const registry = require('./modules');
const settings = require('./settings');
const jalali = require('./jalali');
const { formatNumber, toFaDigits } = require('./utils');
const { can } = require('./auth');
const pkg = require('../../package.json');

const STATUS = {
  class: {
    draft: ['پیش‌نویس', 'gray'], open: ['در حال ثبت‌نام', 'info'], running: ['در حال برگزاری', 'success'],
    finished: ['پایان‌یافته', 'purple'], canceled: ['لغو شده', 'danger'],
  },
  enrollment: {
    active: ['فعال', 'success'], completed: ['فارغ‌التحصیل', 'purple'], withdrawn: ['انصراف', 'danger'], suspended: ['تعلیق', 'warning'],
  },
  attendance: {
    present: ['حاضر', 'success'], absent: ['غایب', 'danger'], late: ['تأخیر', 'warning'], excused: ['غیبت موجه', 'info'],
  },
  session: { scheduled: ['برنامه‌ریزی شده', 'info'], held: ['برگزار شده', 'success'], canceled: ['لغو شده', 'danger'] },
  invoice: {
    unpaid: ['پرداخت نشده', 'danger'], partial: ['پرداخت ناقص', 'warning'], paid: ['تسویه شده', 'success'], canceled: ['باطل شده', 'gray'],
  },
  installment: { pending: ['در انتظار', 'info'], partial: ['پرداخت ناقص', 'warning'], paid: ['پرداخت شده', 'success'], overdue: ['معوق', 'danger'] },
  payment: { pending: ['در انتظار بررسی', 'warning'], approved: ['تأیید شده', 'success'], rejected: ['رد شده', 'danger'] },
  prereg: {
    pending: ['در انتظار بررسی', 'warning'], contacted: ['تماس گرفته شد', 'info'], approved: ['تأیید و ثبت‌نام', 'success'], rejected: ['رد شده', 'danger'],
  },
  certificate: { valid: ['معتبر', 'success'], revoked: ['ابطال شده', 'danger'] },
  sms: { sent: ['ارسال شد', 'success'], failed: ['ناموفق', 'danger'], queued: ['در صف', 'info'], skipped: ['رد شد', 'gray'] },
  active: { 1: ['فعال', 'success'], 0: ['غیرفعال', 'gray'], true: ['فعال', 'success'], false: ['غیرفعال', 'gray'] },
};

const PAYMENT_METHODS = {
  cash: 'نقدی (حضوری)', card_to_card: 'کارت به کارت', pos: 'کارتخوان', bank_transfer: 'واریز / حواله بانکی', online: 'درگاه آنلاین', cheque: 'چک', other: 'سایر',
};

const KINDS = { admin: 'مدیر', staff: 'کارمند', teacher: 'استاد', student: 'دانشجو' };

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildMenu(req) {
  const user = req.user;
  const path = req.path;
  const sections = {};
  for (const m of registry.enabled()) {
    for (const item of m.menu) {
      const perms = item.perm ? [].concat(item.perm) : [];
      if (perms.length && !perms.some((p) => can(user, p))) continue;
      if (item.kinds && !item.kinds.includes(user.kind)) continue;
      if (item.module && !registry.isEnabled(item.module)) continue;
      if (item.hideForKinds && item.hideForKinds.includes(user.kind)) continue;
      const sec = item.section || 'main';
      sections[sec] = sections[sec] || [];
      const match = [].concat(item.match || item.href);
      const active = match.some((mm) => (mm === '/panel' ? path === '/panel' || path === '/panel/' : path === mm || path.startsWith(mm + '/')));
      sections[sec].push(Object.assign({}, item, { active }));
    }
  }
  return Object.entries(sections)
    .map(([key, items]) => ({
      key,
      label: (registry.MENU_SECTIONS[key] || {}).label || key,
      order: (registry.MENU_SECTIONS[key] || {}).order || 50,
      items: items.sort((a, b) => (a.order || 50) - (b.order || 50)),
    }))
    .sort((a, b) => a.order - b.order);
}

function locals(base) {
  return (req, res, next) => {
    const L = res.locals;
    L.base = base;
    L.req = req;
    L.path = req.path;
    L.query = req.query || {};
    L.appVersion = pkg.version;
    L.url = (p = '/') => base + (p.startsWith('/') ? p : '/' + p);
    /** آدرس فرم‌های دارای فایل (توکن CSRF در آدرس) */
    L.mpAction = (p) => `${L.url(p)}${p.includes('?') ? '&' : '?'}_csrf=${encodeURIComponent(res.locals.csrfToken || '')}`;
    L.asset = (p) => `${base}/public/${p.replace(/^\//, '')}?v=${pkg.version}`;
    L.icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="${base}/public/img/icons.svg?v=${pkg.version}#${name}"></use></svg>`;
    L.media = (rel) => (rel ? base + '/media/' + String(rel).replace(/^public[/]/, '') : '');
    L.s = (key, fb) => settings.get(key, fb);
    const faDigits = settings.get('general.persian_digits', true) !== false;
    L.fa = (v) => (faDigits ? toFaDigits(v === null || v === undefined ? '' : v) : String(v === null || v === undefined ? '' : v));
    L.num = (n) => formatNumber(n, faDigits);
    L.money = (n, withUnit = true) => formatNumber(n, faDigits) + (withUnit ? ' ' + settings.get('finance.currency', 'تومان') : '');
    L.jdate = (g, style) => L.fa(jalali.format(g, style));
    L.jdt = (dt) => L.fa(jalali.formatDateTime(dt));
    L.jinput = (g) => (g ? jalali.toJalali(g) : '');
    L.rel = (dt) => L.fa(jalali.relative(dt));
    L.weekday = (n) => jalali.weekdayName(n);
    L.jalali = jalali;
    L.can = (perm) => can(req.user, perm);
    L.canAny = (...perms) => perms.flat().some((p) => can(req.user, p));
    L.moduleOn = (key) => registry.isEnabled(key);
    L.STATUS = STATUS;
    L.PAYMENT_METHODS = PAYMENT_METHODS;
    L.auditLabel = require('./audit').auditLabel;
    L.KINDS = KINDS;
    L.esc = esc;
    L.badge = (type, value, extraCls = '') => {
      const def = (STATUS[type] || {})[value] || [value, 'gray'];
      return `<span class="badge badge-${def[1]} ${extraCls}">${esc(def[0])}</span>`;
    };
    L.statusLabel = (type, value) => ((STATUS[type] || {})[value] || [value])[0];
    L.old = (field, def = '') => {
      const o = res.locals.oldInput || {};
      return o[field] !== undefined ? o[field] : (def === null || def === undefined ? '' : def);
    };
    L.err = (field) => (res.locals.formErrors || {})[field];
    L.json = (obj) => JSON.stringify(obj === undefined ? null : obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    L.qs = (overrides = {}) => {
      const q = Object.assign({}, req.query, overrides);
      const parts = [];
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      return parts.length ? '?' + parts.join('&') : '';
    };
    L.initials = (name) => {
      const p = String(name || '').trim().split(/\s+/);
      return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
    };
    L.truncate = (s, n = 60) => {
      s = String(s || '');
      return s.length > n ? s.slice(0, n) + '…' : s;
    };
    L.pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    L.title = '';
    L.breadcrumbs = [];
    next();
  };
}

/** منو و شمارنده‌ها - فقط برای صفحات پنل */
async function panelLocals(req, res, next) {
  if (!req.user) return next();
  res.locals.menu = buildMenu(req);
  const badges = {};
  for (const m of registry.enabled()) {
    if (typeof m.menuBadges === 'function') {
      try { Object.assign(badges, await m.menuBadges(req)); } catch (e) { /* ignore */ }
    }
  }
  res.locals.menuBadges = badges;
  next();
}

module.exports = { locals, panelLocals, STATUS, PAYMENT_METHODS, KINDS, esc };
