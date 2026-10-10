'use strict';
/**
 * احراز هویت، سطوح دسترسی (RBAC) و محدوده داده (Data Scope)
 *
 * - هر کاربر یک «نقش» دارد و هر نقش مجموعه‌ای از «مجوزها».
 * - محدوده داده نقش: all (همه کلاس‌ها) یا assigned (فقط کلاس‌های تخصیص‌یافته) یا own (فقط اطلاعات خود)
 * - همه کوئری‌های حساس با applyClassScope محدود می‌شوند تا استاد فقط به کلاس‌ها و دانشجویان خود دسترسی داشته باشد.
 */
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const registry = require('./modules');
const { httpError } = require('./utils');

let permModuleMap = null;
function permModule(perm) {
  if (!permModuleMap) {
    permModuleMap = {};
    for (const m of registry.all()) for (const p of m.permissions) permModuleMap[p.key] = m.key;
  }
  return permModuleMap[perm];
}

function hashPassword(pw) {
  return bcrypt.hash(String(pw), 10);
}

function verifyPassword(pw, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(String(pw), hash);
}

async function fetchUser(id) {
  const u = await db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', id)
    .select('u.*', 'r.name as role_name', 'r.slug as role_slug', 'r.kind as role_kind', 'r.is_super', 'r.data_scope', 'r.color as role_color')
    .first();
  if (!u) return null;
  const perms = u.is_super ? [] : await db('role_permissions').where({ role_id: u.role_id }).pluck('permission');
  delete u.password_hash;
  u.perms = new Set(perms);
  u.isSuper = !!u.is_super;
  u.kind = u.role_kind;
  u.fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  return u;
}

async function loadUser(req, res, next) {
  req.user = null;
  const uid = req.session && req.session.userId;
  if (!uid) return next();
  const u = await fetchUser(uid);
  const invalid = !u || !u.is_active ||
    (u.password_changed_at && req.session.authAt && String(u.password_changed_at) > String(req.session.authAt));
  if (invalid) {
    req.session.userId = null;
    return next();
  }
  req.user = u;
  res.locals.user = u;
  next();
}

function can(user, perm) {
  if (!user) return false;
  const mod = permModule(perm);
  if (mod && !registry.isEnabled(mod)) return false;
  if (user.isSuper) return true;
  return user.perms.has(perm);
}

function canAny(user, perms) {
  return perms.some((p) => can(user, p));
}

function requireAuth(req, res, next) {
  if (req.user) {
    if (req.user.must_change_password && !req.path.startsWith('/profile') && req.method === 'GET') {
      req.flash('warning', 'لطفاً برای ادامه، رمز عبور خود را تغییر دهید.');
      return res.go('/panel/profile#password');
    }
    return next();
  }
  if (req.xhr || (req.get('accept') || '').includes('application/json')) {
    return res.status(401).json({ error: 'ابتدا وارد شوید' });
  }
  req.session.returnTo = req.originalUrl;
  return res.go('/login');
}

/** نیازمند حداقل یکی از مجوزهای داده‌شده */
function requirePerm(...perms) {
  const list = perms.flat();
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (canAny(req.user, list)) return next();
    next(httpError(403, 'شما مجوز دسترسی به این بخش را ندارید.'));
  };
}

/* ---------------------------- محدوده داده ---------------------------- */

/** شناسه کلاس‌های قابل دسترسی؛ null یعنی همه کلاس‌ها */
async function scopeClassIds(req) {
  if (req._scopeClassIds !== undefined) return req._scopeClassIds;
  const u = req.user;
  let ids = null;
  if (!u) ids = [];
  else if (!u.isSuper && u.data_scope !== 'all') {
    ids = (await db('class_teachers').where({ user_id: u.id }).pluck('class_id')).map(Number);
  }
  req._scopeClassIds = ids;
  return ids;
}

function applyClassScope(qb, column, ids) {
  if (ids === null || ids === undefined) return qb;
  return qb.whereIn(column, ids.length ? ids : [-1]);
}

async function assertClassAccess(req, classId) {
  const ids = await scopeClassIds(req);
  if (ids && !ids.includes(Number(classId))) throw httpError(403, 'شما به این کلاس دسترسی ندارید.');
}

async function hasClassAccess(req, classId) {
  const ids = await scopeClassIds(req);
  return !ids || ids.includes(Number(classId));
}

/** آیا کاربر جاری به اطلاعات کاربر هدف دسترسی دارد؟ */
async function assertUserAccess(req, userId) {
  const ids = await scopeClassIds(req);
  if (ids === null) return;
  if (Number(userId) === Number(req.user.id)) return;
  const row = await db('enrollments').where({ user_id: userId }).whereIn('class_id', ids.length ? ids : [-1]).first();
  if (!row) throw httpError(403, 'شما به اطلاعات این کاربر دسترسی ندارید.');
}

/** محدود کردن کوئری کاربران به دانشجویان کلاس‌های در محدوده */
function applyUserScope(qb, column, ids) {
  if (ids === null || ids === undefined) return qb;
  return qb.whereIn(column, function () {
    this.select('user_id').from('enrollments').whereIn('class_id', ids.length ? ids : [-1]);
  });
}

/**
 * جلوگیری از افزایش سطح دسترسی: کاربر فقط نقشی را می‌تواند به دیگران بدهد
 * که همه مجوزهای آن را خودش داشته باشد.
 */
async function canAssignRole(actor, roleId) {
  if (actor.isSuper) return true;
  const role = await db('roles').where({ id: roleId }).first();
  if (!role || role.is_super) return false;
  if (role.data_scope === 'all' && actor.data_scope !== 'all') return false;
  const perms = await db('role_permissions').where({ role_id: roleId }).pluck('permission');
  return perms.every((p) => actor.perms.has(p));
}

async function canManageUser(actor, target) {
  if (actor.isSuper) return true;
  if (!target) return false;
  const role = await db('roles').where({ id: target.role_id }).first();
  if (role && role.is_super) return false;
  return canAssignRole(actor, target.role_id);
}

module.exports = {
  hashPassword, verifyPassword, fetchUser, loadUser, can, canAny, requireAuth, requirePerm,
  scopeClassIds, applyClassScope, assertClassAccess, hasClassAccess, assertUserAccess, applyUserScope,
  canAssignRole, canManageUser,
};
