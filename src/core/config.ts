import path from 'path';
import { z } from 'zod';

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
