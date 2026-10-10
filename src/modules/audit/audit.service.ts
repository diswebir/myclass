import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { logger } from '../../core/logger';

export class AuditService {
  constructor(private db: Kysely<DatabaseSchema>) {}

  async log(params: {
    userId?: number | null;
    action: string;
    entityType: string;
    entityId: string | number;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
  }): Promise<void> {
    try {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      
      const sanitizeObject = (obj: any) => {
        if (!obj || typeof obj !== 'object') return obj;
        const copy = { ...obj };
        const secretKeys = ['password', 'password_hash', 'api_key', 'apiKey', 'token', 'secret'];
        for (const k of Object.keys(copy)) {
          if (secretKeys.some(s => k.toLowerCase().includes(s))) {
            copy[k] = '[REDACTED]';
          }
        }
        return copy;
      };

      await this.db.insertInto('audit_logs').values({
        user_id: params.userId || null,
        action: params.action,
        entity_type: params.entityType,
        entity_id: String(params.entityId),
        old_values_json: params.oldValues ? JSON.stringify(sanitizeObject(params.oldValues)) : null,
        new_values_json: params.newValues ? JSON.stringify(sanitizeObject(params.newValues)) : null,
        ip_address: params.ipAddress || '127.0.0.1',
        created_at: now
      }).execute();
    } catch (err) {
      logger.error('Failed to write audit log', err);
    }
  }

  async getRecentLogs(limit = 100, offset = 0) {
    return this.db
      .selectFrom('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', 'users.id')
      .select([
        'audit_logs.id',
        'audit_logs.action',
        'audit_logs.entity_type',
        'audit_logs.entity_id',
        'audit_logs.old_values_json',
        'audit_logs.new_values_json',
        'audit_logs.ip_address',
        'audit_logs.created_at',
        'users.full_name as user_full_name',
        'users.mobile as user_mobile'
      ])
      .orderBy('audit_logs.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }
}
