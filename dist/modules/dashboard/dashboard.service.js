"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
/** All figures are computed from the database on each request; no static or placeholder numbers. */
class DashboardService {
    db;
    constructor(db) {
        this.db = db;
    }
    async stats() {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const [row] = await this.db.query(`SELECT
         (SELECT COUNT(*) FROM users) AS usersTotal,
         (SELECT COUNT(*) FROM users WHERE status = 'active') AS usersActive,
         (SELECT COUNT(*) FROM roles WHERE is_active = 1) AS rolesActive,
         (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > ?) AS activeSessions,
         (SELECT COUNT(*) FROM audit_logs WHERE occurred_at >= ?) AS auditLast24h,
         (SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.login_failed' AND occurred_at >= ?) AS failedLoginsLast24h`, [now, dayAgo, dayAgo]);
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
exports.DashboardService = DashboardService;
