/** سرویس نشست — جدول user_sessions در DB (per spec §۲: کوکی HttpOnly/Secure/SameSite + جدول نشست). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { Config } from '../../core/config/env';
import { nowDb, toDbDateTime } from '../../core/db/time';
import { hashSessionToken, randomToken } from '../../core/security/tokens';

export interface CreatedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export class SessionService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {}

  async create(userId: number, ip: string | null, userAgent: string | null): Promise<CreatedSession> {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600 * 1000);
    await this.db
      .insertInto('user_sessions')
      .values({
        token_hash: hashSessionToken(token),
        user_id: userId,
        csrf_token: csrfToken,
        ip,
        user_agent: userAgent?.slice(0, 255) ?? null,
        created_at: nowDb(),
        expires_at: toDbDateTime(expiresAt),
        last_seen_at: nowDb(),
        revoked_at: null,
      })
      .execute();
    return { token, csrfToken, expiresAt };
  }

  /** لود نشست از روی توکن — null یعنی نامعتبر/منقضی/باطل‌شده. */
  async resolve(token: string) {
    if (!token) return null;
    const row = await this.db
      .selectFrom('user_sessions')
      .selectAll()
      .where('token_hash', '=', hashSessionToken(token))
      .executeTakeFirst();
    if (!row) return null;
    if (row.revoked_at) return null;
    const expiresAt = new Date(row.expires_at + 'Z');
    if (expiresAt.getTime() < Date.now()) return null;
    // idle timeout
    const idleMs = this.config.SESSION_IDLE_HOURS * 3600 * 1000;
    if (row.last_seen_at) {
      const lastSeen = new Date(row.last_seen_at + 'Z');
      if (Date.now() - lastSeen.getTime() > idleMs) {
        await this.revokeByHash(row.token_hash);
        return null;
      }
    }
    // به‌روزرسانی last_seen (ساده: در هر درخواست)
    await this.db
      .updateTable('user_sessions')
      .set({ last_seen_at: nowDb() })
      .where('token_hash', '=', row.token_hash)
      .execute();
    return row;
  }

  async revokeByHash(tokenHash: string): Promise<void> {
    await this.db
      .updateTable('user_sessions')
      .set({ revoked_at: nowDb() })
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revoke(token: string): Promise<void> {
    if (token) await this.revokeByHash(hashSessionToken(token));
  }

  /** خروج از همه نشست‌های کاربر */
  async revokeAllForUser(userId: number, exceptToken?: string): Promise<void> {
    let q = this.db
      .updateTable('user_sessions')
      .set({ revoked_at: nowDb() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null);
    if (exceptToken) q = q.where('token_hash', '!=', hashSessionToken(exceptToken));
    await q.execute();
  }

  async listForUser(userId: number) {
    const rows = await this.db
      .selectFrom('user_sessions')
      .select(['token_hash', 'ip', 'user_agent', 'created_at', 'last_seen_at', 'expires_at', 'revoked_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      ...r,
      tokenPreview: `${r.token_hash.slice(0, 8)}…`,
    }));
  }

  async revokeByIdForUser(userId: number, tokenHash: string): Promise<void> {
    await this.db
      .updateTable('user_sessions')
      .set({ revoked_at: nowDb() })
      .where('user_id', '=', userId)
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** پاکسازی نشست‌های منقضی (برای cron) */
  async purgeExpired(): Promise<number> {
    const cutoff = toDbDateTime(new Date());
    const res = await this.db
      .deleteFrom('user_sessions')
      .where('expires_at', '<', cutoff)
      .executeTakeFirstOrThrow();
    return Number(res.numDeletedRows ?? 0);
  }
}
