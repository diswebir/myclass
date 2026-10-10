/** سرویس settings — کلید تایپ‌شده + Zod + پیش‌فرض + ماسک + audit (REQ-P1-13). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { Config } from '../../core/config/env';
import { AppError } from '../../core/errors/AppError';
import { nowDb } from '../../core/db/time';
import { encryptSecret, decryptSecret, maskSecret } from '../../core/security/crypto';
import type { AuthUser } from '../../core/http/context';
import { AuditService } from '../audit/audit.service';
import { SETTING_DEFS, SETTING_BY_KEY, type SettingDef } from './settings.defaults';

export class SettingsService {
  readonly audit: AuditService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.audit = new AuditService(db);
  }

  /** seed پیش‌فرض‌ها (idempotent) */
  async seedDefaults(): Promise<void> {
    for (const def of SETTING_DEFS) {
      const existing = await this.db
        .selectFrom('settings')
        .select('key')
        .where('key', '=', def.key)
        .executeTakeFirst();
      if (existing) continue;
      const value = def.isSecret
        ? encryptSecret(JSON.stringify(def.defaultValue ?? ''), this.config.ENCRYPTION_KEY)
        : JSON.stringify(def.defaultValue);
      await this.db
        .insertInto('settings')
        .values({
          key: def.key,
          category: def.category,
          value,
          is_secret: def.isSecret ? 1 : 0,
          updated_at: nowDb(),
          updated_by: null,
        })
        .execute();
    }
  }

  /** خواندن مقدار (رمزگشایی برای secret) */
  async get<T = unknown>(key: string): Promise<T> {
    const def = SETTING_BY_KEY.get(key);
    const row = await this.db
      .selectFrom('settings')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) {
      if (!def) throw AppError.notFound(`تنظیم ${key} یافت نشد.`);
      return def.defaultValue as T;
    }
    let raw: unknown;
    if (row.is_secret === 1) {
      raw = JSON.parse(decryptSecret(row.value, this.config.ENCRYPTION_KEY));
    } else {
      raw = JSON.parse(row.value);
    }
    return (def ? def.schema.parse(raw) : raw) as T;
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = await this.get(k);
    return out;
  }

  /** تنظیم مقدار — با اعتبارسنجی Zod + رمزنگاری secret + audit */
  async set(actor: AuthUser, key: string, value: unknown): Promise<void> {
    const def = SETTING_BY_KEY.get(key);
    if (!def) throw AppError.badRequest(`تنظیم ${key} تعریف نشده است.`);
    const parsed = def.schema.parse(value);
    const stored = def.isSecret
      ? encryptSecret(JSON.stringify(parsed), this.config.ENCRYPTION_KEY)
      : JSON.stringify(parsed);
    const existing = await this.db
      .selectFrom('settings')
      .select('key')
      .where('key', '=', key)
      .executeTakeFirst();
    if (existing) {
      await this.db
        .updateTable('settings')
        .set({ value: stored, updated_at: nowDb(), updated_by: actor.id })
        .where('key', '=', key)
        .execute();
    } else {
      await this.db
        .insertInto('settings')
        .values({
          key,
          category: def.category,
          value: stored,
          is_secret: def.isSecret ? 1 : 0,
          updated_at: nowDb(),
          updated_by: actor.id,
        })
        .execute();
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'settings_updated',
      module: 'settings',
      entityType: 'setting',
      entityId: key,
      meta: { key, isSecret: def.isSecret },
    });
  }

  /** فهرست تنظیمات — secretها ماسک می‌شوند */
  async listForUi(category?: string) {
    let q = this.db.selectFrom('settings').selectAll().orderBy('category').orderBy('key');
    if (category) q = q.where('category', '=', category);
    const rows = await q.execute();
    return rows.map((r) => {
      const def = SETTING_BY_KEY.get(r.key);
      let display: unknown;
      if (r.is_secret === 1) {
        try {
          const raw = JSON.parse(decryptSecret(r.value, this.config.ENCRYPTION_KEY));
          display = maskSecret(String(raw));
        } catch {
          display = '***REDACTED***';
        }
      } else {
        try {
          display = JSON.parse(r.value);
        } catch {
          display = r.value;
        }
      }
      return {
        key: r.key,
        category: r.category,
        value: display,
        isSecret: r.is_secret === 1,
        description: def?.description ?? '',
        schemaType: def ? def.schema._def.typeName : 'unknown',
      };
    });
  }

  /** مقادیر لازم برای UI (برندینگ مؤسسه) */
  async getInstituteBranding() {
    return this.getMany([
      'institute.name',
      'institute.logo_file_id',
      'institute.primary_color',
      'institute.secondary_color',
      'institute.address',
      'institute.phone',
      'institute.email',
      'institute.header_note',
    ]);
  }
}

export type { SettingDef };
