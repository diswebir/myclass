import type { Queryable } from '../../db/database';
import { sanitizeForLog } from '../../lib/sanitize';

export interface AuditEvent {
  action: string;
  actorUserId?: number | null;
  entityType?: string | null;
  entityId?: string | number | null;
  ip?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditRow {
  id: number;
  occurred_at: Date;
  actor_user_id: number | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  details_json: string | null;
}

export interface AuditFilter {
  action?: string;
  actorUserId?: number;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/** Writes security-relevant events. Secrets are stripped by sanitizeForLog before persistence. */
export class AuditService {
  constructor(private readonly db: Queryable) {}

  async record(event: AuditEvent): Promise<void> {
    const details = event.details ? JSON.stringify(sanitizeForLog(event.details)) : null;
    await this.db.execute(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, ip_address, details_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event.actorUserId ?? null,
        event.action.slice(0, 120),
        event.entityType ?? null,
        event.entityId === undefined || event.entityId === null ? null : String(event.entityId).slice(0, 64),
        event.ip ? event.ip.slice(0, 45) : null,
        details,
      ],
    );
  }

  async list(filter: AuditFilter): Promise<{ rows: AuditRow[]; total: number }> {
    const where: string[] = [];
    const params: (string | number | Date)[] = [];
    if (filter.action) {
      where.push('a.action LIKE ?');
      params.push(`${filter.action.replace(/[%_\\]/g, '\\$&')}%`);
    }
    if (filter.actorUserId) {
      where.push('a.actor_user_id = ?');
      params.push(filter.actorUserId);
    }
    if (filter.from) {
      where.push('a.occurred_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('a.occurred_at < ?');
      params.push(filter.to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await this.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_logs a ${whereSql}`, params);
    const offset = (filter.page - 1) * filter.pageSize;
    const rows = await this.db.query<AuditRow>(
      `SELECT a.id, a.occurred_at, a.actor_user_id, u.full_name AS actor_name, a.action, a.entity_type,
              a.entity_id, a.ip_address, a.details_json
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         ${whereSql}
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
      [...params, filter.pageSize, offset],
    );
    return { rows, total: Number(totalRow[0]?.n ?? 0) };
  }
}
