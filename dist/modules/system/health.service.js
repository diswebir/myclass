"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const migrator_1 = require("../../db/migrator");
const version_1 = require("../../version");
const registry_1 = require("../registry");
/** Health report. Never includes secrets, connection strings or stack traces. */
class HealthService {
    cfg;
    db;
    migrationsDir;
    isInstalled;
    constructor(cfg, db, migrationsDir, isInstalled) {
        this.cfg = cfg;
        this.db = db;
        this.migrationsDir = migrationsDir;
        this.isInstalled = isInstalled;
    }
    async report() {
        const warnings = [];
        let database = { ok: false, latencyMs: null, message: 'اتصال برقرار نیست.' };
        let migrations = null;
        const started = Date.now();
        try {
            await this.db.ping();
            database = { ok: true, latencyMs: Date.now() - started, message: 'اتصال برقرار است.' };
            const status = await new migrator_1.Migrator(this.db, this.migrationsDir).status();
            migrations = { appliedCount: status.applied.length, pending: status.pending, modified: status.modified };
            if (status.pending.length)
                warnings.push('migration‌های در انتظار اجرا وجود دارد.');
            if (status.modified.length)
                warnings.push('یک فایل migration اعمال‌شده تغییر کرده است.');
        }
        catch {
            warnings.push('خطا در ارتباط با پایگاه داده.');
        }
        let storageWritable = true;
        try {
            node_fs_1.default.mkdirSync(this.cfg.storageDir, { recursive: true });
            node_fs_1.default.accessSync(this.cfg.storageDir, node_fs_1.default.constants.W_OK);
        }
        catch {
            storageWritable = false;
            warnings.push('پوشه ذخیره‌سازی قابل نوشتن نیست.');
        }
        const installed = this.isInstalled();
        if (installed && process.env.INSTALL_TOKEN) {
            warnings.push('INSTALL_TOKEN هنوز در تنظیمات محیطی است؛ پس از نصب آن را حذف کنید.');
        }
        if (this.cfg.isProduction && !this.cfg.cookieSecure)
            warnings.push('COOKIE_SECURE فعال نیست.');
        const status = !database.ok ? 'error' : warnings.length ? 'degraded' : 'ok';
        return {
            status,
            version: version_1.APP_VERSION,
            nodeVersion: process.versions.node,
            uptimeSeconds: Math.round(process.uptime()),
            installed,
            database,
            migrations,
            storageWritable,
            modules: registry_1.MODULES.map((m) => ({ id: m.id, nameFa: m.nameFa, version: m.version, dependencies: m.dependencies, core: m.core })),
            warnings,
        };
    }
}
exports.HealthService = HealthService;
