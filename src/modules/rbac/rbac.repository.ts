/** Repository — نقش‌ها، مجوزها، user_roles, role_permissions */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { nowDb } from '../../core/db/time';

export class RbacRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listPermissions() {
    return this.db.selectFrom('permissions').selectAll().orderBy('module').orderBy('resource').orderBy('action').execute();
  }

  async findPermissionByKey(module: string, resource: string, action: string) {
    return this.db
      .selectFrom('permissions')
      .selectAll()
      .where('module', '=', module)
      .where('resource', '=', resource)
      .where('action', '=', action)
      .executeTakeFirst();
  }

  async upsertPermission(module: string, resource: string, action: string, description: string | null) {
    const existing = await this.findPermissionByKey(module, resource, action);
    if (existing) return Number(existing.id);
    const res = await this.db
      .insertInto('permissions')
      .values({ module, resource, action, description })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async listRoles() {
    return this.db.selectFrom('roles').selectAll().orderBy('id').execute();
  }

  async findRoleBySlug(slug: string) {
    return this.db.selectFrom('roles').selectAll().where('slug', '=', slug).executeTakeFirst();
  }

  async findRoleById(id: number) {
    return this.db.selectFrom('roles').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async createRole(name: string, slug: string, description: string | null, isSystem: boolean) {
    const res = await this.db
      .insertInto('roles')
      .values({ name, slug, description, is_system: isSystem ? 1 : 0, created_at: nowDb(), updated_at: nowDb() })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async updateRole(id: number, name: string, description: string | null) {
    await this.db.updateTable('roles').set({ name, description, updated_at: nowDb() }).where('id', '=', id).execute();
  }

  async deleteRole(id: number) {
    await this.db.deleteFrom('role_permissions').where('role_id', '=', id).execute();
    await this.db.deleteFrom('user_roles').where('role_id', '=', id).execute();
    await this.db.deleteFrom('roles').where('id', '=', id).execute();
  }

  async setRolePermissions(roleId: number, permissionIds: number[]) {
    await this.db.deleteFrom('role_permissions').where('role_id', '=', roleId).execute();
    if (permissionIds.length) {
      await this.db
        .insertInto('role_permissions')
        .values(permissionIds.map((permission_id) => ({ role_id: roleId, permission_id })))
        .execute();
    }
  }

  async getRolePermissionIds(roleId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('role_permissions')
      .select('permission_id')
      .where('role_id', '=', roleId)
      .execute();
    return rows.map((r) => Number(r.permission_id));
  }

  async getUserRoleSlugs(userId: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.id', 'user_roles.role_id')
      .select('roles.slug')
      .where('user_roles.user_id', '=', userId)
      .where('roles.is_active', '=', 1)
      .execute();
    return rows.map((r) => r.slug);
  }

  async getUserPermissions(userId: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('user_roles')
      .innerJoin('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
      .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
      .select(['permissions.module', 'permissions.resource', 'permissions.action'])
      .where('user_roles.user_id', '=', userId)
      .execute();
    const keys = rows.map((r) => `${r.module}.${r.resource}.${r.action}`);
    return [...new Set(keys)];
  }

  async setUserRoles(userId: number, roleIds: number[]) {
    await this.db.deleteFrom('user_roles').where('user_id', '=', userId).execute();
    if (roleIds.length) {
      await this.db
        .insertInto('user_roles')
        .values(roleIds.map((role_id) => ({ user_id: userId, role_id })))
        .execute();
    }
  }

  async countUsersWithRole(roleId: number): Promise<number> {
    const row = await this.db
      .selectFrom('user_roles')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }
}
