"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
class SettingsService {
    db;
    auditService;
    constructor(db, auditService) {
        this.db = db;
        this.auditService = auditService;
    }
    async getAllSettings(maskSecrets = true) {
        const rows = await this.db.selectFrom('system_settings').selectAll().execute();
        const result = {};
        for (const row of rows) {
            let val;
            try {
                val = JSON.parse(row.value_json);
            }
            catch {
                val = row.value_json;
            }
            if (maskSecrets && row.is_secret && val) {
                val = '••••••••';
            }
            result[row.key] = val;
        }
        return result;
    }
    async getSetting(key, defaultValue) {
        const row = await this.db.selectFrom('system_settings').where('key', '=', key).selectAll().executeTakeFirst();
        if (!row)
            return defaultValue;
        try {
            return JSON.parse(row.value_json);
        }
        catch {
            return row.value_json;
        }
    }
    async setSetting(key, value, category = 'general', isSecret = false, userId) {
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
        }
        else {
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
    async updateBulk(settings, userId) {
        for (const [key, value] of Object.entries(settings)) {
            if (value === '••••••••')
                continue; // Do not overwrite secret if sent as mask
            const existing = await this.db.selectFrom('system_settings').where('key', '=', key).selectAll().executeTakeFirst();
            await this.setSetting(key, value, existing?.category || 'general', existing?.is_secret === 1, userId);
        }
    }
}
exports.SettingsService = SettingsService;
