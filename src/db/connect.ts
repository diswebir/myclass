import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/env';
import { MysqlDriver } from './mysql-driver';
import { SqliteDriver } from './sqlite-driver';
import type { Driver, DriverName } from './types';

export type DriverChoice = DriverName;

/**
 * Which engine this installation uses, in priority order:
 *   1. storage/db-config.json, written by the installer when the administrator chose an engine;
 *   2. DB_DRIVER from the environment;
 *   3. MySQL, if DB_NAME and DB_USER are set (installations made before SQLite support existed).
 * Returns null on a fresh install with nothing chosen yet.
 */
export function resolveDriverChoice(cfg: AppConfig): DriverChoice | null {
  const fromFile = readDriverFile(cfg.dbConfigFile);
  if (fromFile) return fromFile;
  if (cfg.dbDriverEnv) return cfg.dbDriverEnv;
  if (cfg.db.name && cfg.db.user) return 'mysql';
  return null;
}

function readDriverFile(file: string): DriverChoice | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { driver?: unknown };
    return parsed.driver === 'mysql' || parsed.driver === 'sqlite' ? parsed.driver : null;
  } catch {
    return null;
  }
}

/** Persists the chosen engine atomically. The file contains no secrets (credentials stay in the environment). */
export function writeDriverChoice(cfg: AppConfig, choice: DriverChoice): void {
  fs.mkdirSync(path.dirname(cfg.dbConfigFile), { recursive: true });
  const tmp = `${cfg.dbConfigFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ driver: choice, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, cfg.dbConfigFile);
}

/** Opens a driver for the given engine. SQLite creates the file on first use; MySQL connects lazily. */
export async function createDriver(cfg: AppConfig, choice: DriverChoice): Promise<Driver> {
  if (choice === 'mysql') return new MysqlDriver(cfg.db);
  return SqliteDriver.open(cfg.sqlitePath);
}
