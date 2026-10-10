/** تست‌های integration — install gate و health. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDb, writeInstallLock, type TestDb } from '../helpers/db';
import { createApp } from '../../src/core/http/server';

describe('install gate', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('وقتی نصب نشده — درخواست به /install redirect می‌شود', async () => {
    const app = createApp({ db: t.db, config: t.config });
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/install');
  });

  it('وقتی نصب نشده — /install در دسترس است', async () => {
    const app = createApp({ db: t.db, config: t.config });
    const res = await request(app).get('/install');
    expect(res.status).toBe(200);
    expect(res.text).toContain('نصب myclass');
  });

  it('وقتی نصب شده — /install بسته می‌شود (redirect)', async () => {
    writeInstallLock(t.storageDir);
    const app = createApp({ db: t.db, config: t.config });
    const res = await request(app).get('/install');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('/healthz عمومی است', async () => {
    const app = createApp({ db: t.db, config: t.config });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('/admin/health بدون ورود → redirect به login', async () => {
    writeInstallLock(t.storageDir);
    const app = createApp({ db: t.db, config: t.config });
    const res = await request(app).get('/admin/health').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('قفل نصب در STORAGE_DIR ساخته می‌شود', () => {
    writeInstallLock(t.storageDir);
    expect(fs.existsSync(path.join(t.storageDir, '.installed'))).toBe(true);
  });
});
