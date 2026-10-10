/** Helper — ساخت اپلیکیشن کامل برای تست‌های integration (با supertest). */
import type { Express } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/core/db/types';
import type { Config } from '../../src/core/config/env';
import { createApp } from '../../src/core/http/server';
import { createTestDb, createAdminUser, writeInstallLock, TEST_ADMIN, type TestDb } from './db';

export interface TestApp extends TestDb {
  app: Express;
  adminId: number;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const t = await createTestDb(overrides);
  writeInstallLock(t.storageDir);
  const adminId = await createAdminUser(t.db, t.config);
  const app = createApp({ db: t.db, config: t.config });
  return { ...t, app, adminId };
}

export { TEST_ADMIN };

/** لاگین و گرفتن agent (کوکی) */
export async function loginAgent(app: Express, username = TEST_ADMIN.username, password = TEST_ADMIN.password) {
  const { default: request } = await import('supertest');
  const agent = request.agent(app);
  await agent.post('/auth/login').type('form').send({ username, password });
  return agent;
}

export type { Kysely, Database, Config };
