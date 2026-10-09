import type { Database } from '../../db/database';
import { errors } from '../../lib/errors';
import { SETTINGS, findSetting, maskSecret, validateSettingValue, type SettingDef, type SettingGroup } from '../../settings/registry';
import type { AuditService } from '../audit/audit.service';
import type { Actor } from '../users/users.service';

export interface SettingView {
  def: SettingDef;
  value: unknown;
  displayValue: string;
}

const CACHE_TTL_MS = 30_000;

/**
 * Typed settings access. Reads fall back to registry defaults when a row is missing or invalid,
 * so the application never crashes because of a bad stored value.
 */
export class SettingsService {
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private defaults(): Map<string, unknown> {
    const values = new Map<string, unknown>();
    for (const def of SETTINGS) values.set(def.key, def.defaultValue);
    return values;
  }

  private async loadAll(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.values;
    let rows: { setting_key: string; value_json: string }[];
    try {
      rows = await this.db.query<{ setting_key: string; value_json: string }>('SELECT setting_key, value_json FROM settings');
    } catch {
      // Database unavailable (e.g. before installation or during an outage): serve registry defaults
      // without caching them, so the installer and error pages still render.
      return this.defaults();
    }
    const values = this.defaults();
    for (const row of rows) {
      const def = findSetting(row.setting_key);
      if (!def) continue;
      try {
        const parsed = JSON.parse(row.value_json) as unknown;
        const check = validateSettingValue(def, parsed);
        if (check.ok) values.set(def.key, check.value);
      } catch {
        // invalid stored JSON: keep default
      }
    }
    this.cache = { at: Date.now(), values };
    return values;
  }

  async get<T = unknown>(key: string): Promise<T> {
    const def = findSetting(key);
    if (!def) throw new Error(`تنظیم ناشناخته: ${key}`);
    const values = await this.loadAll();
    return values.get(key) as T;
  }

  async getGroup(group: SettingGroup): Promise<SettingView[]> {
    const values = await this.loadAll();
    return SETTINGS.filter((d) => d.group === group).map((def) => {
      const value = values.get(def.key);
      const text = value === undefined || value === null ? '' : String(value);
      return { def, value, displayValue: def.sensitive ? maskSecret(text) : text };
    });
  }

  /** Validates and stores one setting. Unknown keys are rejected (no free-form storage). */
  async update(actor: Actor, key: string, rawValue: unknown): Promise<void> {
    const def = findSetting(key);
    if (!def) throw errors.badRequest('تنظیم نامعتبر است.');
    const check = validateSettingValue(def, rawValue);
    if (!check.ok) throw errors.badRequest(check.message, { [key]: check.message });
    const before = (await this.loadAll()).get(key);
    await this.db.execute(
      `INSERT INTO settings (setting_key, value_json, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)`,
      [key, JSON.stringify(check.value), actor.id],
    );
    this.cache = null;
    await this.audit.record({
      action: 'settings.updated',
      actorUserId: actor.id,
      entityType: 'setting',
      entityId: key,
      ip: actor.ip,
      details: def.sensitive
        ? { key, changed: before !== check.value }
        : { key, from: before ?? null, to: check.value },
    });
  }

  invalidateCache(): void {
    this.cache = null;
  }
}
