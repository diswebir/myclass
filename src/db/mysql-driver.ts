import mysql from 'mysql2/promise';
import type { AppConfig } from '../config/env';
import { mysqlDialect } from './dialects';
import type { Dialect, Driver, ExecResult, Queryable, SqlValue } from './types';

/** mysql2 marks connection-level failures with fatal: true; ordinary SQL errors keep the connection usable. */
function isFatal(err: unknown): boolean {
  return Boolean((err as { fatal?: boolean } | null)?.fatal);
}

/** mysql2 rejects `undefined` bind values; the data layer treats them as SQL NULL. */
function bind(params: SqlValue[]): never[] {
  return params.map((v) => (v === undefined ? null : v)) as never[];
}

/** Pure JavaScript MySQL/MariaDB driver (mysql2). No native build, so it runs on cPanel shared hosting. */
export class MysqlDriver implements Driver {
  readonly name = 'mysql' as const;
  readonly dialect: Dialect = mysqlDialect;
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
    const [rows] = await this.pool.query(sql, bind(params));
    return rows as T[];
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    const [res] = await this.pool.execute(sql, bind(params));
    const h = res as mysql.ResultSetHeader;
    return { insertId: Number(h.insertId), affectedRows: Number(h.affectedRows) };
  }

  async withConnection<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    let broken = false;
    const q: Queryable = {
      query: async <R>(sql: string, params: SqlValue[] = []) => {
        try {
          const [rows] = await conn.query(sql, bind(params));
          return rows as R[];
        } catch (err) {
          if (isFatal(err)) broken = true;
          throw err;
        }
      },
      execute: async (sql: string, params: SqlValue[] = []) => {
        try {
          const [res] = await conn.execute(sql, bind(params));
          const h = res as mysql.ResultSetHeader;
          return { insertId: Number(h.insertId), affectedRows: Number(h.affectedRows) };
        } catch (err) {
          if (isFatal(err)) broken = true;
          throw err;
        }
      },
    };
    try {
      return await fn(q);
    } finally {
      // A connection that failed at protocol level is destroyed so session state cannot leak to later requests.
      if (broken) conn.destroy();
      else conn.release();
    }
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.withConnection(async (q) => {
      await q.query(this.dialect.beginSql);
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
