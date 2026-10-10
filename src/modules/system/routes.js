'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { db, paginate } = require('../../core/db');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const config = require('../../core/config');
const jalali = require('../../core/jalali');
const migrator = require('../../core/migrator');
const scheduler = require('../../core/scheduler');
const { requirePerm } = require('../../core/auth');
const { uploader, removeFile } = require('../../core/upload');
const { audit } = require('../../core/audit');
const { str, text, int, bool, httpError, randomToken, safeEqual, toEnDigits } = require('../../core/utils');

const v = (name) => path.join(__dirname, 'views', name);

/** تبدیل مقدار ارسالی فرم بر اساس نوع فیلد */
function parseField(field, body, files) {
  const raw = body[field.key];
  switch (field.type) {
    case 'toggle': return bool(raw);
    case 'number': {
      let n = int(raw, field.default || 0);
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      return n;
    }
    case 'textarea': return text(raw, field.max || 20000);
    case 'color': return /^#[0-9a-fA-F]{6}$/.test(raw || '') ? raw : field.default;
    case 'select': return field.options && Object.prototype.hasOwnProperty.call(field.options, raw) ? raw : field.default;
    case 'multiselect': return [].concat(raw || []).filter((x) => field.options && field.options[x]);
    case 'tags': return String(toEnDigits(raw || '')).split(/[,،\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
    case 'time': return /^\d{2}:\d{2}$/.test(toEnDigits(raw || '')) ? toEnDigits(raw) : field.default;
    case 'password': return raw ? String(raw).trim() : undefined; // خالی = بدون تغییر
    case 'repeater': {
      const rows = [];
      const data = body[field.key] || {};
      const list = Array.isArray(data) ? data : Object.values(data);
      for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const row = {};
        let has = false;
        for (const sf of field.fields) {
          row[sf.key] = sf.type === 'toggle' ? bool(r[sf.key]) : str(toEnDigits(r[sf.key] || ''), 255);
          if (row[sf.key] && sf.type !== 'toggle') has = true;
        }
        if (has) rows.push(row);
      }
      return rows;
    }
    case 'image': {
      const f = files && files[field.key] && files[field.key][0];
      if (f) return f.relPath;
      if (bool(body[field.key + '__remove'])) return '';
      return undefined;
    }
    case 'cron': return undefined;
    default: return str(raw, field.max || 1000);
  }
}

function panel(r) {
  /* ------------------------------ تنظیمات ------------------------------ */
  r.get('/settings', requirePerm('settings.manage'), (req, res) => res.go('/panel/settings/general'));

  r.get('/settings/:tab', requirePerm('settings.manage'), async (req, res, next) => {
    const tabs = registry.settingsTabs();
    const tab = tabs.find((t) => t.key === req.params.tab);
    if (!tab) return next(httpError(404));
    if (tab.key === 'modules' && !req.user.isSuper && !req.user.perms.has('system.manage')) return next(httpError(403));
    const fields = registry.settingsFields(tab.key);
    let cronKey = settings.get('system.cron_key');
    if (tab.key === 'system' && !cronKey) {
      cronKey = randomToken(16);
      await settings.set({ 'system.cron_key': cronKey });
    }
    const values = settings.all();
    res.page(v('settings'), {
      title: 'تنظیمات - ' + tab.label,
      breadcrumbs: [{ label: 'تنظیمات', href: '/panel/settings' }, { label: tab.label }],
      tabs, tab, fields, values,
      modules: registry.all(),
      disabled: registry.disabledList(),
      hasImage: fields.some((f) => f.type === 'image'),
    });
  });

  r.post('/settings/:tab', requirePerm('settings.manage'), async (req, res, next) => {
    // آپلود پویا برای فیلدهای تصویر
    const tab = registry.settingsTabs().find((t) => t.key === req.params.tab);
    if (!tab) return next(httpError(404));
    const fields = registry.settingsFields(tab.key);
    const imageFields = fields.filter((f) => f.type === 'image').map((f) => ({ name: f.key, maxCount: 1 }));
    const isMultipart = (req.get('content-type') || '').startsWith('multipart/form-data');
    const chain = isMultipart ? uploader('public', { types: ['jpg', 'png', 'webp', 'gif'], maxMB: 3, fields: imageFields }) : [];
    const run = (i) => {
      if (i >= chain.length) return save();
      chain[i](req, res, (err) => (err ? next(err) : run(i + 1)));
    };
    const save = async () => {
      try {
        if (tab.key === 'modules') {
          if (!req.user.isSuper && !req.user.perms.has('system.manage')) throw httpError(403);
          const enabled = [].concat(req.body.enabled || []);
          const disabled = registry.all().filter((m) => !m.core && !enabled.includes(m.key)).map((m) => m.key);
          await settings.set({ 'modules.disabled': disabled });
          await audit(req, 'settings.modules', 'settings', null, { disabled });
          req.flash('success', 'وضعیت ماژول‌ها ذخیره شد.');
          return res.go('/panel/settings/modules');
        }
        const values = {};
        const old = settings.all();
        for (const f of fields) {
          if (!f.key) continue;
          if (f.readonly) continue;
          const val = parseField(f, req.body, req.files);
          if (val === undefined) continue;
          if (f.required && (val === '' || val === null)) throw httpError(422, `فیلد «${f.label}» الزامی است.`);
          if (f.type === 'image' && old[f.key] && old[f.key] !== val) removeFile(old[f.key]);
          values[f.key] = val;
        }
        await settings.set(values);
        if (values['general.timezone']) jalali.setTimezone(values['general.timezone']);
        await audit(req, 'settings.update', 'settings', null, { tab: tab.key, keys: Object.keys(values).filter((k) => !/password|api_key|secret/i.test(k)) });
        req.flash('success', 'تنظیمات با موفقیت ذخیره شد.');
        res.go('/panel/settings/' + tab.key);
      } catch (e) {
        next(e);
      }
    };
    run(0);
  });

  r.post('/settings/system/cron-key', requirePerm('system.manage'), async (req, res) => {
    await settings.set({ 'system.cron_key': randomToken(16) });
    await audit(req, 'settings.cron_key_regenerated');
    req.flash('success', 'کلید جدید Cron ساخته شد. دستور Cron Job سی‌پنل را به‌روزرسانی کنید.');
    res.go('/panel/settings/system');
  });

  /* ------------------------------ ابزارهای سیستم ------------------------------ */
  r.get('/system', requirePerm('system.manage'), async (req, res) => {
    const status = await migrator.status();
    const cfg = config.load();
    let errorLog = '';
    const logFile = path.join(config.paths.logs, 'error.log');
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      errorLog = content.slice(-6000);
    }
    const tables = ['users', 'classes', 'enrollments', 'class_sessions', 'attendances', 'invoices', 'payments', 'certificates', 'sms_logs', 'audit_logs'];
    const counts = {};
    for (const t of tables) {
      try { counts[t] = Number((await db(t).count({ c: '*' }).first()).c); } catch (e) { counts[t] = '-'; }
    }
    let uploadsSize = 0;
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else uploadsSize += fs.statSync(p).size;
      }
    };
    walk(config.paths.uploads);
    let dbVersion = '';
    try {
      if (cfg.db.client === 'sqlite') dbVersion = 'SQLite';
      else { const [rows] = await db.raw('select version() as v'); dbVersion = rows[0].v; }
    } catch (e) { dbVersion = '?'; }
    res.page(v('system'), {
      title: 'ابزارهای سیستم',
      breadcrumbs: [{ label: 'سیستم' }],
      status, cfg, errorLog, counts, uploadsSize, dbVersion,
      info: {
        node: process.version, platform: `${os.type()} ${os.release()}`, memory: Math.round(process.memoryUsage().rss / 1048576),
        uptime: Math.round(process.uptime() / 60), pid: process.pid, passenger: !!process.env.PASSENGER_APP_ENV || typeof PhusionPassenger !== 'undefined',
      },
      scheduler: { last: settings.get('scheduler.last_run'), state: settings.get('scheduler.state', {}) },
      tasks: registry.enabled().flatMap((m) => m.tasks.map((t) => ({ key: `${m.key}.${t.key}`, label: t.label, every: t.everyMinutes }))),
    });
  });

  r.post('/system/migrate', requirePerm('system.manage'), async (req, res) => {
    const out = await migrator.latest();
    await audit(req, 'system.migrate', null, null, out);
    req.flash('success', out.log.length ? `${out.log.length} به‌روزرسانی پایگاه داده اعمال شد.` : 'پایگاه داده به‌روز است.');
    res.go('/panel/system');
  });

  r.post('/system/scheduler', requirePerm('system.manage'), async (req, res) => {
    await db('settings').where({ key: 'lock.scheduler' }).del();
    const state = settings.get('scheduler.state', {});
    if (bool(req.body.force)) await settings.set({ 'scheduler.state': {} });
    const out = await scheduler.runAll('manual');
    if (out.skipped) req.flash('warning', 'زمان‌بند در حال اجراست؛ کمی بعد تلاش کنید.');
    else req.flash('success', `زمان‌بند اجرا شد (${out.results.length} وظیفه).`);
    if (!bool(req.body.force) && state) { /* keep */ }
    res.go('/panel/system');
  });

  r.post('/system/restart', requirePerm('system.manage'), async (req, res) => {
    fs.mkdirSync(config.paths.tmp, { recursive: true });
    fs.writeFileSync(path.join(config.paths.tmp, 'restart.txt'), String(Date.now()));
    await audit(req, 'system.restart');
    req.flash('success', 'درخواست راه‌اندازی مجدد ثبت شد. برنامه در درخواست بعدی مجدداً بارگذاری می‌شود.');
    res.go('/panel/system');
  });

  r.post('/system/clear-log', requirePerm('system.manage'), async (req, res) => {
    const f = path.join(config.paths.logs, 'error.log');
    if (fs.existsSync(f)) fs.writeFileSync(f, '');
    req.flash('success', 'گزارش خطاها پاک شد.');
    res.go('/panel/system');
  });

  r.post('/system/sessions/clear', requirePerm('system.manage'), async (req, res) => {
    const n = await db('sessions').whereNot({ sid: req.sessionID }).del();
    await audit(req, 'system.sessions_cleared', null, null, { count: n });
    req.flash('success', `${n} نشست فعال (به جز نشست شما) پایان یافت.`);
    res.go('/panel/system');
  });

  /** پشتیبان کامل JSON از همه جداول */
  r.get('/system/backup', requirePerm('system.manage'), async (req, res) => {
    const skip = new Set(['sessions', 'knex_migrations_lock']);
    let tables;
    const cfg = config.load();
    if (cfg.db.client === 'sqlite') {
      tables = (await db.raw("select name from sqlite_master where type='table' and name not like 'sqlite_%'")).map((x) => x.name);
    } else {
      const [rows] = await db.raw('show tables');
      tables = rows.map((x) => Object.values(x)[0]);
    }
    const out = { app: 'myclass', version: res.locals.appVersion, created_at: jalali.now(), tables: {} };
    for (const t of tables) {
      if (skip.has(t)) continue;
      out.tables[t] = await db(t).select('*');
    }
    await audit(req, 'system.backup');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="myclass-backup-${jalali.toJalali(jalali.today(), '-')}.json"`);
    res.send(JSON.stringify(out));
  });

  /* ------------------------------ گزارش فعالیت ------------------------------ */
  r.get('/audit', requirePerm('audit.view'), async (req, res) => {
    const q = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id')
      .select('a.*', 'u.first_name', 'u.last_name', 'u.username').orderBy('a.id', 'desc');
    if (req.query.user) q.where('a.user_id', int(req.query.user));
    if (req.query.action) q.where('a.action', 'like', `%${str(req.query.action, 50)}%`);
    if (req.query.from) { const g = jalali.fromJalali(req.query.from); if (g) q.where('a.created_at', '>=', g + ' 00:00:00'); }
    if (req.query.to) { const g = jalali.fromJalali(req.query.to); if (g) q.where('a.created_at', '<=', g + ' 23:59:59'); }
    const data = await paginate(q, req.query.page, 30);
    res.page(v('audit'), { title: 'گزارش فعالیت‌ها', breadcrumbs: [{ label: 'گزارش فعالیت‌ها' }], data });
  });
}

function pub(r) {
  /** فراخوانی از Cron Job سی‌پنل: wget -q -O /dev/null "https://site/cron/KEY" */
  r.get('/cron/:key', async (req, res) => {
    const key = settings.get('system.cron_key');
    if (!key || !safeEqual(req.params.key, key)) return res.status(403).json({ error: 'invalid key' });
    const out = await scheduler.runAll('cron');
    res.json(out);
  });
}

module.exports = { panel, public: pub, parseField };
