/** سرویس احراز هویت — login/logout، قفل موقت پس از تلاش ناموفق (per spec §۶-پ). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { Config } from '../../core/config/env';
import { AppError } from '../../core/errors/AppError';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '../../core/security/password';
import { nowDb, toDbDateTime } from '../../core/db/time';
import { SessionService, type CreatedSession } from '../sessions/session.service';
import { AuditService } from '../audit/audit.service';

const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

export interface LoginResult {
  session: CreatedSession;
  user: {
    id: number;
    username: string;
    fullName: string;
    mustChangePassword: boolean;
  };
}

export class AuthService {
  readonly sessions: SessionService;
  readonly audit: AuditService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.sessions = new SessionService(db, config);
    this.audit = new AuditService(db);
  }

  async login(username: string, password: string, ip: string | null, userAgent: string | null): Promise<LoginResult> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('username', '=', username.trim().toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!user) {
      await this.audit.log({ action: 'login_failed', module: 'auth', meta: { username, reason: 'user_not_found' }, ip });
      throw AppError.unauthorized('نام کاربری یا رمز عبور نادرست است.');
    }

    // قفل موقت?
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until + 'Z');
      if (lockedUntil.getTime() > Date.now()) {
        await this.audit.log({ actorId: Number(user.id), action: 'login_failed', module: 'auth', meta: { username, reason: 'locked' }, ip });
        throw AppError.tooManyRequests('حساب موقتاً قفل شده است. کمی بعد تلاش کنید.');
      }
    }

    if (user.is_active !== 1) {
      await this.audit.log({ actorId: Number(user.id), action: 'login_failed', module: 'auth', meta: { username, reason: 'inactive' }, ip });
      throw AppError.forbidden('حساب کاربری غیرفعال است.');
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const attempts = Number(user.failed_login_attempts) + 1;
      const lockUntil = attempts >= LOCK_THRESHOLD ? toDbDateTime(new Date(Date.now() + LOCK_MINUTES * 60 * 1000)) : null;
      await this.db
        .updateTable('users')
        .set({
          failed_login_attempts: attempts,
          locked_until: lockUntil,
          updated_at: nowDb(),
        })
        .where('id', '=', Number(user.id))
        .execute();
      await this.audit.log({
        actorId: Number(user.id),
        action: 'login_failed',
        module: 'auth',
        meta: { username, reason: 'bad_password', attempts, locked: !!lockUntil },
        ip,
      });
      throw AppError.unauthorized('نام کاربری یا رمز عبور نادرست است.');
    }

    // ورود موفق — بازنشانی تلاش‌های ناموفق + ثبت آخرین ورود
    await this.db
      .updateTable('users')
      .set({
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: nowDb(),
        last_login_ip: ip,
        updated_at: nowDb(),
      })
      .where('id', '=', Number(user.id))
      .execute();

    const session = await this.sessions.create(Number(user.id), ip, userAgent);
    await this.audit.log({ actorId: Number(user.id), action: 'login_success', module: 'auth', ip });

    return {
      session,
      user: {
        id: Number(user.id),
        username: user.username,
        fullName: user.full_name,
        mustChangePassword: user.must_change_password === 1,
      },
    };
  }

  async logout(token: string | undefined, userId?: number): Promise<void> {
    if (token) await this.sessions.revoke(token);
    if (userId) await this.audit.log({ actorId: userId, action: 'logout', module: 'auth' });
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_hash'])
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) throw AppError.badRequest('رمز عبور فعلی نادرست است.');
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.ok) throw AppError.badRequest(policy.errors.join(' '));
    const hash = await hashPassword(newPassword, this.config.BCRYPT_ROUNDS);
    await this.db
      .updateTable('users')
      .set({ password_hash: hash, must_change_password: 0, updated_at: nowDb() })
      .where('id', '=', userId)
      .execute();
    // خروج از همه نشست‌ها به‌جز فعلی ( امنیت — per spec: امکان خروج از نشست‌ها)
    await this.audit.log({ actorId: userId, action: 'password_changed', module: 'auth' });
  }
}
