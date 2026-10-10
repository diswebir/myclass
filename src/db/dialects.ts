import type { Dialect } from './types';

export const mysqlDialect: Dialect = {
  name: 'mysql',
  insertIgnore: 'INSERT IGNORE',
  forUpdate: ' FOR UPDATE',
  likeEscape: "ESCAPE '\\\\'",
  incoming: (c) => `${c} = VALUES(${c})`,
  upsert: (_conflict, assignments) => `ON DUPLICATE KEY UPDATE ${assignments.join(', ')}`,
  beginSql: 'START TRANSACTION',
  migrationsTableDdl: `CREATE TABLE IF NOT EXISTS schema_migrations (
    version CHAR(3) NOT NULL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    execution_ms INT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
};

export const sqliteDialect: Dialect = {
  name: 'sqlite',
  insertIgnore: 'INSERT OR IGNORE',
  forUpdate: '',
  likeEscape: "ESCAPE '\\'",
  incoming: (c) => `${c} = excluded.${c}`,
  upsert: (conflict, assignments) => `ON CONFLICT(${conflict.join(', ')}) DO UPDATE SET ${assignments.join(', ')}`,
  beginSql: 'BEGIN IMMEDIATE',
  migrationsTableDdl: `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    execution_ms INTEGER NOT NULL DEFAULT 0
  )`,
};
