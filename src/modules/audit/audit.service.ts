/** سرویس audit log — سبت رویدادهای حساس (per spec §۶-پ). بدون سبت secret. */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { nowDb } from '../../core/db/time';

export interface AuditInput {
  actorId?: number | null;
  action: string;
  module: string;
  entityType?: string;
  entityId?: string | number;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** کلیدهای حساس که هرگز در meta لاگ نمی‌شوند */
const BLOCKED_META_KEYS = [
  'password', 'password_hash', 'passwordhash', 'secret', 'token', 'csrf', 'csrf_token',
  'api_key', 'apikey', 'api-key', 'authorization', 'cookie', 'session_secret',
  'encryption_key', 'private_key', 'credential', 'otp', 'pin', 'card_number', 'cvv',
];

function sanitizeMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '{}';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lk = k.toLowerCase();
    if (BLOCKED_META_KEYS.some((b) => lk.includes(b))) {
      out[k] = '***REDACTED***';
    } else {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}

export class AuditService {
  constructor(private readonly db: Kysely<Database>) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.db
        .insertInto('audit_log')
        .values({
          actor_id: input.actorId ?? null,
          action: input.action,
          module: input.module,
          entity_type: input.entityType ?? '-',
          entity_id: String(input.entityId ?? '-'),
          meta: sanitizeMeta(input.meta),
          ip: input.ip ?? null,
          created_at: nowDb(),
        })
        .execute();
    } catch (err) {
      // لاگ ممیزی هرگز نباید باعث شکست عملیات شود — در لاگ خطا سبت می‌شود
      console.error('[audit] سبت لاگ ممیزی ناموفق بود:', (err as Error).message);
    }
  }

  async list(opts: { limit?: number; offset?: number; action?: string; module?: string } = {}) {
    let q = this.db.selectFrom('audit_log').selectAll().orderBy('id', 'desc');
    if (opts.action) q = q.where('action', '=', opts.action);
    if (opts.module) q = q.where('module', '=', opts.module);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async countRecentErrors(minutes = 60): Promise<number> {
    const since = nowDb(new Date(Date.now() - minutes * 60 * 1000));
    const row = await this.db
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('action', '=', 'error')
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }
}
