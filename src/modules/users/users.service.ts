/** سرویس users — CRUD، فعال/غیرفعال، تغییر/بازنشانی رمز، تخصیص نقش، خروج از نشست‌ها (REQ-P1-18). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { Config } from '../../core/config/env';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { hashPassword, validatePasswordPolicy } from '../../core/security/password';
import { nowDb } from '../../core/db/time';
import { normalizePhone } from '../../core/security/normalize';
import { RbacService } from '../rbac/rbac.service';
import { SessionService } from '../sessions/session.service';
import { AuditService } from '../audit/audit.service';

export class UsersService {
  readonly rbac: RbacService;
  readonly sessions: SessionService;
  readonly audit: AuditService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.rbac = new RbacService(db);
    this.sessions = new SessionService(db, config);
    this.audit = new AuditService(db);
  }

  async list(opts: { q?: string; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('users')
      .select([
        'users.id', 'users.username', 'users.email', 'users.phone', 'users.full_name',
        'users.is_active', 'users.must_change_password', 'users.last_login_at', 'users.created_at',
      ])
      .where('users.deleted_at', 'is', null)
      .orderBy('users.id', 'desc');
    if (opts.q) {
      q = q.where((eb) =>
        eb.or([
          eb('users.username', 'like', `%${opts.q}%`),
          eb('users.full_name', 'like', `%${opts.q}%`),
          eb('users.phone', 'like', `%${opts.q}%`),
        ]),
      );
    }
    const users = await q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
    // نقش‌ها — query جداگانه + گروه‌بندی در JS (قابل حمل بین MySQL/SQLite)
    const ids = users.map((u) => Number(u.id));
    const roleRows = ids.length
      ? await this.db
          .selectFrom('user_roles')
          .innerJoin('roles', 'roles.id', 'user_roles.role_id')
          .select(['user_roles.user_id', 'roles.slug'])
          .where('user_roles.user_id', 'in', ids)
          .execute()
      : [];
    const rolesByUser = new Map<number, string[]>();
    for (const r of roleRows) {
      const uid = Number(r.user_id);
      if (!rolesByUser.has(uid)) rolesByUser.set(uid, []);
      rolesByUser.get(uid)!.push(r.slug);
    }
    return users.map((u) => ({ ...u, role_slugs: (rolesByUser.get(Number(u.id)) ?? []).join(',') }));
  }

  async getById(id: number) {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    const roles = await this.rbac.getUserRoleSlugs(id);
    return { ...user, roleSlugs: roles };
  }

  async create(actor: AuthUser, input: {
    username: string;
    email?: string;
    phone?: string;
    fullName: string;
    password: string;
    roleIds: number[];
    isActive: number;
  }) {
    const username = input.username.trim().toLowerCase();
    const policy = validatePasswordPolicy(input.password);
    if (!policy.ok) throw AppError.badRequest(policy.errors.join(' '));
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
    const existing = await this.db
      .selectFrom('users')
      .select('id')
      .where('username', '=', username)
      .executeTakeFirst();
    if (existing) throw AppError.conflict('نام کاربری تکراری است.');
    if (phone) {
      const dupPhone = await this.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirst();
      if (dupPhone) throw AppError.conflict('شماره موبایل تکراری است.');
    }
    const hash = await hashPassword(input.password, this.config.BCRYPT_ROUNDS);
    const res = await this.db
      .insertInto('users')
      .values({
        username,
        email: input.email || null,
        phone,
        password_hash: hash,
        full_name: input.fullName,
        is_active: input.isActive,
        must_change_password: 1,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const userId = Number(res.insertId);
    await this.rbac.assignRoles(actor, userId, input.roleIds, { allowSelf: true });
    await this.audit.log({
      actorId: actor.id,
      action: 'user_created',
      module: 'users',
      entityType: 'user',
      entityId: userId,
      meta: { username, fullName: input.fullName, roles: input.roleIds },
    });
    return userId;
  }

  async update(actor: AuthUser, userId: number, input: { email?: string; phone?: string; fullName: string; isActive: number }) {
    const user = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
    await this.db
      .updateTable('users')
      .set({
        email: input.email || null,
        phone,
        full_name: input.fullName,
        is_active: input.isActive,
        updated_at: nowDb(),
      })
      .where('id', '=', userId)
      .execute();
    if (input.isActive === 0) {
      // غیرفعال‌سازی — خروج از همه نشست‌ها
      await this.sessions.revokeAllForUser(userId);
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'user_updated',
      module: 'users',
      entityType: 'user',
      entityId: userId,
      meta: { fullName: input.fullName, isActive: input.isActive },
    });
  }

  async setRoles(actor: AuthUser, userId: number, roleIds: number[]) {
    // سیاست: کاربر نمی‌تواند نقش خود را تغییر دهد
    if (actor.id === userId) {
      const current = await this.rbac.getUserRoleSlugs(userId);
      const target = await this.rbac.repo.listRoles();
      const targetSlugs = roleIds.map((id) => target.find((r) => Number(r.id) === id)?.slug).filter(Boolean) as string[];
      if (JSON.stringify([...current].sort()) !== JSON.stringify([...targetSlugs].sort())) {
        throw AppError.forbidden('تغییر نقش خود مجاز نیست.');
      }
    }
    await this.rbac.assignRoles(actor, userId, roleIds);
    await this.audit.log({
      actorId: actor.id,
      action: 'user_roles_changed',
      module: 'users',
      entityType: 'user',
      entityId: userId,
      meta: { roleIds },
    });
  }

  async resetPassword(actor: AuthUser, userId: number, newPassword: string) {
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.ok) throw AppError.badRequest(policy.errors.join(' '));
    const user = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    const hash = await hashPassword(newPassword, this.config.BCRYPT_ROUNDS);
    await this.db
      .updateTable('users')
      .set({ password_hash: hash, must_change_password: 1, updated_at: nowDb() })
      .where('id', '=', userId)
      .execute();
    await this.sessions.revokeAllForUser(userId);
    await this.audit.log({
      actorId: actor.id,
      action: 'user_password_reset',
      module: 'users',
      entityType: 'user',
      entityId: userId,
    });
  }

  /** حذف نرم (soft delete) + خروج از همه نشست‌ها */
  async softDelete(actor: AuthUser, userId: number) {
    if (actor.id === userId) throw AppError.badRequest('نمی‌توانید حساب خود را غیرفعال کنید.');
    const user = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw AppError.notFound('کاربر یافت نشد.');
    await this.db
      .updateTable('users')
      .set({ deleted_at: nowDb(), is_active: 0, updated_at: nowDb() })
      .where('id', '=', userId)
      .execute();
    await this.sessions.revokeAllForUser(userId);
    await this.audit.log({
      actorId: actor.id,
      action: 'user_deleted',
      module: 'users',
      entityType: 'user',
      entityId: userId,
    });
  }
}
