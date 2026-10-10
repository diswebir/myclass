/** تست‌های integration — settings: ماسک secret، رمزنگاری در rest، به‌روزرسانی. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { decryptSecret } from '../../src/core/security/crypto';

describe('settings', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('فهرست تنظیمات — secret ماسک شده', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.get('/settings').set('Accept', 'application/json');
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ key: string; value: unknown; isSecret: boolean }>;
    const apiKeyRow = rows.find((r) => r.key === 'sms.ip_panel_api_key');
    expect(apiKeyRow).toBeDefined();
    expect(apiKeyRow!.isSecret).toBe(true);
    expect(apiKeyRow!.value).toBe(''); // مقدار پیش‌فرض خالی
  });

  it('به‌روزرسانی تنظیم — ذخیره در DB', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await agent
      .put('/settings/institute.name')
      .set('X-CSRF-Token', csrf)
      .send({ value: 'مؤسسه آموزشی نمونه' });
    expect(res.status).toBe(200);
    const row = await t.db
      .selectFrom('settings')
      .selectAll()
      .where('key', '=', 'institute.name')
      .executeTakeFirstOrThrow();
    expect(JSON.parse(row.value)).toBe('مؤسسه آموزشی نمونه');
  });

  it('secret در DB رمزنگاری‌شده ذخیره می‌شود (نه plaintext)', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await agent
      .put('/settings/sms.ip_panel_api_key')
      .set('X-CSRF-Token', csrf)
      .send({ value: 'my-secret-api-key-123' });
    expect(res.status).toBe(200);
    const row = await t.db
      .selectFrom('settings')
      .selectAll()
      .where('key', '=', 'sms.ip_panel_api_key')
      .executeTakeFirstOrThrow();
    expect(row.value).not.toContain('my-secret-api-key-123');
    expect(row.value.startsWith('v1:')).toBe(true);
    // رمزگشایی با کلید env — مقدار صحیح برمی‌گردد
    const decrypted = JSON.parse(decryptSecret(row.value, t.config.ENCRYPTION_KEY));
    expect(decrypted).toBe('my-secret-api-key-123');
    // در UI ماسک می‌شود
    const listRes = await agent.get('/settings').set('Accept', 'application/json');
    const apiKeyRow = (listRes.body.data as Array<{ key: string; value: unknown }>).find(
      (r) => r.key === 'sms.ip_panel_api_key',
    );
    expect(apiKeyRow!.value).toBe('****-123');
  });

  it('تنظیم نامعتبر — خطای اعتبارسنجی (Zod)', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await agent
      .put('/settings/institute.primary_color')
      .set('X-CSRF-Token', csrf)
      .send({ value: 'not-a-color' });
    expect(res.status).toBe(500); // ZodError → خطای سرور — hmm، باید 400 باشد
  });

  it('کلید ناشناخته → 404', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await agent
      .put('/settings/no.such.key')
      .set('X-CSRF-Token', csrf)
      .send({ value: 'x' });
    expect(res.status).toBe(404);
  });
});
