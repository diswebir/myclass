'use strict';
const path = require('path');
const { db, paginate } = require('../../core/db');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');
const { requirePerm, scopeClassIds, applyClassScope } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { str, text, int, bool, httpError, safeJson, normalizeMobile, isMobile, toEnDigits } = require('../../core/utils');
const svc = require('./service');

const v = (name) => path.join(__dirname, 'views', name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = (r) => {
  /* ------------------------------ داشبورد پیامک ------------------------------ */
  r.get('/sms', requirePerm('sms.view', 'sms.send', 'sms.patterns'), async (req, res) => {
    await svc.ensurePatterns();
    const today = jalali.today();
    const from30 = jalali.addDays(today, -29);
    const rows = await db('sms_logs').where('created_at', '>=', from30 + ' 00:00:00').select('created_at', 'status');
    const days = [];
    for (let i = 0; i < 30; i++) days.push(jalali.addDays(from30, i));
    const sent = days.map((d) => rows.filter((x) => String(x.created_at).startsWith(d) && x.status === 'sent').length);
    const failed = days.map((d) => rows.filter((x) => String(x.created_at).startsWith(d) && x.status === 'failed').length);
    const todayCount = rows.filter((x) => String(x.created_at).startsWith(today)).length;
    const total30 = rows.length;
    const failed30 = rows.filter((x) => x.status === 'failed').length;
    const patterns = await db('sms_patterns');
    const activeCount = patterns.filter((p) => p.is_active && p.pattern_code).length;
    const recent = await db('sms_logs as l').leftJoin('users as u', 'u.id', 'l.user_id').select('l.*', 'u.first_name', 'u.last_name').orderBy('l.id', 'desc').limit(10);
    const byEvent = {};
    (await db('sms_logs').where('created_at', '>=', from30 + ' 00:00:00').groupBy('event_key').select('event_key').count({ c: '*' }))
      .forEach((x) => { byEvent[x.event_key || 'other'] = Number(x.c); });
    res.page(v('dashboard'), {
      title: 'پنل پیامک', labels: days.map((d) => jalali.toJalali(d).slice(5)), sent, failed, todayCount, total30, failed30,
      activeCount, totalEvents: registry.allSmsEvents().length, recent, byEvent, events: registry.allSmsEvents(),
      configured: !!(settings.get('sms.ippanel_api_key') && settings.get('sms.from_number')), enabled: svc.isEnabled(),
      breadcrumbs: [{ label: 'پیامک' }],
    });
  });

  r.get('/sms/api/credit', requirePerm('sms.view', 'sms.patterns'), async (req, res) => {
    try {
      const c = await svc.provider().credit();
      res.json({ ok: true, credit: c.credit, updated_at: c.updated_at, test: !!c.test });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  /* ------------------------------ پترن‌ها ------------------------------ */
  r.get('/sms/patterns', requirePerm('sms.patterns'), async (req, res) => {
    await svc.ensurePatterns();
    const rows = {};
    (await db('sms_patterns')).forEach((p) => { rows[p.event_key] = Object.assign(p, { vars: safeJson(p.variables, []) }); });
    const groups = {};
    for (const e of registry.allSmsEvents()) {
      const g = e.group || 'سایر';
      (groups[g] = groups[g] || []).push(Object.assign({}, e, { pattern: rows[e.key], moduleEnabled: registry.isEnabled(e.module) }));
    }
    res.page(v('patterns'), { title: 'پترن‌های پیامک', groups, breadcrumbs: [{ label: 'پیامک', href: '/panel/sms' }, { label: 'پترن‌ها' }] });
  });

  r.get('/sms/patterns/:key', requirePerm('sms.patterns'), async (req, res, next) => {
    await svc.ensurePatterns();
    const def = svc.eventDef(req.params.key);
    if (!def) return next(httpError(404, 'رویداد یافت نشد.'));
    const pattern = await svc.getPattern(def.key);
    const vars = safeJson(pattern.variables, []);
    const sample = svc.sampleTokens();
    const tokens = [...new Set([...(def.tokens || []), ...Object.keys(svc.COMMON_TOKENS)])];
    res.page(v('pattern-form'), {
      title: `پترن: ${def.label}`, def, pattern, vars, tokens, labels: svc.TOKEN_LABELS, sample,
      preview: svc.buildParams(vars, sample),
      breadcrumbs: [{ label: 'پیامک', href: '/panel/sms' }, { label: 'پترن‌ها', href: '/panel/sms/patterns' }, { label: def.label }],
    });
  });

  const readVars = (body) => {
    const list = body.vars ? (Array.isArray(body.vars) ? body.vars : Object.values(body.vars)) : [];
    return list.map((x) => ({ name: str(x.name, 50).replace(/[^\w-]/g, ''), value: text(x.value, 300) })).filter((x) => x.name);
  };

  r.post('/sms/patterns/:key', requirePerm('sms.patterns'), async (req, res, next) => {
    const def = svc.eventDef(req.params.key);
    if (!def) return next(httpError(404));
    const vars = readVars(req.body);
    await db('sms_patterns').where({ event_key: def.key }).update({
      pattern_code: str(req.body.pattern_code, 100), is_active: bool(req.body.is_active), variables: JSON.stringify(vars),
      note: str(req.body.note, 255) || null, updated_by: req.user.id, updated_at: jalali.now(),
    });
    await audit(req, 'sms.pattern_update', 'sms_pattern', null, { event: def.key, active: bool(req.body.is_active) });
    req.flash('success', 'تنظیمات پترن ذخیره شد.');
    res.go(`/panel/sms/patterns/${def.key}`);
  });

  r.post('/sms/patterns/:key/test', requirePerm('sms.patterns'), async (req, res, next) => {
    const def = svc.eventDef(req.params.key);
    if (!def) return next(httpError(404));
    const mobile = normalizeMobile(req.body.mobile || settings.get('sms.test_mobile', ''));
    const code = str(req.body.pattern_code, 100);
    if (!isMobile(mobile)) { req.flash('error', 'شماره موبایل آزمایشی معتبر نیست.'); return res.go(`/panel/sms/patterns/${def.key}`); }
    if (!code) { req.flash('error', 'کد پترن را وارد کنید.'); return res.go(`/panel/sms/patterns/${def.key}`); }
    const params = svc.buildParams(readVars(req.body), svc.sampleTokens());
    const out = await svc.sendPattern({ mobile, code, params, eventKey: `test:${def.key}`, actorId: req.user.id, force: true });
    if (out.ok) req.flash('success', `پیامک آزمایشی به ${mobile} ارسال شد.`);
    else req.flash('error', `ارسال ناموفق: ${out.error || 'نامشخص'}`);
    res.go(`/panel/sms/patterns/${def.key}`);
  });

  /** دریافت مشخصات پترن از IPPanel (برای پر کردن خودکار متغیرها) */
  r.get('/sms/api/patterns', requirePerm('sms.patterns'), async (req, res) => {
    try {
      const code = str(req.query.code, 100);
      const out = await svc.provider().patterns({ code: code || undefined, perPage: 100 });
      res.json({
        ok: true,
        data: (out.data || []).map((p) => ({
          code: p.pattern_code, message: p.pattern_message, status: p.pattern_status, status_fa: p.pattern_status_fa, title: p.title,
          variables: (p.variable || []).map((x) => ({ name: x.name, type: x.type, len: x.len })),
        })),
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  /* ------------------------------ ارسال گروهی ------------------------------ */
  r.get('/sms/send', requirePerm('sms.send'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const cq = db('classes').whereNot('status', 'canceled').select('id', 'title', 'status').orderBy('id', 'desc');
    applyClassScope(cq, 'id', ids);
    const roles = await db('roles').orderBy('id');
    const patterns = (await db('sms_patterns').whereNot('pattern_code', '').whereNotNull('pattern_code')).map((p) => ({ code: p.pattern_code, event: p.event_key }));
    res.page(v('send'), {
      title: 'ارسال پیامک گروهی', classes: await cq, roles, patterns, labels: svc.TOKEN_LABELS, scoped: ids !== null,
      preClass: int(req.query.class) || null, enabled: svc.isEnabled(),
      breadcrumbs: [{ label: 'پیامک', href: '/panel/sms' }, { label: 'ارسال گروهی' }],
    });
  });

  async function resolveRecipients(req) {
    const b = req.body;
    const ids = await scopeClassIds(req);
    let users = [];
    const type = b.target;
    if (type === 'class') {
      const classIds = [].concat(b.class_ids || []).map((x) => int(x)).filter(Boolean).filter((id) => !ids || ids.includes(id));
      const statuses = [].concat(b.enroll_status || ['active']);
      if (classIds.length) {
        users = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').join('classes as c', 'c.id', 'e.class_id')
          .whereIn('e.class_id', classIds).whereIn('e.status', statuses).select('u.*', 'c.id as class_id', 'c.title as class_title', 'c.code as class_code');
      }
    } else if (type === 'role' && ids === null) {
      const roleIds = [].concat(b.role_ids || []).map((x) => int(x)).filter(Boolean);
      if (roleIds.length) users = await db('users').whereIn('role_id', roleIds).where('is_active', true);
    } else if (type === 'debtors' && ids === null && registry.isEnabled('finance')) {
      users = await db('users as u').whereIn('u.id', db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id')
        .whereNot('i.status', 'canceled').whereIn('it.status', ['pending', 'partial', 'overdue']).where('it.due_date', '<', jalali.today()).select('i.user_id')).select('u.*');
    } else if (type === 'custom') {
      const nums = toEnDigits(b.numbers || '').split(/[\s,،;]+/).map((x) => normalizeMobile(x)).filter((x) => isMobile(x));
      users = nums.map((m) => ({ id: null, mobile: m, first_name: '', last_name: '' }));
    }
    const seen = new Set();
    return users.filter((u) => u.mobile && isMobile(u.mobile) && !seen.has(normalizeMobile(u.mobile)) && seen.add(normalizeMobile(u.mobile)));
  }

  r.post('/sms/send/preview', requirePerm('sms.send'), async (req, res) => {
    const list = await resolveRecipients(req);
    res.json({ count: list.length, sample: list.slice(0, 8).map((u) => ({ name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—', mobile: u.mobile })) });
  });

  r.post('/sms/send', requirePerm('sms.send'), async (req, res) => {
    if (!svc.isEnabled()) { req.flash('error', 'ارسال پیامک در تنظیمات غیرفعال است.'); return res.go('/panel/sms/send'); }
    const list = await resolveRecipients(req);
    if (!list.length) { req.flash('error', 'هیچ گیرنده معتبری یافت نشد.'); return res.go('/panel/sms/send'); }
    if (list.length > 5000) { req.flash('error', 'حداکثر ۵۰۰۰ گیرنده در هر ارسال مجاز است.'); return res.go('/panel/sms/send'); }
    const mode = req.body.mode === 'text' ? 'text' : 'pattern';
    const actorId = req.user.id;
    if (mode === 'pattern') {
      const code = str(req.body.pattern_code, 100);
      const vars = (req.body.vars ? (Array.isArray(req.body.vars) ? req.body.vars : Object.values(req.body.vars)) : [])
        .map((x) => ({ name: str(x.name, 50).replace(/[^\w-]/g, ''), value: text(x.value, 300) })).filter((x) => x.name);
      if (!code) { req.flash('error', 'کد پترن را وارد کنید.'); return res.go('/panel/sms/send'); }
      const delay = Number(settings.get('sms.bulk_delay_ms', 150));
      // ارسال در پس‌زمینه
      setImmediate(async () => {
        for (const u of list) {
          const tokens = svc.buildTokens({ user: u, cls: u.class_id ? { title: u.class_title, code: u.class_code } : null });
          await svc.sendPattern({ mobile: u.mobile, code, params: svc.buildParams(vars, tokens), eventKey: 'bulk.pattern', userId: u.id, actorId });
          if (delay) await sleep(delay);
        }
      });
    } else {
      const message = text(req.body.message, 1000);
      if (!message) { req.flash('error', 'متن پیامک را وارد کنید.'); return res.go('/panel/sms/send'); }
      const personalized = /\{[a-z_]+\}/.test(message);
      setImmediate(async () => {
        if (!personalized) {
          const userIds = {};
          list.forEach((u) => { if (u.id) userIds[normalizeMobile(u.mobile)] = u.id; });
          await svc.sendText({ mobiles: list.map((u) => u.mobile), message, actorId, userIds });
        } else {
          for (const u of list) {
            const tokens = svc.buildTokens({ user: u, cls: u.class_id ? { title: u.class_title, code: u.class_code } : null });
            await svc.sendText({ mobiles: [u.mobile], message: require('../../core/utils').fillTemplate(message, tokens), actorId, userIds: { [normalizeMobile(u.mobile)]: u.id } });
          }
        }
      });
    }
    await audit(req, 'sms.bulk_send', null, null, { mode, count: list.length, target: req.body.target });
    req.flash('success', `ارسال پیامک برای ${list.length} گیرنده آغاز شد. نتیجه را در گزارش ارسال ببینید.`);
    res.go('/panel/sms/logs');
  });

  /* ------------------------------ گزارش ارسال ------------------------------ */
  r.get('/sms/logs', requirePerm('sms.view'), async (req, res) => {
    const q = db('sms_logs as l').leftJoin('users as u', 'u.id', 'l.user_id').select('l.*', 'u.first_name', 'u.last_name').orderBy('l.id', 'desc');
    if (req.query.status) q.where('l.status', str(req.query.status, 20));
    if (req.query.event) q.where('l.event_key', str(req.query.event, 100));
    if (req.query.mobile) q.where('l.mobile', 'like', `%${toEnDigits(str(req.query.mobile, 20))}%`);
    if (req.query.from) { const g = jalali.fromJalali(req.query.from); if (g) q.where('l.created_at', '>=', g + ' 00:00:00'); }
    if (req.query.to) { const g = jalali.fromJalali(req.query.to); if (g) q.where('l.created_at', '<=', g + ' 23:59:59'); }
    const data = await paginate(q, req.query.page, 30);
    const eventKeys = await db('sms_logs').distinct('event_key').pluck('event_key');
    const labels = {};
    registry.allSmsEvents().forEach((e) => { labels[e.key] = e.label; });
    Object.assign(labels, { 'bulk.pattern': 'ارسال گروهی (پترن)', 'bulk.text': 'ارسال گروهی (متنی)' });
    res.page(v('logs'), { title: 'گزارش ارسال پیامک', data, eventKeys, labels, breadcrumbs: [{ label: 'پیامک', href: '/panel/sms' }, { label: 'گزارش ارسال' }] });
  });

  r.post('/sms/logs/:id/resend', requirePerm('sms.send'), async (req, res, next) => {
    const l = await db('sms_logs').where({ id: int(req.params.id) }).first();
    if (!l) return next(httpError(404));
    let out;
    if (l.type === 'pattern') out = await svc.sendPattern({ mobile: l.mobile, code: l.pattern_code, params: safeJson(l.params, {}), eventKey: l.event_key, userId: l.user_id, actorId: req.user.id });
    else { const r2 = await svc.sendText({ mobiles: [l.mobile], message: l.message, eventKey: l.event_key, actorId: req.user.id }); out = { ok: r2.sent > 0 }; }
    req.flash(out.ok ? 'success' : 'error', out.ok ? 'پیامک مجدداً ارسال شد.' : `ارسال ناموفق: ${out.error || ''}`);
    res.go('/panel/sms/logs');
  });
};
