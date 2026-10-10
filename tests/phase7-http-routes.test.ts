import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { config } from '../src/core/config';
import { hashPassword } from '../src/core/security';

describe('HTTP Endpoints & Web Routing Integration', () => {
  const db = getDb();
  let app: any;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;

  beforeAll(async () => {
    await runMigrations(db);
    const created = createApp();
    app = created.app;

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const passHash = await hashPassword('Password123!');

    // 1. Seed super_admin user
    const adminRole = await db.selectFrom('roles').where('name', '=', 'super_admin').select('id').executeTakeFirst();
    const adminUser = await db.insertInto('users').values({
      full_name: 'مدیر کل تست',
      mobile: '09121110001',
      password_hash: passHash,
      role_id: adminRole!.id!,
      status: 'active',
      must_change_password: 0,
      created_at: now,
      updated_at: now
    }).execute();
    const adminUserId = Number(adminUser[0]?.insertId);

    // 2. Seed teacher
    const teacherRole = await db.selectFrom('roles').where('name', '=', 'teacher').select('id').executeTakeFirst();
    const tUser = await db.insertInto('users').values({
      full_name: 'استاد تست',
      mobile: '09122220001',
      password_hash: passHash,
      role_id: teacherRole!.id!,
      status: 'active',
      must_change_password: 0,
      created_at: now,
      updated_at: now
    }).execute();
    const teacherUserId = Number(tUser[0]?.insertId);
    await db.insertInto('teachers').values({
      user_id: teacherUserId,
      internal_code: 'TCH-HTTP-1',
      contract_status: 'active',
      created_at: now,
      updated_at: now
    }).execute();

    // 3. Seed student
    const studentRole = await db.selectFrom('roles').where('name', '=', 'student').select('id').executeTakeFirst();
    const sUser = await db.insertInto('users').values({
      full_name: 'فراگیر تست',
      mobile: '09123330001',
      password_hash: passHash,
      role_id: studentRole!.id!,
      status: 'active',
      must_change_password: 0,
      created_at: now,
      updated_at: now
    }).execute();
    const studentUserId = Number(sUser[0]?.insertId);
    await db.insertInto('students').values({
      user_id: studentUserId,
      student_code: 'STD-HTTP-1',
      created_at: now,
      updated_at: now
    }).execute();

    // Helper to log in with proper CSRF token
    async function loginUser(mobile: string, pass: string) {
      const page = await request(app).get('/auth/login');
      const setCookies = page.headers['set-cookie'] || [];
      const csrfCookie = setCookies.find((c: string) => c.startsWith('myclass_csrf='));
      const csrfToken = csrfCookie?.split(';')[0].split('=')[1];

      const res = await request(app)
        .post('/auth/login')
        .set('Cookie', csrfCookie)
        .send({ identifier: mobile, password: pass, _csrf: csrfToken });

      const loginCookies = res.headers['set-cookie'] || [];
      const sessionCookie = loginCookies.find((c: string) => c.startsWith(`${config.SESSION_COOKIE_NAME}=`));
      return sessionCookie || '';
    }

    adminCookie = await loginUser('09121110001', 'Password123!');
    teacherCookie = await loginUser('09122220001', 'Password123!');
    studentCookie = await loginUser('09123330001', 'Password123!');
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
    expect(res.text).toContain('ورود به سامانه');
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

  // Protected Admin Routes Verification
  it('redirects unauthorized requests from /admin to login', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
  });

  it('renders all admin views for logged-in super admin', async () => {
    const endpoints = [
      '/admin',
      '/admin/classes',
      '/admin/teachers',
      '/admin/students',
      '/admin/attendance',
      '/admin/finance',
      '/admin/certificates',
      '/admin/sms',
      '/admin/users',
      '/admin/settings',
      '/admin/backup'
    ];

    for (const ep of endpoints) {
      const res = await request(app).get(ep).set('Cookie', adminCookie);
      expect(res.status, `Endpoint ${ep} returned ${res.status}`).toBe(200);
    }
  });

  it('teacher portal access and role restrictions', async () => {
    // Teacher can access /teacher
    const tRes = await request(app).get('/teacher').set('Cookie', teacherCookie);
    expect(tRes.status).toBe(200);
    expect(tRes.text).toContain('پنل اختصاصی استاد');

    // Teacher is blocked from /admin
    const blockAdmin = await request(app).get('/admin').set('Cookie', teacherCookie);
    expect(blockAdmin.status).toBe(403);
    expect(blockAdmin.text).toContain('عدم دسترسی');
  });

  it('student portal access and role restrictions', async () => {
    // Student can access /student, /student/finance, /student/certificates
    const sRes = await request(app).get('/student').set('Cookie', studentCookie);
    expect(sRes.status).toBe(200);
    expect(sRes.text).toContain('پنل فراگیر');

    const sFin = await request(app).get('/student/finance').set('Cookie', studentCookie);
    expect(sFin.status).toBe(200);

    const sCert = await request(app).get('/student/certificates').set('Cookie', studentCookie);
    expect(sCert.status).toBe(200);

    // Student is blocked from /admin
    const blockAdmin = await request(app).get('/admin').set('Cookie', studentCookie);
    expect(blockAdmin.status).toBe(403);
    expect(blockAdmin.text).toContain('عدم دسترسی');
  });

  it('rejects POST requests missing CSRF token with 403 status', async () => {
    const res = await request(app)
      .post('/admin/courses/create')
      .set('Cookie', adminCookie)
      .send({ title: 'دوره تستی بدون توکن', code: 'CRS-NOCSRF', category: 'تست', level: 'مقدماتی' });

    expect(res.status).toBe(403);
    expect(res.text).toContain('CSRF');
  });

  it('allows admin to create a course with valid CSRF token and session', async () => {
    const page = await request(app).get('/admin/classes').set('Cookie', adminCookie);
    const setCookies = page.headers['set-cookie'] || [];
    const csrfCookie = setCookies.find((c: string) => c.startsWith('myclass_csrf='));
    const csrfToken = csrfCookie?.split(';')[0].split('=')[1];

    const res = await request(app)
      .post('/admin/courses/create')
      .set('Cookie', `${adminCookie}; ${csrfCookie}`)
      .send({
        _csrf: csrfToken,
        title: 'طراحی رابط کاربری با فیگما',
        code: 'CRS-FIGMA-1',
        category: 'طراحی',
        level: 'پیشرفته'
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/classes');

    // Verify course now exists in DB
    const course = await db.selectFrom('courses').where('code', '=', 'CRS-FIGMA-1').selectAll().executeTakeFirst();
    expect(course).toBeDefined();
    expect(course?.title).toBe('طراحی رابط کاربری با فیگما');
  });
});
