/** تست‌های integration — فاز ۳: حضور و غیاب، پنل استاد، پنل فراگیر، IDOR، تفکیک مجوز نقش‌ها. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';

// ---------- helperها ----------

async function csrfOf(agent: request.SuperTest<request.Test>): Promise<string> {
  const page = await agent.get('/');
  return (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
}


/** POST JSON با CSRF (همه‌ی POSTها در تست نیاز به توکن CSRF دارند) */
async function postAs(agent: request.SuperTest<request.Test>, url: string, body: unknown) {
  const csrf = await csrfOf(agent);
  return agent.post(url).set('X-CSRF-Token', csrf).send(body);
}

async function createUser(t: TestApp, username: string, roles: string[] = [], password = 'User12345') {
  const hash = await hashPassword(password, t.config.BCRYPT_ROUNDS);
  const res = await t.db
    .insertInto('users')
    .values({
      username,
      email: null,
      phone: null,
      password_hash: hash,
      full_name: `کاربر ${username}`,
      is_active: 1,
      created_at: nowDb(),
      updated_at: nowDb(),
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

async function seedSession(t: TestApp, classId: number, date = '2026-01-10', teacherId: number | null = null) {
  const now = nowDb();
  const res = await t.db
    .insertInto('class_sessions')
    .values({
      class_id: classId, session_date: date, start_time: '16:00', duration_minutes: 90,
      topic: 'جلسه تست', teacher_id: teacherId, status: 'held',
      status_note: null, created_at: now, updated_at: now,
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

/** کاربر استاد: user + پرونده استاد + نقش teacher */
async function makeTeacherUser(t: TestApp, username: string, teacherRowId: number, password = 'Teacher123') {
  const uid = await createUser(t, username, ['teacher'], password);
  await t.db.updateTable('teachers').set({ user_id: uid }).where('id', '=', teacherRowId).execute();
  return uid;
}

/** کاربر فراگیر: user + پرونده فراگیر + نقش student */
async function makeStudentUser(t: TestApp, username: string, studentRowId: number, password = 'Student123') {
  const uid = await createUser(t, username, ['student'], password);
  await t.db.updateTable('students').set({ user_id: uid }).where('id', '=', studentRowId).execute();
  return uid;
}

/** PNG یک‌پیکسلی معتبر (برای تست آپلود رسید) */
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db4000000004945' +
    '4e44ae426082',
  'hex',
);

/** ساختار: کلاس + استاد + جلسه + ۲ فراگیر + سبت‌نام‌ها */
async function seedClassroom(t: TestApp) {
  const classId = await seedClass(t, 'CL-1');
  const teacherId = await seedTeacher(t, 'T-1', '09120000001');
  await t.db.insertInto('class_teachers').values({ class_id: classId, teacher_id: teacherId, assigned_at: nowDb() }).execute();
  const sessionId = await seedSession(t, classId, '2026-01-10', teacherId);
  const student1 = await seedStudent(t, 'ST-1', '09120000011');
  const student2 = await seedStudent(t, 'ST-2', '09120000012');
  await seedEnrollment(t, classId, student1);
  await seedEnrollment(t, classId, student2);
  return { classId, teacherId, sessionId, student1, student2 };
}

// ---------- attendance ----------

describe('فاز ۳ — attendance (REQ-P3-01)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('سبت حضور با API + ذخیره در DB', async () => {
    const { sessionId, student1, student2 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    const res = await postAs(agent, `/attendance/mark/${sessionId}`, {
      entries: [
        { studentId: student1, status: 'present' },
        { studentId: student2, status: 'absent', note: 'مریض' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(2);
    expect(res.body.corrected).toBe(0);
    const rows = await t.db.selectFrom('attendance').selectAll().where('session_id', '=', sessionId).execute();
    expect(rows).toHaveLength(2);
    const s2 = rows.find((r) => Number(r.student_id) === student2);
    expect(s2?.status).toBe('absent');
    expect(s2?.note).toBe('مریض');
  });

  it('سبت حضور فراگیر غیرعضو کلاس → 400', async () => {
    const { sessionId } = await seedClassroom(t);
    const outsider = await seedStudent(t, 'ST-X', '09120000099');
    const agent = await loginAgent(t.app);
    const res = await postAs(agent, `/attendance/mark/${sessionId}`, {
      entries: [{ studentId: outsider, status: 'present' }],
    });
    expect(res.status).toBe(400);
  });

  it('جلسه ناموجود → 404', async () => {
    const agent = await loginAgent(t.app);
    const res = await postAs(agent, '/attendance/mark/99999', { entries: [{ studentId: 1, status: 'present' }] });
    expect(res.status).toBe(404);
  });

  it('اصلاح حضور با audit (attendance_corrected)', async () => {
    const { sessionId, student1 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    await postAs(agent, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'absent' }] });
    const res = await postAs(agent, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'present' }] });
    expect(res.status).toBe(200);
    expect(res.body.corrected).toBe(1);
    const row = await t.db.selectFrom('attendance').selectAll().where('session_id', '=', sessionId).executeTakeFirstOrThrow();
    expect(row.status).toBe('present');
    const audits = await t.db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'attendance_corrected')
      .execute();
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(audits[0].meta)).toMatchObject({ from: 'absent', to: 'present', studentId: student1 });
  });

  it('یکتایی (جلسه، فراگیر): دو entry یکسان → یک رکورد', async () => {
    const { sessionId, student1 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    const res = await postAs(agent, `/attendance/mark/${sessionId}`, {
      entries: [
        { studentId: student1, status: 'present' },
        { studentId: student1, status: 'late' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(1);
    expect(res.body.corrected).toBe(1);
    const rows = await t.db.selectFrom('attendance').selectAll().where('session_id', '=', sessionId).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('late');
  });

  it('status=unset → حذف رکورد حضور', async () => {
    const { sessionId, student1 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    await postAs(agent, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'present' }] });
    const res = await postAs(agent, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'unset' }] });
    expect(res.status).toBe(200);
    const rows = await t.db.selectFrom('attendance').selectAll().where('session_id', '=', sessionId).execute();
    expect(rows).toHaveLength(0);
  });

  it('گزارش فراگیر — درصد حضور؛ دسترسی خودی', async () => {
    const { sessionId, student1 } = await seedClassroom(t);
    await makeStudentUser(t, 'student_1', student1);
    const agent = await loginAgent(t.app);
    await postAs(agent, `/attendance/mark/${sessionId}`, {
      entries: [
        { studentId: student1, status: 'present' },
        { studentId: student1, status: 'absent' }, // اصلاح → absent
      ],
    });
    const studentAgent = await loginAgent(t.app, 'student_1', 'Student123');
    const res = await studentAgent.get(`/attendance/report/student/${student1}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.absent).toBe(1);
    expect(res.body.data.percent).toBe(0);
  });

  it('گزارش کلاس — JSON + HTML', async () => {
    const { classId, sessionId, student1 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    await postAs(agent, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'present' }] });
    const json = await agent.get(`/attendance/report/class/${classId}`);
    expect(json.status).toBe(200);
    expect(json.body.data.sessions).toHaveLength(1);
    expect(json.body.data.students.length).toBe(2);
    expect(json.body.data.marks[`${sessionId}:${student1}`]).toBe('present');
    const html = await agent.get(`/attendance/report/class/${classId}`).set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('گزارش حضور کلاس');
  });

  it('هشدار حد غیبت — ۳ غیبت + دسترسی فقط license', async () => {
    const { classId, teacherId, student1 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    // ۳ جلسه + ۳ غیبت
    for (let i = 0; i < 3; i++) {
      const sid = await seedSession(t, classId, `2026-01-1${i}`, teacherId);
      await postAs(agent, `/attendance/mark/${sid}`, { entries: [{ studentId: student1, status: 'absent' }] });
    }
    const res = await agent.get('/attendance/warnings');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Number(res.body.data[0].student.id)).toBe(student1);
    expect(res.body.data[0].absentCount).toBe(3);
    // استاد (بدون view_all) → 403
    await makeTeacherUser(t, 'teacher_w', teacherId);
    const teacherAgent = await loginAgent(t.app, 'teacher_w', 'Teacher123');
    const denied = await teacherAgent.get('/attendance/warnings');
    expect(denied.status).toBe(403);
  });

  it('فهرست جلسه + roster + نمای HTML جلسه', async () => {
    const { classId, sessionId, student1 } = await seedClassroom(t);
    const agent = await loginAgent(t.app);
    await postAs(agent, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'late' }] });
    const list = await agent.get(`/attendance/session/${sessionId}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].status).toBe('late');
    const roster = await agent.get(`/attendance/roster/${classId}/${sessionId}`);
    expect(roster.status).toBe(200);
    expect(roster.body.data).toHaveLength(2);
    const html = await agent.get(`/attendance/session/${sessionId}`).set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('حضور جلسه');
  });
});

// ---------- پنل استاد ----------

describe('فاز ۳ — پنل استاد (REQ-P3-02)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('پنل استاد — فقط کلاس‌های خود', async () => {
    const clsA = await seedClass(t, 'CL-A');
    await seedClass(t, 'CL-B');
    const teacherId = await seedTeacher(t, 'T-1', '09120000001');
    await t.db.insertInto('class_teachers').values({ class_id: clsA, teacher_id: teacherId, assigned_at: nowDb() }).execute();
    await makeTeacherUser(t, 'teacher_a', teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    const res = await agent.get('/panel/teacher').set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.data.classes).toHaveLength(1);
    expect(res.body.data.classes[0].code).toBe('CL-A');
    const html = await agent.get('/panel/teacher').set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('پنل استاد');
    expect(html.text).toContain('CL-A');
    expect(html.text).not.toContain('CL-B');
  });

  it('فهرست فراگیران — فیلدهای مجاز + 403 برای کلاس دیگران', async () => {
    const { classId, teacherId, student1 } = await seedClassroom(t);
    const clsB = await seedClass(t, 'CL-B');
    const otherTeacher = await seedTeacher(t, 'T-2', '09120000002');
    await t.db.insertInto('class_teachers').values({ class_id: clsB, teacher_id: otherTeacher, assigned_at: nowDb() }).execute();
    await makeTeacherUser(t, 'teacher_a', teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    const res = await agent.get(`/panel/teacher/classes/${classId}/students`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const st = res.body.data.find((s: { id: number }) => Number(s.id) === student1);
    expect(st).toBeTruthy();
    expect(st.first_name).toBe('علی');
    // فیلدهای غیرمجاز نباید باشند
    expect(st).not.toHaveProperty('national_id');
    expect(st).not.toHaveProperty('fee_amount');
    expect(st).not.toHaveProperty('birth_date');
    // کلاسicata دیگران → 403
    const denied = await agent.get(`/panel/teacher/classes/${clsB}/students`);
    expect(denied.status).toBe(403);
  });

  it('صفحه سبت حضور — 200 برای استاد کلاس، 403 برای استاد دیگر', async () => {
    const { sessionId, teacherId, student1 } = await seedClassroom(t);
    await makeTeacherUser(t, 'teacher_a', teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    const page = await agent.get(`/panel/teacher/mark/${sessionId}`).set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('سبت حضور');
    expect(page.text).toContain('ST-1');
    // استاد دیگر
    const otherTeacher = await seedTeacher(t, 'T-2', '09120000002');
    await makeTeacherUser(t, 'teacher_b', otherTeacher);
    const agentB = await loginAgent(t.app, 'teacher_b', 'Teacher123');
    const denied = await agentB.get(`/panel/teacher/mark/${sessionId}`);
    expect(denied.status).toBe(403);
    expect(student1).toBeGreaterThan(0);
  });

  it('سبت حضور با فرم HTML (urlencoded) → redirect + رکورد', async () => {
    const { sessionId, teacherId, student1, student2 } = await seedClassroom(t);
    await makeTeacherUser(t, 'teacher_a', teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    const csrf = await csrfOf(agent);
    const res = await agent
      .post(`/attendance/mark/${sessionId}`)
      .set('X-CSRF-Token', csrf)
      .type('form')
      .send(`entries[0][studentId]=${student1}&entries[0][status]=present&entries[1][studentId]=${student2}&entries[1][status]=absent`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/panel/teacher/mark/${sessionId}`);
    const rows = await t.db.selectFrom('attendance').selectAll().where('session_id', '=', sessionId).execute();
    expect(rows).toHaveLength(2);
  });

  it('پروفایل استاد — GET/PUT + audit + موبایل نامعتبر', async () => {
    const teacherId = await seedTeacher(t, 'T-1', '09120000001');
    await makeTeacherUser(t, 'teacher_a', teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    const csrf = await csrfOf(agent);
    const get = await agent.get('/panel/teacher/profile').set('Accept', 'application/json');
    expect(get.status).toBe(200);
    expect(get.body.data.code).toBe('T-1');
    const getHtml = await agent.get('/panel/teacher/profile').set('Accept', 'text/html');
    expect(getHtml.status).toBe(200);
    expect(getHtml.text).toContain('پروفایل من');
    const put = await agent.put('/panel/teacher/profile').set('X-CSRF-Token', csrf).send({
      phone: '۰۹۱۲۳۴۵۶۷۸۹', email: 'teacher@test.ir', notes: 'یادداشت تست',
    });
    expect(put.status).toBe(200);
    const row = await t.db.selectFrom('teachers').selectAll().where('id', '=', teacherId).executeTakeFirstOrThrow();
    expect(row.phone).toBe('09123456789');
    expect(row.email).toBe('teacher@test.ir');
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'teacher_profile_updated').execute();
    expect(audits).toHaveLength(1);
    const bad = await agent.put('/panel/teacher/profile').set('X-CSRF-Token', csrf).send({ phone: '123' });
    expect(bad.status).toBe(400);
  });

  it('استاد به تنظیمات/کاربران/گزارش ممیزی دسترسی ندارد', async () => {
    const teacherId = await seedTeacher(t, 'T-1', '09120000001');
    await makeTeacherUser(t, 'teacher_a', teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    expect((await agent.get('/settings')).status).toBe(403);
    expect((await agent.get('/users')).status).toBe(403);
    expect((await agent.get('/audit')).status).toBe(403);
    expect((await agent.get('/students')).status).toBe(403);
  });
});

// ---------- پنل فراگیر ----------

describe('فاز ۳ — پنل فراگیر (REQ-P3-03)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('پنل فراگیر — JSON + HTML (کلاس‌ها + حضور)', async () => {
    const { classId, sessionId, student1 } = await seedClassroom(t);
    await makeStudentUser(t, 'student_1', student1);
    const admin = await loginAgent(t.app);
    await postAs(admin, `/attendance/mark/${sessionId}`, { entries: [{ studentId: student1, status: 'present' }] });
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const json = await agent.get('/panel/student').set('Accept', 'application/json');
    expect(json.status).toBe(200);
    expect(json.body.data.classes).toHaveLength(1);
    expect(json.body.data.classes[0].code).toBe('CL-1');
    expect(json.body.data.attendance.total).toBe(1);
    const html = await agent.get('/panel/student').set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('پنل فراگیر');
    expect(html.text).toContain('کلاس تست');
    expect(html.text).toContain('درصد حضور');
  });

  it('پروفایل فراگیر — GET/PUT + audit + موبایل سرپرست نامعتبر', async () => {
    const { student1 } = await seedClassroom(t);
    await makeStudentUser(t, 'student_1', student1);
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const csrf = await csrfOf(agent);
    const get = await agent.get('/panel/student/profile').set('Accept', 'application/json');
    expect(get.status).toBe(200);
    expect(get.body.data.code).toBe('ST-1');
    const getHtml = await agent.get('/panel/student/profile').set('Accept', 'text/html');
    expect(getHtml.status).toBe(200);
    expect(getHtml.text).toContain('پروفایل من');
    const put = await agent.put('/panel/student/profile').set('X-CSRF-Token', csrf).send({
      phone: '09123456789', guardianName: 'پدر', guardianPhone: '09121112233',
    });
    expect(put.status).toBe(200);
    const row = await t.db.selectFrom('students').selectAll().where('id', '=', student1).executeTakeFirstOrThrow();
    expect(row.guardian_name).toBe('پدر');
    expect(row.guardian_phone).toBe('09121112233');
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'student_profile_updated').execute();
    expect(audits).toHaveLength(1);
    const bad = await agent.put('/panel/student/profile').set('X-CSRF-Token', csrf).send({ guardianPhone: 'abc' });
    expect(bad.status).toBe(400);
  });

  it('امور مالی فراگیر — مانده صحیح با پرداخت approved', async () => {
    const { classId, student1 } = await seedClassroom(t);
    const enrollmentId = await t.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', classId)
      .where('student_id', '=', student1)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.id));
    await makeStudentUser(t, 'student_1', student1);
    await t.db.insertInto('payments').values({
      student_id: student1, enrollment_id: enrollmentId, method_id: 1, amount: '400000',
      idempotency_key: 'pay-test-1', status: 'approved', created_at: nowDb(),
    }).execute();
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const res = await agent.get('/panel/student/finance');
    expect(res.status).toBe(200);
    expect(res.body.data.enrollments).toHaveLength(1);
    expect(res.body.data.enrollments[0].due).toBe('1000000');
    expect(res.body.data.enrollments[0].paid).toBe('400000');
    expect(res.body.data.enrollments[0].balance).toBe('600000');
    expect(res.body.data.payments).toHaveLength(1);
  });

  it('آپلود رسید کارت‌به‌کارت — 201 + idempotency → 409', async () => {
    const { classId, student1 } = await seedClassroom(t);
    const enrollmentId = await t.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', classId)
      .where('student_id', '=', student1)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.id));
    await makeStudentUser(t, 'student_1', student1);
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const csrf = await csrfOf(agent);
    const res = await agent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(enrollmentId))
      .field('amount', '۵۰۰۰۰۰')
      .field('idempotencyKey', 'receipt-key-1')
      .attach('file', PNG_1PX, 'receipt.png');
    expect(res.status).toBe(201);
    expect(res.body.receiptId).toBeGreaterThan(0);
    const receipt = await t.db.selectFrom('card_receipts').selectAll().where('id', '=', res.body.receiptId).executeTakeFirstOrThrow();
    expect(receipt.status).toBe('pending');
    expect(String(receipt.amount)).toBe('500000');
    // تکرار idempotencyKey → 409
    const dup = await agent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(enrollmentId))
      .field('amount', '500000')
      .field('idempotencyKey', 'receipt-key-1')
      .attach('file', PNG_1PX, 'receipt.png');
    expect(dup.status).toBe(409);
    // audit
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'receipt_uploaded').execute();
    expect(audits.length).toBe(1);
  });

  it('رسید برای سبت‌نام دیگری → 403', async () => {
    const { classId, student1, student2 } = await seedClassroom(t);
    const otherEnrollment = await t.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', classId)
      .where('student_id', '=', student2)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.id));
    await makeStudentUser(t, 'student_1', student1);
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const csrf = await csrfOf(agent);
    const res = await agent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(otherEnrollment))
      .field('amount', '100000')
      .field('idempotencyKey', 'receipt-other-1')
      .attach('file', PNG_1PX, 'receipt.png');
    expect(res.status).toBe(403);
  });

  it('مدارک فراگیر', async () => {
    const { classId, student1 } = await seedClassroom(t);
    await makeStudentUser(t, 'student_1', student1);
    const now = nowDb();
    await t.db.insertInto('certificates').values({
      template_id: null, student_id: student1, class_id: classId, code: 'CERT-001',
      status: 'issued', issued_at: now, verification_token: 'tok-123', created_at: now, updated_at: now,
    }).execute();
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const res = await agent.get('/panel/student/certificates');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('CERT-001');
    expect(res.body.data[0].class_code).toBe('CL-1');
  });

  it('دانلود فایل — خودی 200، دیگران 403، admin 200؛ نوع فایل غیرمجاز → 400', async () => {
    const { classId, student1, student2 } = await seedClassroom(t);
    const enrollmentId = await t.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', classId)
      .where('student_id', '=', student1)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.id));
    await makeStudentUser(t, 'student_1', student1);
    await makeStudentUser(t, 'student_2', student2);
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const csrf = await csrfOf(agent);
    const up = await agent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(enrollmentId))
      .field('amount', '100000')
      .field('idempotencyKey', 'receipt-dl-1')
      .attach('file', PNG_1PX, 'receipt.png');
    expect(up.status).toBe(201);
    const fileId = up.body.fileId;
    // خودی → 200
    const own = await agent.get(`/files/${fileId}`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toContain('image/png');
    // فراگیر دیگر → 403
    const agent2 = await loginAgent(t.app, 'student_2', 'Student123');
    const denied = await agent2.get(`/files/${fileId}`);
    expect(denied.status).toBe(403);
    // admin → 200
    const admin = await loginAgent(t.app);
    const adminGet = await admin.get(`/files/${fileId}`);
    expect(adminGet.status).toBe(200);
    // نوع فایل غیرمجاز (MZ) → 400
    const bad = await agent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(enrollmentId))
      .field('amount', '100000')
      .field('idempotencyKey', 'receipt-bad-1')
      .attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), 'virus.exe');
    expect(bad.status).toBe(400);
  });

  it('کاربر بدون نقش → آپلود رسید 403', async () => {
    const { classId, student1 } = await seedClassroom(t);
    const enrollmentId = await t.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', classId)
      .where('student_id', '=', student1)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.id));
    await createUser(t, 'norole_user', []);
    const agent = await loginAgent(t.app, 'norole_user', 'User12345');
    const csrf = await csrfOf(agent);
    const res = await agent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(enrollmentId))
      .field('amount', '100000')
      .field('idempotencyKey', 'receipt-norole-1')
      .attach('file', PNG_1PX, 'receipt.png');
    expect(res.status).toBe(403);
  });
});

// ---------- IDOR ----------

describe('فاز ۳ — تست‌های IDOR منفی (REQ-P3-04)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('استاد A به جلسه/گزارش کلاس B دسترسی ندارد', async () => {
    const roomA = await seedClassroom(t);
    const clsB = await seedClass(t, 'CL-B');
    const teacherB = await seedTeacher(t, 'T-B', '09120000050');
    await t.db.insertInto('class_teachers').values({ class_id: clsB, teacher_id: teacherB, assigned_at: nowDb() }).execute();
    const sessionB = await seedSession(t, clsB, '2026-01-11', teacherB);
    await makeTeacherUser(t, 'teacher_a', roomA.teacherId);
    const agent = await loginAgent(t.app, 'teacher_a', 'Teacher123');
    // mark کلاس B
    const mark = await postAs(agent, `/attendance/mark/${sessionB}`, { entries: [{ studentId: 1, status: 'present' }] });
    expect(mark.status).toBe(403);
    // view جلسه کلاس B
    const view = await agent.get(`/attendance/session/${sessionB}`);
    expect(view.status).toBe(403);
    // report کلاس B
    const report = await agent.get(`/attendance/report/class/${clsB}`);
    expect(report.status).toBe(403);
    // roster کلاس B
    const roster = await agent.get(`/attendance/roster/${clsB}/${sessionB}`);
    expect(roster.status).toBe(403);
    // mark صفحه کلاس B
    const markPage = await agent.get(`/panel/teacher/mark/${sessionB}`);
    expect(markPage.status).toBe(403);
  });

  it('فراگیر A به گزارش فراگیر B دسترسی ندارد', async () => {
    const { student1, student2 } = await seedClassroom(t);
    await makeStudentUser(t, 'student_1', student1);
    await makeStudentUser(t, 'student_2', student2);
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const res = await agent.get(`/attendance/report/student/${student2}`);
    expect(res.status).toBe(403);
  });

  it('دسترسی بدون ورود → 401', async () => {
    const { sessionId, classId } = await seedClassroom(t);
    const anon = request.agent(t.app);
    expect((await anon.get('/panel/teacher')).status).toBe(401);
    expect((await anon.get('/panel/student')).status).toBe(401);
    expect((await anon.get(`/attendance/session/${sessionId}`)).status).toBe(401);
    expect((await anon.get(`/attendance/report/class/${classId}`)).status).toBe(401);
    expect((await anon.get('/attendance/warnings')).status).toBe(401);
  });

  it('فراگیر به پنل استاد دسترسی ندارد (404 — پرونده استاد ندارد)', async () => {
    const { student1 } = await seedClassroom(t);
    await makeStudentUser(t, 'student_1', student1);
    const agent = await loginAgent(t.app, 'student_1', 'Student123');
    const res = await agent.get('/panel/teacher');
    expect(res.status).toBe(404);
  });
});

// ---------- RBAC — تفکیک مجوز نقش‌های سیستمی ----------

describe('RBAC — تفکیک مجوز نقش‌های سیستمی (shorthand module.action)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  async function rolePermissions(slug: string): Promise<string[]> {
    const role = await t.db.selectFrom('roles').select('id').where('slug', '=', slug).executeTakeFirstOrThrow();
    const rows = await t.db
      .selectFrom('role_permissions')
      .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
      .select(['permissions.module', 'permissions.resource', 'permissions.action'])
      .where('role_permissions.role_id', '=', Number(role.id))
      .execute();
    return rows.map((r) => `${r.module}.${r.resource}.${r.action}`);
  }

  it('نقش استاد — مجوزهای حضور/کلاس/جلسات/فهرست resolves می‌شود', async () => {
    const perms = await rolePermissions('teacher');
    for (const needed of [
      'attendance.attendance.view',
      'attendance.attendance.mark',
      'attendance.attendance.correct',
      'attendance.attendance.report',
      'classes.classes.list',
      'sessions.sessions.list',
      'sessions.sessions.update',
      'dashboard.dashboard.view',
      'self.profile.view',
      'self.profile.update',
      'self.password.change',
      'notifications.notifications.view',
    ]) {
      expect(perms).toContain(needed);
    }
    // و نباید license کامل داشته باشد
    expect(perms).not.toContain('attendance.attendance.view_all');
    expect(perms).not.toContain('finance.payments.view_all');
    expect(perms).not.toContain('settings.settings.view');
  });

  it('نقش فراگیر — self + آپلود فایل؛ بدون مجوز مالی', async () => {
    const perms = await rolePermissions('student');
    for (const needed of [
      'self.profile.view',
      'self.profile.update',
      'self.password.change',
      'dashboard.dashboard.view',
      'files.files.upload',
      'notifications.notifications.view',
    ]) {
      expect(perms).toContain(needed);
    }
    expect(perms).not.toContain('finance.payments.view_all');
    expect(perms).not.toContain('students.students.view_all');
    expect(perms).not.toContain('attendance.attendance.mark');
  });

  it('نقش‌های finance و admin — shorthandهای ۲بخشی resolve می‌شوند', async () => {
    const finance = await rolePermissions('finance');
    for (const needed of [
      'students.students.view_all',
      'classes.classes.list',
      'attendance.attendance.view_all',
      'attendance.attendance.report',
      'dashboard.dashboard.view',
      'finance.payments.approve',
    ]) {
      expect(finance).toContain(needed);
    }
    const admin = await rolePermissions('admin');
    for (const needed of ['audit.audit.view', 'health.health.view', 'dashboard.dashboard.view']) {
      expect(admin).toContain(needed);
    }
  });
});
