/** Rate limit — با ذخیره در DB (جدول rate_limits) — per spec §۲ (ممکن است چند پروسس وجود داشته باشد). */
import type { Kysely } from 'kysely';
import { rateLimit, MemoryStore, type Store, type Options, type ClientRateLimitInfo } from 'express-rate-limit';
import type { Database } from '../../db/types';
import type { Config } from '../../config/env';
import { nowDb, toDbDateTime } from '../../db/time';
import { AppError } from '../../errors/AppError';
import { logger } from '../../logger/logger';

interface RateLimitRow {
  key: string;
  window_start: string;
  count: number;
  expires_at: string;
}

class DbRateLimitStore implements Store {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly windowMs: number,
  ) {}

  private windowStartMs(): number {
    return Math.floor(Date.now() / this.windowMs) * this.windowMs;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const windowStart = new Date(this.windowStartMs());
    const expiresAt = new Date(windowStart.getTime() + this.windowMs);
    const wsSec = Math.floor(windowStart.getTime() / 1000);
    const row = (await this.db
      .selectFrom('rate_limits')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst()) as RateLimitRow | undefined;
    const windowMatches = !!row && Math.floor(new Date(row.window_start + 'Z').getTime() / 1000) === wsSec;
    if (windowMatches && row) {
      const newCount = Number(row.count) + 1;
      await this.db
        .updateTable('rate_limits')
        .set({ count: newCount })
        .where('key', '=', key)
        .execute();
      return { totalHits: newCount, resetTime: expiresAt };
    }
    // پنجره جدید — upsert با count=1
    const upd = await this.db
      .updateTable('rate_limits')
      .set({
        count: 1,
        window_start: toDbDateTime(windowStart),
        expires_at: toDbDateTime(expiresAt),
      })
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    if (Number(upd.numUpdatedRows ?? 0) > 0) {
      return { totalHits: 1, resetTime: expiresAt };
    }
    try {
      await this.db
        .insertInto('rate_limits')
        .values({
          key,
          window_start: toDbDateTime(windowStart),
          count: 1,
          expires_at: toDbDateTime(expiresAt),
        })
        .execute();
    } catch {
      // race — ردیف همزمان ساخته شد؛ مشکلی نیست
    }
    return { totalHits: 1, resetTime: expiresAt };
  }

  async decrement(key: string): Promise<void> {
    await this.db
      .updateTable('rate_limits')
      .set({ count: 0 })
      .where('key', '=', key)
      .execute();
  }

  async resetKey(key: string): Promise<void> {
    await this.db.deleteFrom('rate_limits').where('key', '=', key).execute();
  }
}

/**
 * Store با fallback — اگر DB در دسترس نباشد (مثلاً حالت نصب اولیه: جدول rate_limits هنوز ساخته نشده)،
 * به MemoryStore پروسس فعلی می‌افتد تا installer و healthz از کار نیفتند. پس از نصب، DB خودبه‌خود دوباره استفاده می‌شود.
 */
class FallbackStore implements Store {
  private readonly memory = new MemoryStore();
  private warned = false;

  constructor(private readonly primary: Store) {}

  init(options: Options): void {
    this.memory.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      return await this.primary.increment(key);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        logger.warn('Rate limit DB در دسترس نیست — fallback به حافظه‌ی پروسس', { error: String(err) });
      }
      return this.memory.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.primary.decrement(key);
    } catch {
      await this.memory.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.primary.resetKey(key);
    } catch {
      await this.memory.resetKey(key);
    }
  }
}

/** پاکسازی ردیف‌های منقضی (برای cron) */
export async function purgeExpiredRateLimits(db: Kysely<Database>): Promise<number> {
  const res = await db
    .deleteFrom('rate_limits')
    .where('expires_at', '<', nowDb())
    .executeTakeFirstOrThrow();
  return Number(res.numDeletedRows ?? 0);
}

export function createRateLimiter(db: Kysely<Database>, config: Config) {
  const windowMs = config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  return rateLimit({
    windowMs,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new FallbackStore(new DbRateLimitStore(db, windowMs)),
    keyGenerator: (req) => {
      const userId = req.user?.id;
      return userId ? `u:${userId}` : `ip:${req.ip}`;
    },
    handler: (_req, _res, _next, _opts) => {
      throw AppError.tooManyRequests();
    },
  });
}

export function createLoginRateLimiter(db: Kysely<Database>, config: Config) {
  const windowMs = config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  return rateLimit({
    windowMs,
    limit: config.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new FallbackStore(new DbRateLimitStore(db, windowMs)),
    keyGenerator: (req) => `login:${req.ip}:${String(req.body?.username ?? '').toLowerCase()}`,
    skipSuccessfulRequests: true,
    handler: (_req, _res, _next, _opts) => {
      throw AppError.tooManyRequests('تعداد تلاش‌های ورود زیاد است. کمی بعد دوباره تلاش کنید.');
    },
  });
}
