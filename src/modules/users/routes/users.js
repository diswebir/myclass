'use strict';
/** مدیریت کاربران (دانشجویان، اساتید، کارکنان) */
const path = require('path');
const fs = require('fs');
const { db, paginate, fullNameSql } = require('../../../core/db');
const settings = require('../../../core/settings');
const registry = require('../../../core/modules');
const jalali = require('../../../core/jalali');
const events = require('../../../core/events');
const {
  requirePerm, can, scopeClassIds, applyUserScope, applyClassScope, assertUserAccess, canAssignRole, canManageUser, hashPassword,
} = require('../../../core/auth');
const { audit } = require('../../../core/audit');
const { uploader } = require('../../../core/upload');
const { destroyUserSessions } = require('../../../core/session-store');
const { str, int, bool, httpError, sendCsv, parseCsv, normalizeMobile, isMobile, isNationalCode, toEnDigits, randomPassword } = require('../../../core/utils');
const { validateUser, createUser } = require('../service');

const v = (name) => path.join(__dirname, '..', 'views', name);

const PAGES = {
  students: { kind: 'student', title: 'دانشجویان', single: 'دانشجو', icon: 'graduation-cap', href: '/panel/students' },
  teachers: { kind: 'teacher', title: 'اساتید', single: 'استاد', icon: 'presentation', href: '/panel/teachers' },
  users: { kind: null, title: 'همه کاربران', single: 'کاربر', icon: 'users', href: '/panel/users' },
};

async function assignableRoles(actor, kind) {
  const q = db('roles').orderBy('id');
  if (kind) q.where({ kind });
  const roles = await q;
  const out = [];
  for (const r of roles) if (await canAssignRole(actor, r.id)) out.push(r);
  return out;
}

function buildQuery(req, page) {
  const q = db('users as u').join('roles as r', 'r.id', 'u.role_id')
    .select('u.id', 'u.first_name', 'u.last_name', 'u.username', 'u.mobile', 'u.national_code', 'u.email', 'u.avatar', 'u.is_active',
      'u.last_login_at', 'u.created_at', 'u.gender', 'u.father_name', 'r.name as role_name', 'r.color as role_color', 'r.kind as role_kind');
  const kind = page.kind || req.query.kind;
  if (kind) q.where('r.kind', kind);
  if (req.query.role) q.where('u.role_id', int(req.query.role));
  if (req.query.status === 'active') q.where('u.is_active', true);
  if (req.query.status === 'inactive') q.where('u.is_active', false);
  if (req.query.class) q.whereIn('u.id', db('enrollments').select('user_id').where('class_id', int(req.query.class)));
  if (req.query.q) {
    const term = `%${toEnDigits(str(req.query.q, 100))}%`;
    q.where((w) => w.where('u.first_name', 'like', term).orWhere('u.last_name', 'like', term).orWhere('u.mobile', 'like', term)
      .orWhere('u.national_code', 'like', term).orWhere('u.username', 'like', term)
      .orWhereRaw(`${fullNameSql('u')} like ?`, [term]));
  }
  const sort = { name: 'u.last_name', created: 'u.id', login: 'u.last_login_at' }[req.query.sort] || 'u.id';
  q.orderBy(sort, req.query.dir === 'asc' ? 'asc' : 'desc');
  return q;
}

module.exports = (r) => {
  /* ------------------------------ لیست ------------------------------ */
  const list = (pageKey) => async (req, res) => {
    const page = PAGES[pageKey];
    const ids = await scopeClassIds(req);
    const q = buildQuery(req, page);
    applyUserScope(q, 'u.id', ids);
    if (ids !== null && page.kind !== 'student') q.where('r.kind', 'student'); // استاد فقط دانشجویان خود را می‌بیند
    const data = await paginate(q, req.query.page, settings.get('general.items_per_page', 20));
    // تعداد کلاس‌های هر کاربر
    const userIds = data.rows.map((x) => x.id);
    const enrollCounts = {};
    const teachCounts = {};
    if (userIds.length && registry.isEnabled('classes')) {
      (await db('enrollments').whereIn('user_id', userIds).groupBy('user_id').select('user_id').count({ c: '*' }))
        .forEach((x) => { enrollCounts[x.user_id] = Number(x.c); });
      (await db('class_teachers').whereIn('user_id', userIds).groupBy('user_id').select('user_id').count({ c: '*' }))
        .forEach((x) => { teachCounts[x.user_id] = Number(x.c); });
    }
    const roles = await db('roles').modify((qq) => { if (page.kind) qq.where('kind', page.kind); }).orderBy('id');
    let classes = [];
    if (registry.isEnabled('classes')) {
      const cq = db('classes').select('id', 'title').orderBy('id', 'desc');
      applyClassScope(cq, 'id', ids);
      classes = await cq;
    }
    const stats = {};
    if (!page.kind || page.kind) {
      const base = db('users as u').join('roles as r', 'r.id', 'u.role_id');
      if (page.kind) base.where('r.kind', page.kind);
      applyUserScope(base, 'u.id', ids);
      stats.total = Number((await base.clone().count({ c: '*' }).first()).c);
      stats.active = Number((await base.clone().where('u.is_active', true).count({ c: '*' }).first()).c);
      stats.month = Number((await base.clone().where('u.created_at', '>=', jalali.currentJalaliMonthRange().start).count({ c: '*' }).first()).c);
    }
    res.page(v('users/list'), {
      title: page.title, page, pageKey, data, roles, classes, enrollCounts, teachCounts, stats,
      breadcrumbs: [{ label: page.title }],
    });
  };

  r.get('/students', requirePerm('users.view'), list('students'));
  r.get('/teachers', requirePerm('users.view'), list('teachers'));
  r.get('/users', requirePerm('users.view'), list('users'));

  /* ------------------------------ خروجی CSV ------------------------------ */
  r.get('/users/export', requirePerm('users.export'), async (req, res) => {
    const page = PAGES[req.query.page] || PAGES.users;
    const ids = await scopeClassIds(req);
    const q = buildQuery(req, page);
    applyUserScope(q, 'u.id', ids);
    const rows = await q.limit(20000);
    sendCsv(res, `users-${jalali.toJalali(jalali.today(), '-')}.csv`, [
      { label: 'شناسه', key: 'id' }, { label: 'نام', key: 'first_name' }, { label: 'نام خانوادگی', key: 'last_name' },
      { label: 'نام پدر', key: 'father_name' }, { label: 'کد ملی', key: 'national_code' }, { label: 'موبایل', key: 'mobile' },
      { label: 'نام کاربری', key: 'username' }, { label: 'ایمیل', key: 'email' }, { label: 'نقش', key: 'role_name' },
      { label: 'وضعیت', value: (x) => (x.is_active ? 'فعال' : 'غیرفعال') }, { label: 'تاریخ ثبت', value: (x) => jalali.formatDateTime(x.created_at) },
    ], rows);
    await audit(req, 'users.export', null, null, { count: rows.length });
  });

  /* ------------------------------ جستجو (API) ------------------------------ */
  r.get('/api/users/search', requirePerm('users.view', 'classes.students', 'finance.invoices'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const q = db('users as u').join('roles as r', 'r.id', 'u.role_id')
      .select('u.id', 'u.first_name', 'u.last_name', 'u.mobile', 'u.national_code', 'r.name as role_name', 'r.kind').limit(15);
    if (req.query.kind) q.where('r.kind', str(req.query.kind, 20));
    if (req.query.exclude_class) q.whereNotIn('u.id', db('enrollments').select('user_id').where('class_id', int(req.query.exclude_class)));
    const term = `%${toEnDigits(str(req.query.q, 100))}%`;
    q.where((w) => w.where('u.first_name', 'like', term).orWhere('u.last_name', 'like', term).orWhere('u.mobile', 'like', term).orWhere('u.national_code', 'like', term));
    applyUserScope(q, 'u.id', ids);
    const rows = await q;
    res.json(rows.map((x) => ({ id: x.id, text: `${x.first_name} ${x.last_name}`, sub: [x.mobile, x.national_code, x.role_name].filter(Boolean).join(' • ') })));
  });

  /* ------------------------------ فرم افزودن ------------------------------ */
  r.get(['/users/new', '/students/new', '/teachers/new'], requirePerm('users.create'), async (req, res) => {
    const pageKey = req.path.split('/')[1];
    const page = PAGES[pageKey] || PAGES.users;
    const roles = await assignableRoles(req.user, page.kind);
    let classes = [];
    if (registry.isEnabled('classes')) {
      const cq = db('classes').whereIn('status', ['draft', 'open', 'running']).select('id', 'title', 'code').orderBy('id', 'desc');
      applyClassScope(cq, 'id', await scopeClassIds(req));
      classes = await cq;
    }
    res.page(v('users/form'), {
      title: `افزودن ${page.single}`, page, pageKey, item: null, roles, classes,
      breadcrumbs: [{ label: page.title, href: page.href }, { label: `افزودن ${page.single}` }],
    });
  });

  r.post('/users', requirePerm('users.create'), async (req, res) => {
    const pageKey = PAGES[req.body._page] ? req.body._page : 'users';
    const page = PAGES[pageKey];
    const { data, errors } = await validateUser(req.body);
    const roleId = int(req.body.role_id);
    if (!roleId || !(await canAssignRole(req.user, roleId))) errors.role_id = 'نقش انتخاب‌شده معتبر نیست یا اجازه تخصیص آن را ندارید.';
    const password = req.body.password ? String(req.body.password) : null;
    if (password) {
      const { passwordPolicyError } = require('../service');
      const pe = passwordPolicyError(password);
      if (pe) errors.password = pe;
    }
    if (Object.keys(errors).length) return req.backWithErrors(errors);
    data.is_active = bool(req.body.is_active);
    const { id } = await createUser(data, {
      roleId, password, actorId: req.user.id, sendSms: bool(req.body.send_sms),
      mustChange: password ? bool(req.body.must_change_password) : undefined,
    });
    // ثبت‌نام در کلاس
    const classIds = [].concat(req.body.enroll_classes || []).map((x) => int(x)).filter(Boolean);
    if (classIds.length && registry.isEnabled('classes') && can(req.user, 'classes.students')) {
      const scope = await scopeClassIds(req);
      for (const cid of classIds) {
        if (scope && !scope.includes(cid)) continue;
        const svc = require('../../classes/service');
        await svc.enroll(cid, id, { actorId: req.user.id, source: 'admin' }).catch(() => {});
      }
    }
    await audit(req, 'users.create', 'user', id, { username: data.username, role_id: roleId });
    req.flash('success', `${page.single} «${data.first_name} ${data.last_name}» با موفقیت ایجاد شد.`);
    res.go(`/panel/users/${id}`);
  });

  /* ------------------------------ نمایش ------------------------------ */
  r.get('/users/:id', requirePerm('users.view'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    const item = await db('users as u').join('roles as r', 'r.id', 'u.role_id')
      .select('u.*', 'r.name as role_name', 'r.color as role_color', 'r.kind as role_kind', 'r.is_super').where('u.id', id).first();
    if (!item) return next(httpError(404, 'کاربر یافت نشد.'));
    delete item.password_hash;
    // تب‌های ماژول‌ها
    const tabs = [];
    for (const m of registry.enabled()) {
      for (const t of m.userTabs || []) {
        if (t.perm && !can(req.user, t.perm)) continue;
        if (t.kinds && !t.kinds.includes(item.role_kind)) continue;
        try {
          const out = await t.load(req, item);
          if (out) tabs.push(Object.assign({ key: t.key, label: t.label, icon: t.icon, order: t.order || 50 }, out));
        } catch (e) { console.error('[userTab]', t.key, e.message); }
      }
    }
    tabs.sort((a, b) => a.order - b.order);
    const page = item.role_kind === 'student' ? PAGES.students : item.role_kind === 'teacher' ? PAGES.teachers : PAGES.users;
    const manageable = await canManageUser(req.user, item);
    res.page(v('users/show'), {
      title: `${item.first_name} ${item.last_name}`, item, tabs, page, manageable,
      breadcrumbs: [{ label: page.title, href: page.href }, { label: `${item.first_name} ${item.last_name}` }],
    });
  });

  /* ------------------------------ ویرایش ------------------------------ */
  r.get('/users/:id/edit', requirePerm('users.edit'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    const item = await db('users').where({ id }).first();
    if (!item) return next(httpError(404));
    if (!(await canManageUser(req.user, item))) return next(httpError(403, 'اجازه ویرایش این کاربر را ندارید.'));
    const role = await db('roles').where({ id: item.role_id }).first();
    const page = role.kind === 'student' ? PAGES.students : role.kind === 'teacher' ? PAGES.teachers : PAGES.users;
    const roles = await assignableRoles(req.user, null);
    res.page(v('users/form'), {
      title: `ویرایش ${item.first_name} ${item.last_name}`, page, pageKey: 'users', item, roles, classes: [],
      breadcrumbs: [{ label: page.title, href: page.href }, { label: `${item.first_name} ${item.last_name}`, href: `/panel/users/${id}` }, { label: 'ویرایش' }],
    });
  });

  r.post('/users/:id', requirePerm('users.edit'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    const item = await db('users').where({ id }).first();
    if (!item) return next(httpError(404));
    if (!(await canManageUser(req.user, item))) return next(httpError(403));
    const { data, errors } = await validateUser(req.body, { id });
    const roleId = int(req.body.role_id) || item.role_id;
    if (roleId !== item.role_id && !(await canAssignRole(req.user, roleId))) errors.role_id = 'اجازه تخصیص این نقش را ندارید.';
    if (id === req.user.id && roleId !== item.role_id) errors.role_id = 'امکان تغییر نقش خودتان وجود ندارد.';
    // جلوگیری از حذف آخرین مدیر کل
    if (roleId !== item.role_id) {
      const oldRole = await db('roles').where({ id: item.role_id }).first();
      if (oldRole.is_super) {
        const supers = await db('users').where({ role_id: item.role_id, is_active: true }).count({ c: '*' }).first();
        if (Number(supers.c) <= 1) errors.role_id = 'حداقل یک مدیر کل فعال باید در سیستم باقی بماند.';
      }
    }
    if (req.body.password) {
      const { passwordPolicyError } = require('../service');
      const pe = passwordPolicyError(req.body.password);
      if (pe) errors.password = pe;
    }
    if (Object.keys(errors).length) return req.backWithErrors(errors);
    const now = jalali.now();
    const upd = Object.assign(data, { role_id: roleId, updated_at: now });
    if (id !== req.user.id) upd.is_active = bool(req.body.is_active);
    if (req.body.password) {
      upd.password_hash = await hashPassword(req.body.password);
      upd.password_changed_at = now;
      upd.must_change_password = bool(req.body.must_change_password);
    }
    await db('users').where({ id }).update(upd);
    if (upd.is_active === false || req.body.password || roleId !== item.role_id) await destroyUserSessions(id, id === req.user.id ? req.sessionID : null);
    await audit(req, 'users.update', 'user', id, { role_changed: roleId !== item.role_id, password_changed: !!req.body.password });
    req.flash('success', 'اطلاعات کاربر به‌روزرسانی شد.');
    res.go(`/panel/users/${id}`);
  });

  r.post('/users/:id/toggle', requirePerm('users.edit'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    const item = await db('users').where({ id }).first();
    if (!item || id === req.user.id) return next(httpError(422, 'امکان تغییر وضعیت حساب خودتان وجود ندارد.'));
    if (!(await canManageUser(req.user, item))) return next(httpError(403));
    await db('users').where({ id }).update({ is_active: !item.is_active, updated_at: jalali.now() });
    if (item.is_active) await destroyUserSessions(id);
    await audit(req, item.is_active ? 'users.deactivate' : 'users.activate', 'user', id);
    req.flash('success', item.is_active ? 'حساب کاربر غیرفعال شد.' : 'حساب کاربر فعال شد.');
    res.back(`/panel/users/${id}`);
  });

  r.post('/users/:id/reset-password', requirePerm('users.edit'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    const item = await db('users').where({ id }).first();
    if (!item) return next(httpError(404));
    if (!(await canManageUser(req.user, item))) return next(httpError(403));
    const password = randomPassword(8);
    const now = jalali.now();
    await db('users').where({ id }).update({ password_hash: await hashPassword(password), password_changed_at: now, must_change_password: true, failed_logins: 0, locked_until: null, updated_at: now });
    await destroyUserSessions(id);
    let smsInfo = '';
    if (bool(req.body.send_sms) && item.mobile) {
      events.emit('user.password_reset', { user: item, password });
      smsInfo = ' و برای کاربر پیامک شد';
    }
    await audit(req, 'users.password_reset', 'user', id);
    req.flash('success', `رمز جدید: ${password} ${smsInfo}. کاربر در اولین ورود باید رمز را تغییر دهد.`);
    res.go(`/panel/users/${id}`);
  });

  r.post('/users/:id/unlock', requirePerm('users.edit'), async (req, res) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    await db('users').where({ id }).update({ failed_logins: 0, locked_until: null });
    await audit(req, 'users.unlock', 'user', id);
    req.flash('success', 'قفل حساب کاربر برداشته شد.');
    res.go(`/panel/users/${id}`);
  });

  r.post('/users/:id/delete', requirePerm('users.delete'), async (req, res, next) => {
    const id = int(req.params.id);
    await assertUserAccess(req, id);
    const item = await db('users').where({ id }).first();
    if (!item) return next(httpError(404));
    if (id === req.user.id) return next(httpError(422, 'امکان حذف حساب خودتان وجود ندارد.'));
    if (!(await canManageUser(req.user, item))) return next(httpError(403));
    const role = await db('roles').where({ id: item.role_id }).first();
    if (role.is_super) {
      const supers = await db('users').where({ role_id: role.id }).count({ c: '*' }).first();
      if (Number(supers.c) <= 1) return next(httpError(422, 'آخرین مدیر کل قابل حذف نیست.'));
    }
    if (registry.get('finance')) {
      const inv = await db('invoices').where({ user_id: id }).first().catch(() => null);
      if (inv) return next(httpError(422, 'این کاربر دارای سوابق مالی است و قابل حذف نیست. به جای حذف، حساب را غیرفعال کنید.'));
    }
    await db('users').where({ id }).del();
    await audit(req, 'users.delete', 'user', id, { name: `${item.first_name} ${item.last_name}`, username: item.username });
    req.flash('success', 'کاربر حذف شد.');
    res.go(role.kind === 'student' ? '/panel/students' : role.kind === 'teacher' ? '/panel/teachers' : '/panel/users');
  });

  /* ------------------------------ ورود گروهی ------------------------------ */
  r.get('/users/import', requirePerm('users.import'), async (req, res) => {
    const roles = await assignableRoles(req.user, null);
    let classes = [];
    if (registry.isEnabled('classes')) {
      const cq = db('classes').whereIn('status', ['draft', 'open', 'running']).select('id', 'title').orderBy('id', 'desc');
      applyClassScope(cq, 'id', await scopeClassIds(req));
      classes = await cq;
    }
    res.page(v('users/import'), {
      title: 'ورود گروهی کاربران', roles, classes, result: req.session.importResult || null,
      breadcrumbs: [{ label: 'دانشجویان', href: '/panel/students' }, { label: 'ورود گروهی' }],
    });
    delete req.session.importResult;
  });

  r.get('/users/import/sample.csv', requirePerm('users.import'), (req, res) => {
    sendCsv(res, 'sample-users.csv', [
      { label: 'first_name', key: 'a' }, { label: 'last_name', key: 'b' }, { label: 'mobile', key: 'c' }, { label: 'national_code', key: 'd' },
      { label: 'father_name', key: 'e' }, { label: 'email', key: 'f' }, { label: 'gender', key: 'g' },
    ], [{ a: 'علی', b: 'محمدی', c: '09121234567', d: '0012345679', e: 'حسین', f: '', g: 'male' }]);
  });

  r.post('/users/import', requirePerm('users.import'), ...uploader('tmp', { types: ['csv'], maxMB: 5, field: 'file' }), async (req, res) => {
    if (!req.file) { req.flash('error', 'فایل CSV را انتخاب کنید.'); return res.go('/panel/users/import'); }
    const roleId = int(req.body.role_id);
    if (!(await canAssignRole(req.user, roleId))) { req.flash('error', 'نقش انتخاب‌شده مجاز نیست.'); return res.go('/panel/users/import'); }
    const classId = int(req.body.class_id);
    if (classId) {
      const scope = await scopeClassIds(req);
      if (scope && !scope.includes(classId)) { req.flash('error', 'به این کلاس دسترسی ندارید.'); return res.go('/panel/users/import'); }
    }
    const content = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);
    const rows = parseCsv(content);
    if (!rows.length) { req.flash('error', 'فایل خالی است.'); return res.go('/panel/users/import'); }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const hasHeader = header.includes('first_name') || header.includes('mobile');
    const cols = hasHeader ? header : ['first_name', 'last_name', 'mobile', 'national_code', 'father_name', 'email', 'gender'];
    const result = { created: 0, existing: 0, enrolled: 0, errors: [] };
    const svc = registry.isEnabled('classes') ? require('../../classes/service') : null;
    const dataRows = hasHeader ? rows.slice(1) : rows;
    for (let i = 0; i < dataRows.length && i < 5000; i++) {
      const row = {};
      cols.forEach((c, idx) => { row[c] = (dataRows[i][idx] || '').trim(); });
      const line = i + (hasHeader ? 2 : 1);
      const mobile = row.mobile ? normalizeMobile(row.mobile) : null;
      const nc = toEnDigits(row.national_code || '').replace(/\D/g, '') || null;
      let existing = null;
      if (mobile) existing = await db('users').where({ mobile }).first();
      if (!existing && nc) existing = await db('users').where({ national_code: nc }).first();
      let userId;
      if (existing) {
        result.existing++;
        userId = existing.id;
      } else {
        const { data, errors } = await validateUser({ ...row, mobile: mobile && isMobile(mobile) ? mobile : row.mobile, national_code: nc && isNationalCode(nc) ? nc : row.national_code });
        if (Object.keys(errors).length) { result.errors.push(`سطر ${line}: ${Object.values(errors)[0]}`); continue; }
        const out = await createUser(data, { roleId, actorId: req.user.id, sendSms: bool(req.body.send_sms) });
        userId = out.id;
        result.created++;
      }
      if (classId && svc) {
        const ok = await svc.enroll(classId, userId, { actorId: req.user.id, source: 'import' }).then(() => true).catch(() => false);
        if (ok) result.enrolled++;
      }
    }
    await audit(req, 'users.import', null, null, { created: result.created, existing: result.existing, errors: result.errors.length });
    req.session.importResult = result;
    req.flash('success', `ورود اطلاعات انجام شد: ${result.created} کاربر جدید، ${result.existing} کاربر موجود.`);
    res.go('/panel/users/import');
  });
};
