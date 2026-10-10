/** Integration tests — in-app notifications (REQ-X-12): scoping, mark-read, IDOR, event-driven. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';

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

async function seedStudentWithUser(t: TestApp, code: string, userId: number) {
  const now = nowDb();
  const res = await t.db
    .insertInto('students')
    .values({
      code, first_name: 'علی', last_name: 'رضایی', phone: `0912${code.slice(-7)}`,
      status: 'active', user_id: userId, created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

async function seedClassWithEnrollment(t: TestApp, studentId: number) {
  const now = nowDb();
  const cls = await t.db
    .insertInto('classes')
    .values({
      title: 'کلاس اعلان', code: 'CL-N', capacity: 10, fee: '1000000', status: 'running',
      weekdays: '[]', prereg_enabled: 0, created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  const classId = Number(cls.insertId);
  const enr = await t.db
    .insertInto('enrollments')
    .values({
      class_id: classId, student_id: studentId, fee_amount: '1000000', discount_amount: '0',
      status: 'active', enrolled_at: now, created_at: now, updated_at: now,
    })
    .executeTakeFirstOrThrow();
  return { classId, enrollmentId: Number(enr.insertId) };
}

describe('اعلان‌های داخل برنامه (REQ-X-12)', () => {
  let t: TestApp;
  let admin: request.SuperTest<request.Test>;
  let adminCsrf: string;

  beforeEach(async () => {
    t = await createTestApp();
    admin = await loginAgent(t.app);
    adminCsrf = await csrfOf(admin);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('service — notify/list scoped to self + unreadCount', async () => {
    const svc = new NotificationsService(t.db);
    const u1 = await createUser(t, 'n_user1', ['student']);
    const u2 = await createUser(t, 'n_user2', ['student']);
    await svc.notify(u1, { type: 'test', title: 'سلام ۱' });
    await svc.notify(u1, { type: 'test', title: 'سلام ۲' });
    await svc.notify(u2, { type: 'test', title: 'دیگری' });
    const rows1 = await svc.list(u1);
    expect(rows1).toHaveLength(2);
    expect(rows1.every((r) => Number(r.user_id) === u1)).toBe(true);
    expect(await svc.unreadCount(u1)).toBe(2);
    expect(await svc.unreadCount(u2)).toBe(1);
  });

  it('service — markRead only for owner; not-found otherwise', async () => {
    const svc = new NotificationsService(t.db);
    const u1 = await createUser(t, 'n_user1', ['student']);
    const u2 = await createUser(t, 'n_user2', ['student']);
    const id = await svc.notify(u1, { type: 'test', title: 'mine' });
    await expect(svc.markRead(id, u2)).rejects.toMatchObject({ statusCode: 404 });
    await svc.markRead(id, u1);
    expect(await svc.unreadCount(u1)).toBe(0);
    // markAllRead
    await svc.notify(u1, { type: 'test', title: 'a' });
    await svc.notify(u1, { type: 'test', title: 'b' });
    expect(await svc.markAllRead(u1)).toBe(2);
    expect(await svc.unreadCount(u1)).toBe(0);
  });

  it('routes — list JSON/HTML + unread-count + mark read via POST (CSRF)', async () => {
    const svc = new NotificationsService(t.db);
    const u1 = await createUser(t, 'n_user1', ['student']);
    const u2 = await createUser(t, 'n_user2', ['student']);
    const agent = await loginAgent(t.app, 'n_user1', 'User12345');
    const csrf = await csrfOf(agent);
    await svc.notify(u2, { type: 'test', title: 'x' }); // other user — must not appear
    const nid = await svc.notify(u1, { type: 'test', title: 'اعلان تستی', link: '/panel/student' });
    const list = await agent.get('/notifications');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].title).toBe('اعلان تستی');
    const cnt = await agent.get('/notifications/unread-count');
    expect(cnt.body.data.count).toBe(1);
    const read = await agent.post(`/notifications/${nid}/read`).set('X-CSRF-Token', csrf).send({});
    expect(read.status).toBe(200);
    expect((await agent.get('/notifications/unread-count')).body.data.count).toBe(0);
    // HTML page renders
    const html = await agent.get('/notifications').set('Accept', 'text/html');
    expect(html.status).toBe(200);
    expect(html.text).toContain('اعلان تستی');
  });

  it('IDOR — student cannot read/mark another user notification (404)', async () => {
    const svc = new NotificationsService(t.db);
    const u1 = await createUser(t, 'n_user1', ['student']);
    const u2 = await createUser(t, 'n_user2', ['student']);
    const otherId = await svc.notify(u2, { type: 'test', title: 'private' }); // other user's notification
    const agent = await loginAgent(t.app, 'n_user1', 'User12345');
    const list = await agent.get('/notifications');
    expect(list.body.data).toHaveLength(0);
    const csrf = await csrfOf(agent);
    const res = await agent.post(`/notifications/${otherId}/read`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(404);
    expect(u1).not.toBe(u2);
  });

  it('event-driven — approved payment creates a notification for the student user', async () => {
    const userId = await createUser(t, 'n_student', ['student']);
    const studentId = await seedStudentWithUser(t, 'ST-N1', userId);
    const { enrollmentId } = await seedClassWithEnrollment(t, studentId);
    const pay = await admin.post('/finance/payments').set('X-CSRF-Token', adminCsrf).send({
      studentId, enrollmentId, methodId: 1, amount: '250000', idempotencyKey: 'notif-pay-1',
    });
    expect(pay.status).toBe(201);
    const rows = await t.db.selectFrom('notifications').selectAll().where('user_id', '=', userId).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('payment_approved');
    expect(rows[0].link).toBe('/panel/student/finance');
  });

  it('event-driven — notifyStudent returns null for unlinked student (no crash)', async () => {
    const svc = new NotificationsService(t.db);
    const now = nowDb();
    const res = await t.db
      .insertInto('students')
      .values({
        code: 'ST-NL', first_name: 'بدون', last_name: 'کاربر', phone: '09120000099',
        status: 'active', user_id: null, created_at: now, updated_at: now,
      })
      .executeTakeFirstOrThrow();
    const sid = Number(res.insertId);
    expect(await svc.notifyStudent(sid, { type: 'test', title: 'x' })).toBeNull();
  });
});
