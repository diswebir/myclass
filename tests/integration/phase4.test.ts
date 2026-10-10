/** تست‌های integration — فاز ۴: پرداخت‌ها، اقساط، رسید کارت‌به‌کارت، گزارش‌های مالی، PaymentGateway. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';
import { FakeGateway, getGateway } from '../../src/modules/finance/gateway';

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

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db4000000004945' +
    '4e44ae426082',
  'hex',
);

async function setupClassroom(t: TestApp) {
  const classId = await seedClass(t, 'CL-1');
  const student1 = await seedStudent(t, 'ST-1', '09120000011');
  const enrollmentId = await seedEnrollment(t, classId, student1);
  return { classId, student1, enrollmentId };
}

describe('فاز ۴ — پرداخت‌ها (REQ-P4-02)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('ثبت پرداخت + ledger credit + موجودی', async () => {
    const { student1, enrollmentId } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1,
      enrollmentId,
      methodId: 1, // نقدی
      amount: '۴۵۰۰۰۰',
      idempotencyKey: 'pay-test-001',
      note: 'پیش‌پرداخت',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
    const pay = await t.db.selectFrom('payments').selectAll().where('id', '=', res.body.paymentId).executeTakeFirstOrThrow();
    expect(String(pay.amount)).toBe('450000');
    expect(pay.status).toBe('approved');
    // ledger
    const ledger = await t.db.selectFrom('ledger_entries').selectAll().where('payment_id', '=', res.body.paymentId).execute();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].entry_type).toBe('credit');
    expect(String(ledger[0].balance_after)).toBe('450000');
    // audit
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'payment_created').execute();
    expect(audits.length).toBe(1);
    // موجودی در پنل فراگیر
    await makeStudentUser(t, 'student_1', student1);
    const sagent = await loginAgent(t.app, 'student_1', 'Student123');
    const fin = await sagent.get('/panel/student/finance');
    expect(fin.body.data.enrollments[0].paid).toBe('450000');
    expect(fin.body.data.enrollments[0].balance).toBe('550000');
  });

  it('idempotency — پرداخت تکراری → 409', async () => {
    const { student1 } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const body = { studentId: student1, methodId: 1, amount: '100000', idempotencyKey: 'pay-dup-1' };
    expect((await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send(body)).status).toBe(201);
    const dup = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send(body);
    expect(dup.status).toBe(409);
    const count = await t.db.selectFrom('payments').selectAll().where('idempotency_key', '=', 'pay-dup-1').execute();
    expect(count).toHaveLength(1);
  });

  it('مبلغ نامعتبر/صفر → 400', async () => {
    const { student1 } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, methodId: 1, amount: '0', idempotencyKey: 'pay-zero-1',
    });
    expect(res.status).toBe(400);
    const bad = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, methodId: 1, amount: 'abc', idempotencyKey: 'pay-bad-1',
    });
    expect(bad.status).toBe(400);
  });

  it('approve/reject/reverse — با ledger و audit', async () => {
    const { student1, enrollmentId } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    // pending
    const created = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, enrollmentId, methodId: 1, amount: '200000', idempotencyKey: 'pay-pend-1', status: 'pending',
    });
    expect(created.status).toBe(201);
    const pid = created.body.paymentId;
    // approve
    const appr = await agent.post(`/finance/payments/${pid}/approve`).set('X-CSRF-Token', csrf).send({});
    expect(appr.status).toBe(200);
    let pay = await t.db.selectFrom('payments').selectAll().where('id', '=', pid).executeTakeFirstOrThrow();
    expect(pay.status).toBe('approved');
    // reverse
    const rev = await agent.post(`/finance/payments/${pid}/reverse`).set('X-CSRF-Token', csrf).send({ reason: 'تست برگشت' });
    expect(rev.status).toBe(200);
    pay = await t.db.selectFrom('payments').selectAll().where('id', '=', pid).executeTakeFirstOrThrow();
    expect(pay.status).toBe('reversed');
    // ledger: credit + reversal → balance_after صفر
    const ledger = await t.db.selectFrom('ledger_entries').selectAll().where('payment_id', '=', pid).orderBy('id').execute();
    expect(ledger).toHaveLength(2);
    expect(ledger[0].entry_type).toBe('credit');
    expect(ledger[1].entry_type).toBe('reversal');
    expect(String(ledger[1].balance_after)).toBe('0');
    // double reverse → 400
    const rev2 = await agent.post(`/finance/payments/${pid}/reverse`).set('X-CSRF-Token', csrf).send({});
    expect(rev2.status).toBe(400);
    // audits
    const actions = (await t.db.selectFrom('audit_log').select('action').where('entity_type', '=', 'payment').execute()).map((r) => r.action);
    expect(actions).toContain('payment_approved');
    expect(actions).toContain('payment_reversed');
  });

  it('reject پرداخت در انتظار + audit', async () => {
    const { student1 } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const created = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, methodId: 1, amount: '100000', idempotencyKey: 'pay-rej-1', status: 'pending',
    });
    const pid = created.body.paymentId;
    const rej = await agent.post(`/finance/payments/${pid}/reject`).set('X-CSRF-Token', csrf).send({ note: 'رسید نامعتبر' });
    expect(rej.status).toBe(200);
    const pay = await t.db.selectFrom('payments').selectAll().where('id', '=', pid).executeTakeFirstOrThrow();
    expect(pay.status).toBe('rejected');
    expect(pay.note).toBe('رسید نامعتبر');
    // ledger shouldn't exist for rejected
    const ledger = await t.db.selectFrom('ledger_entries').selectAll().where('payment_id', '=', pid).execute();
    expect(ledger).toHaveLength(0);
  });

  it('ثبت‌نام replayed — پرداخت برای ثبت‌نام دیگری → 400', async () => {
    const { student1 } = await setupClassroom(t);
    const other = await seedStudent(t, 'ST-2', '09120000012');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: other, enrollmentId: 1, methodId: 1, amount: '100000', idempotencyKey: 'pay-wrong-1',
    });
    expect(res.status).toBe(400);
    expect(student1).toBeGreaterThan(0);
  });
});

describe('فاز ۴ — اقساط', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('ایجاد برنامه‌ی ۴ قسط +سررسید ماهانه', async () => {
    const { enrollmentId } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const res = await agent.post('/finance/installments/schedule').set('X-CSRF-Token', csrf).send({
      enrollmentId, count: 4, firstDueDate: '2026-02-01',
    });
    expect(res.status).toBe(201);
    expect(res.body.each).toBe('250000'); // 1000000 / 4
    const rows = await t.db.selectFrom('installments').selectAll().where('enrollment_id', '=', enrollmentId).orderBy('due_date').execute();
    expect(rows).toHaveLength(4);
    expect(rows[0].due_date).toBe('2026-02-01');
    expect(rows[1].due_date).toBe('2026-03-01');
    expect(rows[3].due_date).toBe('2026-05-01');
    const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
    expect(sum).toBe(1000000);
  });

  it('پرداخت → تخصیص خودکار به قدیمی‌ترین قسط‌ها', async () => {
    const { student1, enrollmentId } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    await agent.post('/finance/installments/schedule').set('X-CSRF-Token', csrf).send({
      enrollmentId, count: 4, firstDueDate: '2026-02-01',
    });
    // پرداخت ۶۰۰۰۰۰ → ۲ قسط کامل + ۱۰۰۰۰۰ از سومی
    await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, enrollmentId, methodId: 1, amount: '600000', idempotencyKey: 'pay-inst-1',
    });
    const rows = await t.db.selectFrom('installments').selectAll().where('enrollment_id', '=', enrollmentId).orderBy('due_date').execute();
    expect(rows[0].status).toBe('paid');
    expect(rows[1].status).toBe('paid');
    expect(rows[2].status).toBe('partial');
    expect(String(rows[2].paid_amount)).toBe('100000');
    expect(rows[3].status).toBe('pending');
    // گزارش اقساط
    const rep = await agent.get('/finance/installments');
    expect(rep.status).toBe(200);
    expect(rep.body.data).toHaveLength(4);
    const pending = await agent.get('/finance/installments?status=pending');
    expect(pending.body.data).toHaveLength(1); // فقط قسط چهارم
    const partial = await agent.get('/finance/installments?status=partial');
    expect(partial.body.data).toHaveLength(1); // قسط سوم
  });
});

describe('فاز ۴ — رسید کارت‌به‌کارت (REQ-P4-03)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  async function uploadReceipt(t: TestApp, student1: number, enrollmentId: number, key: string) {
    await makeStudentUser(t, 'student_1', student1);
    const sagent = await loginAgent(t.app, 'student_1', 'Student123');
    const csrf = await csrfOf(sagent);
    const res = await sagent
      .post('/panel/student/receipts')
      .set('X-CSRF-Token', csrf)
      .field('enrollmentId', String(enrollmentId))
      .field('amount', '۵۰۰۰۰۰')
      .field('idempotencyKey', key)
      .attach('file', PNG_1PX, 'receipt.png');
    expect(res.status).toBe(201);
    return res.body.receiptId;
  }

  it('تأیید رسید → پرداخت approved + ledger + موجودی به‌روز', async () => {
    const { student1, enrollmentId } = await setupClassroom(t);
    const receiptId = await uploadReceipt(t, student1, enrollmentId, 'rcpt-approve-1');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    // فهرست در انتظار
    const list = await agent.get('/finance/receipts?status=pending');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(Number(list.body.data[0].id)).toBe(receiptId);
    // HTML صفحه
    const html = await agent.get('/finance/receipts').set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('رسیدهای کارت‌به‌کارت');
    // تأیید
    const rev = await agent.post(`/finance/receipts/${receiptId}/review`).set('X-CSRF-Token', csrf).send({ action: 'approve' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('approved');
    expect(rev.body.paymentId).toBeGreaterThan(0);
    // پرداخت مرتبط
    const pay = await t.db.selectFrom('payments').selectAll().where('id', '=', rev.body.paymentId).executeTakeFirstOrThrow();
    expect(pay.status).toBe('approved');
    expect(String(pay.amount)).toBe('500000');
    expect(pay.method_id).toBe(2); // کارت‌به‌کارت
    // رسید
    const receipt = await t.db.selectFrom('card_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
    expect(receipt.status).toBe('approved');
    expect(Number(receipt.payment_id)).toBe(rev.body.paymentId);
    // ledger + موجودی
    const ledger = await t.db.selectFrom('ledger_entries').selectAll().where('payment_id', '=', rev.body.paymentId).execute();
    expect(ledger).toHaveLength(1);
    await makeStudentUser(t, 'student_f', student1);
    const fin = await loginAgent(t.app, 'student_f', 'Student123').then((a) => a.get('/panel/student/finance'));
    expect(fin.body.data.enrollments[0].paid).toBe('500000');
    // audit
    const audits = await t.db.selectFrom('audit_log').selectAll().where('action', '=', 'receipt_approved').execute();
    expect(audits.length).toBe(1);
  });

  it('بررسی دوباره → 400 + رد رسید', async () => {
    const { student1, enrollmentId } = await setupClassroom(t);
    const receiptId = await uploadReceipt(t, student1, enrollmentId, 'rcpt-review-1');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const first = await agent.post(`/finance/receipts/${receiptId}/review`).set('X-CSRF-Token', csrf).send({ action: 'approve' });
    expect(first.status).toBe(200);
    const second = await agent.post(`/finance/receipts/${receiptId}/review`).set('X-CSRF-Token', csrf).send({ action: 'reject' });
    expect(second.status).toBe(400);
  });

  it('رد رسید → وضعیت rejected + audit', async () => {
    const { student1, enrollmentId } = await setupClassroom(t);
    const receiptId = await uploadReceipt(t, student1, enrollmentId, 'rcpt-reject-1');
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    const rev = await agent.post(`/finance/receipts/${receiptId}/review`).set('X-CSRF-Token', csrf).send({ action: 'reject', note: 'مغایرت مبلغ' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('rejected');
    const receipt = await t.db.selectFrom('card_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
    expect(receipt.status).toBe('rejected');
    //بدون پرداخت
    const pays = await t.db.selectFrom('payments').selectAll().where('idempotency_key', '=', `receipt-${receiptId}`).execute();
    expect(pays).toHaveLength(0);
  });
});

describe('فاز ۴ — گزارش‌های مالی (REQ-P4-04)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('درآمد per روش + بدهکاران + گزارش کلاس', async () => {
    const { classId, student1, enrollmentId } = await setupClassroom(t);
    const agent = await loginAgent(t.app);
    const csrf = await csrfOf(agent);
    await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, enrollmentId, methodId: 1, amount: '300000', idempotencyKey: 'rep-pay-1',
    });
    await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, enrollmentId, methodId: 2, amount: '200000', idempotencyKey: 'rep-pay-2',
    });
    // پرداخت ردشده — در درآمد حساب نمی‌شود
    const rej = await agent.post('/finance/payments').set('X-CSRF-Token', csrf).send({
      studentId: student1, enrollmentId, methodId: 1, amount: '999000', idempotencyKey: 'rep-pay-3', status: 'pending',
    });
    await agent.post(`/finance/payments/${rej.body.paymentId}/reject`).set('X-CSRF-Token', csrf).send({});
    const rep = await agent.get('/finance/reports');
    expect(rep.status).toBe(200);
    expect(rep.body.data.revenue.total).toBe('500000');
    const cash = rep.body.data.revenue.byMethod.find((m: { type: string }) => m.type === 'cash');
    expect(cash.total).toBe('300000');
    // بدهکاران — مانده ۵۰۰۰۰۰
    expect(rep.body.data.debtors).toHaveLength(1);
    expect(rep.body.data.debtors[0].balance).toBe('500000');
    // گزارش کلاس
    const cls = await agent.get(`/finance/reports/class/${classId}`);
    expect(cls.status).toBe(200);
    expect(cls.body.data[0].balance).toBe('500000');
    // HTML
    const html = await agent.get('/finance/reports').set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('گزارش‌های مالی');
    // dashboard مالی — صفحه پرداخت‌ها HTML
    const payHtml = await agent.get('/finance/payments').set('Accept', 'text/html');
    expect(payHtml.status).toBe(200);
    expect(payHtml.text).toContain('پرداخت‌ها');
  });
});

describe('فاز ۴ — PaymentGateway (REQ-P4-05)', () => {
  it('FakeGateway — createSession + verify (mock)', async () => {
    const gw = new FakeGateway();
    const s = await gw.createSession({ amount: '100000', description: 'تست', callbackUrl: 'https://example.com/cb' });
    expect(s.sessionId).toMatch(/^fake-/);
    expect(s.url).toContain('fake_session=');
    expect(s.amount).toBe('100000');
    const v = await gw.verify({ sessionId: s.sessionId, authority: 'A123' });
    expect(v.ok).toBe(true);
    expect(v.refId).toBe('A123');
  });

  it('getGateway — FakeGateway پیش‌فرض', async () => {
    const t = await createTestApp();
    const gw = getGateway(t.config);
    expect(gw.name).toBe('fake');
    await t.cleanup();
  });
});

describe('فاز ۴ — دسترسی مالی (REQ-P4-04)', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.cleanup(); });

  it('استاد و فراگیر به /finance دسترسی ندارند — 403', async () => {
    const { student1 } = await setupClassroom(t);
    const teacherId = await t.db
      .insertInto('teachers')
      .values({
        code: 'T-1', first_name: 'محمد', last_name: 'استاد', phone: '09120000001',
        specialties: '[]', status: 'active', created_at: nowDb(), updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.insertId));
    const tUid = await createUser(t, 'teacher_x', ['teacher'], 'Teacher123');
    await t.db.updateTable('teachers').set({ user_id: tUid }).where('id', '=', teacherId).execute();
    await makeStudentUser(t, 'student_1', student1);
    const tagent = await loginAgent(t.app, 'teacher_x', 'Teacher123');
    expect((await tagent.get('/finance/payments')).status).toBe(403);
    expect((await tagent.get('/finance/reports')).status).toBe(403);
    expect((await tagent.get('/finance/receipts')).status).toBe(403);
    const sagent = await loginAgent(t.app, 'student_1', 'Student123');
    expect((await sagent.get('/finance/payments')).status).toBe(403);
    expect((await sagent.get('/finance/installments')).status).toBe(403);
  });

  it('بدون ورود → 401', async () => {
    const anon = request.agent(t.app);
    expect((await anon.get('/finance/payments')).status).toBe(401);
    expect((await anon.get('/finance/reports')).status).toBe(401);
  });
});
