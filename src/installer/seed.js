'use strict';
/** مقداردهی اولیه: نقش‌های پیش‌فرض و مجوزها */
const { db, insertId } = require('../core/db');
const registry = require('../core/modules');
const jalali = require('../core/jalali');

function expandPerms(role) {
  const all = registry.allPermissionKeys();
  if (role.perms === '*') return all.filter((p) => !(role.except || []).includes(p));
  return (role.perms || []).filter((p) => all.includes(p));
}

async function seedRoles() {
  const { DEFAULT_ROLES } = require('../modules/users');
  const now = jalali.now();
  for (const r of DEFAULT_ROLES) {
    let role = await db('roles').where({ slug: r.slug }).first();
    if (!role) {
      const id = await insertId('roles', {
        name: r.name, slug: r.slug, description: r.description, kind: r.kind, data_scope: r.data_scope,
        is_system: !!r.is_system, is_super: !!r.is_super, color: r.color, created_at: now, updated_at: now,
      });
      role = { id };
      const perms = expandPerms(r);
      for (const p of perms) await db('role_permissions').insert({ role_id: id, permission: p });
    }
  }
}

module.exports = { seedRoles, expandPerms };
