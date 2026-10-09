"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrap = bootstrap;
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("./config/env");
const database_1 = require("./db/database");
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
    const db = new database_1.Database(cfg.db);
    const migrationsDir = cfg.migrationsDir;
    const publicDir = node_path_1.default.join(appRoot, 'public');
    const audit = new audit_service_1.AuditService(db);
    const settings = new settings_service_1.SettingsService(db, audit);
    const rbac = new rbac_service_1.RbacService(db);
    const auth = new auth_service_1.AuthService(db, audit, {
        sessionTtlHours: cfg.sessionTtlHours,
        maxFailures: 5,
    });
    // The login lock threshold is read from settings so administrators can tune it without code changes.
    const users = new users_service_1.UsersService(db, audit, auth, rbac, () => settings.get('security.password_min_length'));
    const roles = new roles_service_1.RolesService(db, audit);
    const dashboard = new dashboard_service_1.DashboardService(db);
    const install = new install_service_1.InstallService(cfg, db, rbac, users, audit, migrationsDir, () => undefined);
    const health = new health_service_1.HealthService(cfg, db, migrationsDir, () => install.isInstalled());
    const services = { cfg, db, audit, auth, rbac, users, roles, settings, install, health, dashboard };
    return { cfg, services, publicDir, migrationsDir };
}
