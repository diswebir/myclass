'use strict';
const path = require('path');
const { db, insertId, paginate } = require('../../core/db');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { requirePerm, can, scopeClassIds, applyClassScope, assertClassAccess } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { str, text, int, num, bool, httpError, normTime, timeToMinutes, sendCsv, toEnDigits } = require('../../core/utils');
const svc = require('./service');

const v = (name) => path.join(__dirname, 'views', name);
const STATUSES = ['draft', 'open', 'running', 'finished', 'canceled'];

async function readClassForm(req, id = null) {
  const b = req.body;
  const errors = {};
  const data = {
    title: str(b.title, 191),
    code: toEnDigits(str(b.code, 50)).toUpperCase() || null,
    category_id: int(b.category_id) || null,
    description: text(b.description, 20000) || null,
    capacity: Math.max(0, int(b.capacity)),
    price: Math.max(0, Math.round(num(b.price))),
    start_date: b.start_date ? jalali.fromJalali(b.start_date) : null,
    end_date: b.end_date ? jalali.fromJalali(b.end_date) : null,
    start_time: normTime(b.start_time) || null,
    end_time: normTime(b.end_time) || null,
    week_days: [].concat(b.week_days || []).map((x) => int(x, -1)).filter((x) => x >= 0 && x <= 6).join(',') || null,
    location: str(b.location, 255) || null,
    online_link: str(b.online_link, 255) || null,
    level: str(b.level, 50) || null,
    status: STATUSES.includes(b.status) ? b.status : 'draft',
    is_public: bool(b.is_public),
    prereg_enabled: bool(b.prereg_enabled),
    min_attendance: b.min_attendance !== '' && b.min_attendance !== undefined ? Math.min(100, Math.max(0, int(b.min_attendance))) : null,
    total_hours: b.total_hours ? Math.max(0, int(b.total_hours)) : null,
    color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : null,
    notes: text(b.notes, 5000) || null,
  };
  if (!data.title) errors.title = 'عنوان کلاس الزامی است.';
  if (b.start_date && !data.start_date) errors.start_date = 'تاریخ شروع معتبر نیست.';
  if (b.end_date && !data.end_date) errors.end_date = 'تاریخ پایان معتبر نیست.';
  if (data.start_date && data.end_date && data.end_date < data.start_date) errors.end_date = 'تاریخ پایان باید بعد از تاریخ شروع باشد.';
  if (data.start_time && data.end_time && timeToMinutes(data.end_time) <= timeToMinutes(data.start_time)) errors.end_time = 'ساعت پایان باید بعد از ساعت شروع باشد.';
  if (data.online_link && !/^https?:\/\//i.test(data.online_link)) errors.online_link = 'لینک کلاس آنلاین باید با http شروع شود.';
  if (data.code) {
    const dup = await db('classes').where({ code: data.code }).modify((q) => { if (id) q.whereNot('id', id); }).first();
    if (dup) errors.code = 'این کد کلاس قبلاً استفاده شده است.';
  }
  const teacherIds = [...new Set([].concat(b.teachers || []).map((x) => int(x)).filter(Boolean))];
  return { data, errors, teacherIds };
}

async function syncTeachers(classId, teacherIds, trx) {
  const q = trx || db;
  await q('class_teachers').where({ class_id: classId }).whereNotIn('user_id', teacherIds.length ? teacherIds : [-1]).del();
  const existing = await q('class_teachers').where({ class_id: classId }).pluck('user_id');
  const valid = teacherIds.length ? await q('users').whereIn('id', teacherIds).pluck('id') : [];
  for (const uid of valid) if (!existing.includes(uid)) await q('class_teachers').insert({ class_id: classId, user_id: uid });
}

async function formData() {
  const categories = await db('categories').orderBy('sort').orderBy('id');
  const teachers = await db('users as u').join('roles as r', 'r.id', 'u.role_id').whereIn('r.kind', ['teacher', 'admin', 'staff'])
    .where('u.is_active', true).select('u.id', 'u.first_name', 'u.last_name', 'r.kind', 'r.name as role_name').orderBy('r.kind', 'desc').orderBy('u.last_name');
  return { categories, teachers };
}

module.exports = (r) => {
  /* ------------------------------ لیست کلاس‌ها ------------------------------ */
  r.get('/classes', requirePerm('classes.view'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const q = db('classes as c').leftJoin('categories as cat', 'cat.id', 'c.category_id')
      .select('c.*', 'cat.name as category_name', 'cat.color as category_color');
    applyClassScope(q, 'c.id', ids);
    if (req.query.q) {
      const t = `%${str(req.query.q, 100)}%`;
      q.where((w) => w.where('c.title', 'like', t).orWhere('c.code', 'like', t));
    }
    if (req.query.status && STATUSES.includes(req.query.status)) q.where('c.status', req.query.status);
    else if (!req.query.status) q.whereNot('c.status', 'canceled');
    if (req.query.category) q.where('c.category_id', int(req.query.category));
    if (req.query.teacher) q.whereIn('c.id', db('class_teachers').select('class_id').where('user_id', int(req.query.teacher)));
    q.orderByRaw("CASE c.status WHEN 'running' THEN 1 WHEN 'open' THEN 2 WHEN 'draft' THEN 3 WHEN 'finished' THEN 4 ELSE 5 END").orderBy('c.id', 'desc');
    const data = await paginate(q, req.query.page, req.query.view === 'table' ? settings.get('general.items_per_page', 20) : 12);
    const stats = await svc.classStats(data.rows.map((c) => c.id));
    const counts = {};
    const cq = db('classes').groupBy('status').select('status').count({ c: '*' });
    applyClassScope(cq, 'id', ids);
    (await cq).forEach((x) => { counts[x.status] = Number(x.c); });
    const { categories, teachers } = await formData();
    res.page(v('list'), {
      title: 'کلاس‌ها', data, stats, counts, categories, teachers: teachers.filter((t) => t.kind === 'teacher'),
      viewMode: req.query.view === 'table' ? 'table' : 'grid', weekDaysLabel: svc.weekDaysLabel,
      breadcrumbs: [{ label: 'کلاس‌ها' }],
    });
  });

  /* ------------------------------ ایجاد ------------------------------ */
  r.get('/classes/new', requirePerm('classes.create'), async (req, res) => {
    const fd = await formData();
    res.page(v('form'), Object.assign(fd, {
      title: 'ایجاد کلاس جدید', item: null, classTeachers: [], suggestedCode: await svc.nextCode(),
      breadcrumbs: [{ label: 'کلاس‌ها', href: '/panel/classes' }, { label: 'کلاس جدید' }],
    }));
  });

  r.post('/classes', requirePerm('classes.create'), async (req, res) => {
    const { data, errors, teacherIds } = await readClassForm(req);
    if (Object.keys(errors).length) return req.backWithErrors(errors);
    if (!data.code) data.code = await svc.nextCode();
    const now = jalali.now();
    const id = await db.transaction(async (trx) => {
      const cid = await insertId('classes', Object.assign(data, { created_by: req.user.id, created_at: now, updated_at: now }), trx);
      await syncTeachers(cid, teacherIds, trx);
      return cid;
    });
    let generated = 0;
    if (bool(req.body.generate_sessions) && data.start_date && data.end_date && data.week_days) {
      generated = await svc.generateSessions(id).catch(() => 0);
    }
    await audit(req, 'classes.create', 'class', id, { title: data.title });
    events.emit('class.created', { classId: id });
    req.flash('success', `کلاس «${data.title}» ایجاد شد${generated ? ` و ${generated} جلسه به صورت خودکار ساخته شد` : ''}.`);
    res.go(`/panel/classes/${id}`);
  });

  /* ------------------------------ نمایش ------------------------------ */
  r.get('/classes/:id', requirePerm('classes.view'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const cls = await db('classes as c').leftJoin('categories as cat', 'cat.id', 'c.category_id')
      .select('c.*', 'cat.name as category_name', 'cat.color as category_color').where('c.id', id).first();
    if (!cls) return next(httpError(404, 'کلاس یافت نشد.'));
    const stats = (await svc.classStats([id]))[id];
    const tab = str(req.query.tab, 30) || 'overview';

    // تب‌های داخلی و تب‌های ماژول‌های دیگر
    const tabs = [
      { key: 'overview', label: 'نمای کلی', icon: 'layout-dashboard' },
      { key: 'students', label: 'دانشجویان', icon: 'graduation-cap', count: stats.students },
      { key: 'sessions', label: 'جلسات', icon: 'calendar-days', count: stats.sessions },
    ];
    const moduleTabs = [];
    for (const m of registry.enabled()) {
      for (const t of m.classTabs || []) {
        if (t.perm && ![].concat(t.perm).some((p) => can(req.user, p))) continue;
        moduleTabs.push(t);
        tabs.push({ key: t.key, label: t.label, icon: t.icon, order: t.order });
      }
    }
    const locals = { title: cls.title, cls, stats, tab, tabs, weekDaysLabel: svc.weekDaysLabel, breadcrumbs: [{ label: 'کلاس‌ها', href: '/panel/classes' }, { label: cls.title }] };

    if (tab === 'overview' || tab === 'students') {
      locals.students = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', id)
        .select('e.*', 'u.first_name', 'u.last_name', 'u.mobile', 'u.national_code', 'u.avatar', 'u.username')
        .orderByRaw("CASE e.status WHEN 'active' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END").orderBy('u.last_name');
      const att = {};
      if (locals.students.length && registry.isEnabled('attendance')) {
        (await db('attendances').whereIn('enrollment_id', locals.students.map((s) => s.id)).groupBy('enrollment_id', 'status').select('enrollment_id', 'status').count({ c: '*' }))
          .forEach((x) => { att[x.enrollment_id] = att[x.enrollment_id] || {}; att[x.enrollment_id][x.status] = Number(x.c); });
      }
      locals.att = att;
      const balances = {};
      if (locals.students.length && registry.isEnabled('finance') && can(req.user, 'finance.view')) {
        (await db('invoices').where('class_id', id).whereNot('status', 'canceled').groupBy('user_id').select('user_id').sum({ total: 'total' }).sum({ paid: 'paid' }))
          .forEach((x) => { balances[x.user_id] = { total: Number(x.total), paid: Number(x.paid) }; });
      }
      locals.balances = balances;
      locals.showContacts = !(req.user.kind === 'teacher' && !settings.get('classes.teacher_sees_contacts', true));
    }
    if (tab === 'overview' || tab === 'sessions') {
      locals.sessions = await db('class_sessions').where({ class_id: id }).orderBy('date').orderBy('start_time');
      if (registry.isEnabled('attendance')) {
        const ac = {};
        (await db('attendances as a').join('class_sessions as s', 's.id', 'a.session_id').where('s.class_id', id).groupBy('a.session_id', 'a.status').select('a.session_id', 'a.status').count({ c: '*' }))
          .forEach((x) => { ac[x.session_id] = ac[x.session_id] || {}; ac[x.session_id][x.status] = Number(x.c); });
        locals.sessionAtt = ac;
      } else locals.sessionAtt = {};
    }
    const mt = moduleTabs.find((t) => t.key === tab);
    if (mt) {
      const out = await mt.load(req, cls);
      locals.moduleTab = out;
    }
    res.page(v('show'), locals);
  });

  /* ------------------------------ ویرایش ------------------------------ */
  r.get('/classes/:id/edit', requirePerm('classes.edit'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const item = await db('classes').where({ id }).first();
    if (!item) return next(httpError(404));
    const fd = await formData();
    const classTeachers = await db('class_teachers').where({ class_id: id }).pluck('user_id');
    res.page(v('form'), Object.assign(fd, {
      title: `ویرایش ${item.title}`, item, classTeachers,
      breadcrumbs: [{ label: 'کلاس‌ها', href: '/panel/classes' }, { label: item.title, href: `/panel/classes/${id}` }, { label: 'ویرایش' }],
    }));
  });

  r.post('/classes/:id', requirePerm('classes.edit'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const item = await db('classes').where({ id }).first();
    if (!item) return next(httpError(404));
    const { data, errors, teacherIds } = await readClassForm(req, id);
    if (Object.keys(errors).length) return req.backWithErrors(errors);
    if (!data.code) data.code = item.code;
    await db.transaction(async (trx) => {
      await trx('classes').where({ id }).update(Object.assign(data, { updated_at: jalali.now() }));
      // استاد با محدوده «تخصیص‌یافته» نمی‌تواند خودش را از کلاس حذف کند یا استاد دیگری اضافه کند
      if (req.user.isSuper || req.user.data_scope === 'all') await syncTeachers(id, teacherIds, trx);
    });
    if (bool(req.body.regenerate_sessions)) await svc.generateSessions(id, { replace: true }).catch((e) => req.flash('warning', e.message));
    await audit(req, 'classes.update', 'class', id, { title: data.title });
    req.flash('success', 'اطلاعات کلاس به‌روزرسانی شد.');
    res.go(`/panel/classes/${id}`);
  });

  r.post('/classes/:id/status', requirePerm('classes.edit'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const status = STATUSES.includes(req.body.status) ? req.body.status : null;
    if (status) {
      await db('classes').where({ id }).update({ status, updated_at: jalali.now() });
      await audit(req, 'classes.status', 'class', id, { status });
      events.emit('class.status_changed', { classId: id, status });
      req.flash('success', 'وضعیت کلاس تغییر کرد.');
    }
    res.go(`/panel/classes/${id}`);
  });

  r.post('/classes/:id/duplicate', requirePerm('classes.create'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const item = await db('classes').where({ id }).first();
    if (!item) return next(httpError(404));
    const copy = Object.assign({}, item);
    delete copy.id;
    const now = jalali.now();
    Object.assign(copy, { title: `${item.title} (کپی)`, code: await svc.nextCode(), status: 'draft', created_by: req.user.id, created_at: now, updated_at: now });
    const nid = await insertId('classes', copy);
    const teachers = await db('class_teachers').where({ class_id: id });
    for (const t of teachers) await db('class_teachers').insert({ class_id: nid, user_id: t.user_id, title: t.title });
    await audit(req, 'classes.duplicate', 'class', nid, { from: id });
    req.flash('success', 'از کلاس کپی گرفته شد. اطلاعات و تاریخ‌ها را ویرایش کنید.');
    res.go(`/panel/classes/${nid}/edit`);
  });

  r.post('/classes/:id/delete', requirePerm('classes.delete'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const item = await db('classes').where({ id }).first();
    if (!item) return next(httpError(404));
    if (registry.get('finance')) {
      const inv = await db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('i.class_id', id).where('p.status', 'approved').first().catch(() => null);
      if (inv) return next(httpError(422, 'برای این کلاس پرداخت ثبت شده است و قابل حذف نیست. وضعیت آن را «لغو شده» قرار دهید.'));
    }
    await db('classes').where({ id }).del();
    await audit(req, 'classes.delete', 'class', id, { title: item.title, code: item.code });
    req.flash('success', `کلاس «${item.title}» حذف شد.`);
    res.go('/panel/classes');
  });

  /* ------------------------------ دانشجویان کلاس ------------------------------ */
  r.post('/classes/:id/enroll', requirePerm('classes.students'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const userIds = [...new Set([].concat(req.body.user_ids || req.body.user_id || []).map((x) => int(x)).filter(Boolean))];
    if (!userIds.length) { req.flash('error', 'هیچ دانشجویی انتخاب نشده است.'); return res.go(`/panel/classes/${id}?tab=students`); }
    const cls = await db('classes').where({ id }).first();
    let ok = 0;
    const errs = [];
    for (const uid of userIds) {
      try {
        const eid = await svc.enroll(id, uid, { actorId: req.user.id, source: 'admin', force: bool(req.body.force) && req.user.data_scope === 'all', notify: bool(req.body.notify) });
        ok++;
        // صدور فاکتور
        if (bool(req.body.create_invoice) && registry.isEnabled('finance') && can(req.user, 'finance.invoices') && cls.price > 0) {
          const fin = require('../finance/service');
          await fin.createInvoice({
            userId: uid, classId: id, enrollmentId: eid, amount: cls.price, discount: Math.max(0, Math.round(num(req.body.discount))),
            paymentType: req.body.payment_type === 'installment' ? 'installment' : 'cash',
            installments: int(req.body.installments_count, 1), actorId: req.user.id,
          });
        }
      } catch (e) { errs.push(e.message); }
    }
    if (ok) req.flash('success', `${ok} دانشجو در کلاس ثبت‌نام شد.`);
    errs.slice(0, 5).forEach((e) => req.flash('error', e));
    await audit(req, 'classes.enroll', 'class', id, { users: userIds, ok });
    res.go(`/panel/classes/${id}?tab=students`);
  });

  r.post('/enrollments/:id/status', requirePerm('classes.students'), async (req, res, next) => {
    const e = await db('enrollments').where({ id: int(req.params.id) }).first();
    if (!e) return next(httpError(404));
    await assertClassAccess(req, e.class_id);
    const status = ['active', 'completed', 'withdrawn', 'suspended'].includes(req.body.status) ? req.body.status : e.status;
    await db('enrollments').where({ id: e.id }).update({ status, updated_at: jalali.now() });
    await audit(req, 'enrollments.status', 'enrollment', e.id, { status });
    req.flash('success', 'وضعیت ثبت‌نام تغییر کرد.');
    res.go(`/panel/classes/${e.class_id}?tab=students`);
  });

  r.post('/enrollments/:id/delete', requirePerm('classes.students'), async (req, res, next) => {
    const e = await db('enrollments').where({ id: int(req.params.id) }).first();
    if (!e) return next(httpError(404));
    await assertClassAccess(req, e.class_id);
    if (registry.get('finance')) {
      const paid = await db('invoices').where({ enrollment_id: e.id }).where('paid', '>', 0).first().catch(() => null);
      if (paid) return next(httpError(422, 'برای این ثبت‌نام پرداخت ثبت شده است. به جای حذف، وضعیت را «انصراف» قرار دهید.'));
    }
    await db('enrollments').where({ id: e.id }).del();
    await audit(req, 'enrollments.delete', 'enrollment', e.id, { class_id: e.class_id, user_id: e.user_id });
    req.flash('success', 'دانشجو از کلاس حذف شد.');
    res.go(`/panel/classes/${e.class_id}?tab=students`);
  });

  /** ثبت گروهی نمرات - استاد کلاس هم می‌تواند نمره ثبت کند */
  r.post('/classes/:id/grades', requirePerm('classes.students', 'attendance.manage'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const grades = req.body.grades || {};
    let n = 0;
    for (const [eid, val] of Object.entries(grades)) {
      const g = String(val).trim() === '' ? null : Math.min(100, Math.max(0, num(val)));
      n += await db('enrollments').where({ id: int(eid), class_id: id }).update({ grade: g, updated_at: jalali.now() });
    }
    await audit(req, 'classes.grades', 'class', id, { count: n });
    req.flash('success', 'نمرات ذخیره شد.');
    res.go(`/panel/classes/${id}?tab=students`);
  });

  r.get('/classes/:id/students.csv', requirePerm('classes.view'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const cls = await db('classes').where({ id }).first();
    const rows = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', id)
      .select('u.first_name', 'u.last_name', 'u.national_code', 'u.mobile', 'e.status', 'e.grade', 'e.enrolled_at');
    const showContacts = !(req.user.kind === 'teacher' && !settings.get('classes.teacher_sees_contacts', true));
    sendCsv(res, `class-${cls.code}.csv`, [
      { label: 'نام', key: 'first_name' }, { label: 'نام خانوادگی', key: 'last_name' }, { label: 'کد ملی', key: 'national_code' },
      { label: 'موبایل', value: (x) => (showContacts ? x.mobile : '') }, { label: 'وضعیت', key: 'status' }, { label: 'نمره', key: 'grade' },
      { label: 'تاریخ ثبت‌نام', value: (x) => jalali.toJalali(x.enrolled_at) },
    ], rows);
  });

  /* ------------------------------ جلسات ------------------------------ */
  r.post('/classes/:id/sessions/generate', requirePerm('classes.sessions'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const n = await svc.generateSessions(id, { replace: bool(req.body.replace) });
    await audit(req, 'sessions.generate', 'class', id, { count: n });
    req.flash('success', n ? `${n} جلسه جدید ایجاد شد.` : 'جلسه جدیدی برای ایجاد وجود نداشت.');
    res.go(`/panel/classes/${id}?tab=sessions`);
  });

  r.post('/classes/:id/sessions', requirePerm('classes.sessions'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const cls = await db('classes').where({ id }).first();
    const date = jalali.fromJalali(req.body.date);
    if (!date) { req.flash('error', 'تاریخ جلسه معتبر نیست.'); return res.go(`/panel/classes/${id}?tab=sessions`); }
    const now = jalali.now();
    await db('class_sessions').insert({
      class_id: id, date, start_time: normTime(req.body.start_time) || cls.start_time, end_time: normTime(req.body.end_time) || cls.end_time,
      topic: str(req.body.topic, 255) || null, status: 'scheduled', created_at: now, updated_at: now,
    });
    await svc.renumber(id);
    await audit(req, 'sessions.create', 'class', id, { date });
    req.flash('success', 'جلسه جدید اضافه شد.');
    res.go(`/panel/classes/${id}?tab=sessions`);
  });

  r.post('/sessions/:id', requirePerm('classes.sessions'), async (req, res, next) => {
    const s = await db('class_sessions').where({ id: int(req.params.id) }).first();
    if (!s) return next(httpError(404));
    await assertClassAccess(req, s.class_id);
    const upd = { updated_at: jalali.now() };
    if (req.body.date) { const d = jalali.fromJalali(req.body.date); if (d) upd.date = d; }
    if (req.body.start_time !== undefined) upd.start_time = normTime(req.body.start_time) || s.start_time;
    if (req.body.end_time !== undefined) upd.end_time = normTime(req.body.end_time) || s.end_time;
    if (req.body.topic !== undefined) upd.topic = str(req.body.topic, 255) || null;
    if (req.body.notes !== undefined) upd.notes = text(req.body.notes, 5000) || null;
    if (['scheduled', 'held', 'canceled'].includes(req.body.status)) upd.status = req.body.status;
    await db('class_sessions').where({ id: s.id }).update(upd);
    if (upd.date || upd.status) await svc.renumber(s.class_id);
    if (upd.status === 'canceled' && s.status !== 'canceled' && bool(req.body.notify)) {
      const cls = await db('classes').where({ id: s.class_id }).first();
      const students = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where({ 'e.class_id': s.class_id, 'e.status': 'active' }).select('u.*');
      students.forEach((u) => events.emit('session.canceled', { user: u, cls, session: s }));
    }
    await audit(req, 'sessions.update', 'session', s.id, upd);
    req.flash('success', 'جلسه به‌روزرسانی شد.');
    res.back(`/panel/classes/${s.class_id}?tab=sessions`);
  });

  r.post('/sessions/:id/delete', requirePerm('classes.sessions'), async (req, res, next) => {
    const s = await db('class_sessions').where({ id: int(req.params.id) }).first();
    if (!s) return next(httpError(404));
    await assertClassAccess(req, s.class_id);
    await db('class_sessions').where({ id: s.id }).del();
    await svc.renumber(s.class_id);
    await audit(req, 'sessions.delete', 'session', s.id, { class_id: s.class_id, date: s.date });
    req.flash('success', 'جلسه حذف شد.');
    res.go(`/panel/classes/${s.class_id}?tab=sessions`);
  });

  /* ------------------------------ تقویم ------------------------------ */
  r.get('/calendar', requirePerm('classes.view'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const t = jalali.toJalaliParts(jalali.today());
    let jy = int(req.query.y, t.jy), jm = int(req.query.m, t.jm);
    if (jm < 1 || jm > 12) { jm = t.jm; jy = t.jy; }
    const start = jalali.jalaliToGregorian(jy, jm, 1);
    const len = jalali.monthLength(jy, jm);
    const end = jalali.jalaliToGregorian(jy, jm, len);
    const q = db('class_sessions as s').join('classes as c', 'c.id', 's.class_id').whereBetween('s.date', [start, end])
      .whereNot('c.status', 'canceled').select('s.*', 'c.title as class_title', 'c.color', 'c.code').orderBy('s.start_time');
    applyClassScope(q, 'c.id', ids);
    if (req.query.class) q.where('c.id', int(req.query.class));
    const sessions = await q;
    const byDate = {};
    sessions.forEach((s) => { const d = String(s.date).slice(0, 10); (byDate[d] = byDate[d] || []).push(s); });
    const cq = db('classes').whereIn('status', ['open', 'running']).select('id', 'title').orderBy('title');
    applyClassScope(cq, 'id', ids);
    res.page(v('calendar'), {
      title: 'تقویم جلسات', jy, jm, len, start, byDate, classes: await cq,
      firstWeekday: jalali.WEEK_ORDER.indexOf(jalali.weekday(start)),
      prev: jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 },
      next: jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 },
      breadcrumbs: [{ label: 'تقویم جلسات' }],
    });
  });

  /* ------------------------------ دسته‌بندی‌ها ------------------------------ */
  r.get('/categories', requirePerm('classes.categories'), async (req, res) => {
    const categories = await db('categories').orderBy('sort').orderBy('id');
    const counts = {};
    (await db('classes').groupBy('category_id').select('category_id').count({ c: '*' })).forEach((x) => { counts[x.category_id] = Number(x.c); });
    res.page(v('categories'), { title: 'دسته‌بندی کلاس‌ها', categories, counts, breadcrumbs: [{ label: 'کلاس‌ها', href: '/panel/classes' }, { label: 'دسته‌بندی‌ها' }] });
  });

  r.post('/categories', requirePerm('classes.categories'), async (req, res) => {
    const name = str(req.body.name, 100);
    if (!name) { req.flash('error', 'نام دسته‌بندی الزامی است.'); return res.go('/panel/categories'); }
    await db('categories').insert({ name, color: /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#6366f1', sort: int(req.body.sort), created_at: jalali.now() });
    req.flash('success', 'دسته‌بندی اضافه شد.');
    res.go('/panel/categories');
  });

  r.post('/categories/:id', requirePerm('classes.categories'), async (req, res) => {
    const name = str(req.body.name, 100);
    if (name) await db('categories').where({ id: int(req.params.id) }).update({ name, color: /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#6366f1', sort: int(req.body.sort) });
    req.flash('success', 'دسته‌بندی ویرایش شد.');
    res.go('/panel/categories');
  });

  r.post('/categories/:id/delete', requirePerm('classes.categories'), async (req, res) => {
    await db('categories').where({ id: int(req.params.id) }).del();
    req.flash('success', 'دسته‌بندی حذف شد.');
    res.go('/panel/categories');
  });

  /* ------------------------------ API ------------------------------ */
  r.get('/api/classes/:id/students', requirePerm('classes.view'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const rows = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', id).where('e.status', 'active')
      .select('e.id as enrollment_id', 'u.id', 'u.first_name', 'u.last_name', 'u.mobile');
    res.json(rows.map((x) => ({ id: x.id, enrollment_id: x.enrollment_id, text: `${x.first_name} ${x.last_name}`, sub: x.mobile })));
  });

};
