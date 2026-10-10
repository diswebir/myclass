/** Service — مدیریت نقش‌ها و مجوزها (بدون خودارتقایی، نقش‌های سیستمی غیرقابل حذف). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { RbacRepository } from './rbac.repository';
import { PERMISSIONS, SYSTEM_ROLES, permissionKey, type RoleDef } from './catalog';

export class RbacService {
  readonly repo: RbacRepository;

  constructor(private readonly db: Kysely<Database>) {
    this.repo = new RbacRepository(db);
  }

  /** همگام‌سازی کاتالوگ مجوزها با DB (idempotent) — توسط seed صدا زده می‌شود. */
  async syncPermissions(): Promise<number> {
    let count = 0;
    for (const p of PERMISSIONS) {
      await this.repo.upsertPermission(p.module, p.resource, p.action, p.description);
      count++;
    }
    return count;
  }

  /** seed نقش‌های سیستمی (idempotent) — نقش موجود آپدیت می‌شود مگر permissionها (دستی حفظ می‌شوند). */
  async seedSystemRoles(): Promise<void> {
    for (const role of SYSTEM_ROLES) {
      const existing = await this.repo.findRoleBySlug(role.slug);
      if (!existing) {
        const roleId = await this.repo.createRole(role.name, role.slug, role.description, true);
        const permIds = await this.resolvePermissionIds(role.permissions);
        await this.repo.setRolePermissions(roleId, permIds);
      }
    }
  }

  /**
   * تبدیل لیست مجوزها به idهای DB.
   * قالب‌ها: 'module.resource.action' | 'module.*' | 'module.resource.*' | '*:*' | 'module.action' (shorthand: همه resourceهای ماژول با آن action)
   */
  async resolvePermissionIds(keys: string[]): Promise<number[]> {
    const ids = new Set<number>();
    const needsAll = keys.some((k) => k === '*:*' || k.endsWith('.*') || k.split('.').length === 2);
    const all = needsAll ? await this.repo.listPermissions() : [];
    for (const key of keys) {
      if (key === '*:*') {
        for (const p of all) ids.add(Number(p.id));
        continue;
      }
      if (key.endsWith('.*')) {
        const [module, resource] = key.split('.');
        for (const p of all) {
          if (p.module === module && (resource === '*' || p.resource === resource)) ids.add(Number(p.id));
        }
        continue;
      }
      const parts = key.split('.');
      if (parts.length === 2) {
        // shorthand: 'module.action' — همه resourceهای آن ماژول با این action
        const [module, action] = parts;
        for (const p of all) {
          if (p.module === module && p.action === action) ids.add(Number(p.id));
        }
        continue;
      }
      const [module, resource, action] = parts;
      const p = await this.repo.findPermissionByKey(module, resource, action);
      if (p) ids.add(Number(p.id));
    }
    return [...ids];
  }

  async listRoles() {
    const roles = await this.repo.listRoles();
    const out = [];
    for (const r of roles) {
      const permIds = await this.repo.getRolePermissionIds(Number(r.id));
      out.push({
        id: Number(r.id),
        name: r.name,
        slug: r.slug,
        description: r.description,
        isSystem: r.is_system === 1,
        isActive: r.is_active === 1,
        permissionIds: permIds,
      });
    }
    return out;
  }

  async createRole(actor: AuthUser, name: string, slug: string, description: string | null, permissionKeys: string[]) {
    if (await this.repo.findRoleBySlug(slug)) throw AppError.conflict('slug نقش تکراری است.');
    const roleId = await this.repo.createRole(name, slug, description, false);
    const permIds = await this.resolvePermissionIds(permissionKeys);
    await this.repo.setRolePermissions(roleId, permIds);
    return roleId;
  }

  async updateRole(actor: AuthUser, roleId: number, name: string, description: string | null, permissionKeys?: string[]) {
    const role = await this.repo.findRoleById(roleId);
    if (!role) throw AppError.notFound('نقش یافت نشد.');
    await this.repo.updateRole(roleId, name, description);
    if (permissionKeys) {
      const permIds = await this.resolvePermissionIds(permissionKeys);
      await this.repo.setRolePermissions(roleId, permIds);
    }
  }

  async deleteRole(actor: AuthUser, roleId: number) {
    const role = await this.repo.findRoleById(roleId);
    if (!role) throw AppError.notFound('نقش یافت نشد.');
    if (role.is_system === 1) throw AppError.badRequest('نقش‌های سیستمی غیرقابل حذف هستند.');
    await this.repo.deleteRole(roleId);
  }

  /** تخصیص نقش به کاربر — کاربر نمی‌تواند نقش خود را عوض کند مگر license داشته باشد. */
  async assignRoles(actor: AuthUser, userId: number, roleIds: number[], opts: { allowSelf?: boolean } = {}) {
    if (!opts.allowSelf && actor.id === userId) {
      throw AppError.forbidden('تغییر نقش خود مجاز نیست؛ فقط مدیر می‌تواند نقش شما را تغییر دهد.');
    }
    const roles = await this.repo.listRoles();
    for (const id of roleIds) {
      if (!roles.some((r) => Number(r.id) === id && r.is_active === 1)) {
        throw AppError.badRequest('نقش نامعتبر یا غیرفعال است.');
      }
    }
    await this.repo.setUserRoles(userId, roleIds);
  }

  async getUserRoleSlugs(userId: number) {
    return this.repo.getUserRoleSlugs(userId);
  }

  async getUserPermissions(userId: number) {
    return this.repo.getUserPermissions(userId);
  }
}

export { permissionKey, type RoleDef };
