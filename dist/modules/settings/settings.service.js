"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const errors_1 = require("../../lib/errors");
const registry_1 = require("../../settings/registry");
const CACHE_TTL_MS = 30_000;
/**
 * Typed settings access. Reads fall back to registry defaults when a row is missing or invalid,
 * so the application never crashes because of a bad stored value.
 */
class SettingsService {
    db;
    audit;
    cache = null;
    constructor(db, audit) {
        this.db = db;
        this.audit = audit;
    }
    defaults() {
        const values = new Map();
        for (const def of registry_1.SETTINGS)
            values.set(def.key, def.defaultValue);
        return values;
    }
    async loadAll() {
        if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS)
            return this.cache.values;
        let rows;
        try {
            rows = await this.db.query('SELECT setting_key, value_json FROM settings');
        }
        catch {
            // Database unavailable (e.g. before installation or during an outage): serve registry defaults
            // without caching them, so the installer and error pages still render.
            return this.defaults();
        }
        const values = this.defaults();
        for (const row of rows) {
            const def = (0, registry_1.findSetting)(row.setting_key);
            if (!def)
                continue;
            try {
                const parsed = JSON.parse(row.value_json);
                const check = (0, registry_1.validateSettingValue)(def, parsed);
                if (check.ok)
                    values.set(def.key, check.value);
            }
            catch {
                // invalid stored JSON: keep default
            }
        }
        this.cache = { at: Date.now(), values };
        return values;
    }
    async get(key) {
        const def = (0, registry_1.findSetting)(key);
        if (!def)
            throw new Error(`تنظیم ناشناخته: ${key}`);
        const values = await this.loadAll();
        return values.get(key);
    }
    async getGroup(group) {
        const values = await this.loadAll();
        return registry_1.SETTINGS.filter((d) => d.group === group).map((def) => {
            const value = values.get(def.key);
            const text = value === undefined || value === null ? '' : String(value);
            return { def, value, displayValue: def.sensitive ? (0, registry_1.maskSecret)(text) : text };
        });
    }
    /** Validates and stores one setting. Unknown keys are rejected (no free-form storage). */
    async update(actor, key, rawValue) {
        const def = (0, registry_1.findSetting)(key);
        if (!def)
            throw errors_1.errors.badRequest('تنظیم نامعتبر است.');
        const check = (0, registry_1.validateSettingValue)(def, rawValue);
        if (!check.ok)
            throw errors_1.errors.badRequest(check.message, { [key]: check.message });
        const before = (await this.loadAll()).get(key);
        await this.db.execute(`INSERT INTO settings (setting_key, value_json, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)`, [key, JSON.stringify(check.value), actor.id]);
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
    invalidateCache() {
        this.cache = null;
    }
}
exports.SettingsService = SettingsService;
