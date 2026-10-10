/**
 * Config — laden و اعتبارسنجی متغیرهای محیطی با Zod.
 *هیچ secret در کد hardcode نشده؛ همه چیز از env (یا فایل .env خارج از webroot).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** لود فایل .env (اگر موجود باشد) — مقدار موجود در process.env برتری دارد.
 *  ترتیب: ../.env (خارج از webroot — امن‌تر) سپس ./.env */
export function loadDotEnv(filePath?: string): void {
  const p =
    filePath ??
    [path.join(process.cwd(), '..', '.env'), path.join(process.cwd(), '.env')].find((c) => fs.existsSync(c)) ??
    path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    let val = rawVal;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** مقادیر پیش‌فرض Environment desarrollo — فقط برای dev/test؛ در production توسط installer/env مقداردهی می‌شوند. */
export const DEV_DEFAULT_SESSION_SECRET = 'dev-only-insecure-secret-change-me';
export const DEV_DEFAULT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().default('http://localhost:3000'),

  DB_DRIVER: z.enum(['mysql', 'sqlite']).default('mysql'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_NAME: z.string().default('myclass'),
  DB_USER: z.string().default('myclass'),
  DB_PASSWORD: z.string().default(''),
  DB_SQLITE_PATH: z.string().default('./.test-data/app.sqlite'),

  SESSION_SECRET: z.string().min(16).default(DEV_DEFAULT_SESSION_SECRET),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(2),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  STORAGE_DIR: z.string().default('../storage'),
  UPLOAD_DIR: z.string().default('../storage/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),

  ENCRYPTION_KEY: z.string().min(32).default(DEV_DEFAULT_ENCRYPTION_KEY),

  INSTALL_ALLOW_REINSTALL: z.enum(['0', '1']).default('0'),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  SMS_PROVIDER: z.string().default('ippanel'),
  IP_PANEL_API_KEY: z.string().default(''),
  IP_PANEL_BASE_URL: z.string().default('https://edge.ippanel.com/v1'),
  SMS_LIVE_TESTS: z.enum(['0', '1']).default('0'),
  SMS_CRON_TOKEN: z.string().default(''),

  TEST_DB_DSN: z.string().default(''),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  const merged: Record<string, string | undefined> = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`خطای تنظیمات محیطی: ${issues}`);
  }
  return parsed.data;
}

export function isSecureCookies(cfg: Config): boolean {
  if (cfg.COOKIE_SECURE === 'true') return true;
  if (cfg.COOKIE_SECURE === 'false') return false;
  return cfg.APP_BASE_URL.startsWith('https://');
}
