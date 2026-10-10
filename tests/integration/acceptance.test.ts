/**
 * سناریوی پذیرش §۸ — ۲۳ گام end-to-end.
 * Step 20 (real SMS) is NOT_RUN unless SMS_LIVE_TESTS=1 + API key — per spec.
 * Each step is one test; success/failure/not-run is recorded in the name and assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb, toDbDate } from '../../src/core/db/time';
import { formatJalaali } from '../../src/core/text/jalaali';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { RbacService } from '../../src/modules/rbac/rbac.service';
import { FakeSmsProvider } from '../../src/modules/sms/provider';
import { migrateToLatest } from '../../src/core/db/migrate';

async function csrfOf(agent: request.SuperTest<request.Test>): Promise<string> {
  const page = await agent.get('/');
  return (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

async function createUser(t: TestApp, username: string, roles: string[] = [], password = 'User12345') {
  const hash = await hashPassword(password, t.config.BCRYPT_ROUNDS);
  const res = await t.db
    .insertInto('users')
    .values({
      username, email: null, phone: null, password_hash: hash,
      full_name: `کاربر ${username}`, is_active: 1, created_at: nowDb(), updated_at: nowDb(),
    })
    .executeTakeFirstOrThrow();
  const userId = Number(res.insertId);
  const rbac = new RbacService(t.db);
  for (const slug of roles) {
    const role = await rbac.repo.findRoleBySlug(slug);
    if (role) await t.db.insertInto('user_roles').values({ user_id: userId, role_id: Number(role.id) }).execute();
  }
  return userId;
}

describe('سناریوی پذیرش §۸ — ۲۳ گام', () => {
  let t: TestApp;
  let admin: request.SuperTest<request.Test>;
  let adminCsrf: string;

  // shared state across steps
  const S: {
    classId?: number;
    courseId?: number;
    teacherId?: number;
    teacherUserId?: number;
    studentIds: number[];
    studentUserIds: number[];
    sessionId?: number;
    enrollmentId?: number;
    preregId?: number;
    paymentId?: number;
    receiptId?: number;
    certToken?: string;
    certCode?: string;
    roleId?: number;
    financeUserId?: number;
  } = { studentIds: [], studentUserIds: [] };

  beforeAll(async () => {
    FakeSmsProvider.reset();
    t = await createTestApp();
    admin = await loginAgent(t.app);
    adminCsrf = await csrfOf(admin);
  });
  afterAll(async () => { await t.cleanup(); });

  it('step 1 — install (createTestApp = sqlite install + lock)', async () => {
    // createTestApp = migrations + seed + admin + install lock (install API e2e covered in install.test.ts)
    const status = await admin.get('/install/status');
    expect([200, 302]).toContain(status.status);
    // install lock file exists and records installedAt
    const lockPath = path.join(t.storageDir, '.installed');
    expect(fs.existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(lock.installedAt).toBeTruthy();
  });

  it('گام ۲ — ثبت اطلاعات مؤسسه', async () => {
    for (const [key, value] of [
      ['institute.name', 'مؤسسه آموزشی نمونه'],
      ['institute.phone', '02100000000'],
      ['institute.primary_color', '#1d4ed8'],
    ] as Array<[string, string]>) {
      const res = await admin.put(`/settings/${key}`).set('X-CSRF-Token', adminCsrf).send({ value });
      expect(res.status).toBe(200);
    }
    const row = await t.db.selectFrom('settings').select('value').where('key', '=', 'institute.name').executeTakeFirstOrThrow();
    expect(row.value).toContain('مؤسسه آموزشی نمونه');
  });

  it('گام ۳ — ساخت نقش جدید و تخصیص مجوز', async () => {
    const res = await admin.post('/rbac/roles').set('X-CSRF-Token', adminCsrf).send({
      name: 'مسئول مالی',
      slug: 'acceptance_finance',
      description: 'نقش تستی سناریوی پذیرش',
      permissions: ['finance.*', 'students.list', 'classes.list'],
    });
    expect(res.status).toBe(201);
    S.roleId = res.body.roleId;
    const role = await t.db.selectFrom('roles').selectAll().where('slug', '=', 'acceptance_finance').executeTakeFirstOrThrow();
    expect(Number(role.id)).toBe(S.roleId);
    const permCount = await t.db
      .selectFrom('role_permissions')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('role_id', '=', S.roleId)
      .executeTakeFirstOrThrow();
    expect(Number(permCount.c)).toBeGreaterThanOrEqual(3);
  });

  it('گام ۴ — ثبت یک استاد و چند فراگیر', async () => {
    // استاد
    const tres = await admin.post('/teachers').set('X-CSRF-Token', adminCsrf).send({
      code: 'T-ACC-1', firstName: 'احمد', lastName: 'استادی', phone: '09120000050',
    });
    expect(tres.status).toBe(201);
    S.teacherId = tres.body.id;
    // link teacher to user
    S.teacherUserId = await createUser(t, 'acc_teacher', ['teacher']);
    await t.db.updateTable('teachers').set({ user_id: S.teacherUserId }).where('id', '=', S.teacherId).execute();
    // فراگیرها
    for (let i = 0; i < 3; i++) {
      const sres = await admin.post('/students').set('X-CSRF-Token', adminCsrf).send({
        code: `ST-ACC-${i}`, firstName: 'سارا', lastName: 'احمدی', phone: `0912000006${i}`,
      });
      expect(sres.status).toBe(201);
      S.studentIds.push(sres.body.id);
      S.studentUserIds.push(await createUser(t, `acc_student_${i}`, ['student']));
      await t.db.updateTable('students').set({ user_id: S.studentUserIds[i] }).where('id', '=', S.studentIds[i]).execute();
    }
    expect(S.studentIds).toHaveLength(3);
  });

  it('گام ۵ — ساخت کلاس با زمان، جلسات و شهریه', async () => {
    const cres = await admin.post('/courses').set('X-CSRF-Token', adminCsrf).send({ title: 'دوره Front-End', code: 'FE-1' });
    expect(cres.status).toBe(201);
    S.courseId = cres.body.id;
    const cls = await admin.post('/classes').set('X-CSRF-Token', adminCsrf).send({
      title: 'کلاس Front-End ۱', code: 'FE-CL-1', courseId: S.courseId, capacity: 10, fee: '2000000', weekdays: [6],
    });
    expect(cls.status).toBe(201);
    S.classId = cls.body.id;
    // جلسه — تاریخ شمسی
    const sess = await admin.post(`/classes/${S.classId}/sessions`).set('X-CSRF-Token', adminCsrf).send({
      sessionDate: formatJalaali(new Date()), startTime: '16:00', durationMinutes: 90, topic: 'جلسه اول',
    });
    expect(sess.status).toBe(201);
    S.sessionId = sess.body.id;
  });

  it('گام ۶ — تخصیص استاد به کلاس', async () => {
    const res = await admin.post(`/classes/${S.classId}/teachers`).set('X-CSRF-Token', adminCsrf).send({ teacherId: S.teacherId });
    expect(res.status).toBe(201);
    const row = await t.db.selectFrom('class_teachers').selectAll().where('class_id', '=', S.classId).executeTakeFirst();
    expect(row).toBeTruthy();
  });

  it('گام ۷ — فعال‌سازی فرم پیش‌ثبت‌نام', async () => {
    const res = await admin.post(`/prereg/forms/${S.classId}`).set('X-CSRF-Token', adminCsrf).send({
      fields: [{ key: 'phone2', label: 'تلفن تماس', type: 'phone', required: false }],
    });
    expect(res.status).toBe(200);
    // enable public preregistration on the class (classSchema.preregEnabled)
    const en = await admin.put(`/classes/${S.classId}`).set('X-CSRF-Token', adminCsrf).send({
      title: 'کلاس Front-End ۱', code: 'FE-CL-1', courseId: S.courseId, capacity: 10, fee: '2000000', weekdays: [6], preregEnabled: 1,
    });
    expect(en.status).toBe(200);
    const cls = await t.db.selectFrom('classes').select('prereg_enabled').where('id', '=', S.classId).executeTakeFirstOrThrow();
    expect(Number(cls.prereg_enabled)).toBe(1);
  });

  it('گام ۸ — تبدیل درخواست متقاضی به ثبت‌نام قطعی (بدون تکرار)', async () => {
    // ثبت‌نام مستقیم دو فراگیر + یک پیش‌ثبت‌نام
    for (let i = 0; i < 2; i++) {
      const enr = await admin.post('/enrollments').set('X-CSRF-Token', adminCsrf).send({
        classId: S.classId, studentId: S.studentIds[i], feeAmount: '2000000',
      });
      expect(enr.status).toBe(201);
      if (i === 0) S.enrollmentId = enr.body.id;
    }
    // پیش‌ثبت‌نام عمومی
    const pub = await request(t.app)
      .post(`/prereg/public/FE-CL-1`)
      .send({ applicantName: 'رضا پیش‌ثبت', phone: '09120000070' });
    expect(pub.status).toBe(201);
    S.preregId = pub.body.id;
    // ابتدا بررسی و تأیید پیش‌ثبت‌نام
    const rev = await admin.post(`/prereg/${S.preregId}/review`).set('X-CSRF-Token', adminCsrf).send({ status: 'approved' });
    expect(rev.status).toBe(200);
    // تبدیل به ثبت‌نام
    const conv = await admin.post(`/enrollments/convert/${S.preregId}`).set('X-CSRF-Token', adminCsrf).send({});
    expect(conv.status).toBe(200);
    // تبدیل دوباره → تکراری → ۴۰۹
    const dup = await admin.post(`/enrollments/convert/${S.preregId}`).set('X-CSRF-Token', adminCsrf).send({});
    expect(dup.status).toBe(409);
  });

  it('گام ۹ — ورود فراگیر و مشاهده فقط اطلاعات خودش', async () => {
    const sagent = await loginAgent(t.app, 'acc_student_0', 'User12345');
    const panel = await sagent.get('/panel/student');
    expect(panel.status).toBe(200);
    expect(panel.body.data.classes).toHaveLength(1);
    expect(Number(panel.body.data.classes[0].class_id)).toBe(S.classId);
    expect(Number(panel.body.data.classes[0].enrollment_id)).toBe(S.enrollmentId);
    // student 0 sees only own finance data (no other student's rows)
    const fin = await sagent.get('/panel/student/finance');
    expect(fin.status).toBe(200);
    expect(fin.body.data.enrollments).toHaveLength(1);
    expect(Number(fin.body.data.enrollments[0].enrollment.id)).toBe(S.enrollmentId);
  });

  it('گام ۱۰ — ورود استاد و مشاهده فقط کلاس‌های خودش', async () => {
    const tagent = await loginAgent(t.app, 'acc_teacher', 'User12345');
    const panel = await tagent.get('/panel/teacher');
    expect(panel.status).toBe(200);
    expect(panel.body.data.classes).toHaveLength(1);
    expect(Number(panel.body.data.classes[0].id)).toBe(S.classId);
  });

  it('گام ۱۱ — ثبت حضور و غیاب یک جلسه', async () => {
    const res = await admin
      .post(`/attendance/mark/${S.sessionId}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        entries: S.studentIds.slice(0, 2).map((sid, i) => ({ studentId: sid, status: i === 0 ? 'present' : 'absent' })),
      });
    expect(res.status).toBe(200);
    const rows = await t.db.selectFrom('attendance').selectAll().where('session_id', '=', S.sessionId).execute();
    expect(rows).toHaveLength(2);
  });

  it('گام ۱۲ — انعکاس در گزارش‌های مجاز', async () => {
    const rep = await admin.get(`/attendance/report/class/${S.classId}`);
    expect(rep.status).toBe(200);
    expect(rep.body.data.sessions).toHaveLength(1);
    expect(rep.body.data.students.length).toBeGreaterThanOrEqual(2);
  });

  it('گام ۱۳ — تعریف شهریه و اقساط برای فراگیر', async () => {
    const res = await admin.post('/finance/installments/schedule').set('X-CSRF-Token', adminCsrf).send({
      enrollmentId: S.enrollmentId,
      count: 4,
      firstDueDate: toDbDate(new Date(Date.now() + 86400000)),
    });
    expect(res.status).toBe(201);
    const rows = await t.db.selectFrom('installments').selectAll().where('enrollment_id', '=', S.enrollmentId).execute();
    expect(rows).toHaveLength(4);
    // ۴ قسط ۵۰۰۰۰۰ — مجموع = شهریه
    const total = rows.reduce((a, r) => a + Number(r.amount), 0);
    expect(total).toBe(2000000);
  });

  it('گام ۱۴ — ثبت رسید کارت‌به‌کارت و بررسی توسط کاربر مالی', async () => {
    // finance user with the role created in step 3
    S.financeUserId = await createUser(t, 'acc_finance', []);
    await admin.post(`/users/${S.financeUserId}/roles`).set('X-CSRF-Token', adminCsrf).send({ roleIds: [S.roleId] });
    // student uploads receipt (1x1 PNG)
    const PNG = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db4000000004945' +
        '4e44ae426082',
      'hex',
    );
    const sagent = await loginAgent(t.app, 'acc_student_0', 'User12345');
    const scsrf = await csrfOf(sagent);
    const up = await sagent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', scsrf)
      .field('enrollmentId', String(S.enrollmentId))
      .field('amount', '۵۰۰۰۰۰')
      .field('idempotencyKey', 'acc-receipt-1')
      .attach('file', PNG, { filename: 'receipt.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    S.receiptId = up.body.receiptId;
    // بررسی توسط کاربر مالی
    const fagent = await loginAgent(t.app, 'acc_finance', 'User12345');
    const fcsrf = await csrfOf(fagent);
    const review = await fagent
      .post(`/finance/receipts/${S.receiptId}/review`)
      .set('X-CSRF-Token', fcsrf)
      .send({ action: 'approve' });
    expect(review.status).toBe(200);
  });

  it('گام ۱۵ — به‌روزرسانی وضعیت مالی و مانده طبق پرداخت تأییدشده', async () => {
    const bal = await admin.get(`/enrollments/${S.enrollmentId}/balance`);
    expect(bal.status).toBe(200);
    expect(bal.body.data.paid).toBe('500000');
    expect(bal.body.data.balance).toBe('1500000');
    // direct payment of the remainder
    const pay = await admin.post('/finance/payments').set('X-CSRF-Token', adminCsrf).send({
      studentId: S.studentIds[0],
      enrollmentId: S.enrollmentId,
      methodId: 1,
      amount: '۱۵۰۰۰۰۰',
      idempotencyKey: 'acc-pay-full',
    });
    expect(pay.status).toBe(201);
    const bal2 = await admin.get(`/enrollments/${S.enrollmentId}/balance`);
    expect(bal2.body.data.balance).toBe('0');
  });

  it('گام ۱۶ — صدور مدرک پس از تحقق شرایط + نمایش در حساب فراگیر', async () => {
    // attendance: one session, student 0 present -> 100% >= threshold; finance settled -> issue
    // student 0: present -> 100% attendance; finance settled -> issue allowed
    const res = await admin.post('/certificates/issue').set('X-CSRF-Token', adminCsrf).send({
      studentId: S.studentIds[0],
      classId: S.classId,
    });
    expect(res.status).toBe(201);
    S.certToken = res.body.certificate.verification_token;
    S.certCode = res.body.certificate.code;
    // visible in student account
    const sagent = await loginAgent(t.app, 'acc_student_0', 'User12345');
    const certs = await sagent.get('/panel/student/certificates');
    expect(certs.status).toBe(200);
    expect(certs.body.data).toHaveLength(1);
    expect(certs.body.data[0].code).toBe(S.certCode);
  });

  it('گام ۱۷ — اعتبارسنجی مدرک با کد/QR در صفحه عمومی', async () => {
    const pub = await request(t.app).get(`/verify/${S.certToken}`);
    expect(pub.status).toBe(200);
    expect(pub.text).toContain(S.certCode);
    expect(pub.text).toContain('معتبر');
  });

  it('گام ۱۸ — ثبت اتصال IPPanel و یک پترن', async () => {
    const key = await admin.put('/settings/sms.ip_panel_api_key').set('X-CSRF-Token', adminCsrf).send({ value: 'test-api-key-123' });
    expect(key.status).toBe(200);
    const row = await t.db.selectFrom('settings').select('value').where('key', '=', 'sms.ip_panel_api_key').executeTakeFirstOrThrow();
    expect(row.value).not.toContain('test-api-key-123'); // رمزنگاری‌شده
    const pat = await admin.post('/sms/patterns').set('X-CSRF-Token', adminCsrf).send({
      name: 'پترن سناریوی پذیرش',
      patternCode: 'acceptance_pattern',
      variables: [{ name: 'student_name', required: true }, { name: 'amount', required: true }],
    });
    expect(pat.status).toBe(201);
  });

  it('گام ۱۹ — استخراج و نگاشت متغیرها از داده واقعی', async () => {
    // پرداخت approve شده در گام ۱۵ → هوک payment_approved → صف
    const rows = await t.db.selectFrom('sms_queue').selectAll().where('dedupe_key', 'like', 'payment_approved:%').execute();
    expect(rows.length).toBeGreaterThanOrEqual(2); // receipt 500000 + direct 1500000
    const varsList = rows.map((r) => JSON.parse(r.variables));
    for (const v of varsList) expect(v.student_name).toBeTruthy();
    expect(varsList.map((v) => v.amount).sort()).toEqual(['1500000', '500000']);
    // process queue with Fake provider -> outbox (deterministic: reset first)
    FakeSmsProvider.reset();
    const { SmsService } = await import('../../src/modules/sms/sms.service');
    const svc = new SmsService(t.db, t.config);
    const result = await svc.processPending();
    expect(result.sent).toBeGreaterThan(0);
    expect(FakeSmsProvider.outbox.length).toBeGreaterThan(0);
    const withAmount = FakeSmsProvider.outbox.filter((m) => m.variables.amount !== undefined);
    expect(withAmount.map((m) => m.variables.amount).sort()).toEqual(['1500000', '500000']);
  });

  it('گام ۲۰ — ارسال واقعی پیامک — اجرا‌نشده (SMS_LIVE_TESTS=0، بدون تماس شبکه)', async () => {
    // Gate: provider باید Fake باشد
    const { SmsService } = await import('../../src/modules/sms/sms.service');
    const svc = new SmsService(t.db, t.config);
    const provider = await svc.getProvider();
    expect(provider.name).toBe('fake');
    // یعنی ارسال «واقعی» انجام نشده — per spec «اجرا‌نشده + دلیل» ثبت می‌شود
    expect(t.config.SMS_LIVE_TESTS).toBe('0');
  });

  it('گام ۲۱ — داشبورد از داده واقعی', async () => {
    const kpis = await admin.get('/dashboard/api/kpis');
    expect(kpis.status).toBe(200);
    expect(kpis.body.kpis.scope).toBe('full');
    expect(kpis.body.kpis.students.active).toBeGreaterThanOrEqual(3);
    expect(kpis.body.kpis.finance.received).toBe('2000000');
    expect(kpis.body.kpis.certificatesActive).toBe(1);
    const charts = await admin.get('/dashboard/api/charts?range=30');
    expect(charts.status).toBe(200);
    expect(charts.body.enrollmentTrend.reduce((a: number, x: { count: number }) => a + x.count, 0)).toBeGreaterThanOrEqual(3);
    expect(charts.body.revenueTrend.reduce((a: number, x: { count: number }) => a + x.count, 0)).toBe(2000000);
  });

  it('گام ۲۲ — ناکامی دسترسی غیرمجاز با دست‌کاری URL/API (IDOR)', async () => {
    // فراگیر ۱ به داده‌های فراگیر ۰ دسترسی ندارد
    const s1 = await loginAgent(t.app, 'acc_student_1', 'User12345');
    const panel = await s1.get('/panel/student');
    expect(panel.status).toBe(200);
    expect(panel.body.data.classes).toHaveLength(1);
    expect(Number(panel.body.data.classes[0].enrollment_id)).not.toBe(S.enrollmentId);
    // direct access to /finance as student -> 403
    expect((await s1.get('/finance/payments')).status).toBe(403);
    // teacher accessing finance -> 403
    const tagent = await loginAgent(t.app, 'acc_teacher', 'User12345');
    expect((await tagent.get('/finance/payments')).status).toBe(403);
    // guest -> 401/302
    const guest = await request(t.app).get('/finance/payments');
    expect([401, 302, 303]).toContain(guest.status);
  });

  it('گام ۲۳ — اجرای migration نسخه جدید بدون از دست رفتن داده', async () => {
    const before = await t.db.selectFrom('students').selectAll().execute();
    // اجرای دوباره migration — idempotent
    await migrateToLatest(t.db);
    const after = await t.db.selectFrom('students').selectAll().execute();
    expect(after).toHaveLength(before.length);
    const migRes = (await sql`SELECT name FROM migrations`.execute(t.db as never)) as unknown as { rows: Array<{ name: string }> };
    const names = migRes.rows.map((r) => r.name);
    expect(names).toContain('0006_certificates_sms_notifications');
    // data intact
    expect(after.find((s) => s.code === 'ST-ACC-0' || s.phone === '09120000060')).toBeTruthy();
  });
});
