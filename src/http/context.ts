import type { AppConfig } from '../config/env';
import type { Database } from '../db/database';
import type { AuditService } from '../modules/audit/audit.service';
import type { AuthService, AuthUser } from '../modules/auth/auth.service';
import type { DashboardService } from '../modules/dashboard/dashboard.service';
import type { HealthService } from '../modules/system/health.service';
import type { InstallService } from '../modules/install/install.service';
import type { RbacService } from '../modules/rbac/rbac.service';
import type { RolesService } from '../modules/roles/roles.service';
import type { SettingsService } from '../modules/settings/settings.service';
import type { UsersService } from '../modules/users/users.service';

/** Dependency container. Routes receive services through this object; modules never import each other's internals. */
export interface AppServices {
  cfg: AppConfig;
  db: Database;
  audit: AuditService;
  auth: AuthService;
  rbac: RbacService;
  users: UsersService;
  roles: RolesService;
  settings: SettingsService;
  install: InstallService;
  health: HealthService;
  dashboard: DashboardService;
}

export interface AuthContext {
  user: AuthUser;
  permissions: ReadonlySet<string>;
  sessionId: number;
  token: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      csrfToken?: string;
      clientIp?: string | null;
    }
  }
}
