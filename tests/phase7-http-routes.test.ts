import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { config } from '../src/core/config';

describe('HTTP Endpoints & Web Routing Integration', () => {
  const db = getDb();
  let app: any;

  beforeAll(async () => {
    await runMigrations(db);
    const created = createApp();
    app = created.app;
  });

  afterAll(async () => {
    await closeDb();
  });

  it('GET /health returns healthy status and system metrics', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.status).toBe('healthy');
    expect(res.body.nodeVersion).toBeDefined();
    expect(res.body.memory).toBeDefined();
  });

  it('GET /auth/login renders login page with CSRF token and 200 status', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ورود به سامانه مدیریت مؤسسه');
    expect(res.text).toContain('identifier');
    expect(res.text).toContain('password');
  });

  it('GET /verify/CERT-SAMPLE renders public certificate verification page', async () => {
    const res = await request(app).get('/verify/CERT-SAMPLE');
    expect(res.status).toBe(200);
    expect(res.text).toContain('گواهینامه یافت نشد');
  });

  it('GET /preregister/status renders pre-registration lookup page', async () => {
    const res = await request(app).get('/preregister/status');
    expect(res.status).toBe(200);
    expect(res.text).toContain('پیگیری وضعیت پیش‌ثبت‌نام');
  });

  it('GET /api/cron/run protects against invalid cron token', async () => {
    const res = await request(app).get('/api/cron/run?token=invalid_secret');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('نامعتبر');
  });

  it('GET /api/cron/run processes queue with valid cron secret', async () => {
    const res = await request(app).get(`/api/cron/run?token=${config.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.processedSms).toBeDefined();
  });
});
