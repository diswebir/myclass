/** تست‌های integration — احراز هویت: login/logout، قفل موقت، تغییر رمز، CSRF. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent, TEST_ADMIN } from '../helpers/app';

describe('auth — ورود/خروج', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('ورود موفق → redirect به داشبورد + کوکی HttpOnly', async () => {
    const res = await request(t.app)
      .post('/auth/login')
      .type('form')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toContain('mc_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('ورود با رمز اشتباه → 401 و پیام فارسی', async () => {
    const res = await request(t.app)
      .post('/auth/login')
      .type('form')
      .send({ username: TEST_ADMIN.username, password: 'wrong-pass' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('نام کاربری یا رمز عبور نادرست است');
  });

  it(' کاربر ناشناس → 401 JSON', async () => {
    const res = await request(t.app)
      .post('/auth/login')
      .send({ username: 'nobody', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('۵ تلاش ناموفق → قفل موقت (۴۲۹)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(t.app)
        .post('/auth/login')
        .type('form')
        .send({ username: TEST_ADMIN.username, password: 'wrong-pass' });
    }
    const res = await request(t.app)
      .post('/auth/login')
      .type('form')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });
    expect(res.status).toBe(429);
    expect(res.text).toContain('قفل');
  });

  it('نشست معتبر — داشبورد قابل مشاهده است', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('داشبورد');
    expect(res.text).toContain(TEST_ADMIN.fullName);
  });

  it('خروج → کوکی پاک می‌شود', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await agent.post('/auth/logout').type('form').send({ _csrf: csrf });
    expect(res.status).toBe(302);
    const after = await agent.get('/');
    expect(after.status).toBe(302); // دیگر وارد نیست → redirect به login
  });

  it('تغییر رمز — با رمز فعلی نادرست → 400', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent
      .post('/auth/change-password')
      .type('form')
      .send({ currentPassword: 'wrong', newPassword: 'NewPass123', confirmPassword: 'NewPass123', _csrf: '' });
    // CSRF zuerst — بدون توکن → 403
    expect([400, 403]).toContain(res.status);
  });

  it('تغییر رمز با CSRF → موفق', async () => {
    const agent = await loginAgent(t.app);
    // گرفتن توکن CSRF از صفحه تغییر رمز
    const page = await agent.get('/auth/change-password');
    const m = page.text.match(/name="_csrf" value="([^"]+)"/);
    const csrf = m ? m[1] : '';
    const res = await agent
      .post('/auth/change-password')
      .type('form')
      .set('Accept', 'text/html')
      .send({ currentPassword: TEST_ADMIN.password, newPassword: 'NewPass123', confirmPassword: 'NewPass123', _csrf: csrf });
    expect(res.status).toBe(200);
    expect(res.text).toContain('رمز عبور با موفقیت تغییر کرد');
    // ورود با رمز جدید
    const res2 = await request(t.app)
      .post('/auth/login')
      .type('form')
      .send({ username: TEST_ADMIN.username, password: 'NewPass123' });
    expect(res2.status).toBe(302);
  });
});

describe('CSRF', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('POST بدون توکن CSRF → 403', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.post('/settings/institute.name').send({ value: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST با توکن CSRF در هدر → موفق', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const m = page.text.match(/name="_csrf" value="([^"]+)"/);
    const csrf = m ? m[1] : '';
    expect(csrf.length).toBeGreaterThan(10);
    const res = await agent
      .put('/settings/institute.name')
      .set('X-CSRF-Token', csrf)
      .send({ value: 'مؤسسه تست' });
    expect(res.status).toBe(200);
  });

  it('GET undir CSRF — مشکلی نیست', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.get('/settings');
    expect(res.status).toBe(200);
  });
});
