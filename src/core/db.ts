import { Kysely, MysqlDialect, SqliteDialect } from 'kysely';
import mysql from 'mysql2';
import { DatabaseSchema } from './types';
import { config } from './config';
import { logger } from './logger';

let dbInstance: Kysely<DatabaseSchema> | null = null;
let sqliteRawDb: any = null;

export function getDb(): Kysely<DatabaseSchema> {
  if (dbInstance) return dbInstance;

  if (config.DB_DIALECT === 'mysql') {
    logger.info('Connecting to MySQL/MariaDB database...');
    const pool = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      dateStrings: true
    });

    dbInstance = new Kysely<DatabaseSchema>({
      dialect: new MysqlDialect({ pool: pool as any })
    });
  } else {
    // SQLite mode using Node 22 built-in DatabaseSync
    const { DatabaseSync } = require('node:sqlite');
    sqliteRawDb = new DatabaseSync(':memory:');
    
    // Enable WAL and foreign keys
    sqliteRawDb.exec('PRAGMA foreign_keys = ON;');

    dbInstance = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({
        database: {
          prepare: (sql: string) => {
            const stmt = sqliteRawDb.prepare(sql);
            const isSelect = !sql.trim().match(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK|PRAGMA)/i);
            return {
              reader: isSelect,
              all: (params: any) => stmt.all(...(params || [])),
              run: (params: any) => {
                const info = stmt.run(...(params || []));
                return {
                  changes: info.changes,
                  lastInsertRowid: info.lastInsertRowid
                };
              },
              iterate: (params: any) => stmt.iterate ? stmt.iterate(...(params || [])) : stmt.all(...(params || []))[Symbol.iterator]()
            } as any;
          },
          close: () => sqliteRawDb.close()
        } as any
      })
    });
    logger.info('Initialized in-memory SQLite database dialect');
  }

  return dbInstance;
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
