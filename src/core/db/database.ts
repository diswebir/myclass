/**
 * Factory برای اتصال پایگاه داده (Kysely).
 * - Production: MariaDB/MySQL از طریق `mysql2` (per spec §۲)
 * - تست/توسعه: SQLite از طریق `node:sqlite` (ماژول داخلی)
 */
import path from 'node:path';
import { Kysely, MysqlDialect, sql } from 'kysely';
// Kysely's MysqlDialect نیاز به pool با API callback دارد — mysql2/promise کار نمی‌کند (getConnection با callback را ignore می‌کند)
import type { PoolOptions } from 'mysql2';
import { createPool } from 'mysql2';
import type { Config } from '../config/env';
import type { Database } from './types';
import { NodeSqliteDialect } from './sqlite-dialect';
import { logger } from '../logger/logger';

export type DbDialectName = 'mysql' | 'sqlite';

export function detectDialect(db: Kysely<any>): DbDialectName {
  const executor = db.getExecutor() as unknown as { adapter?: { constructor?: { name?: string } } };
  const adapterName = executor.adapter?.constructor?.name ?? '';
  return adapterName === 'SqliteAdapter' ? 'sqlite' : 'mysql';
}

function resolveSqlitePath(p: string): string {
  if (p === ':memory:') return p;
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export function createDatabase(cfg: Config): Kysely<Database> {
  if (cfg.DB_DRIVER === 'sqlite') {
    return new Kysely<Database>({
      dialect: new NodeSqliteDialect(resolveSqlitePath(cfg.DB_SQLITE_PATH)),
    });
  }

  const poolOptions: PoolOptions = {
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    connectionLimit: 5,
    // BIGINT به‌صورت string (بدون از دست دادن دقت) + DATETIME به‌صورت string (UTC)
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  };

  const pool = createPool(poolOptions);
  // خطای pool (مثلاً قطع اتصال) نباید پروسس را crash کند
  pool.on('error', (err: Error) => {
    logger.warn('خطای pool پایگاه داده:', { error: err.message });
  });
  // mysql2 (callback pool) در runtime با Kysely سازگار است؛ شکل overloadهای typings differs → cast
  type KyselyMysqlPool = ConstructorParameters<typeof MysqlDialect>[0]['pool'];
  return new Kysely<Database>({
    dialect: new MysqlDialect({ pool: pool as unknown as KyselyMysqlPool }),
  });
}

export async function pingDatabase(db: Kysely<any>): Promise<boolean> {
  try {
    await sql`select 1 as ok`.execute(db);
    return true;
  } catch {
    return false;
  }
}
