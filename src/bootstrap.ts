import path from 'node:path';
import { loadConfig, loadDotEnv, type AppConfig } from './config/env';
import { Database } from './db/database';
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
}

/** Composition root: the only place where concrete services are wired together. */
export function bootstrap(appRoot: string, env: NodeJS.ProcessEnv = process.env): Runtime {
  loadDotEnv(path.join(appRoot, '.env'), env);
  const cfg = loadConfig(appRoot, env);
  const db = new Database(cfg.db);
  const migrationsDir = cfg.migrationsDir;
  const publicDir = path.join(appRoot, 'public');

  const audit = new AuditService(db);
  const settings = new SettingsService(db, audit);
  const rbac = new RbacService(db);
  const auth = new AuthService(db, audit, {
    sessionTtlHours: cfg.sessionTtlHours,
    maxFailures: 5,
  });
  // The login lock threshold is read from settings so administrators can tune it without code changes.
  const users = new UsersService(db, audit, auth, rbac, () => settings.get<number>('security.password_min_length'));
  const roles = new RolesService(db, audit);
  const dashboard = new DashboardService(db);
  const install = new InstallService(cfg, db, rbac, users, audit, migrationsDir, () => undefined);
  const health = new HealthService(cfg, db, migrationsDir, () => install.isInstalled());
  const services: AppServices = { cfg, db, audit, auth, rbac, users, roles, settings, install, health, dashboard };
  return { cfg, services, publicDir, migrationsDir };
}
