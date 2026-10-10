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

describe('installer — انتخاب درایور و نصب کامل با SQLite', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  function installApp() {
    return createApp({ db: t.db, config: t.config });
  }

  function installBody(sqliteFile: string) {
    return {
      dbDriver: 'sqlite',
      sqlitePath: sqliteFile,
      appBaseUrl: 'http://localhost:3000',
      adminUsername: 'admin',
      adminPassword: 'Admin12345',
      adminFullName: 'مدیر تست',
    };
  }

  /** پیدا کردن و پاک کردن .env نوشته‌شده توسط installer (اثرات جانبی تست) */
  function cleanupWrittenEnv(): string | null {
    const candidates = [path.join(process.cwd(), '..', '.env'), path.join(process.cwd(), '.env')];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const content = fs.readFileSync(c, 'utf-8');
        fs.unlinkSync(c);
        return content;
      }
    }
    return null;
  }

  it('درایور نامعتبر → 400', async () => {
    const app = installApp();
    const res = await request(app).post('/install/run').send({ ...installBody('x'), dbDriver: 'postgres' });
    expect(res.status).toBe(400);
  });

  it('POST /install/check با sqlite — همه‌ی checks ok', async () => {
    const app = installApp();
    const sqliteFile = path.join(t.storageDir, 'check.sqlite');
    const res = await request(app).post('/install/check').send(installBody(sqliteFile));
    expect(res.status).toBe(200);
    // نکته: checkهای SESSION_SECRET/ENCRYPTION_KEY با مقدار پیش‌فرض dev «ok» نیستند (informational) —
    // اینجا فقط اتصال DB مهم است
    const labels = res.body.checks.map((c: { label: string }) => c.label);
    expect(labels).toContain('اتصال پایگاه داده');
    const dbCheck = res.body.checks.find((c: { label: string }) => c.label === 'اتصال پایگاه داده');
    expect(dbCheck.ok).toBe(true);
    expect(dbCheck.detail).toContain('SQLite');
  });

  it('POST /install/check با mysql down — check «اتصال» fail (بدون crash)', async () => {
    const app = installApp();
    const res = await request(app)
      .post('/install/check')
      .send({
        dbDriver: 'mysql',
        dbHost: '127.0.0.1',
        dbPort: 1, // refused
        dbName: 'myclass',
        dbUser: 'root',
        dbPassword: '',
        appBaseUrl: 'http://localhost:3000',
        adminUsername: 'admin',
        adminPassword: 'Admin12345',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    const dbCheck = res.body.checks.find((c: { label: string }) => c.label === 'اتصال پایگاه داده');
    expect(dbCheck.ok).toBe(false);
  });

  it('نصب کامل با SQLite — migrate + seed + admin + قفل + .env — و سپس لاگین واقعی', async () => {
    const app = installApp();
    const sqliteFile = path.join(t.storageDir, 'app.sqlite');
    let envContent: string | null = null;
    try {
      const res = await request(app).post('/install/run').send(installBody(sqliteFile));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.adminId).toBeGreaterThan(0);
      // قفل نصب
      expect(fs.existsSync(path.join(t.storageDir, '.installed'))).toBe(true);
      // فایل sqlite ساخته شده و جدول‌ها موجودند
      expect(fs.existsSync(sqliteFile)).toBe(true);
      // .env نوشته شده — محتوا را می‌خوانیم و پاک می‌کنیم
      envContent = cleanupWrittenEnv();
      expect(envContent).toBeTruthy();
      expect(envContent).toContain('DB_DRIVER=sqlite');
      expect(envContent).toContain(`DB_SQLITE_PATH=${sqliteFile}`);
      expect(envContent).toContain('SESSION_SECRET=');
      expect(envContent).not.toContain('DB_PASSWORD=');

      // اپلیکیشن دوم روی دیتابیس نصب‌شده — لاگین admin واقعی
      const { loadConfig } = await import('../../src/core/config/env');
      const { createDatabase } = await import('../../src/core/db/database');
      const { createApp: createApp2 } = await import('../../src/core/http/server');
      const config2 = loadConfig({
        NODE_ENV: 'test',
        DB_DRIVER: 'sqlite',
        DB_SQLITE_PATH: sqliteFile,
        STORAGE_DIR: t.storageDir,
        BCRYPT_ROUNDS: '4',
      });
      const db2 = createDatabase(config2);
      const app2 = createApp2({ db: db2, config: config2 });
      const agent = request.agent(app2);
      const login = await agent.post('/auth/login').type('form').send({ username: 'admin', password: 'Admin12345' });
      expect([200, 302]).toContain(login.status);
      const dash = await agent.get('/');
      expect(dash.status).toBe(200);
      expect(dash.text).toContain('داشبورد');
      // RBAC seed شده — admin دسترسی کامل دارد
      const warnings = await agent.get('/attendance/warnings');
      expect(warnings.status).toBe(200);
      await db2.destroy();
    } finally {
      if (!envContent) cleanupWrittenEnv();
    }
  }, 30000);

  it('پس از نصب — /install بسته می‌شود', async () => {
    const app = installApp();
    const sqliteFile = path.join(t.storageDir, 'app2.sqlite');
    try {
      await request(app).post('/install/run').send(installBody(sqliteFile));
      const res = await request(app).get('/install');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      // و نصب مجدد بسته است
      const again = await request(app).post('/install/run').send(installBody(sqliteFile));
      expect(again.status).toBe(302);
    } finally {
      cleanupWrittenEnv();
    }
  });
});
