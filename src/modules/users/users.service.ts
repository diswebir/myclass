import type { Database, Queryable } from '../../db/database';
import { errors, AppError } from '../../lib/errors';
import { generateTemporaryPassword, hashPassword } from '../../lib/crypto';
import { MAX_PASSWORD_LENGTH } from '../auth/auth.service';
import { normalizeIranMobile, normalizeText, normalizeUsername, toEnglishDigits } from '../../lib/persian';
import { SUPER_ADMIN_ROLE, missingGrantablePermissions } from '../../rbac/permissions';
import type { AuditService } from '../audit/audit.service';
import type { AuthService } from '../auth/auth.service';

export interface Actor {
  id: number;
  permissions: ReadonlySet<string>;
  ip: string | null;
}

export interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_id: number;
  role_slug: string;
  role_name: string;
  status: 'active' | 'disabled';
  must_change_password: number;
  last_login_at: Date | null;
  created_at: Date;
}

export interface UserInput {
  username?: string;
  fullName: string;
  email?: string;
  phone?: string;
  roleId: number;
  password?: string;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function validateProfile(input: Partial<UserInput>, requireUsername: boolean): Record<string, string> {
  const fe: Record<string, string> = {};
  if (requireUsername) {
    const u = normalizeUsername(input.username ?? '');
    if (!USERNAME_RE.test(u)) fe.username = 'نام کاربری باید ۳ تا ۶۴ نویسه از حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.';
  }
  const name = normalizeText(input.fullName ?? '');
  if (name.length < 2 || name.length > 190) fe.fullName = 'نام و نام خانوادگی باید بین ۲ تا ۱۹۰ نویسه باشد.';
  if (input.email && input.email.trim() !== '' && (!EMAIL_RE.test(input.email.trim()) || input.email.trim().length > 190)) {
    fe.email = 'ایمیل نامعتبر است.';
  }
  if (input.phone && input.phone.trim() !== '' && !normalizeIranMobile(input.phone)) {
    fe.phone = 'شماره همراه باید یک شماره موبایل ایرانی معتبر باشد (مثال: ۰۹۱۲۱۲۳۴۵۶۷).';
  }
  if (!Number.isInteger(input.roleId) || (input.roleId as number) <= 0) fe.roleId = 'نقش را انتخاب کنید.';
  return fe;
}

/**
 * User administration. Every mutating method enforces:
 *  - anti-escalation: the actor must already hold every permission of the target role;
 *  - no self-lockout: an actor cannot disable themselves or change their own role;
 *  - the last active super administrator can never be disabled or demoted.
 */
export class UsersService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly passwordMinLength: () => Promise<number>,
  ) {}

  async list(filter: { q?: string; status?: string; roleId?: number; page: number; pageSize: number }): Promise<{ rows: UserRow[]; total: number }> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.q) {
      // Persian/Arabic digits are folded so searching ۰۹۱۲ finds 0912 (phones are stored ASCII).
      const term = toEnglishDigits(normalizeText(filter.q)).replace(/[\s-]/g, '');
      const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
      where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)');
      params.push(like, like, like, like);
    }
    if (filter.status === 'active' || filter.status === 'disabled') {
      where.push('u.status = ?');
      params.push(filter.status);
    }
    if (filter.roleId) {
      where.push('u.role_id = ?');
      params.push(filter.roleId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [count] = await this.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params);
    const rows = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, r.slug AS role_slug, r.name_fa AS role_name,
              u.status, u.must_change_password, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id
         ${whereSql}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ? OFFSET ?`,
      [...params, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    return { rows, total: Number(count?.n ?? 0) };
  }

  async get(id: number): Promise<UserRow> {
    const [row] = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, r.slug AS role_slug, r.name_fa AS role_name,
              u.status, u.must_change_password, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [id],
    );
    if (!row) throw errors.notFound('کاربر');
    return row;
  }

  private async rolePermissionCodes(roleId: number): Promise<{ slug: string; codes: string[]; active: boolean }> {
    const [role] = await this.db.query<{ slug: string; is_active: number }>('SELECT slug, is_active FROM roles WHERE id = ?', [roleId]);
    if (!role) throw errors.badRequest('نقش انتخاب‌شده یافت نشد.', { roleId: 'نقش نامعتبر است.' });
    const codes = await this.db.query<{ code: string }>(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
      [roleId],
    );
    return { slug: role.slug, codes: codes.map((c) => c.code), active: role.is_active === 1 };
  }

  /** Anti-escalation guard: the actor may only manage/assign roles whose permissions they fully hold. */
  private async assertCanGrantRole(actor: Actor, roleId: number): Promise<{ slug: string }> {
    const role = await this.rolePermissionCodes(roleId);
    if (!role.active) throw errors.badRequest('نقش انتخاب‌شده غیرفعال است.', { roleId: 'نقش غیرفعال است.' });
    const missing = missingGrantablePermissions(actor.permissions, role.codes);
    if (missing.length > 0) {
      throw errors.forbidden();
    }
    return { slug: role.slug };
  }

  private async assertCanManageTarget(actor: Actor, targetUserId: number): Promise<UserRow> {
    const target = await this.get(targetUserId);
    const role = await this.rolePermissionCodes(target.role_id);
    if (missingGrantablePermissions(actor.permissions, role.codes).length > 0) throw errors.forbidden();
    return target;
  }

  /**
   * Counts active super administrators and locks their rows (FOR UPDATE) inside the caller's transaction,
   * so two concurrent requests cannot each see "2 admins" and demote both.
   */
  private async countActiveSuperAdminsLocked(q: Queryable): Promise<number> {
    const rows = await q.query<{ id: number }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.slug = ? AND u.status = 'active' FOR UPDATE`,
      [SUPER_ADMIN_ROLE],
    );
    return rows.length;
  }

  async create(actor: Actor, input: UserInput): Promise<number> {
    const fe = validateProfile(input, true);
    const minLen = await this.passwordMinLength();
    const password = input.password ?? '';
    if (password.length < minLen) fe.password = `رمز عبور باید حداقل ${minLen} نویسه باشد.`;
    else if (password.length > MAX_PASSWORD_LENGTH) fe.password = 'رمز عبور بیش از حد طولانی است.';
    if (Object.keys(fe).length) throw errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);

    await this.assertCanGrantRole(actor, input.roleId);
    const username = normalizeUsername(input.username!);
    const phone = input.phone && input.phone.trim() ? normalizeIranMobile(input.phone) : null;
    const email = input.email && input.email.trim() ? input.email.trim().toLowerCase() : null;
    const hash = await hashPassword(password);
    try {
      const res = await this.db.execute(
        `INSERT INTO users (username, email, phone, full_name, password_hash, role_id, must_change_password, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [username, email, phone, normalizeText(input.fullName), hash, input.roleId, actor.id],
      );
      const id = Number(res.insertId);
      await this.audit.record({ action: 'user.created', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip, details: { username, roleId: input.roleId } });
      return id;
    } catch (err) {
      throw this.mapDuplicate(err);
    }
  }

  private mapDuplicate(err: unknown): Error {
    const code = (err as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY') {
      const msg = String((err as { message?: string }).message ?? '');
      if (msg.includes('uq_users_username')) return errors.conflict('این نام کاربری قبلاً ثبت شده است.');
      if (msg.includes('uq_users_phone')) return errors.conflict('این شماره همراه قبلاً ثبت شده است.');
      if (msg.includes('uq_users_email')) return errors.conflict('این ایمیل قبلاً ثبت شده است.');
      return errors.conflict('اطلاعات تکراری است.');
    }
    return err instanceof Error ? err : new Error('unknown error');
  }

  async update(actor: Actor, id: number, input: Omit<UserInput, 'username' | 'password'>): Promise<void> {
    const fe = validateProfile(input, false);
    if (Object.keys(fe).length) throw errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
    const target = await this.assertCanManageTarget(actor, id);
    const roleChanged = target.role_id !== input.roleId;
    if (roleChanged) {
      if (id === actor.id) throw new AppError(400, 'SELF_ROLE_CHANGE', 'امکان تغییر نقش خودتان وجود ندارد.');
      await this.assertCanGrantRole(actor, input.roleId);
    }
    const phone = input.phone && input.phone.trim() ? normalizeIranMobile(input.phone) : null;
    const email = input.email && input.email.trim() ? input.email.trim().toLowerCase() : null;
    try {
      await this.db.transaction(async (tx) => {
        if (roleChanged && target.role_slug === SUPER_ADMIN_ROLE && (await this.countActiveSuperAdminsLocked(tx)) <= 1) {
          throw errors.conflict('آخرین مدیر اصلی فعال را نمی‌توان تغییر نقش داد.');
        }
        await tx.execute(
          'UPDATE users SET full_name = ?, email = ?, phone = ?, role_id = ? WHERE id = ?',
          [normalizeText(input.fullName), email, phone, input.roleId, id],
        );
      });
    } catch (err) {
      throw this.mapDuplicate(err);
    }
    await this.audit.record({
      action: roleChanged ? 'user.role_changed' : 'user.updated',
      actorUserId: actor.id,
      entityType: 'user',
      entityId: id,
      ip: actor.ip,
      details: { fromRole: target.role_slug, toRoleId: input.roleId },
    });
  }

  async setStatus(actor: Actor, id: number, active: boolean): Promise<void> {
    if (id === actor.id) throw new AppError(400, 'SELF_DISABLE', 'امکان غیرفعال‌کردن حساب خودتان وجود ندارد.');
    const target = await this.assertCanManageTarget(actor, id);
    await this.db.transaction(async (tx) => {
      if (!active && target.role_slug === SUPER_ADMIN_ROLE && (await this.countActiveSuperAdminsLocked(tx)) <= 1) {
        throw errors.conflict('آخرین مدیر اصلی فعال را نمی‌توان غیرفعال کرد.');
      }
      await tx.execute('UPDATE users SET status = ? WHERE id = ?', [active ? 'active' : 'disabled', id]);
    });
    if (!active) await this.auth.revokeUserSessions(id);
    await this.audit.record({ action: active ? 'user.activated' : 'user.disabled', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip });
  }

  /** Sets a generated temporary password. It is returned once to the administrator and must be changed at next login. */
  async resetPassword(actor: Actor, id: number): Promise<string> {
    await this.assertCanManageTarget(actor, id);
    const temp = generateTemporaryPassword(14);
    await this.auth.setPassword(id, temp, await this.passwordMinLength(), true);
    await this.auth.revokeUserSessions(id);
    await this.audit.record({ action: 'user.password_reset', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip });
    return temp;
  }

  async revokeSessions(actor: Actor, id: number): Promise<number> {
    await this.assertCanManageTarget(actor, id);
    const n = await this.auth.revokeUserSessions(id);
    await this.audit.record({ action: 'user.sessions_revoked', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip, details: { count: n } });
    return n;
  }

  /** Used by the installer to create the first super administrator. */
  async createFirstSuperAdmin(q: Queryable, input: { username: string; fullName: string; email?: string; password: string }): Promise<number> {
    const [role] = await q.query<{ id: number }>('SELECT id FROM roles WHERE slug = ?', [SUPER_ADMIN_ROLE]);
    if (!role) throw new Error('نقش مدیر اصلی یافت نشد.');
    const hash = await hashPassword(input.password);
    const res = await q.execute(
      `INSERT INTO users (username, email, full_name, password_hash, role_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [normalizeUsername(input.username), input.email ? input.email.trim().toLowerCase() : null, normalizeText(input.fullName), hash, role.id],
    );
    return Number(res.insertId);
  }
}
