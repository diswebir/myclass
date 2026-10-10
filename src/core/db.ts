import path from 'path';
import fs from 'fs';
import { Kysely, MysqlDialect, SqliteDialect, sql } from 'kysely';
import mysql from 'mysql2';
import { DatabaseSchema } from './types';
import { config, getEffectiveDbConfig, DbConfig } from './config';
import { logger } from './logger';

let dbInstance: Kysely<DatabaseSchema> | null = null;

export function createDbInstance(dbConf?: DbConfig): Kysely<DatabaseSchema> {
  const effectiveConfig = dbConf || getEffectiveDbConfig();

  if (effectiveConfig.dialect === 'mysql') {
    const mysqlConf = effectiveConfig.mysql || {
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME
    };

    logger.info(`Connecting to MySQL/MariaDB at ${mysqlConf.host}:${mysqlConf.port}/${mysqlConf.database}...`);
    const pool = mysql.createPool({
      host: mysqlConf.host,
      port: mysqlConf.port,
      user: mysqlConf.user,
      password: mysqlConf.password,
      database: mysqlConf.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      dateStrings: true
    });

    return new Kysely<DatabaseSchema>({
      dialect: new MysqlDialect({ pool: pool as any })
    });
  } else {
    // SQLite mode using Node 22 built-in DatabaseSync
    const { DatabaseSync } = require('node:sqlite');
    
    // In automated tests, only use a file if explicitly specified in dbConf.sqlitePath
    let dbTarget = ':memory:';
    if (process.env.NODE_ENV === 'test') {
      if (dbConf?.sqlitePath && dbConf.sqlitePath !== ':memory:') {
        dbTarget = dbConf.sqlitePath;
        fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
      } else {
        dbTarget = ':memory:';
      }
    } else {
      const sqlitePath = effectiveConfig.sqlitePath || path.join(config.STORAGE_DIR, 'database.sqlite');
      fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
      dbTarget = sqlitePath;
    }

    const localRawDb = new DatabaseSync(dbTarget);
    localRawDb.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

    const normalizeParam = (p: any): any => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    };

    const mapParams = (params: any) => {
      if (!params || !Array.isArray(params)) return [];
      return params.map(normalizeParam);
    };

    return new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({
        database: {
          prepare: (querySql: string) => {
            const stmt = localRawDb.prepare(querySql);
            const isSelect = !querySql.trim().match(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK|PRAGMA)/i);
            return {
              reader: isSelect,
              all: (params: any) => stmt.all(...mapParams(params)),
              run: (params: any) => {
                const info = stmt.run(...mapParams(params));
                return {
                  changes: info.changes,
                  lastInsertRowid: info.lastInsertRowid
                };
              },
              iterate: (params: any) => stmt.iterate ? stmt.iterate(...mapParams(params)) : stmt.all(...mapParams(params))[Symbol.iterator]()
            } as any;
          },
          close: () => {
            try {
              localRawDb.close();
            } catch {
              // Ignored
            }
          }
        } as any
      })
    });
  }
}

export function getDb(): Kysely<DatabaseSchema> {
  if (!dbInstance) {
    dbInstance = createDbInstance();
  }
  return dbInstance;
}

export async function reconnectDb(newConfig?: DbConfig): Promise<Kysely<DatabaseSchema>> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
  dbInstance = createDbInstance(newConfig);
  return dbInstance;
}

export async function testDbConnection(dbConf: DbConfig): Promise<{ success: boolean; error?: string }> {
  let tempDb: Kysely<DatabaseSchema> | null = null;
  try {
    tempDb = createDbInstance(dbConf);
    await sql`SELECT 1`.execute(tempDb);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'خطا در برقراری اتصال به پایگاه داده' };
  } finally {
    if (tempDb) {
      await tempDb.destroy();
    }
  }
}

export function setTestDb(db: Kysely<DatabaseSchema>) {
  dbInstance = db;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
