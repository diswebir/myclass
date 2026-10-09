import type { Database } from '../../db/database';

export interface DashboardStats {
  usersTotal: number;
  usersActive: number;
  rolesActive: number;
  activeSessions: number;
  auditLast24h: number;
  failedLoginsLast24h: number;
}

/** All figures are computed from the database on each request; no static or placeholder numbers. */
export class DashboardService {
  constructor(private readonly db: Database) {}

  async stats(): Promise<DashboardStats> {
    const [row] = await this.db.query<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS usersTotal,
         (SELECT COUNT(*) FROM users WHERE status = 'active') AS usersActive,
         (SELECT COUNT(*) FROM roles WHERE is_active = 1) AS rolesActive,
         (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)) AS activeSessions,
         (SELECT COUNT(*) FROM audit_logs WHERE occurred_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY) AS auditLast24h,
         (SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.login_failed' AND occurred_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY) AS failedLoginsLast24h`,
    );
    return {
      usersTotal: Number(row?.usersTotal ?? 0),
      usersActive: Number(row?.usersActive ?? 0),
      rolesActive: Number(row?.rolesActive ?? 0),
      activeSessions: Number(row?.activeSessions ?? 0),
      auditLast24h: Number(row?.auditLast24h ?? 0),
      failedLoginsLast24h: Number(row?.failedLoginsLast24h ?? 0),
    };
  }
}
