'use strict';
/**
 * سرویس پیامک
 * - هر رویداد سیستم (ثبت‌نام، غیبت، قسط و ...) یک «پترن» اختصاصی دارد.
 * - متغیرهای ارسالی به پترن کاملاً قابل تنظیم هستند: نام متغیر پترن ← مقدار (متن ثابت یا توکن‌هایی مثل {first_name})
 */
const { db, insertId } = require('../../core/db');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');
const { siteUrl } = require('../../core/site');
const { fillTemplate, toE164, normalizeMobile, formatNumber, safeJson } = require('../../core/utils');
const { IPPanel } = require('./providers/ippanel');

/** توکن‌های عمومی قابل استفاده در همه پترن‌ها */
const COMMON_TOKENS = {
  institute_name: 'نام موسسه', institute_phone: 'تلفن موسسه', site_url: 'آدرس سامانه', login_url: 'آدرس ورود', today: 'تاریخ امروز',
};

const TOKEN_LABELS = Object.assign({
  name: 'نام کامل', first_name: 'نام', last_name: 'نام خانوادگی', mobile: 'موبایل', username: 'نام کاربری', password: 'رمز عبور',
  national_code: 'کد ملی', code: 'کد تأیید', class_title: 'عنوان کلاس', class_code: 'کد کلاس', start_date: 'تاریخ شروع کلاس',
  start_time: 'ساعت شروع', end_time: 'ساعت پایان', week_days: 'روزهای برگزاری', location: 'محل برگزاری', session_date: 'تاریخ جلسه',
  session_time: 'ساعت جلسه', session_no: 'شماره جلسه', absent_count: 'تعداد غیبت', invoice_no: 'شماره فاکتور', amount: 'مبلغ (با جداکننده)',
  amount_raw: 'مبلغ (عدد خام)', remaining: 'مانده بدهی', installments_count: 'تعداد اقساط', first_due_date: 'سررسید اولین قسط',
  installment_no: 'شماره قسط', due_date: 'تاریخ سررسید', days_left: 'روز مانده', days_late: 'روز تأخیر', tracking_code: 'کد رهگیری/پیگیری',
  reason: 'دلیل', serial: 'شماره سریال مدرک', verify_code: 'کد استعلام', verify_url: 'لینک استعلام', currency: 'واحد پول',
}, COMMON_TOKENS);

function provider() {
  const name = settings.get('sms.provider', 'ippanel');
  if (name === 'log') {
    return {
      name: 'log',
      async sendPattern() { return { ids: ['test-' + Date.now()], response: { test: true } }; },
      async sendText() { return { ids: ['test-' + Date.now()], response: { test: true } }; },
      async credit() { return { credit: 0, test: true }; },
      async patterns() { return { data: [] }; },
    };
  }
  return new IPPanel({
    apiKey: settings.get('sms.ippanel_api_key', ''),
    baseUrl: settings.get('sms.ippanel_base_url', 'https://edge.ippanel.com/v1'),
    fromNumber: settings.get('sms.from_number', ''),
  });
}

function eventDef(key) {
  return registry.allSmsEvents().find((e) => e.key === key);
}

/** اطمینان از وجود ردیف پترن برای همه رویدادها */
async function ensurePatterns() {
  const existing = new Set(await db('sms_patterns').pluck('event_key'));
  const now = jalali.now();
  for (const e of registry.allSmsEvents()) {
    if (existing.has(e.key)) continue;
    await db('sms_patterns').insert({ event_key: e.key, pattern_code: '', is_active: false, variables: JSON.stringify(e.defaultVars || []), updated_at: now });
  }
}

async function getPattern(eventKey) {
  return db('sms_patterns').where({ event_key: eventKey }).first();
}

const money = (n) => formatNumber(n, false);
const jd = (g) => (g ? jalali.toJalali(g) : '');

/** ساخت توکن‌ها از روی داده‌های زمینه */
function buildTokens(ctx = {}) {
  const t = {
    institute_name: settings.get('general.institute_name', ''),
    institute_phone: settings.get('general.phone', '') || settings.get('general.mobile', ''),
    site_url: siteUrl(''),
    login_url: siteUrl('/login'),
    today: jalali.toJalali(jalali.today()),
    currency: settings.get('finance.currency', 'تومان'),
  };
  const u = ctx.user || ctx.prereg;
  if (u) {
    Object.assign(t, {
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim(), first_name: u.first_name || '', last_name: u.last_name || '',
      mobile: u.mobile || '', username: u.username || '', national_code: u.national_code || '',
    });
  }
  if (ctx.cls) {
    const { weekDaysLabel } = require('../classes/service');
    Object.assign(t, {
      class_title: ctx.cls.title, class_code: ctx.cls.code, start_date: jd(ctx.cls.start_date), start_time: ctx.cls.start_time || '',
      end_time: ctx.cls.end_time || '', week_days: weekDaysLabel(ctx.cls.week_days), location: ctx.cls.location || '',
    });
  }
  if (ctx.session) {
    Object.assign(t, { session_date: jd(ctx.session.date), session_time: ctx.session.start_time || '', session_no: ctx.session.session_no || '' });
  }
  if (ctx.invoice) {
    Object.assign(t, { invoice_no: ctx.invoice.invoice_no, remaining: money(Number(ctx.invoice.total) - Number(ctx.invoice.paid)) });
  }
  if (ctx.installment) {
    const rem = Number(ctx.installment.amount) - Number(ctx.installment.paid_amount || 0);
    Object.assign(t, { installment_no: ctx.installment.seq, due_date: jd(ctx.installment.due_date), amount: money(rem), amount_raw: rem });
  }
  if (ctx.payment) {
    Object.assign(t, { amount: money(ctx.payment.amount), amount_raw: Number(ctx.payment.amount), tracking_code: ctx.payment.tracking_code || '' });
  }
  if (ctx.prereg) t.tracking_code = ctx.prereg.tracking_code;
  if (ctx.certificate) {
    Object.assign(t, { serial: ctx.certificate.serial, verify_code: ctx.certificate.verify_code, verify_url: siteUrl(`/verify/${ctx.certificate.verify_code}`) });
  }
  return Object.assign(t, ctx.extra || {});
}

function buildParams(variables, tokens) {
  const params = {};
  for (const v of variables || []) {
    if (!v || !v.name) continue;
    params[String(v.name).trim()] = fillTemplate(v.value, tokens).trim().slice(0, 200) || '-';
  }
  return params;
}

async function log(entry) {
  try {
    return await insertId('sms_logs', Object.assign({ created_at: jalali.now() }, entry, {
      params: entry.params ? JSON.stringify(entry.params) : null,
      error: entry.error ? String(entry.error).slice(0, 1000) : null,
      message: entry.message ? String(entry.message).slice(0, 2000) : null,
    }));
  } catch (e) {
    console.error('[sms] log failed:', e.message);
    return null;
  }
}

function isEnabled() {
  return !!settings.get('sms.enabled', false);
}

/** ارسال پترن به یک شماره */
async function sendPattern({ mobile, code, params, eventKey = null, userId = null, actorId = null, force = false }) {
  const recipient = toE164(mobile);
  const base = { mobile: normalizeMobile(mobile), event_key: eventKey, type: 'pattern', pattern_code: code, params, user_id: userId, created_by: actorId };
  if (!recipient) return { ok: false, id: await log(Object.assign(base, { status: 'failed', error: 'شماره موبایل نامعتبر است' })) };
  if (!isEnabled() && !force) return { ok: false, skipped: true };
  try {
    const out = await provider().sendPattern({ code, recipient, params });
    const id = await log(Object.assign(base, { status: 'sent', provider_id: String(out.ids[0] || '').slice(0, 100) }));
    return { ok: true, id, ids: out.ids };
  } catch (e) {
    const id = await log(Object.assign(base, { status: 'failed', error: e.message }));
    return { ok: false, id, error: e.message };
  }
}

/** ارسال پیامک متنی به چند شماره (دسته‌های ۱۰۰تایی) */
async function sendText({ mobiles, message, eventKey = 'bulk.text', actorId = null, userIds = {} }) {
  const valid = [...new Set(mobiles.map((m) => toE164(m)).filter(Boolean))];
  const results = { sent: 0, failed: 0 };
  for (let i = 0; i < valid.length; i += 100) {
    const batch = valid.slice(i, i + 100);
    try {
      const out = await provider().sendText({ message, recipients: batch });
      for (const r of batch) {
        const m = '0' + r.slice(3);
        await log({ mobile: m, user_id: userIds[m] || null, event_key: eventKey, type: 'text', message, status: 'sent', provider_id: String(out.ids[0] || ''), created_by: actorId });
      }
      results.sent += batch.length;
    } catch (e) {
      for (const r of batch) await log({ mobile: '0' + r.slice(3), user_id: userIds['0' + r.slice(3)] || null, event_key: eventKey, type: 'text', message, status: 'failed', error: e.message, created_by: actorId });
      results.failed += batch.length;
    }
  }
  return results;
}

/** ارسال پیامک یک رویداد بر اساس پترن تنظیم‌شده */
async function dispatch(eventKey, ctx = {}) {
  if (!isEnabled()) return { skipped: 'disabled' };
  const pattern = await getPattern(eventKey);
  if (!pattern || !pattern.is_active || !pattern.pattern_code) return { skipped: 'inactive' };
  const def = eventDef(eventKey) || {};
  const tokens = buildTokens(ctx);
  const params = buildParams(safeJson(pattern.variables, []), tokens);
  let targets = [];
  if (def.recipient === 'مدیران') {
    targets = (settings.get('sms.admin_mobiles', []) || []).map((m) => ({ mobile: m, userId: null }));
  } else {
    const u = ctx.user || ctx.prereg;
    if (u && u.mobile) targets = [{ mobile: u.mobile, userId: ctx.user ? ctx.user.id : null }];
  }
  const results = [];
  for (const t of targets) results.push(await sendPattern({ mobile: t.mobile, code: pattern.pattern_code, params, eventKey, userId: t.userId }));
  return { sent: results.filter((r) => r.ok).length, results };
}

/** بارگذاری داده‌های لازم هر رویداد از روی شناسه‌ها */
async function resolveContext(eventKey, p = {}) {
  const ctx = { extra: Object.assign({}, p.extra || {}) };
  if (p.user) ctx.user = p.user;
  if (p.cls) ctx.cls = p.cls;
  if (p.session) ctx.session = p.session;
  if (p.code) ctx.extra.code = p.code;
  if (p.password) ctx.extra.password = p.password;
  if (p.reason) ctx.extra.reason = p.reason;
  if (p.installmentId) {
    ctx.installment = await db('installments').where({ id: p.installmentId }).first();
    if (ctx.installment) p.invoiceId = ctx.installment.invoice_id;
  }
  if (p.paymentId) {
    ctx.payment = await db('payments').where({ id: p.paymentId }).first();
    if (ctx.payment) p.invoiceId = ctx.payment.invoice_id;
  }
  if (p.invoiceId) {
    ctx.invoice = await db('invoices').where({ id: p.invoiceId }).first();
    if (ctx.invoice) {
      if (!ctx.user) ctx.user = await db('users').where({ id: ctx.invoice.user_id }).first();
      if (!ctx.cls && ctx.invoice.class_id) ctx.cls = await db('classes').where({ id: ctx.invoice.class_id }).first();
      if (eventKey === 'invoice.created') {
        const items = await db('installments').where({ invoice_id: ctx.invoice.id }).orderBy('seq');
        Object.assign(ctx.extra, {
          amount: money(ctx.invoice.total), amount_raw: Number(ctx.invoice.total), installments_count: items.length,
          first_due_date: items[0] ? jd(items[0].due_date) : '',
        });
      }
    }
  }
  if (p.preregId) {
    ctx.prereg = await db('preregistrations').where({ id: p.preregId }).first();
    if (ctx.prereg && ctx.prereg.class_id && !ctx.cls) ctx.cls = await db('classes').where({ id: ctx.prereg.class_id }).first();
    if (ctx.prereg && !ctx.cls) ctx.extra.class_title = ctx.extra.class_title || 'دوره‌های آموزشی';
  }
  if (p.certificateId) {
    ctx.certificate = await db('certificates').where({ id: p.certificateId }).first();
    if (ctx.certificate) {
      if (!ctx.user) ctx.user = await db('users').where({ id: ctx.certificate.user_id }).first();
      if (!ctx.cls && ctx.certificate.class_id) ctx.cls = await db('classes').where({ id: ctx.certificate.class_id }).first();
    }
  }
  if (p.enrollmentId && !ctx.cls) {
    const e = await db('enrollments').where({ id: p.enrollmentId }).first();
    if (e) ctx.cls = await db('classes').where({ id: e.class_id }).first();
  }
  return ctx;
}

/** داده نمونه برای پیش‌نمایش و تست */
function sampleTokens() {
  return buildTokens({
    user: { first_name: 'علی', last_name: 'رضایی', mobile: '09121234567', username: '09121234567', national_code: '0012345679' },
    cls: { title: 'دوره برنامه‌نویسی پایتون', code: 'CL-0001', start_date: jalali.today(), start_time: '16:00', end_time: '18:00', week_days: '6,1', location: 'کلاس ۲' },
    session: { date: jalali.addDays(jalali.today(), 1), start_time: '16:00', session_no: 5 },
    invoice: { invoice_no: 'INV-1403-00012', total: 12000000, paid: 4000000 },
    installment: { seq: 2, due_date: jalali.addDays(jalali.today(), 3), amount: 4000000, paid_amount: 0 },
    certificate: { serial: 'CRT-140300001', verify_code: 'AB12CD34EF' },
    extra: { code: '482915', password: 'Pass1234', tracking_code: '73519246', reason: 'تصویر رسید خوانا نیست', absent_count: 2, days_left: 3, days_late: 5, installments_count: 3, first_due_date: jalali.toJalali(jalali.today()) },
  });
}

module.exports = {
  provider, ensurePatterns, getPattern, buildTokens, buildParams, sendPattern, sendText, dispatch, resolveContext, sampleTokens,
  eventDef, isEnabled, TOKEN_LABELS, COMMON_TOKENS,
};
