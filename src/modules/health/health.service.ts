import { Kysely, sql } from 'kysely';
import { DatabaseSchema } from '../../core/types';

export class HealthService {
  constructor(private db: Kysely<DatabaseSchema>) {}

  async getHealthStatus() {
    let dbStatus = 'healthy';
    let dbError: string | null = null;
    const start = Date.now();

    try {
      await sql`SELECT 1`.execute(this.db);
    } catch (err: any) {
      dbStatus = 'unhealthy';
      dbError = err.message || 'خطای اتصال به دیتابیس';
    }

    const dbLatencyMs = Date.now() - start;
    const memory = process.memoryUsage();

    let usersCount = 0;
    let classesCount = 0;
    try {
      const uRes = await this.db.selectFrom('users').select(this.db.fn.count('id').as('count')).executeTakeFirst();
      usersCount = Number(uRes?.count || 0);

      const cRes = await this.db.selectFrom('classes').select(this.db.fn.count('id').as('count')).executeTakeFirst();
      classesCount = Number(cRes?.count || 0);
    } catch {
      // Ignored if tables not yet created
    }

    return {
      status: dbStatus === 'healthy' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        error: dbError
      },
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024))
      },
      metrics: {
        usersCount,
        classesCount
      }
    };
  }
}
