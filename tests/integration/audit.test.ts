/** تست‌های integration — audit log + health + صفحه خطا. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent, TEST_ADMIN } from '../helpers/app';

describe('audit log', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('ورود موفق در audit ثبت می‌شود', async () => {
    await request(t.app)
      .post('/auth/login')
      .type('form')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });
    const rows = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'login_success').execute();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('تغییر تنظیمات در audit ثبت می‌شود (بدون مقدار secret)', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    await agent
      .put('/settings/sms.ip_panel_api_key')
      .set('X-CSRF-Token', csrf)
      .send({ value: 'super-secret-key-999' });
    const rows = await t.db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'settings_updated')
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    // مقدار secret در meta لاگ نمی‌شود
    expect(rows[0].meta).not.toContain('super-secret-key-999');
  });

  it('فهرست audit — فقط با مجوز', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.get('/audit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('login_success');
  });

  it('کاربر student به /audit دسترسی ندارد', async () => {
    const { hashPassword } = await import('../../src/core/security/password');
    const { nowDb } = await import('../../src/core/db/time');
    const hash = await hashPassword('User12345', t.config.BCRYPT_ROUNDS);
    const ins = await t.db
      .insertInto('users')
      .values({
        username: 'student1', email: null, phone: null, password_hash: hash,
        full_name: 'دانش‌آموز', is_active: 1, created_at: nowDb(), updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const uid = Number(ins.insertId);
    const rbac = new (await import('../../src/modules/rbac/rbac.service')).RbacService(t.db);
    const role = await rbac.repo.findRoleBySlug('student');
    await t.db.insertInto('user_roles').values({ user_id: uid, role_id: Number(role!.id) }).execute();
    const agent = await loginAgent(t.app, 'student1', 'User12345');
    const res = await agent.get('/audit');
    expect(res.status).toBe(403);
  });
});

describe('health + خطا', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('مدیرکل — /admin/health 200 + JSON', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.get('/admin/health');
    expect(res.status).toBe(200);
    expect(res.body.dbConnected).toBe(true);
    expect(res.body.dialect).toBe('sqlite');
    expect(res.body.migrationsApplied).toBe(6);
  });

  it('صفحه 404 — HTML فارسی', async () => {
    const res = await request(t.app).get('/no-such-page').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.text).toContain('یافت نشد');
  });

  it('پاسخ 404 به‌صورت JSON برای API', async () => {
    const res = await request(t.app).get('/api/no-such').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
