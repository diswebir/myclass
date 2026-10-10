'use strict';
/** مدیریت نقش‌ها و مجوزها (سطوح دسترسی) */
const path = require('path');
const { db, insertId } = require('../../../core/db');
const registry = require('../../../core/modules');
const jalali = require('../../../core/jalali');
const { requirePerm } = require('../../../core/auth');
const { audit } = require('../../../core/audit');
const { str, int, httpError } = require('../../../core/utils');

const v = (name) => path.join(__dirname, '..', 'views', name);
const KINDS = ['admin', 'staff', 'teacher', 'student'];
const SCOPES = ['all', 'assigned', 'own'];

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

async function readForm(req, id) {
  const errors = {};
  const valid = new Set(registry.allPermissionKeys());
  const data = {
    name: str(req.body.name, 100),
    description: str(req.body.description, 255) || null,
    kind: KINDS.includes(req.body.kind) ? req.body.kind : 'staff',
    data_scope: SCOPES.includes(req.body.data_scope) ? req.body.data_scope : 'assigned',
    color: /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#64748b',
  };
  if (data.kind === 'student') data.data_scope = 'own';
  let slug = slugify(req.body.slug) || slugify(data.name) || `role_${Date.now()}`;
  if (!data.name) errors.name = 'نام نقش الزامی است.';
  const dup = await db('roles').where({ slug }).modify((q) => { if (id) q.whereNot('id', id); }).first();
  if (dup) slug = `${slug}_${Date.now().toString(36)}`;
  data.slug = slug;
  const perms = [...new Set([].concat(req.body.perms || []).filter((p) => valid.has(p)))];
  // جلوگیری از افزایش سطح دسترسی: فقط مجوزهایی که خود کاربر دارد
  const allowed = req.user.isSuper ? perms : perms.filter((p) => req.user.perms.has(p));
  return { data, perms: allowed, errors };
}

module.exports = (r) => {
  r.get('/roles', requirePerm('roles.manage'), async (req, res) => {
    const roles = await db('roles').orderBy('id');
    const userCounts = {};
    (await db('users').groupBy('role_id').select('role_id').count({ c: '*' })).forEach((x) => { userCounts[x.role_id] = Number(x.c); });
    const permCounts = {};
    (await db('role_permissions').groupBy('role_id').select('role_id').count({ c: '*' })).forEach((x) => { permCounts[x.role_id] = Number(x.c); });
    res.page(v('roles/list'), {
      title: 'نقش‌ها و سطوح دسترسی', roles, userCounts, permCounts, totalPerms: registry.allPermissionKeys().length,
      breadcrumbs: [{ label: 'نقش‌ها و دسترسی‌ها' }],
    });
  });

  r.get('/roles/new', requirePerm('roles.manage'), async (req, res) => {
    let copy = null;
    if (req.query.copy) {
      copy = await db('roles').where({ id: int(req.query.copy) }).first();
      if (copy) copy.perms = await db('role_permissions').where({ role_id: copy.id }).pluck('permission');
    }
    res.page(v('roles/form'), {
      title: 'نقش جدید', item: copy ? Object.assign({}, copy, { id: null, name: copy.name + ' (کپی)', slug: '', is_system: false, is_super: false }) : null,
      rolePerms: copy ? copy.perms : [], groups: registry.permissionGroups(),
      breadcrumbs: [{ label: 'نقش‌ها', href: '/panel/roles' }, { label: 'نقش جدید' }],
    });
  });

  r.post('/roles', requirePerm('roles.manage'), async (req, res) => {
    const { data, perms, errors } = await readForm(req);
    if (Object.keys(errors).length) return req.backWithErrors(errors);
    const now = jalali.now();
    const id = await db.transaction(async (trx) => {
      const rid = await insertId('roles', Object.assign(data, { is_system: false, is_super: false, created_at: now, updated_at: now }), trx);
      if (perms.length) await trx('role_permissions').insert(perms.map((p) => ({ role_id: rid, permission: p })));
      return rid;
    });
    await audit(req, 'roles.create', 'role', id, { name: data.name, perms });
    req.flash('success', `نقش «${data.name}» ایجاد شد.`);
    res.go('/panel/roles');
  });

  r.get('/roles/:id/edit', requirePerm('roles.manage'), async (req, res, next) => {
    const item = await db('roles').where({ id: int(req.params.id) }).first();
    if (!item) return next(httpError(404));
    if (item.is_super && !req.user.isSuper) return next(httpError(403));
    const rolePerms = await db('role_permissions').where({ role_id: item.id }).pluck('permission');
    const users = await db('users').where({ role_id: item.id }).select('id', 'first_name', 'last_name', 'avatar').limit(12);
    const usersCount = Number((await db('users').where({ role_id: item.id }).count({ c: '*' }).first()).c);
    res.page(v('roles/form'), {
      title: `ویرایش نقش ${item.name}`, item, rolePerms, groups: registry.permissionGroups(), users, usersCount,
      breadcrumbs: [{ label: 'نقش‌ها', href: '/panel/roles' }, { label: item.name }],
    });
  });

  r.post('/roles/:id', requirePerm('roles.manage'), async (req, res, next) => {
    const id = int(req.params.id);
    const item = await db('roles').where({ id }).first();
    if (!item) return next(httpError(404));
    if (item.is_super && !req.user.isSuper) return next(httpError(403));
    if (!req.user.isSuper && item.id === req.user.role_id) return next(httpError(422, 'امکان ویرایش نقش خودتان وجود ندارد.'));
    const { data, perms, errors } = await readForm(req, id);
    if (Object.keys(errors).length) return req.backWithErrors(errors);
    if (item.is_system) { data.slug = item.slug; data.kind = item.kind; }
    if (item.is_super) data.data_scope = 'all';
    await db.transaction(async (trx) => {
      await trx('roles').where({ id }).update(Object.assign(data, { updated_at: jalali.now() }));
      if (!item.is_super) {
        // حفظ مجوزهایی که کاربر جاری اجازه تغییرشان را ندارد
        const existing = await trx('role_permissions').where({ role_id: id }).pluck('permission');
        const keep = req.user.isSuper ? [] : existing.filter((p) => !req.user.perms.has(p));
        await trx('role_permissions').where({ role_id: id }).del();
        const final = [...new Set([...perms, ...keep])];
        if (final.length) await trx('role_permissions').insert(final.map((p) => ({ role_id: id, permission: p })));
      }
    });
    await audit(req, 'roles.update', 'role', id, { name: data.name, perms_count: perms.length });
    req.flash('success', `نقش «${data.name}» به‌روزرسانی شد.`);
    res.go('/panel/roles');
  });

  r.post('/roles/:id/delete', requirePerm('roles.manage'), async (req, res, next) => {
    const id = int(req.params.id);
    const item = await db('roles').where({ id }).first();
    if (!item) return next(httpError(404));
    if (item.is_system || item.is_super) return next(httpError(422, 'نقش‌های سیستمی قابل حذف نیستند.'));
    const users = Number((await db('users').where({ role_id: id }).count({ c: '*' }).first()).c);
    if (users) return next(httpError(422, `این نقش به ${users} کاربر اختصاص دارد. ابتدا نقش آن‌ها را تغییر دهید.`));
    await db('roles').where({ id }).del();
    await audit(req, 'roles.delete', 'role', id, { name: item.name });
    req.flash('success', 'نقش حذف شد.');
    res.go('/panel/roles');
  });
};
