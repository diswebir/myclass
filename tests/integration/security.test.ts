/** تست‌های integration — امنیت: هدرهای helmet، rate limit، CSRF، XSS در خروجی. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';

describe('security — هدرهای امنیتی (helmet)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('هدرهای امنیتی در پاسخ موجودند', async () => {
    const res = await request(t.app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('Rate limit — بعد از N درخواست بلاک می‌شود', async () => {
    // محدودیت پیش‌فرض ۱۰۰ در ۱۵ دقیقه — با override تست Stripe: 5
    const t2 = await createTestApp({ RATE_LIMIT_MAX: '5', RATE_LIMIT_WINDOW_MINUTES: '15' });
    try {
      let lastStatus = 0;
      for (let i = 0; i < 8; i++) {
        const res = await request(t2.app).get('/healthz');
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
    } finally {
      await t2.cleanup();
    }
  });

  it('Rate limit — IPهای مختلف کلید متفاوت دارند', async () => {
    const t2 = await createTestApp({ RATE_LIMIT_MAX: '3' });
    try {
      // ۳ درخواست از 10.0.0.0 (در محدودیت) — همگی OK
      for (let i = 0; i < 3; i++) {
        const res = await request(t2.app).get('/healthz').set('X-Forwarded-For', '10.0.0.0');
        expect(res.status).toBe(200);
      }
      // درخواست چهارم از همان IP → بلاک
      const blocked = await request(t2.app).get('/healthz').set('X-Forwarded-For', '10.0.0.0');
      expect(blocked.status).toBe(429);
      // IP دیگر هنوز باز است (کلید متفاوت)
      const other = await request(t2.app).get('/healthz').set('X-Forwarded-For', '10.0.0.1');
      expect(other.status).toBe(200);
    } finally {
      await t2.cleanup();
    }
  });
});

describe('security — XSS در خروجی (escaping)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('نام کاربر با HTML injection در داشبورد escape می‌شود', async () => {
    // کاربر admin را به یک مقدار HTML تغییر می‌دهیم و داشبورد را می‌بینیم
    await t.db.updateTable('users').set({ full_name: '<script>alert(1)</script>' }).where('id', '=', t.adminId).execute();
    const agent = await loginAgent(t.app);
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('security — CSRF — بررسی توکن', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('توکن CSRF در هر نشست متفاوت است', async () => {
    const agent1 = await loginAgent(t.app);
    const agent2 = await loginAgent(t.app);
    const p1 = await agent1.get('/');
    const p2 = await agent2.get('/');
    const csrf1 = (p1.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const csrf2 = (p2.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    expect(csrf1).toBeTruthy();
    expect(csrf2).toBeTruthy();
    expect(csrf1).not.toBe(csrf2);
  });

  it('توکن اشتباه CSRF → 403', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.post('/settings/institute.name').set('X-CSRF-Token', 'wrong-token').send({ value: 'x' });
    expect(res.status).toBe(403);
  });
});
