/** تست‌های integration — فاز ۵: قالب‌ها، صدور مدرک PDF+QR، صفحه عمومی verify، لغو، دسته‌ای (REQ-P5-01..04). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';

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

async function seedClass(t: TestApp, code = 'CL-1') {
  const now = nowDb();
  const res = await t.db
    .insertInto('classes')
    .values({
      title: 'کلاس تست', code, capacity: 10, fee: '1000000', status: 'running',
      weekdays: '[]', prereg_enabled: 0, created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

async function seedStudent(t: TestApp, code: string, phone: string) {
  const now = nowDb();
  const res = await t.db
    .insertInto('students')
    .values({
      code, first_name: 'علی', last_name: 'رضایی', phone,
      status: 'active', created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

async function seedEnrollment(t: TestApp, classId: number, studentId: number, fee = '1000000') {
  const now = nowDb();
  const res = await t.db
    .insertInto('enrollments')
    .values({
      class_id: classId, student_id: studentId, status: 'active', fee_amount: fee,
      discount_amount: '0', enrolled_at: now, created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

async function seedSession(t: TestApp, classId: number, date: string) {
  const now = nowDb();
  const res = await t.db
    .insertInto('class_sessions')
    .values({
      class_id: classId, session_date: date, start_time: '16:00', duration_minutes: 90,
      topic: 'جلسه تست', teacher_id: null, status: 'held',
      status_note: null, created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

async function mark(t: TestApp, sessionId: number, studentId: number, status: string) {
  await t.db
    .insertInto('attendance')
    .values({
      session_id: sessionId, student_id: studentId, status,
      note: null, marked_by: null, marked_at: nowDb(), created_at: nowDb(),
    })
    .execute();
}

/** پرداخت تأییدشده مستقیم در DB ( تست API مالی در فاز ۴ پوشش داده شده). */
async function seedApprovedPayment(t: TestApp, studentId: number, enrollmentId: number, amount: string, key: string) {
  const now = nowDb();
  const res = await t.db
    .insertInto('payments')
    .values({
      student_id: studentId, enrollment_id: enrollmentId, method_id: 1, amount,
      idempotency_key: key, status: 'approved', note: null, created_by: 1,
      created_at: now, approved_by: 1, approved_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

async function makeStudentUser(t: TestApp, username: string, studentRowId: number, password = 'Student123') {
  const uid = await createUser(t, username, ['student'], password);
  await t.db.updateTable('students').set({ user_id: uid }).where('id', '=', studentRowId).execute();
  return uid;
}

/** کلاس آماده با ۴ جلسه (۳ present + ۱ absent = ۷۵٪) و پرداخت کامل. */
async function setupReady(t: TestApp) {
  const classId = await seedClass(t, 'CL-1');
  const studentId = await seedStudent(t, 'ST-1', '09120000011');
  const enrollmentId = await seedEnrollment(t, classId, studentId);
  const sessions = [];
  for (let i = 1; i <= 4; i++) sessions.push(await seedSession(t, classId, `1405/07/0${i}`));
  await mark(t, sessions[0], studentId, 'present');
  await mark(t, sessions[1], studentId, 'present');
  await mark(t, sessions[2], studentId, 'late');
  await mark(t, sessions[3], studentId, 'absent');
  await seedApprovedPayment(t, studentId, enrollmentId, '1000000', 'pay-cert-001');
  return { classId, studentId, enrollmentId, sessions };
}

describe('فاز ۵ — صدور مدرک (REQ-P5-02)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('صدور موفق: ردیف + PDF با فونت Vazirmatn + QR + audit', async () => {
    const { classId, studentId } = await setupReady(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    expect(res.status).toBe(201);
    const cert = res.body.certificate;
    expect(cert.status).toBe('active');
    expect(cert.code).toMatch(/^MC-\d{4}-\d{5}$/);
    expect(cert.file_id).toBeTruthy();
    // فایل PDF واقعی
    const file = await t.db.selectFrom('files').selectAll().where('id', '=', cert.file_id).executeTakeFirstOrThrow();
    expect(file.mime).toBe('application/pdf');
    expect(Number(file.size)).toBeGreaterThan(1000);
    // audit
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'certificate_issued').execute();
    expect(audits).toHaveLength(1);
    // دانلود فایل — امضای PDF + فونت
    const dl = await agent.get(`/files/${cert.file_id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    expect(dl.body.toString('latin1').slice(0, 5)).toBe('%PDF-');
    expect(dl.body.toString('latin1')).toContain('Vazirmatn');
  });

  it('صفحه عمومی /verify/:token — بدون ورود + یافت‌شده + نامعتبر', async () => {
    const { classId, studentId } = await setupReady(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    const cert = res.body.certificate;
    // عمومی — بدون کوکی
    const pub = await request(t.app).get(`/verify/${cert.verification_token}`);
    expect(pub.status).toBe(200);
    expect(pub.text).toContain(cert.code);
    expect(pub.text).toContain('علی رضایی');
    // توکن نامعتبر → ۴۰۴
    const nf = await request(t.app).get('/verify/deadbeefdeadbeefdeadbeefdeadbeef');
    expect(nf.status).toBe(404);
    expect(nf.text).toContain('یافت نشد');
  });

  it('حضور ناکافی → ۴۰۰ با علت', async () => {
    const classId = await seedClass(t, 'CL-2');
    const studentId = await seedStudent(t, 'ST-2', '09120000012');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const s1 = await seedSession(t, classId, '1405/07/01');
    const s2 = await seedSession(t, classId, '1405/07/02');
    await mark(t, s1, studentId, 'absent');
    await mark(t, s2, studentId, 'absent');
    await seedApprovedPayment(t, studentId, enrollmentId, '1000000', 'pay-cert-002');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('70');
  });

  it('تسویه‌نشده → ۴۰۰، پس از پرداخت → ۲۰۱', async () => {
    const { classId, studentId } = await setupReady(t);
    // پرداخت را حذف می‌کنیم تا مانده بماند
    await t.db.deleteFrom('payments').execute();
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const blocked = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toContain('تسویه');
    // پرداخت کامل → صدور موفق
    const enr = await t.db.selectFrom('enrollments').select('id').where('student_id', '=', studentId).executeTakeFirstOrThrow();
    await seedApprovedPayment(t, studentId, Number(enr.id), '1000000', 'pay-cert-003');
    const ok = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    expect(ok.status).toBe(201);
  });

  it('صدور تکراری → ۴۰۹', async () => {
    const { classId, studentId } = await setupReady(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    const dup = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    expect(dup.status).toBe(409);
  });

  it('لغو: وضعیت + audit + صفحه verify + بازتولید فایل با واترمارک', async () => {
    const { classId, studentId } = await setupReady(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    const cert = res.body.certificate;
    const rev = await agent
      .post(`/certificates/${cert.id}/revoke`)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'درخواست فراگیر' });
    expect(rev.status).toBe(200);
    expect(rev.body.certificate.status).toBe('revoked');
    expect(rev.body.certificate.revoke_reason).toBe('درخواست فراگیر');
    // کد ثابت می‌ماند، فایل جدید
    expect(rev.body.certificate.code).toBe(cert.code);
    expect(Number(rev.body.certificate.file_id)).not.toBe(Number(cert.file_id));
    // audit
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'certificate_revoked').execute();
    expect(audits).toHaveLength(1);
    // صفحه عمومی — لغو شده
    const pub = await request(t.app).get(`/verify/${cert.verification_token}`);
    expect(pub.status).toBe(200);
    expect(pub.text).toContain('لغو شده');
    expect(pub.text).toContain('درخواست فراگیر');
    // لغو دوباره → ۴۰۹
    const again = await agent
      .post(`/certificates/${cert.id}/revoke`)
      .set('X-CSRF-Token', csrf)
      .send({ reason: 'دوباره' });
    expect(again.status).toBe(409);
  });

  it('صدور دسته‌ای: صادرشده/ردشده + dryRun', async () => {
    const classId = await seedClass(t, 'CL-3');
    // A: آماده (۷۵٪ + پرداخت)
    const sa = await seedStudent(t, 'ST-A', '09120000021');
    const ea = await seedEnrollment(t, classId, sa);
    // B: حضور ناکافی
    const sb = await seedStudent(t, 'ST-B', '09120000022');
    await seedEnrollment(t, classId, sb);
    // C: آماده
    const sc = await seedStudent(t, 'ST-C', '09120000023');
    const ec = await seedEnrollment(t, classId, sc);
    const sessions = [];
    for (let i = 1; i <= 4; i++) sessions.push(await seedSession(t, classId, `1405/08/0${i}`));
    for (const s of sessions.slice(0, 3)) await mark(t, s, sa, 'present');
    await mark(t, sessions[3], sa, 'absent');
    await seedApprovedPayment(t, sa, ea, '1000000', 'pay-batch-a');
    await mark(t, sessions[0], sb, 'absent');
    await mark(t, sessions[1], sb, 'absent');
    for (const s of sessions.slice(0, 3)) await mark(t, s, sc, 'present');
    await mark(t, sessions[3], sc, 'absent');
    await seedApprovedPayment(t, sc, ec, '1000000', 'pay-batch-c');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    // dryRun — هیچ ردیفی نسازد
    const dry = await agent.post('/certificates/issue-batch').set('X-CSRF-Token', csrf).send({ classId, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.issued).toHaveLength(2);
    expect(dry.body.skipped).toHaveLength(1);
    expect(await t.db.selectFrom('certificates').selectAll().execute()).toHaveLength(0);
    // واقعی
    const real = await agent.post('/certificates/issue-batch').set('X-CSRF-Token', csrf).send({ classId });
    expect(real.status).toBe(200);
    expect(real.body.issued).toHaveLength(2);
    expect(real.body.skipped).toHaveLength(1);
    expect(real.body.skipped[0].studentId).toBe(sb);
    const rows = await t.db.selectFrom('certificates').selectAll().execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe('active');
      expect(r.file_id).toBeTruthy();
    }
    // اجرای دوباره — همه «قبلاً صادر شده»
    const again = await agent.post('/certificates/issue-batch').set('X-CSRF-Token', csrf).send({ classId });
    expect(again.body.issued).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(3);
  });

  it('پنل فراگیر — مدرک صادرشده نمایش داده می‌شود', async () => {
    const { classId, studentId } = await setupReady(t);
    await makeStudentUser(t, 'student_c1', studentId);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId });
    const sagent = await loginAgent(t.app, 'student_c1', 'Student123');
    const panel = await sagent.get('/panel/student/certificates');
    expect(panel.status).toBe(200);
    expect(panel.body.data).toHaveLength(1);
    expect(panel.body.data[0].status).toBe('active');
    expect(panel.body.data[0].code).toMatch(/^MC-\d{4}-\d{5}$/);
  });
});

describe('فاز ۵ — قالب‌ها و شرط قالب (REQ-P5-01)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('CRUD قالب + شرط قالب (min_attendance_percent=۱۰۰)', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const created = await agent.post('/certificates/templates').set('X-CSRF-Token', csrf).send({
      name: 'قالب سخت‌گیرانه',
      conditions: { min_attendance_percent: 100 },
      design: { primaryColor: '#1d4ed8', showQr: true },
    });
    expect(created.status).toBe(201);
    const tplId = created.body.template.id;
    const list = await agent.get('/certificates/templates');
    expect(list.status).toBe(200);
    expect(list.body.templates).toHaveLength(1);
    const updated = await agent.post(`/certificates/templates/${tplId}`).set('X-CSRF-Token', csrf).send({ name: 'قالب ویرایش‌شده' });
    expect(updated.status).toBe(200);
    expect(updated.body.template.name).toBe('قالب ویرایش‌شده');
    // شرط قالب: ۷۵٪ < ۱۰۰٪ → ۴۰۰
    const { classId, studentId } = await setupReady(t);
    const blocked = await agent.post('/certificates/issue').set('X-CSRF-Token', csrf).send({ studentId, classId, templateId: tplId });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toContain('100');
  });

  it('RBAC: استاد خارج از کلاس → ۴۰۳، فراگیر → ۴۰۳', async () => {
    const { classId, studentId } = await setupReady(t);
    // استاد بدون تخصیص کلاس
    await createUser(t, 'teacher_x', ['teacher']);
    const tagent = await loginAgent(t.app, 'teacher_x', 'User12345');
    const tcsrf = await csrfOf(tagent);
    const forbidden = await tagent.post('/certificates/issue').set('X-CSRF-Token', tcsrf).send({ studentId, classId });
    expect(forbidden.status).toBe(403);
    // RBAC — فراگیر دسترسی ندارد → ۴۰۳
    await makeStudentUser(t, 'student_rbac', studentId);
    const sagent = await loginAgent(t.app, 'student_rbac', 'Student123');
    const list = await sagent.get('/certificates');
    expect(list.status).toBe(403);
  });
});
