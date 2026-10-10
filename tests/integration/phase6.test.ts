/**  integration   : SmsProvider/Fake/IPPanel adapter /  DB (dedupe+rate+backoff) cron   (REQ-P6-01..05). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';
import { SmsService } from '../../src/modules/sms/sms.service';
import { FakeSmsProvider, getSmsProvider, SmsProviderError } from '../../src/modules/sms/provider';
import { IPanelSmsProvider } from '../../src/modules/sms/ippanel.adapter';

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

async function makeStudentUser(t: TestApp, username: string, studentRowId: number, password = 'Student123') {
  const uid = await createUser(t, username, ['student'], password);
  await t.db.updateTable('students').set({ user_id: uid }).where('id', '=', studentRowId).execute();
  return uid;
}

function sms(t: TestApp) {
  return new SmsService(t.db, t.config);
}

async function eventIdOf(t: TestApp, eventKey: string): Promise<number> {
  const row = await t.db.selectFrom('sms_events').select('id').where('event_key', '=', eventKey).executeTakeFirstOrThrow();
  return Number(row.id);
}

describe('فاز ۶ — Provider و Gate (REQ-P6-01/05)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('SMS_LIVE_TESTS=0 → همیشه Fake Provider (حتی با provider=ippanel)', async () => {
    const provider = await sms(t).getProvider();
    expect(provider).toBeInstanceOf(FakeSmsProvider);
  });

  it('getSmsProvider — live=1 + provider=ippanel + بدون کلید → خطا', () => {
    expect(() =>
      getSmsProvider({ ...t.config, SMS_LIVE_TESTS: '1', SMS_PROVIDER: 'ippanel' } as never, { apiKey: '' }),
    ).toThrow(SmsProviderError);
    // live=1 +   IPanel adapter (      send)
    const p = getSmsProvider({ ...t.config, SMS_LIVE_TESTS: '1', SMS_PROVIDER: 'ippanel' } as never, { apiKey: 'k' });
    expect(p).toBeInstanceOf(IPanelSmsProvider);
    expect(p.name).toBe('ippanel');
  });

  it('کلید API رمزنگاری‌شده در DB + fallback به env — هرگز در لاگ ذخیره نمی‌شود', async () => {
    const service = sms(t);
    //    settings ( Secret    )
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    await agent.put('/settings/sms.ip_panel_api_key').set('X-CSRF-Token', csrf).send({ value: 'secret-key-123' });
    const row = await t.db.selectFrom('settings').select('value').where('key', '=', 'sms.ip_panel_api_key').executeTakeFirstOrThrow();
    expect(row.value).not.toContain('secret-key-123'); // رمزنگاری‌شده
    expect(row.value.startsWith('v1:')).toBe(true);
    expect(await service.getApiKey()).toBe('secret-key-123');
  });
});

describe('فاز ۶ — پترن/رویداد و نگاشت متغیر (REQ-P6-03)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('seedDefaults idempotent — پترن‌ها و رویدادهای پیش‌فرض', async () => {
    const patterns = await t.db.selectFrom('sms_patterns').selectAll().execute();
    const events = await t.db.selectFrom('sms_events').selectAll().execute();
    expect(patterns.length).toBeGreaterThanOrEqual(4);
    expect(events.map((e) => e.event_key).sort()).toEqual(
      ['certificate_issued', 'class_session_reminder', 'enrollment_created', 'payment_approved'].sort(),
    );
    await sms(t).seedDefaults();
    expect(await t.db.selectFrom('sms_patterns').selectAll().execute()).toHaveLength(patterns.length);
    expect(await t.db.selectFrom('sms_events').selectAll().execute()).toHaveLength(events.length);
  });

  it('CRUD پترن + تکراری → ۴۰۹ + RBAC', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const created = await agent.post('/sms/patterns').set('X-CSRF-Token', csrf).send({
      name: 'پترن تست',
      patternCode: 'test_pattern',
      variables: [{ name: 'student_name', required: true }],
    });
    expect(created.status).toBe(201);
    const dup = await agent.post('/sms/patterns').set('X-CSRF-Token', csrf).send({ name: 'تکراری', patternCode: 'test_pattern' });
    expect(dup.status).toBe(409);
    const list = await agent.get('/sms/patterns');
    expect(list.body.patterns.some((p: { pattern_code: string }) => p.pattern_code === 'test_pattern')).toBe(true);
    // RBAC   
    await createUser(t, 'plain_user', []);
    const uagent = await loginAgent(t.app, 'plain_user', 'User12345');
    expect((await uagent.get('/sms/patterns')).status).toBe(403);
  });

  it('renderVariables — نگاشت + پیش‌فرض + الزامی مفقود', async () => {
    const service = sms(t);
    const { variables, missing } = service.renderVariables(
      [
        { name: 'student_name', required: true },
        { name: 'class_title', required: false, default: 'نامشخص' },
      ],
      { full_name: 'student_name' },
      { full_name: 'علی رضایی' },
    );
    expect(variables.student_name).toBe('علی رضایی');
    expect(variables.class_title).toBe('نامشخص');
    expect(missing).toHaveLength(0);
    const bad = service.renderVariables([{ name: 'student_name', required: true }], {}, {});
    expect(bad.missing).toEqual(['student_name']);
  });

  it('CRUD رویداد + فعال/غیرفعال‌سازی', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const created = await agent.post('/sms/events').set('X-CSRF-Token', csrf).send({
      eventKey: 'custom_event',
      name: 'رویداد سفارشی',
      recipient: 'student',
    });
    expect(created.status).toBe(201);
    const dup = await agent.post('/sms/events').set('X-CSRF-Token', csrf).send({ eventKey: 'custom_event', name: 'تکراری' });
    expect(dup.status).toBe(409);
    const id = created.body.eventId;
    const off = await agent.post(`/sms/events/${id}`).set('X-CSRF-Token', csrf).send({ enabled: '0' });
    expect(off.status).toBe(200);
    const row = await t.db.selectFrom('sms_events').select('enabled').where('id', '=', id).executeTakeFirstOrThrow();
    expect(Number(row.enabled)).toBe(0);
  });
});

describe('فاز ۶ — صف DB: dedupe + rate limit + backoff (REQ-P6-04)', () => {
  let t: TestApp;
  beforeEach(async () => {
    FakeSmsProvider.reset();
    t = await createTestApp();
  });
  afterEach(async () => { await t.cleanup(); });

  it('enqueue — ضد تکرار (event+entity+recipient)', async () => {
    const classId = await seedClass(t, 'CL-1');
    const studentId = await seedStudent(t, 'ST-1', '09120000011');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const service = sms(t);
    const ctx = { entityType: 'enrollment', entityId: enrollmentId, studentId, classId };
    const r1 = await service.enqueue('enrollment_created', ctx, { student_name: 'علی رضایی' });
    expect(r1.queued).toBe(1);
    const r2 = await service.enqueue('enrollment_created', ctx, { student_name: 'علی رضایی' });
    expect(r2.queued).toBe(0);
    expect(r2.skipped[0]).toContain('duplicate');
    const rows = await t.db.selectFrom('sms_queue').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe('09120000011');
    expect(rows[0].dedupe_key).toBe(`enrollment_created:enrollment:${enrollmentId}:09120000011`);
    expect(JSON.parse(rows[0].variables).student_name).toBe('علی رضایی');
  });

  it('enqueue — رویداد غیرفعال / متغیر الزامی مفقود → skip', async () => {
    const classId = await seedClass(t, 'CL-2');
    const studentId = await seedStudent(t, 'ST-2', '09120000012');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const service = sms(t);
    const ctx = { entityType: 'enrollment', entityId: enrollmentId, studentId, classId };
    //  
    await t.db.updateTable('sms_events').set({ enabled: 0 }).where('event_key', '=', 'enrollment_created').execute();
    expect((await service.enqueue('enrollment_created', ctx, { student_name: 'X' })).queued).toBe(0);
    await t.db.updateTable('sms_events').set({ enabled: 1 }).where('event_key', '=', 'enrollment_created').execute();
    //    (student_name )
    const r = await service.enqueue('enrollment_created', ctx, {});
    expect(r.queued).toBe(0);
    expect(r.skipped[0]).toContain('missing variables');
    //     skip
    await t.db.updateTable('students').set({ phone: '' }).where('id', '=', studentId).execute();
    expect((await service.enqueue('enrollment_created', ctx, { student_name: 'X' })).queued).toBe(0);
  });

  it('processPending — ارسال با Fake + وضعیت sent + متغیرهای نگاشت‌شده', async () => {
    const classId = await seedClass(t, 'CL-3');
    const studentId = await seedStudent(t, 'ST-3', '09120000013');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const service = sms(t);
    await service.enqueue('enrollment_created', { entityType: 'enrollment', entityId: enrollmentId, studentId, classId }, { student_name: 'علی رضایی' });
    const res = await service.processPending();
    expect(res.processed).toBe(1);
    expect(res.sent).toBe(1);
    expect(FakeSmsProvider.outbox).toHaveLength(1);
    expect(FakeSmsProvider.outbox[0].patternCode).toBe('welcome_student');
    expect(FakeSmsProvider.outbox[0].variables).toEqual({ student_name: 'علی رضایی' });
    const row = await t.db.selectFrom('sms_queue').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('sent');
    expect(row.sent_at).toBeTruthy();
  });

  it('processPending — تأخیر (delay_minutes) رعایت می‌شود', async () => {
    const classId = await seedClass(t, 'CL-4');
    const studentId = await seedStudent(t, 'ST-4', '09120000014');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const service = sms(t);
    //     
    await t.db.updateTable('sms_events').set({ delay_minutes: 1440 }).where('event_key', '=', 'enrollment_created').execute();
    await service.enqueue('enrollment_created', { entityType: 'enrollment', entityId: enrollmentId, studentId, classId }, { student_name: 'X' });
    const res = await service.processPending();
    expect(res.processed).toBe(0);
    const row = await t.db.selectFrom('sms_queue').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
    expect(new Date(row.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('backoff — شکست → attempts+1 + next_attempt_at آینده → تلاش دوم موفق', async () => {
    const classId = await seedClass(t, 'CL-5');
    const studentId = await seedStudent(t, 'ST-5', '09120000015');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const service = sms(t);
    await service.enqueue('enrollment_created', { entityType: 'enrollment', entityId: enrollmentId, studentId, classId }, { student_name: 'X' });
    FakeSmsProvider.failNext(1);
    const r1 = await service.processPending();
    expect(r1.sent).toBe(0);
    expect(r1.failed).toBe(1);
    let row = await t.db.selectFrom('sms_queue').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
    expect(Number(row.attempts)).toBe(1);
    expect(new Date(row.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(row.last_error).toContain('fake provider failure');
    // backoff  base=5min    
    const service2 = sms(t);
    expect(service2.backoffMinutes(5, 1)).toBe(5);
    expect(service2.backoffMinutes(5, 3)).toBe(20);
    expect(service2.backoffMinutes(5, 10)).toBe(60); // سقف
    //  Erinnerung   
    await t.db.updateTable('sms_queue').set({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).execute();
    const r2 = await service.processPending();
    expect(r2.sent).toBe(1);
    row = await t.db.selectFrom('sms_queue').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('sent');
  });

  it('retry_max — اتمام تلاش‌ها → failed', async () => {
    const classId = await seedClass(t, 'CL-6');
    const studentId = await seedStudent(t, 'ST-6', '09120000016');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const service = sms(t);
    await t.db.updateTable('sms_events').set({ retry_max: 1 }).where('event_key', '=', 'enrollment_created').execute();
    await service.enqueue('enrollment_created', { entityType: 'enrollment', entityId: enrollmentId, studentId, classId }, { student_name: 'X' });
    FakeSmsProvider.failNext(5);
    const r1 = await service.processPending();
    expect(r1.exhausted).toBe(1);
    const row = await t.db.selectFrom('sms_queue').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('failed');
    expect(Number(row.attempts)).toBe(1);
  });

  it('rate limit — سقف پردازش در هر اجرا', async () => {
    const classId = await seedClass(t, 'CL-7');
    const service = sms(t);
    await t.db.updateTable('settings').set({ value: '2' }).where('key', '=', 'sms.rate_limit_per_minute').execute();
    for (let i = 0; i < 5; i++) {
      const studentId = await seedStudent(t, `ST-7${i}`, `0912000010${i}`);
      const enrollmentId = await seedEnrollment(t, classId, studentId);
      await service.enqueue('enrollment_created', { entityType: 'enrollment', entityId: enrollmentId, studentId, classId }, { student_name: 'X' });
    }
    const res = await service.processPending();
    expect(res.processed).toBe(2);
    expect(res.sent).toBe(2);
    expect(FakeSmsProvider.outbox).toHaveLength(2);
    const remaining = await t.db.selectFrom('sms_queue').selectAll().where('status', '=', 'pending').execute();
    expect(remaining).toHaveLength(3);
  });

  it('class_students — یک پیام برای هر فراگیر فعال کلاس', async () => {
    const classId = await seedClass(t, 'CL-8');
    const service = sms(t);
    for (let i = 0; i < 3; i++) {
      const studentId = await seedStudent(t, `ST-8${i}`, `0912000020${i}`);
      await seedEnrollment(t, classId, studentId);
    }
    //     ( Wettbewerber)    
    const inactive = await seedStudent(t, 'ST-8X', '09120000299');
    await t.db
      .insertInto('enrollments')
      .values({
        class_id: classId, student_id: inactive, status: 'dropped', fee_amount: '1000000',
        discount_amount: '0', enrolled_at: nowDb(), created_at: nowDb(), updated_at: nowDb(),
      })
      .execute();
    const r = await service.enqueue(
      'class_session_reminder',
      { entityType: 'class', entityId: classId, classId },
      { class_title: 'کلاس تست', session_date: '۱۴۰۵/۰۸/۱۰' },
    );
    expect(r.queued).toBe(3);
    // رویداد delay=۱۴۴۰ دقیقه دارد — برای پردازش، next_attempt_at را به گذشته می‌بریم
    await t.db.updateTable('sms_queue').set({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).execute();
    const res = await service.processPending();
    expect(res.sent).toBe(3);
    expect(FakeSmsProvider.outbox.every((m) => m.patternCode === 'class_reminder')).toBe(true);
  });
});

describe('فاز ۶ — ارسال آزمایشی + endpoint داخلی cron (REQ-P6-04)', () => {
  let t: TestApp;
  beforeEach(async () => {
    FakeSmsProvider.reset();
    t = await createTestApp();
  });
  afterEach(async () => { await t.cleanup(); });

  it('test-send — admin → ۲۰۰ + outbox + audit؛ شماره نامعتبر → ۴۰۰؛ RBAC', async () => {
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const patternRow = await t.db.selectFrom('sms_patterns').select('id').where('pattern_code', '=', 'welcome_student').executeTakeFirstOrThrow();
    const res = await agent.post('/sms/test-send').set('X-CSRF-Token', csrf).send({
      patternId: Number(patternRow.id),
      recipient: '09120000011',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.provider).toBe('fake');
    expect(res.body.variables.student_name).toBeTruthy();
    expect(FakeSmsProvider.outbox).toHaveLength(1);
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'sms_test_sent').execute();
    expect(audits).toHaveLength(1);
    const bad = await agent.post('/sms/test-send').set('X-CSRF-Token', csrf).send({ patternId: Number(patternRow.id), recipient: 'abcde' });
    expect(bad.status).toBe(400);
    // RBAC   
    await createUser(t, 'plain_sms', []);
    const uagent = await loginAgent(t.app, 'plain_sms', 'User12345');
    const ucsrf = await csrfOf(uagent);
    expect((await uagent.post('/sms/test-send').set('X-CSRF-Token', ucsrf).send({ patternId: Number(patternRow.id), recipient: '09120000011' })).status).toBe(403);
  });

  it('endpoint داخلی /internal/jobs/run — بدون توکن → ۴۰۴، توکن sai → ۴۰۱، درست → پردازش صف', async () => {
    //    
    expect((await request(t.app).post('/internal/jobs/run')).status).toBe(404);
    //  
    const t2 = await createTestApp({ SMS_CRON_TOKEN: 'cron-secret-123' });
    try {
      const wrong = await request(t2.app).post('/internal/jobs/run').set('Authorization', 'Bearer wrong');
      expect(wrong.status).toBe(401);
      //    
      const classId = await seedClass(t2, 'CL-9');
      const studentId = await seedStudent(t2, 'ST-9', '09120000030');
      const enrollmentId = await seedEnrollment(t2, classId, studentId);
      await sms(t2).enqueue('enrollment_created', { entityType: 'enrollment', entityId: enrollmentId, studentId, classId }, { student_name: 'X' });
      const ok = await request(t2.app).post('/internal/jobs/run').set('Authorization', 'Bearer cron-secret-123');
      expect(ok.status).toBe(200);
      expect(ok.body.sms.sent).toBe(1);
      expect(FakeSmsProvider.outbox).toHaveLength(1);
    } finally {
      await t2.cleanup();
    }
  });
});

describe('فاز ۶ — هوک‌های دامنه (enrollment/payment → صف)', () => {
  let t: TestApp;
  beforeEach(async () => {
    FakeSmsProvider.reset();
    t = await createTestApp();
  });
  afterEach(async () => { await t.cleanup(); });

  it('ثبت‌نام از API → صف پیامک enrollment_created', async () => {
    const classId = await seedClass(t, 'CL-10');
    const studentId = await seedStudent(t, 'ST-10', '09120000040');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/enrollments').set('X-CSRF-Token', csrf).send({ classId, studentId, feeAmount: '1000000' });
    expect(res.status).toBe(201);
    const rows = await t.db.selectFrom('sms_queue').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupe_key).toContain('enrollment_created:enrollment:');
  });

  it('تأیید پرداخت از API → صف پیامک payment_approved', async () => {
    const classId = await seedClass(t, 'CL-11');
    const studentId = await seedStudent(t, 'ST-11', '09120000041');
    const enrollmentId = await seedEnrollment(t, classId, studentId);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const pay = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId, enrollmentId, methodId: 1, amount: '500000', idempotencyKey: 'sms-hook-1', status: 'pending',
    });
    expect(pay.status).toBe(201);
    const appr = await agent.post(`/finance/payments/${pay.body.paymentId}/approve`).set('X-CSRF-Token', csrf).send({});
    expect(appr.status).toBe(200);
    const rows = await t.db.selectFrom('sms_queue').selectAll().where('dedupe_key', 'like', 'payment_approved:%').execute();
    expect(rows).toHaveLength(1);
    const vars = JSON.parse(rows[0].variables);
    expect(vars.amount).toBe('500000');
    expect(vars.student_name).toBe('علی رضایی');
    expect(vars.class_title).toBe('کلاس تست');
  });
});
