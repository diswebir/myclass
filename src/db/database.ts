import mysql from 'mysql2/promise';
import type { AppConfig } from '../config/env';

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

  /** Runs `fn` inside a transaction; rolls back on any thrown error. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx: Queryable = {
        query: async <R>(sql: string, params: SqlValue[] = []) => {
          const [rows] = await conn.query(sql, params);
          return rows as R[];
        },
        execute: async (sql: string, params: SqlValue[] = []) => {
          const [res] = await conn.execute(sql, params);
          return res as mysql.ResultSetHeader;
        },
      };
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
