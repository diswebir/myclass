import path from 'node:path';
import { loadConfig, loadDotEnv, type AppConfig } from './config/env';
import { Database } from './db/database';
import { createDriver, resolveDriverChoice, writeDriverChoice, type DriverChoice } from './db/connect';
import type { AppServices } from './http/context';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { InstallService } from './modules/install/install.service';
import { RbacService } from './modules/rbac/rbac.service';
import { RolesService } from './modules/roles/roles.service';
import { SettingsService } from './modules/settings/settings.service';
import { UsersService } from './modules/users/users.service';
import { HealthService } from './modules/system/health.service';

export interface Runtime {
  cfg: AppConfig;
  services: AppServices;
  publicDir: string;
  migrationsDir: string;
  /** Resolves once the configured engine is attached (SQLite opens asynchronously). Server startup awaits it. */
  ready: Promise<void>;
}

/** Composition root: the only place where concrete services are wired together. */
export function bootstrap(appRoot: string, env: NodeJS.ProcessEnv = process.env): Runtime {
  loadDotEnv(path.join(appRoot, '.env'), env);
  const cfg = loadConfig(appRoot, env);
  const db = new Database();
  const migrationsDir = cfg.migrationsDir;
  // The engine is attached from the saved choice (or env). A fresh install has none until the installer runs.
  // Failures are logged without credentials; the health page then reports the database as unavailable.
  const connect = async (choice: DriverChoice, persist: boolean): Promise<void> => {
    const driver = await createDriver(cfg, choice);
    if (persist) {
      // The installer only saves a choice that actually answers, so a wrong host or password is not persisted.
      try {
        await driver.ping();
      } catch (err) {
        await driver.close().catch(() => undefined);
        throw err;
      }
    }
    await db.attach(driver);
    if (persist) writeDriverChoice(cfg, choice);
  };
  const ready = (async () => {
    const choice = resolveDriverChoice(cfg);
    if (!choice) return;
    try {
      await connect(choice, false);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'database_attach_failed', driver: choice, code: (err as { code?: string }).code ?? 'UNKNOWN' }));
    }
  })();
  const publicDir = path.join(appRoot, 'public');

  const audit = new AuditService(db);
  const settings = new SettingsService(db, audit);
  const rbac = new RbacService(db);
  const auth = new AuthService(db, audit, {
    sessionTtlHours: cfg.sessionTtlHours,
    maxFailures: 5,
  });
  // The login lock threshold is read from settings so administrators can tune it without code changes.
  const users = new UsersService(db, audit, auth, () => settings.get<number>('security.password_min_length'));
  const roles = new RolesService(db, audit);
  const dashboard = new DashboardService(db);
  const install = new InstallService(cfg, db, rbac, users, audit, migrationsDir, connect, () => undefined);
  const health = new HealthService(cfg, db, migrationsDir, () => install.isInstalled());
  const services: AppServices = { cfg, db, audit, auth, rbac, users, roles, settings, install, health, dashboard };
  return { cfg, services, publicDir, migrationsDir, ready };
}
