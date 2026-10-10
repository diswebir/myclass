'use strict';
const path = require('path');
const rateLimit = require('express-rate-limit');
const { db, insertId, paginate } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const { requirePerm, can, scopeClassIds, applyClassScope, assertClassAccess } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { uploader } = require('../../core/upload');
const { str, text, int, bool, httpError, toEnDigits } = require('../../core/utils');
const svc = require('./service');

const v = (name) => path.join(__dirname, 'views', name);

async function loadCert(req, id) {
  const c = await db('certificates as c').join('users as u', 'u.id', 'c.user_id').leftJoin('classes as cl', 'cl.id', 'c.class_id')
    .select('c.*', 'u.first_name', 'u.last_name', 'u.mobile', 'cl.title as class_title').where('c.id', id).first();
  if (!c) throw httpError(404, 'مدرک یافت نشد.');
  return c;
}

/** رندر صفحه چاپ مدرک (مشترک بین پنل مدیریت و پنل دانشجو) */
async function renderCertificate(req, res, cert) {
  const data = await svc.renderData(cert, req);
  res.render(v('print'), Object.assign({ cert, title: `مدرک ${cert.serial}` }, data));
}

function readDesign(b) {
  const d = Object.assign({}, svc.DEFAULT_DESIGN);
  d.orientation = b.orientation === 'portrait' ? 'portrait' : 'landscape';
  d.theme = ['classic', 'modern', 'minimal', 'elegant'].includes(b.theme) ? b.theme : 'classic';
  d.primary_color = /^#[0-9a-fA-F]{6}$/.test(b.primary_color || '') ? b.primary_color : d.primary_color;
  d.accent_color = /^#[0-9a-fA-F]{6}$/.test(b.accent_color || '') ? b.accent_color : d.accent_color;
  d.title = str(b.title, 150);
  d.subtitle = str(b.subtitle, 150);
  d.body = text(b.body, 3000);
  d.footer = text(b.footer, 500);
  d.border = ['double', 'single', 'ornate', 'none'].includes(b.border) ? b.border : 'double';
  d.show_logo = bool(b.show_logo);
  d.show_qr = bool(b.show_qr);
  d.show_serial = bool(b.show_serial);
  const signers = b.signers ? (Array.isArray(b.signers) ? b.signers : Object.values(b.signers)) : [];
  d.signers = signers.slice(0, 3).map((s) => ({
    title: str(s.title, 80), name: str(s.name, 80), use_teacher: s.source === 'teacher', use_manager: s.source === 'manager',
  })).filter((s) => s.title || s.name || s.use_teacher || s.use_manager);
  return d;
}

function panel(r) {
  r.get('/certificates', requirePerm('certificates.view'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const q = db('certificates as c').join('users as u', 'u.id', 'c.user_id').leftJoin('classes as cl', 'cl.id', 'c.class_id')
      .select('c.*', 'u.first_name', 'u.last_name', 'cl.title as class_title').orderBy('c.id', 'desc');
    applyClassScope(q, 'c.class_id', ids);
    if (req.query.class) q.where('c.class_id', int(req.query.class));
    if (req.query.status) q.where('c.status', str(req.query.status, 20));
    if (req.query.q) {
      const t = `%${toEnDigits(str(req.query.q, 100))}%`;
      q.where((w) => w.where('c.serial', 'like', t).orWhere('c.verify_code', 'like', t).orWhere('u.first_name', 'like', t).orWhere('u.last_name', 'like', t));
    }
    const data = await paginate(q, req.query.page, settings.get('general.items_per_page', 20));
    const cq = db('classes').select('id', 'title').orderBy('id', 'desc');
    applyClassScope(cq, 'id', ids);
    const total = Number((await applyClassScope(db('certificates').where('status', 'valid'), 'class_id', ids).count({ c: '*' }).first()).c);
    res.page(v('list'), { title: 'مدارک و گواهینامه‌ها', data, classes: await cq, total, breadcrumbs: [{ label: 'مدارک' }] });
  });

  r.get('/certificates/issue', requirePerm('certificates.issue'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const cq = db('classes').whereNot('status', 'canceled').select('id', 'title', 'status').orderBy('id', 'desc');
    applyClassScope(cq, 'id', ids);
    const classes = await cq;
    const classId = int(req.query.class);
    let cls = null;
    let rows = [];
    if (classId) {
      await assertClassAccess(req, classId);
      cls = await db('classes').where({ id: classId }).first();
      const enrollments = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', classId)
        .whereNot('e.status', 'withdrawn').select('e.*', 'u.first_name', 'u.last_name', 'u.national_code').orderBy('u.last_name');
      const issued = {};
      (await db('certificates').where({ class_id: classId, status: 'valid' })).forEach((c) => { issued[c.enrollment_id] = c; });
      for (const e of enrollments) rows.push(Object.assign(e, { elig: await svc.eligibility(e, cls), cert: issued[e.id] || null }));
    }
    await svc.ensureDefaultTemplate();
    const templates = await db('certificate_templates').orderBy('is_default', 'desc').orderBy('id');
    res.page(v('issue'), {
      title: 'صدور مدرک', classes, cls, rows, templates,
      breadcrumbs: [{ label: 'مدارک', href: '/panel/certificates' }, { label: 'صدور مدرک' }],
    });
  });

  r.post('/certificates/issue', requirePerm('certificates.issue'), async (req, res) => {
    const classId = int(req.body.class_id);
    await assertClassAccess(req, classId);
    const cls = await db('classes').where({ id: classId }).first();
    const ids = [...new Set([].concat(req.body.enrollment_ids || []).map((x) => int(x)).filter(Boolean))];
    const override = bool(req.body.override);
    const issuedDate = jalali.fromJalali(req.body.issued_date) || jalali.today();
    let ok = 0;
    const errs = [];
    for (const eid of ids) {
      const e = await db('enrollments').where({ id: eid, class_id: classId }).first();
      if (!e) continue;
      if (!override) {
        const el = await svc.eligibility(e, cls);
        if (!el.ok) { const u = await db('users').where({ id: e.user_id }).first(); errs.push(`${u.first_name} ${u.last_name}: ${el.issues.join('، ')}`); continue; }
      }
      try {
        await svc.issue({ enrollmentId: eid, templateId: int(req.body.template_id) || null, issuedDate, actorId: req.user.id, notify: bool(req.body.notify) });
        ok++;
      } catch (e2) { errs.push(e2.message); }
    }
    await audit(req, 'certificates.issue', 'class', classId, { count: ok, override });
    if (ok) req.flash('success', `${ok} مدرک صادر شد.`);
    errs.slice(0, 6).forEach((e) => req.flash('warning', e));
    res.go(`/panel/certificates/issue?class=${classId}`);
  });

  r.get('/certificates/:id', requirePerm('certificates.view'), async (req, res) => {
    const cert = await loadCert(req, int(req.params.id));
    if (cert.class_id) await assertClassAccess(req, cert.class_id);
    const data = await svc.renderData(cert, req);
    res.page(v('show'), Object.assign({ title: `مدرک ${cert.serial}`, cert, breadcrumbs: [{ label: 'مدارک', href: '/panel/certificates' }, { label: cert.serial }] }, { render: data }));
  });

  r.get('/certificates/:id/print', requirePerm('certificates.view'), async (req, res) => {
    const cert = await loadCert(req, int(req.params.id));
    if (cert.class_id) await assertClassAccess(req, cert.class_id);
    await renderCertificate(req, res, cert);
  });

  r.post('/certificates/:id/revoke', requirePerm('certificates.revoke'), async (req, res) => {
    const cert = await loadCert(req, int(req.params.id));
    if (cert.class_id) await assertClassAccess(req, cert.class_id);
    const restore = cert.status === 'revoked';
    await db('certificates').where({ id: cert.id }).update({ status: restore ? 'valid' : 'revoked', revoked_reason: restore ? null : str(req.body.reason, 255) || null, updated_at: jalali.now() });
    await audit(req, restore ? 'certificates.restore' : 'certificates.revoke', 'certificate', cert.id, { reason: req.body.reason });
    req.flash('success', restore ? 'مدرک مجدداً معتبر شد.' : 'مدرک ابطال شد.');
    res.go(`/panel/certificates/${cert.id}`);
  });

  /* ------------------------------ قالب‌ها ------------------------------ */
  r.get('/certificate-templates', requirePerm('certificates.templates'), async (req, res) => {
    await svc.ensureDefaultTemplate();
    const templates = await db('certificate_templates').orderBy('id');
    const counts = {};
    (await db('certificates').groupBy('template_id').select('template_id').count({ c: '*' })).forEach((x) => { counts[x.template_id] = Number(x.c); });
    res.page(v('templates'), {
      title: 'قالب‌های مدرک', templates: templates.map((t) => Object.assign(t, { d: svc.designOf(t) })), counts,
      breadcrumbs: [{ label: 'مدارک', href: '/panel/certificates' }, { label: 'قالب‌ها' }],
    });
  });

  r.get(['/certificate-templates/new', '/certificate-templates/:id/edit'], requirePerm('certificates.templates'), async (req, res, next) => {
    let item = null;
    if (req.params.id) {
      item = await db('certificate_templates').where({ id: int(req.params.id) }).first();
      if (!item) return next(httpError(404));
    }
    res.page(v('template-form'), {
      title: item ? `ویرایش قالب ${item.name}` : 'قالب جدید', item, design: svc.designOf(item), variables: svc.VARIABLES,
      breadcrumbs: [{ label: 'قالب‌های مدرک', href: '/panel/certificate-templates' }, { label: item ? item.name : 'قالب جدید' }],
    });
  });

  const saveTemplate = async (req, res, id) => {
    const name = str(req.body.name, 100) || 'قالب بدون نام';
    const design = readDesign(req.body);
    const old = id ? svc.designOf(await db('certificate_templates').where({ id }).first()) : {};
    design.bg_image = req.file ? req.file.relPath : (bool(req.body.bg_remove) ? '' : old.bg_image || '');
    const now = jalali.now();
    const isDefault = bool(req.body.is_default);
    if (isDefault) await db('certificate_templates').update({ is_default: false });
    if (id) await db('certificate_templates').where({ id }).update({ name, design: JSON.stringify(design), is_default: isDefault, updated_at: now });
    else id = await insertId('certificate_templates', { name, design: JSON.stringify(design), is_default: isDefault, created_at: now, updated_at: now });
    await audit(req, 'certificates.template_save', 'certificate_template', id, { name });
    req.flash('success', 'قالب ذخیره شد.');
    res.go(`/panel/certificate-templates/${id}/edit`);
  };

  const bgUpload = uploader('public/certificates', { types: ['jpg', 'png', 'webp'], maxMB: 4, field: 'bg_image' });
  r.post('/certificate-templates', requirePerm('certificates.templates'), ...bgUpload, (req, res) => saveTemplate(req, res, null));
  r.post('/certificate-templates/:id', requirePerm('certificates.templates'), ...bgUpload, (req, res) => saveTemplate(req, res, int(req.params.id)));

  r.post('/certificate-templates/:id/delete', requirePerm('certificates.templates'), async (req, res) => {
    const count = Number((await db('certificate_templates').count({ c: '*' }).first()).c);
    if (count <= 1) { req.flash('error', 'حداقل یک قالب باید وجود داشته باشد.'); return res.go('/panel/certificate-templates'); }
    await db('certificate_templates').where({ id: int(req.params.id) }).del();
    req.flash('success', 'قالب حذف شد.');
    res.go('/panel/certificate-templates');
  });

  /** پیش‌نمایش قالب با داده نمونه */
  r.get('/certificate-templates/:id/preview', requirePerm('certificates.templates'), async (req, res, next) => {
    const tpl = await db('certificate_templates').where({ id: int(req.params.id) }).first();
    if (!tpl) return next(httpError(404));
    const fake = {
      id: 0, template_id: tpl.id, serial: `${settings.get('certificates.serial_prefix', 'CRT-')}140300001`, verify_code: 'SAMPLE1234',
      issued_date: jalali.today(), status: 'valid',
      snapshot: JSON.stringify({
        student_name: 'سارا محمدی', first_name: 'سارا', last_name: 'محمدی', father_name: 'علی', national_code: '0012345679', gender: 'female',
        class_title: 'دوره جامع طراحی وب', class_code: 'CL-0001', start_date: jalali.addDays(jalali.today(), -90), end_date: jalali.today(),
        hours: 48, teacher_name: 'دکتر رضا احمدی', grade: 18.5, institute_name: settings.get('general.institute_name'), manager_name: settings.get('general.manager_name', ''),
      }),
    };
    await renderCertificate(req, res, fake);
  });

  r.get('/api/certificates/:id/verify-url', requirePerm('certificates.view'), async (req, res) => {
    const c = await loadCert(req, int(req.params.id));
    res.json({ url: svc.verifyUrl(req, c.verify_code), canRevoke: can(req.user, 'certificates.revoke') });
  });
}

const verifyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function pub(r) {
  r.get('/verify', verifyLimiter, async (req, res, next) => {
    if (!settings.get('certificates.verify_enabled', true)) return next();
    if (req.query.code) return res.go(`/verify/${encodeURIComponent(toEnDigits(str(req.query.code, 40)).toUpperCase())}`);
    res.page(v('verify'), { title: 'استعلام مدرک', cert: undefined }, 'layouts/public');
  });

  r.get('/verify/:code', verifyLimiter, async (req, res, next) => {
    if (!settings.get('certificates.verify_enabled', true)) return next();
    const code = toEnDigits(str(req.params.code, 40)).toUpperCase();
    const cert = await db('certificates').where('verify_code', code).orWhere('serial', code).first();
    let data = null;
    if (cert) data = JSON.parse(cert.snapshot || '{}');
    res.page(v('verify'), { title: 'استعلام مدرک', cert: cert || null, data, code }, 'layouts/public');
  });
}

module.exports = { panel, public: pub, renderCertificate, loadCert };
