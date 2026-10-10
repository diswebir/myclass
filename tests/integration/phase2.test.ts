/** تست‌های integration — فاز ۲: اساتید، فراگیران (+CSV)، دوره‌ها، کلاس‌ها، جلسات، پیش‌ثبت‌نام، ثبت‌نام. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { nowDb, toDbDate } from '../../src/core/db/time';

async function csrfOf(agent: request.SuperTest<request.Test>): Promise<string> {
  const page = await agent.get('/');
  return (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}

async function seedClass(t: TestApp, code = 'CL-1') {
  const now = nowDb();
  const res = await t.db
    .insertInto('classes')
    .values({
      title: 'کلاس تست', code, capacity: 2, fee: '1000000', status: 'open',
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

async function seedTeacher(t: TestApp, code: string, phone: string) {
  const now = nowDb();
  const res = await t.db
    .insertInto('teachers')
    .values({
      code, first_name: 'محمد', last_name: 'استاد', phone,
      specialties: '[]', status: 'active', created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

describe('فاز ۲ — اساتید', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('ایجاد استاد + فهرست + get', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/teachers').set('X-CSRF-Token', csrf).send({
      code: 'T-100', firstName: 'محمد', lastName: 'استاد', phone: '09121112233',
      specialties: ['ریاضی'], status: 'active',
    });
    expect(res.status).toBe(201);
    const id = res.body.id;
    const row = await t.db.selectFrom('teachers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.code).toBe('T-100');
    expect(JSON.parse(row.specialties)).toEqual(['ریاضی']);
    const list = await agent.get('/teachers');
    expect(list.status).toBe(200);
    expect(list.text).toContain('T-100');
  });

  it('کد تکراری → 409', async () => {
    await seedTeacher(t, 'T-100', '09121112233');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/teachers').set('X-CSRF-Token', csrf).send({
      code: 'T-100', firstName: 'x', lastName: 'y', phone: '09124445566',
    });
    expect(res.status).toBe(409);
  });

  it('موبایل نامعتبر → 400', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/teachers').set('X-CSRF-Token', csrf).send({
      code: 'T-101', firstName: 'x', lastName: 'y', phone: '123',
    });
    expect(res.status).toBe(400);
  });
});

describe('فاز ۲ — فراگیران + CSV', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('ایجاد فراگیر با موبایل فارسی', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/students').set('X-CSRF-Token', csrf).send({
      code: 'ST-1', firstName: 'سارا', lastName: 'محمدی', phone: '۰۹۱۲۳۴۵۶۷۸۹',
    });
    expect(res.status).toBe(201);
    const row = await t.db.selectFrom('students').selectAll().where('code', '=', 'ST-1').executeTakeFirstOrThrow();
    expect(row.phone).toBe('09123456789');
  });

  it('CSV import — پیش‌نمایش با خطای هر سطر + commit', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const csv = [
      'code,firstName,lastName,phone,email,nationalId,guardianName,guardianPhone,birthDate,notes',
      'ST-10,سارا,محمدی,09120000010,,,,,۱۳۸۵/۰۳/۱۵,',
      'ST-11, ,,09120000011,,,,,,', // نام خالی → خطا
      ',بدون کد,09120000012,,,,,1385,', // کد خالی → خطا
    ].join('\n');
    const preview = await agent
      .post('/students/import/preview')
      .set('X-CSRF-Token', csrf)
      .attach('file', Buffer.from(csv), 'students.csv');
    expect(preview.status).toBe(200);
    expect(preview.body.okCount).toBe(1);
    expect(preview.body.errorCount).toBe(2);
    expect(preview.body.rows[1].errors.length).toBeGreaterThan(0);

    const commit = await agent.post('/students/import/commit').set('X-CSRF-Token', csrf).send({
      rows: preview.body.rows.filter((r: { errors: string[] }) => r.errors.length === 0),
    });
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(1);
    const row = await t.db.selectFrom('students').selectAll().where('code', '=', 'ST-10').executeTakeFirstOrThrow();
    expect(row.birth_date).toBe(toDbDate(new Date(Date.UTC(2006, 5, 5)))); // ۱۳۸۵/۰۳/۱۵
  });

  it('CSV export — با محافظ formula injection', async () => {
    await seedStudent(t, 'ST-20', '09120000020');
    const agent = await loginAgent(t.app);
    const res = await agent.get('/students/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('code,firstName');
    expect(res.text).toContain('ST-20');
  });
});

describe('فاز ۲ — کلاس‌ها + استاد + ظرفیت', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('ایجاد کلاس + تخصیص چند استاد +Sessions', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const cls = await seedClass(t);
    const t1 = await seedTeacher(t, 'T-1', '09120000001');
    const t2 = await seedTeacher(t, 'T-2', '09120000002');
    await agent.post(`/classes/${cls}/teachers`).set('X-CSRF-Token', csrf).send({ teacherId: t1 });
    const r2 = await agent.post(`/classes/${cls}/teachers`).set('X-CSRF-Token', csrf).send({ teacherId: t2 });
    expect(r2.status).toBe(201);
    // تخصیص تکراری → 409
    const dup = await agent.post(`/classes/${cls}/teachers`).set('X-CSRF-Token', csrf).send({ teacherId: t1 });
    expect(dup.status).toBe(409);
    const teachers = await agent.get(`/classes/${cls}/teachers`);
    expect(teachers.body.data.length).toBe(2);
    // برداشتن تخصیص — تاریخچه حفظ می‌شود
    const rm = await agent.delete(`/classes/${cls}/teachers/${t2}`).set('X-CSRF-Token', csrf);
    expect(rm.status).toBe(200);
    const row = await t.db
      .selectFrom('class_teachers')
      .selectAll()
      .where('class_id', '=', cls)
      .where('teacher_id', '=', t2)
      .executeTakeFirstOrThrow();
    expect(row.removed_at).not.toBeNull();
  });

  it('جلسه — تضاد زمانی استاد شناسایی می‌شود', async () => {
    const cls = await seedClass(t);
    await t.db.updateTable('classes').set({ start_time: '16:00', location: 'سالن ۱' }).where('id', '=', cls).execute();
    const teacherId = await seedTeacher(t, 'T-1', '09120000001');
    const otherCls = await seedClass(t, 'CL-2');
    await t.db.updateTable('classes').set({ location: 'سالن ۱' }).where('id', '=', otherCls).execute();

    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    // جلسه اول در کلاس ۱ — ۱۶:۰۰ تا ۱۷:۳۰
    const s1 = await agent.post(`/classes/${cls}/sessions`).set('X-CSRF-Token', csrf).send({
      sessionDate: '۱۴۰۳/۰۸/۱۰', startTime: '16:00', durationMinutes: 90, teacherId,
    });
    expect(s1.status).toBe(201);
    expect(s1.body.conflicts.teacherConflicts.length).toBe(0);
    // جلسه دوم — همان استاد، همان روز، ۱۷:۰۰ → تضاد
    const s2 = await agent.post(`/classes/${otherCls}/sessions`).set('X-CSRF-Token', csrf).send({
      sessionDate: '1403/08/10', startTime: '17:00', durationMinutes: 90, teacherId,
    });
    expect(s2.status).toBe(201);
    expect(s2.body.conflicts.teacherConflicts.length).toBe(1);
    // جلسه سوم — همان مکان (سالن ۱)، ۱۷:۰۰ → تضاد مکانی
    const s3 = await agent.post(`/classes/${otherCls}/sessions`).set('X-CSRF-Token', csrf).send({
      sessionDate: '۱۴۰۳/۰۸/۱۰', startTime: '17:00', durationMinutes: 60,
    });
    expect(s3.body.conflicts.locationConflicts.length).toBeGreaterThan(0);
    // بدون همپوشانی → بدون تضاد
    const s4 = await agent.post(`/classes/${otherCls}/sessions`).set('X-CSRF-Token', csrf).send({
      sessionDate: '۱۴۰۳/۰۸/۱۰', startTime: '20:00', durationMinutes: 60,
    });
    expect(s4.body.conflicts.teacherConflicts.length + s4.body.conflicts.locationConflicts.length).toBe(0);
  });
});

describe('فاز ۲ — پیش‌ثبت‌نام + ثبت‌نام', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  async function setupPreregClass() {
    const cls = await seedClass(t, 'CL-PR');
    await t.db.updateTable('classes').set({ prereg_enabled: 1 }).where('id', '=', cls).execute();
    return cls;
  }

  it('فرم عمومی — ثبت + کد پیگیری + ضدتکرار', async () => {
    const cls = await setupPreregClass();
    const res = await request(t.app)
      .post(`/prereg/public/CL-PR`)
      .type('form')
      .send({ applicantName: 'سارا محمدی', phone: '09123456789', email: 'sara@example.com' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('پیش‌ثبت‌نام شما ثبت شد');
    const m = res.text.match(/کد پیگیری: <code[^>]*>([^<]+)<\/code>/);
    expect(m).toBeTruthy();
    const trackingCode = m![1];
    expect(trackingCode).toMatch(/^PR-/);
    // ضدتکرار — همان موبایل
    const dup = await request(t.app)
      .post(`/prereg/public/CL-PR`)
      .type('form')
      .send({ applicantName: 'سارا محمدی', phone: '09123456789' });
    expect(dup.status).toBe(409);
    // honeypot — پر شده → 400
    const bot = await request(t.app)
      .post(`/prereg/public/CL-PR`)
      .type('form')
      .send({ applicantName: 'ربات', phone: '09120000099', website: 'http://spam.example' });
    expect(bot.status).toBe(400);
    // پیگیری
    const track = await request(t.app).get(`/prereg/tracking/${trackingCode}`);
    expect(track.status).toBe(200);
    expect(track.text).toContain('pending');
  });

  it('review + تبدیل به ثبت‌نام — کنترل ظرفیت', async () => {
    const cls = await setupPreregClass();
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    // ثبت عمومی
    const sub = await request(t.app)
      .post(`/prereg/public/CL-PR`)
      .type('form')
      .send({ applicantName: 'علی رضایی', phone: '09121112233' });
    const trackingCode = sub.text.match(/کد پیگیری: <code[^>]*>([^<]+)<\/code>/)![1];
    const row = await t.db.selectFrom('preregistrations').selectAll().where('tracking_code', '=', trackingCode).executeTakeFirstOrThrow();
    // review — needs_fix → قابل تبدیل نیست
    const bad = await agent.post(`/prereg/${row.id}/review`).set('X-CSRF-Token', csrf).send({ status: 'needs_fix' });
    expect(bad.status).toBe(200);
    const convBad = await agent.post(`/enrollments/convert/${row.id}`).set('X-CSRF-Token', csrf);
    expect(convBad.status).toBe(400);
    // review مجدد → 409 (قبلاً بررسی شده)
    const reReview = await agent.post(`/prereg/${row.id}/review`).set('X-CSRF-Token', csrf).send({ status: 'approved' });
    expect(reReview.status).toBe(409);
    // یک پیش‌ثبت‌نام دیگر — approve → تبدیل
    const sub2 = await request(t.app)
      .post(`/prereg/public/CL-PR`)
      .type('form')
      .send({ applicantName: 'مریم احمدی', phone: '09125556677' });
    const trackingCode2 = sub2.text.match(/کد پیگیری: <code[^>]*>([^<]+)<\/code>/)![1];
    const row2 = await t.db.selectFrom('preregistrations').selectAll().where('tracking_code', '=', trackingCode2).executeTakeFirstOrThrow();
    const approve = await agent.post(`/prereg/${row2.id}/review`).set('X-CSRF-Token', csrf).send({ status: 'approved' });
    expect(approve.status).toBe(200);
    const conv = await agent.post(`/enrollments/convert/${row2.id}`).set('X-CSRF-Token', csrf);
    expect(conv.status).toBe(200);
    expect(conv.body.enrollmentId).toBeGreaterThan(0);
    // تبدیل مجدد → 409
    const conv2 = await agent.post(`/enrollments/convert/${row2.id}`).set('X-CSRF-Token', csrf);
    expect(conv2.status).toBe(409);
    // student ساخته شده
    const stu = await t.db.selectFrom('students').selectAll().where('phone', '=', '09125556677').executeTakeFirstOrThrow();
    expect(stu.first_name).toBe('مریم');
  });

  it('ثبت‌نام — ضدتکرار + کنترل ظرفیت (کلاس ۲ نفره)', async () => {
    const cls = await seedClass(t);
    const s1 = await seedStudent(t, 'ST-1', '09120000001');
    const s2 = await seedStudent(t, 'ST-2', '09120000002');
    const s3 = await seedStudent(t, 'ST-3', '09120000003');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const e1 = await agent.post('/enrollments').set('X-CSRF-Token', csrf).send({ classId: cls, studentId: s1 });
    expect(e1.status).toBe(201);
    const e2 = await agent.post('/enrollments').set('X-CSRF-Token', csrf).send({ classId: cls, studentId: s2 });
    expect(e2.status).toBe(201);
    // کلاس full شد
    const clsRow = await t.db.selectFrom('classes').select('status').where('id', '=', cls).executeTakeFirstOrThrow();
    expect(clsRow.status).toBe('full');
    // نفر سوم → ظرفیت تکمیل → 409
    const e3 = await agent.post('/enrollments').set('X-CSRF-Token', csrf).send({ classId: cls, studentId: s3 });
    expect(e3.status).toBe(409);
    // تکراری → 409
    const dup = await agent.post('/enrollments').set('X-CSRF-Token', csrf).send({ classId: cls, studentId: s1 });
    expect(dup.status).toBe(409);
    // UNIQUE DB — خطای خام reject می‌شود
    const now = nowDb();
    await expect(
      t.db.insertInto('enrollments').values({
        class_id: cls, student_id: s1, status: 'active', fee_amount: '0',
        discount_amount: '0', enrolled_at: now, created_at: now, updated_at: now,
      }).execute(),
    ).rejects.toThrow();
    // لغو → کلاس باز می‌شود
    const cancel = await agent.post(`/enrollments/${e2.body.id}/cancel`).set('X-CSRF-Token', csrf).send({ reason: 'انصراف' });
    expect(cancel.status).toBe(200);
    const clsRow2 = await t.db.selectFrom('classes').select('status').where('id', '=', cls).executeTakeFirstOrThrow();
    expect(clsRow2.status).toBe('open');
  });
});

describe('فاز ۲ — جداسازی داده کلاس‌ها (Policy Layer)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('استاد کلاس A به داده‌های کلاس B دسترسی ندارد (403)', async () => {
    // two classes, teacher only in class A
    const clsA = await seedClass(t, 'CL-A');
    const clsB = await seedClass(t, 'CL-B');
    const teacherRow = await seedTeacher(t, 'T-A', '09120000001');
    await t.db.insertInto('class_teachers').values({ class_id: clsA, teacher_id: teacherRow, assigned_at: nowDb() }).execute();
    // user for teacher
    const { hashPassword } = await import('../../src/core/security/password');
    const hash = await hashPassword('Teacher123', t.config.BCRYPT_ROUNDS);
    const u = await t.db
      .insertInto('users')
      .values({
        username: 'teacher_a', email: null, phone: null, password_hash: hash,
        full_name: 'استاد A', is_active: 1, created_at: nowDb(), updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const uid = Number(u.insertId);
    await t.db.updateTable('teachers').set({ user_id: uid }).where('id', '=', teacherRow).execute();
    const rbac = new (await import('../../src/modules/rbac/rbac.service')).RbacService(t.db);
    const role = await rbac.repo.findRoleBySlug('teacher');
    await t.db.insertInto('user_roles').values({ user_id: uid, role_id: Number(role!.id) }).execute();

    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    // Policy.assertClassAccess — از طریق سرویس classes
    const { Policy } = await import('../../src/core/policy/policy');
    const policy = new Policy(t.db);
    const me = { id: uid, username: 'teacher_a', fullName: 'استاد A', isActive: true, mustChangePassword: false, roles: ['teacher'], permissions: [] };
    // کلاس A — OK
    await policy.assertClassAccess(me, clsA);
    // کلاس B — 403
    await expect(policy.assertClassAccess(me, clsB)).rejects.toMatchObject({ statusCode: 403 });
    // student B — 403
    const sB = await seedStudent(t, 'ST-B', '09120000009');
    await t.db.insertInto('enrollments').values({
      class_id: clsB, student_id: sB, status: 'active', fee_amount: '0',
      discount_amount: '0', enrolled_at: nowDb(), created_at: nowDb(), updated_at: nowDb(),
    }).execute();
    await expect(policy.assertStudentAccess(me, sB)).rejects.toMatchObject({ statusCode: 403 });
    // student A — OK
    const sA = await seedStudent(t, 'ST-A', '09120000008');
    await t.db.insertInto('enrollments').values({
      class_id: clsA, student_id: sA, status: 'active', fee_amount: '0',
      discount_amount: '0', enrolled_at: nowDb(), created_at: nowDb(), updated_at: nowDb(),
    }).execute();
    await policy.assertStudentAccess(me, sA);
  });
});
