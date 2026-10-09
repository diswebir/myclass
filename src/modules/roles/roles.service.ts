import type { Database } from '../../db/database';
import { errors, AppError } from '../../lib/errors';
import { normalizeText } from '../../lib/persian';
import { PERMISSIONS, SUPER_ADMIN_ROLE, isKnownPermission, missingGrantablePermissions } from '../../rbac/permissions';
import type { AuditService } from '../audit/audit.service';
import type { Actor } from '../users/users.service';

export interface RoleRow {
  id: number;
  slug: string;
  name_fa: string;
  description: string | null;
  is_system: number;
  is_active: number;
  user_count: number;
  permission_count: number;
}

export interface RoleInput {
  slug?: string;
  nameFa: string;
  description?: string;
  permissions: string[];
}

const SLUG_RE = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * Role management (custom roles, permission assignment, activation, deletion).
 * Rules: system roles cannot be deleted; super_admin permissions are fixed; an actor cannot grant
 * permissions they do not hold; roles with assigned users cannot be deleted.
 */
export class RolesService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleRow[]> {
    return this.db.query<RoleRow>(
      `SELECT r.id, r.slug, r.name_fa, r.description, r.is_system, r.is_active,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
         FROM roles r ORDER BY r.is_system DESC, r.name_fa ASC`,
    );
  }

  async get(id: number): Promise<RoleRow & { permissions: string[] }> {
    const [row] = await this.db.query<RoleRow>(
      `SELECT r.id, r.slug, r.name_fa, r.description, r.is_system, r.is_active,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
         FROM roles r WHERE r.id = ?`,
      [id],
    );
    if (!row) throw errors.notFound('نقش');
    const perms = await this.db.query<{ code: string }>(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
      [id],
    );
    return { ...row, permissions: perms.map((p) => p.code) };
  }

  private validatePermissions(actor: Actor, codes: string[]): void {
    const unknown = codes.filter((c) => !isKnownPermission(c));
    if (unknown.length) throw errors.badRequest('مجوز نامعتبر انتخاب شده است.', { permissions: 'مجوز نامعتبر است.' });
    if (missingGrantablePermissions(actor.permissions, codes).length > 0) throw errors.forbidden();
  }

  private validateNameAndDescription(input: { nameFa: string; description?: string }): Record<string, string> {
    const fe: Record<string, string> = {};
    const name = normalizeText(input.nameFa ?? '');
    if (name.length < 2 || name.length > 120) fe.nameFa = 'نام نقش باید بین ۲ تا ۱۲۰ نویسه باشد.';
    if ((input.description ?? '').length > 500) fe.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
    return fe;
  }

  private permissionIds(codes: string[]): string[] {
    return [...new Set(codes)];
  }

  async create(actor: Actor, input: RoleInput): Promise<number> {
    const fe = this.validateNameAndDescription(input);
    const slug = (input.slug ?? '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) fe.slug = 'شناسه نقش باید با حرف انگلیسی شروع شود و فقط حروف کوچک، عدد و زیرخط داشته باشد (۳ تا ۶۴ نویسه).';
    if (Object.keys(fe).length) throw errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
    if (slug === SUPER_ADMIN_ROLE) throw errors.conflict('این شناسه برای نقش سیستمی رزرو شده است.');
    const perms = this.permissionIds(input.permissions);
    this.validatePermissions(actor, perms);

    return this.db.transaction(async (tx) => {
      const [dup] = await tx.query<{ id: number }>('SELECT id FROM roles WHERE slug = ?', [slug]);
      if (dup) throw errors.conflict('نقشی با این شناسه وجود دارد.');
      const res = await tx.execute(
        'INSERT INTO roles (slug, name_fa, description, is_system, is_active) VALUES (?, ?, ?, 0, 1)',
        [slug, normalizeText(input.nameFa), input.description?.trim() || null],
      );
      const roleId = Number(res.insertId);
      for (const code of perms) {
        await tx.execute(
          'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ?',
          [roleId, code],
        );
      }
      await this.audit.record({ action: 'role.created', actorUserId: actor.id, entityType: 'role', entityId: roleId, ip: actor.ip, details: { slug, permissions: perms } });
      return roleId;
    });
  }

  async update(actor: Actor, id: number, input: RoleInput): Promise<void> {
    const fe = this.validateNameAndDescription(input);
    if (Object.keys(fe).length) throw errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
    const role = await this.get(id);
    const perms = this.permissionIds(input.permissions);
    if (role.slug === SUPER_ADMIN_ROLE) {
      // The super administrator always holds every permission; only the display name may change.
      if (perms.length !== PERMISSIONS.length) throw new AppError(400, 'LOCKED_ROLE', 'مجوزهای مدیر اصلی قابل تغییر نیست.');
    } else {
      this.validatePermissions(actor, perms);
    }
    await this.db.transaction(async (tx) => {
      await tx.execute('UPDATE roles SET name_fa = ?, description = ? WHERE id = ?', [normalizeText(input.nameFa), input.description?.trim() || null, id]);
      if (role.slug !== SUPER_ADMIN_ROLE) {
        await tx.execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
        for (const code of perms) {
          await tx.execute('INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ?', [id, code]);
        }
      }
    });
    await this.audit.record({
      action: 'role.updated',
      actorUserId: actor.id,
      entityType: 'role',
      entityId: id,
      ip: actor.ip,
      details: { before: role.permissions, after: role.slug === SUPER_ADMIN_ROLE ? 'locked' : perms },
    });
  }

  async setActive(actor: Actor, id: number, active: boolean): Promise<void> {
    const role = await this.get(id);
    if (role.is_system) throw new AppError(400, 'SYSTEM_ROLE', 'نقش‌های سیستمی قابل غیرفعال‌سازی نیستند.');
    await this.db.execute('UPDATE roles SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    await this.audit.record({ action: active ? 'role.activated' : 'role.deactivated', actorUserId: actor.id, entityType: 'role', entityId: id, ip: actor.ip });
  }

  async remove(actor: Actor, id: number): Promise<void> {
    const role = await this.get(id);
    if (role.is_system) throw new AppError(400, 'SYSTEM_ROLE', 'نقش‌های سیستمی قابل حذف نیستند.');
    if (role.user_count > 0) throw errors.conflict('این نقش به کاربران اختصاص داده شده است. ابتدا نقش آن‌ها را تغییر دهید یا نقش را غیرفعال کنید.');
    await this.db.execute('DELETE FROM roles WHERE id = ?', [id]);
    await this.audit.record({ action: 'role.deleted', actorUserId: actor.id, entityType: 'role', entityId: id, ip: actor.ip, details: { slug: role.slug } });
  }
}
