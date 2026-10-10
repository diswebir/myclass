import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { AuditService } from '../audit/audit.service';

export class SettingsService {
  constructor(private db: Kysely<DatabaseSchema>, private auditService?: AuditService) {}

  async getAllSettings(maskSecrets = true): Promise<Record<string, any>> {
    const rows = await this.db.selectFrom('system_settings').selectAll().execute();
    const result: Record<string, any> = {};

    for (const row of rows) {
      let val: any;
      try {
        val = JSON.parse(row.value_json);
      } catch {
        val = row.value_json;
      }

      if (maskSecrets && row.is_secret && val) {
        val = '••••••••';
      }
      result[row.key] = val;
    }
    return result;
  }

  async getSetting<T = any>(key: string, defaultValue?: T): Promise<T> {
    const row = await this.db.selectFrom('system_settings').where('key', '=', key).selectAll().executeTakeFirst();
    if (!row) return defaultValue as T;

    try {
      return JSON.parse(row.value_json);
    } catch {
      return row.value_json as unknown as T;
    }
  }

  async setSetting(key: string, value: any, category = 'general', isSecret = false, userId?: number): Promise<void> {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const existing = await this.db.selectFrom('system_settings').where('key', '=', key).selectAll().executeTakeFirst();

    const valueJson = JSON.stringify(value);

    if (existing) {
      await this.db
        .updateTable('system_settings')
        .set({
          value_json: valueJson,
          updated_at: now
        })
        .where('key', '=', key)
        .execute();
    } else {
      await this.db
        .insertInto('system_settings')
        .values({
          key,
          value_json: valueJson,
          category,
          is_secret: isSecret ? 1 : 0,
          updated_at: now
        })
        .execute();
    }

    if (this.auditService) {
      await this.auditService.log({
        userId,
        action: 'UPDATE_SETTING',
        entityType: 'system_settings',
        entityId: key,
        oldValues: isSecret ? '[SECRET]' : existing?.value_json,
        newValues: isSecret ? '[SECRET]' : valueJson
      });
    }
  }

  async updateBulk(settings: Record<string, any>, userId?: number): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (value === '••••••••') continue; // Do not overwrite secret if sent as mask
      const existing = await this.db.selectFrom('system_settings').where('key', '=', key).selectAll().executeTakeFirst();
      await this.setSetting(
        key,
        value,
        existing?.category || 'general',
        existing?.is_secret === 1,
        userId
      );
    }
  }
}
