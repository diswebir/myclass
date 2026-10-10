import mysql from 'mysql2/promise';
import type { AppConfig } from '../config/env';

/** mysql2 marks connection-level failures with fatal: true; ordinary SQL errors keep the connection usable. */
function isFatal(err: unknown): boolean {
  return Boolean((err as { fatal?: boolean } | null)?.fatal);
}

export type SqlValue = string | number | bigint | boolean | Date | null;

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<mysql.ResultSetHeader>;
}

/**
 * Thin data-access wrapper over mysql2 (pure JavaScript driver, no native build).
 * All application SQL MUST use `?` placeholders; string concatenation of user input is forbidden.
 */
export class Database implements Queryable {
  private readonly pool: mysql.Pool;

  constructor(cfg: AppConfig['db']) {
    this.pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.name,
      user: cfg.user,
      password: cfg.password,
      waitForConnections: true,
      connectionLimit: cfg.connectionLimit,
      charset: 'utf8mb4',
      timezone: 'Z', // DATETIME values are stored and read as UTC
      dateStrings: false,
      namedPlaceholders: false,
    });
  }

  async query<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<mysql.ResultSetHeader> {
    const [res] = await this.pool.execute(sql, params);
    return res as mysql.ResultSetHeader;
  }

  /**
   * Runs `fn` on ONE pooled connection. Required for session-scoped state such as GET_LOCK/RELEASE_LOCK.
   * If any statement fails, the connection is destroyed instead of returned to the pool, so session
   * state (like a named lock) cannot leak into later requests.
   */
  async withConnection<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    let broken = false;
    const q: Queryable = {
      query: async <R>(sql: string, params: SqlValue[] = []) => {
        try {
          const [rows] = await conn.query(sql, params);
          return rows as R[];
        } catch (err) {
          if (isFatal(err)) broken = true;
          throw err;
        }
      },
      execute: async (sql: string, params: SqlValue[] = []) => {
        try {
          const [res] = await conn.execute(sql, params);
          return res as mysql.ResultSetHeader;
        } catch (err) {
          if (isFatal(err)) broken = true;
          throw err;
        }
      },
    };
    try {
      return await fn(q);
    } finally {
      if (broken) conn.destroy();
      else conn.release();
    }
  }

  /** Runs `fn` inside a transaction; rolls back on any thrown error. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.withConnection(async (q) => {
      // The transaction runs on the same pinned connection.
      await q.query('START TRANSACTION');
      try {
        const result = await fn(q);
        await q.query('COMMIT');
        return result;
      } catch (err) {
        await q.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
