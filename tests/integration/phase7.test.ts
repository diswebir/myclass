/** تست‌های integration — فاز ۷: داشبورد KPI+charts، registry ماژول‌ها، backup/restore (REQ-P7-01..03). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb, toDbDate } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';
import { BackupService } from '../../src/modules/backup/backup.service';

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

describe('فاز ۷ — داشبورد (REQ-P7-01)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('KPIهای واقعی + ۷ نمودار از داده seedشده', async () => {
    const classId = await seedClass(t, 'CL-1');
    const s1 = await seedStudent(t, 'ST-1', '09120000011');
    const s2 = await seedStudent(t, 'ST-2', '09120000012');
    const e1 = await seedEnrollment(t, classId, s1);
    await seedEnrollment(t, classId, s2);
    const sess = await seedSession(t, classId, toDbDate(new Date())); // امروز — داخل محدوده نمودار
    await mark(t, sess, s1, 'present');
    await mark(t, sess, s2, 'absent');
    await seedApprovedPayment(t, s1, e1, '400000', 'dash-pay-1');

    const agent = await loginAgent(t.app);
    // صفحه داشبورد — ۲۰۰ + کارت‌های KPI
    const page = await agent.get('/dashboard');
    expect(page.status).toBe(200);
    expect(page.text).toContain('داشبورد');
    // KPI API — admin → full scope
    const kpis = await agent.get('/dashboard/api/kpis');
    expect(kpis.status).toBe(200);
    expect(kpis.body.kpis.scope).toBe('full');
    expect(kpis.body.kpis.students.active).toBe(2);
    expect(kpis.body.kpis.finance.received).toBe('400000');
    expect(kpis.body.kpis.finance.feeRegistered).toBe('2000000');
    expect(kpis.body.kpis.finance.receivables).toBe('1600000');
    expect(kpis.body.kpis.sessionsToday).toBe(1); // جلسه امروز seed شد
    expect(kpis.body.kpis.attendanceToday.present).toBe(1);
    expect(kpis.body.kpis.attendanceToday.absent).toBe(1);
    // Charts API — ۷ مجموعه داده
    const charts = await agent.get('/dashboard/api/charts?range=30');
    expect(charts.status).toBe(200);
    expect(charts.body.enrollmentTrend).toHaveLength(30);
    expect(charts.body.enrollmentTrend.reduce((a: number, x: { count: number }) => a + x.count, 0)).toBe(2);
    expect(charts.body.revenueTrend.reduce((a: number, x: { count: number }) => a + x.count, 0)).toBe(400000);
    expect(charts.body.classComparison).toHaveLength(1);
    expect(charts.body.classComparison[0].enrolled).toBe(2);
    expect(charts.body.capacityVsEnrollment[0].capacity).toBe(10);
    expect(charts.body.paymentStatus.find((x: { status: string }) => x.status === 'approved').count).toBe(1);
    expect(charts.body.attendance.find((x: { status: string }) => x.status === 'present').count).toBe(1);
    expect(charts.body.attendance.find((x: { status: string }) => x.status === 'absent').count).toBe(1);
    expect(charts.body.sms).toEqual([]);
    // range=7 → ۷ روز
    const c7 = await agent.get('/dashboard/api/charts?range=7');
    expect(c7.body.enrollmentTrend).toHaveLength(7);
  });

  it('محتوای per نقش: استاد → scope=teacher، فراگیر → scope=student، نمودار کامل → ۴۰۳', async () => {
    const classId = await seedClass(t, 'CL-2');
    const studentId = await seedStudent(t, 'ST-3', '09120000013');
    await seedEnrollment(t, classId, studentId);
    // استاد + تخصیص کلاس
    const teacherUid = await createUser(t, 'teacher_dash', ['teacher']);
    const now = nowDb();
    const tres = await t.db
      .insertInto('teachers')
      .values({
        user_id: teacherUid, code: 'T-1', first_name: 'استاد', last_name: 'تست', phone: '09120000099',
        specialties: '[]', status: 'active', started_at: null, created_at: now, updated_at: now,
      })
      .executeTakeFirstOrThrow();
    await t.db.insertInto('class_teachers').values({ class_id: classId, teacher_id: Number(tres.insertId), assigned_at: nowDb(), assigned_by: null, removed_at: null }).execute();

    const tagent = await loginAgent(t.app, 'teacher_dash', 'User12345');
    const tk = await tagent.get('/dashboard/api/kpis');
    expect(tk.status).toBe(200);
    expect(tk.body.kpis.scope).toBe('teacher');
    expect(tk.body.kpis.students).toBe(1);
    // نمودارهای کامل برای استاد → ۴۰۳
    const tc = await tagent.get('/dashboard/api/charts?range=30');
    expect(tc.status).toBe(403);

    // فراگیر
    await makeStudentUser(t, 'student_dash', studentId);
    const sagent = await loginAgent(t.app, 'student_dash', 'Student123');
    const sk = await sagent.get('/dashboard/api/kpis');
    expect(sk.status).toBe(200);
    expect(sk.body.kpis.scope).toBe('student');
    expect(sk.body.kpis.enrollments).toBe(1);
    expect(sk.body.kpis.balance).toBe('1000000');
    // صفحه '/' برای فراگیر — ۲۰۰
    const home = await sagent.get('/');
    expect(home.status).toBe(200);
  });
});

describe('فاز ۷ — registry ماژول‌ها (REQ-P7-03)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('فهرست + غیرفعال‌سازی مسیر (گیت) + فعال‌سازی دوباره', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const list = await agent.get('/admin/modules');
    expect(list.status).toBe(200);
    const auditMod = list.body.modules.find((m: { slug: string }) => m.slug === 'audit');
    expect(auditMod.status).toBe('enabled');
    // غیرفعال‌سازی
    const off = await agent.post('/admin/modules/audit/toggle').set('X-CSRF-Token', csrf).send({ enabled: false });
    expect(off.status).toBe(200);
    // مسیر → ۴۰۴
    const gated = await agent.get('/audit');
    expect(gated.status).toBe(404);
    // فعال‌سازی دوباره
    const on = await agent.post('/admin/modules/audit/toggle').set('X-CSRF-Token', csrf).send({ enabled: true });
    expect(on.status).toBe(200);
    const back = await agent.get('/audit');
    expect(back.status).toBe(200);
    // audit
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'module_disabled').execute();
    expect(audits.length).toBe(1);
  });

  it('چک وابستگی: غیرفعال‌سازی classes با attendance فعال → ۴۰۹؛ هسته → ۴۰۰', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const blocked = await agent.post('/admin/modules/classes/toggle').set('X-CSRF-Token', csrf).send({ enabled: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('وابسته');
    // ماژول هسته
    const core = await agent.post('/admin/modules/modules/toggle').set('X-CSRF-Token', csrf).send({ enabled: false });
    expect(core.status).toBe(400);
    // RBAC — کاربر عادی
    await createUser(t, 'plain_mod', []);
    const uagent = await loginAgent(t.app, 'plain_mod', 'User12345');
    expect((await uagent.get('/admin/modules')).status).toBe(403);
  });
});

describe('فاز ۷ — backup/restore (REQ-P7-02)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('ساخت پشتیبان → فهرست → حذف داده → بازیابی → داده‌ها برمی‌گردند', async () => {
    // داده اولیه
    const classId = await seedClass(t, 'CL-1');
    const s1 = await seedStudent(t, 'ST-1', '09120000011');
    const e1 = await seedEnrollment(t, classId, s1);
    await seedApprovedPayment(t, s1, e1, '400000', 'bk-pay-1');
    // a stored file (simulating an upload)
    const storageFile = path.join(t.storageDir, 'uploads');
    fs.mkdirSync(storageFile, { recursive: true });
    fs.writeFileSync(path.join(storageFile, 'sample.txt'), 'hello-backup');

    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    // ساخت پشتیبان از API
    const created = await agent.post('/admin/backup/create').set('X-CSRF-Token', csrf).send({});
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(fs.existsSync(path.join(t.storageDir, 'backups', id, 'dump.json'))).toBe(true);
    expect(fs.existsSync(path.join(t.storageDir, 'backups', id, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(t.storageDir, 'backups', id, 'files', 'uploads', 'sample.txt'))).toBe(true);
    expect(created.body.meta.rows).toBeGreaterThan(10);
    // auditِ ساخت — قبل از restore
    const createdAudits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'backup_created').execute();
    expect(createdAudits).toHaveLength(1);

    // فهرست
    const list = await agent.get('/admin/backup');
    expect(list.status).toBe(200);
    expect(list.body.backups[0].id).toBe(id);

    // wipe the data
    await t.db.deleteFrom('payments').execute();
    await t.db.deleteFrom('enrollments').execute();
    await t.db.deleteFrom('students').execute();
    await t.db.deleteFrom('classes').execute();
    expect(await t.db.selectFrom('students').selectAll().execute()).toHaveLength(0);

    // بازیابی
    const restored = await agent.post('/admin/backup/restore').set('X-CSRF-Token', csrf).send({ id });
    expect(restored.status).toBe(200);
    expect(restored.body.rows).toBeGreaterThan(10);
    // داده‌ها برگشتند
    const students = await t.db.selectFrom('students').selectAll().execute();
    expect(students).toHaveLength(1);
    expect(students[0].code).toBe('ST-1');
    const payments = await t.db.selectFrom('payments').selectAll().execute();
    expect(payments).toHaveLength(1);
    expect(String(payments[0].amount)).toBe('400000');
    const classes = await t.db.selectFrom('classes').selectAll().execute();
    expect(classes).toHaveLength(1);
    // audit — backup_restored بعد از restore؛ backup_created قبل از restore ثبت شده بود
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'backup_restored').execute();
    expect(audits).toHaveLength(1);
    const auditsCreated = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'backup_created').execute();
    expect(auditsCreated).toHaveLength(0); // دامپ قبل از ثبت audit ساخته شد — restore آن را پاک کرد
  });

  it('restore با شناسه نامعتبر/ناموجود → ۴۰۰/۴۰۴ + RBAC', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const bad = await agent.post('/admin/backup/restore').set('X-CSRF-Token', csrf).send({ id: '../etc' });
    expect(bad.status).toBe(400);
    const nf = await agent.post('/admin/backup/restore').set('X-CSRF-Token', csrf).send({ id: '20200101-000000' });
    expect(nf.status).toBe(404);
    // RBAC — کاربر عادی
    await createUser(t, 'plain_bk', []);
    const uagent = await loginAgent(t.app, 'plain_bk', 'User12345');
    expect((await uagent.get('/admin/backup')).status).toBe(403);
    const ucsrf = await csrfOf(uagent);
    expect((await uagent.post('/admin/backup/create').set('X-CSRF-Token', ucsrf).send({})).status).toBe(403);
  });

  it('restore با نسخه اسکیما ناسازگار → ۴۰۹ (tamper با meta)', async () => {
    // tamper — change schema version in meta
    const classId = await seedClass(t, 'CL-9');
    const s1 = await seedStudent(t, 'ST-9', '09120000019');
    await seedEnrollment(t, classId, s1);
    const service = new BackupService(t.db, t.config);
    const actor = { id: t.adminId } as never;
    const { id } = await service.createBackup(actor);
    // tamper — نسخه اسکیما را عوض می‌کنیم
    const metaPath = path.join(t.storageDir, 'backups', id, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.schemaVersion = '0000_fake';
    fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf8');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/admin/backup/restore').set('X-CSRF-Token', csrf).send({ id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('سازگار');
  });
});
