import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Loads KEY=VALUE pairs from a .env file (if present) without overriding
 * variables already defined by the host (cPanel "Environment variables").
 * Dependency-free on purpose: shared hosts should not need extra packages.
 */
export function loadDotEnv(filePath: string, target: NodeJS.ProcessEnv = process.env): boolean {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (target[key] === undefined) target[key] = value;
  }
  return true;
}

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().default(''),
  DB_USER: z.string().default(''),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  INSTALL_TOKEN: z.string().default(''),
  STORAGE_DIR: z.string().default(''),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(8),
  COOKIE_SECURE: boolish.default(false),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
});

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  appRoot: string;
  storageDir: string;
  installLockFile: string;
  migrationsDir: string;
  db: { host: string; port: number; name: string; user: string; password: string; connectionLimit: number };
  installToken: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  trustProxy: number;
}

/** Builds a validated, immutable configuration. Secrets are never logged. */
export function loadConfig(appRoot: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`تنظیمات محیطی نامعتبر است: ${fields}`);
  }
  const e = parsed.data;
  const storageDir = e.STORAGE_DIR ? path.resolve(e.STORAGE_DIR) : path.join(appRoot, 'storage');
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    appRoot,
    storageDir,
    installLockFile: path.join(storageDir, 'install.lock'),
    migrationsDir: path.join(appRoot, 'migrations'),
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      name: e.DB_NAME,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      connectionLimit: e.DB_CONNECTION_LIMIT,
    },
    installToken: e.INSTALL_TOKEN,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: e.TRUST_PROXY,
  });
}
