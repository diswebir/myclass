import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export interface DbConfig {
  dialect: 'mysql' | 'sqlite';
  sqlitePath?: string;
  mysql?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_SECRET: z.string().min(16).default('myclass_super_secret_app_key_default_32ch'),
  SESSION_COOKIE_NAME: z.string().default('myclass_session'),
  DB_DIALECT: z.enum(['mysql', 'sqlite']).default('sqlite'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('myclass_db'),
  STORAGE_DIR: z.string().default(path.resolve(process.cwd(), 'storage')),
  PUBLIC_DIR: z.string().default(path.resolve(process.cwd(), 'public')),
  CRON_SECRET: z.string().default('cron_secret_token_change_in_production'),
  SMS_LIVE_TESTS: z.coerce.number().default(0),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration variables:', parsed.error.format());
  throw new Error('Invalid environment variables');
}

export const config = parsed.data;

export function getDbConfigFile(): string {
  return path.join(config.STORAGE_DIR, 'db-config.json');
}

export function getEffectiveDbConfig(): DbConfig {
  const configFile = getDbConfigFile();
  if (fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, 'utf8');
      const loaded = JSON.parse(content);
      if (loaded && (loaded.dialect === 'mysql' || loaded.dialect === 'sqlite')) {
        return loaded;
      }
    } catch {
      // Fallback to env
    }
  }

  return {
    dialect: config.DB_DIALECT,
    sqlitePath: path.join(config.STORAGE_DIR, 'database.sqlite'),
    mysql: {
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME
    }
  };
}

export function saveEffectiveDbConfig(newConfig: DbConfig): void {
  fs.mkdirSync(config.STORAGE_DIR, { recursive: true });
  fs.writeFileSync(getDbConfigFile(), JSON.stringify(newConfig, null, 2), 'utf8');

  // Update in-memory config object
  config.DB_DIALECT = newConfig.dialect;
  if (newConfig.mysql) {
    if (newConfig.mysql.host) config.DB_HOST = newConfig.mysql.host;
    if (newConfig.mysql.port) config.DB_PORT = newConfig.mysql.port;
    if (newConfig.mysql.user) config.DB_USER = newConfig.mysql.user;
    if (newConfig.mysql.password !== undefined) config.DB_PASSWORD = newConfig.mysql.password;
    if (newConfig.mysql.database) config.DB_NAME = newConfig.mysql.database;
  }
}
