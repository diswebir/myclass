"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrap = bootstrap;
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("./config/env");
const database_1 = require("./db/database");
const connect_1 = require("./db/connect");
const audit_service_1 = require("./modules/audit/audit.service");
const auth_service_1 = require("./modules/auth/auth.service");
const dashboard_service_1 = require("./modules/dashboard/dashboard.service");
const install_service_1 = require("./modules/install/install.service");
const rbac_service_1 = require("./modules/rbac/rbac.service");
const roles_service_1 = require("./modules/roles/roles.service");
const settings_service_1 = require("./modules/settings/settings.service");
const users_service_1 = require("./modules/users/users.service");
const health_service_1 = require("./modules/system/health.service");
/** Composition root: the only place where concrete services are wired together. */
function bootstrap(appRoot, env = process.env) {
    (0, env_1.loadDotEnv)(node_path_1.default.join(appRoot, '.env'), env);
    const cfg = (0, env_1.loadConfig)(appRoot, env);
    const db = new database_1.Database();
    const migrationsDir = cfg.migrationsDir;
    // The engine is attached from the saved choice (or env). A fresh install has none until the installer runs.
    // Failures are logged without credentials; the health page then reports the database as unavailable.
    const connect = async (choice, persist) => {
        const driver = await (0, connect_1.createDriver)(cfg, choice);
        if (persist) {
            // The installer only saves a choice that actually answers, so a wrong host or password is not persisted.
            try {
                await driver.ping();
            }
            catch (err) {
                await driver.close().catch(() => undefined);
                throw err;
            }
        }
        await db.attach(driver);
        if (persist)
            (0, connect_1.writeDriverChoice)(cfg, choice);
    };
    const ready = (async () => {
        const choice = (0, connect_1.resolveDriverChoice)(cfg);
        if (!choice)
            return;
        try {
            await connect(choice, false);
        }
        catch (err) {
            console.error(JSON.stringify({ level: 'error', msg: 'database_attach_failed', driver: choice, code: err.code ?? 'UNKNOWN' }));
        }
    })();
    const publicDir = node_path_1.default.join(appRoot, 'public');
    const audit = new audit_service_1.AuditService(db);
    const settings = new settings_service_1.SettingsService(db, audit);
    const rbac = new rbac_service_1.RbacService(db);
    const auth = new auth_service_1.AuthService(db, audit, {
        sessionTtlHours: cfg.sessionTtlHours,
        maxFailures: 5,
    });
    // The login lock threshold is read from settings so administrators can tune it without code changes.
    const users = new users_service_1.UsersService(db, audit, auth, () => settings.get('security.password_min_length'));
    const roles = new roles_service_1.RolesService(db, audit);
    const dashboard = new dashboard_service_1.DashboardService(db);
    const install = new install_service_1.InstallService(cfg, db, rbac, users, audit, migrationsDir, connect, () => undefined);
    const health = new health_service_1.HealthService(cfg, db, migrationsDir, () => install.isInstalled());
    const services = { cfg, db, audit, auth, rbac, users, roles, settings, install, health, dashboard };
    return { cfg, services, publicDir, migrationsDir, ready };
}
