/** تست‌های integration — RBAC: کاربران، نقش‌ها، negative authorization، خودارتقایی. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { TestApp } from '../helpers/app';
import { createTestApp, loginAgent, TEST_ADMIN } from '../helpers/app';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';

async function createUser(t: TestApp, username: string, roles: string[] = []) {
  const hash = await hashPassword('User12345', t.config.BCRYPT_ROUNDS);
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
  const rbac = new (await import('../../src/modules/rbac/rbac.service')).RbacService(t.db);
  for (const slug of roles) {
    const role = await rbac.repo.findRoleBySlug(slug);
    if (role) await t.db.insertInto('user_roles').values({ user_id: userId, role_id: Number(role.id) }).execute();
  }
  return userId;
}

describe('RBAC — دسترسی و مالکیت', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it('مدیرکل — فهرست کاربران', async () => {
    const agent = await loginAgent(t.app);
    const res = await agent.get('/users');
    expect(res.status).toBe(200);
    expect(res.text).toContain(TEST_ADMIN.username);
  });

  it('ایجاد کاربر جدید (API)', async () => {
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const res = await agent
      .post('/users')
      .set('X-CSRF-Token', csrf)
      .send({
        username: 'teacher1',
        fullName: 'استاد یک',
        password: 'Teacher123',
        roleIds: [],
        isActive: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('negative — کاربر student به /users دسترسی ندارد (403)', async () => {
    await createUser(t, 'student1', ['student']);
    const agent = await loginAgent(t.app, 'student1', 'User12345');
    const res = await agent.get('/users');
    expect(res.status).toBe(403);
  });

  it('negative — کاربر teacher به /settings دسترسی ندارد (403)', async () => {
    await createUser(t, 'teacher1', ['teacher']);
    const agent = await loginAgent(t.app, 'teacher1', 'User12345');
    const res = await agent.get('/settings');
    expect(res.status).toBe(403);
  });

  it('negative — کاربر ناشناس به /users → redirect login', async () => {
    const res = await request(t.app).get('/users').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('خودارتقایی — کاربر نمی‌تواند نقش خود را تغییر دهد', async () => {
    const userId = await createUser(t, 'teacher1', ['teacher']);
    const agent = await loginAgent(t.app, 'teacher1', 'User12345');
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const rbac = new (await import('../../src/modules/rbac/rbac.service')).RbacService(t.db);
    const adminRole = await rbac.repo.findRoleBySlug('admin');
    const res = await agent
      .post(`/users/${userId}/roles`)
      .set('X-CSRF-Token', csrf)
      .send({ roleIds: [Number(adminRole!.id)] });
    expect(res.status).toBe(403);
  });

  it('مدیرکل می‌تواند نقش کاربر را تغییر دهد', async () => {
    const userId = await createUser(t, 'teacher1', ['teacher']);
    const agent = await loginAgent(t.app);
    const page = await agent.get('/');
    const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    const rbac = new (await import('../../src/modules/rbac/rbac.service')).RbacService(t.db);
    const financeRole = await rbac.repo.findRoleBySlug('finance');
    const res = await agent
      .post(`/users/${userId}/roles`)
      .set('X-CSRF-Token', csrf)
      .send({ roleIds: [Number(financeRole!.id)] });
    expect(res.status).toBe(200);
    // اثر فوری: کاربر دیگر teacher نیست
    const roles = await rbac.getUserRoleSlugs(userId);
    expect(roles).toEqual(['finance']);
  });

  it('RBAC — اثر فوری: غیرفعال‌سازی کاربر → نشست باطل می‌شود', async () => {
    await createUser(t, 'student1', ['student']);
    const agent = await loginAgent(t.app, 'student1', 'User12345');
    const before = await agent.get('/');
    expect(before.status).toBe(200);
    // غیرفعال‌سازی توسط admin
    const adminAgent = await loginAgent(t.app);
    const row = await t.db.selectFrom('users').select('id').where('username', '=', 'student1').executeTakeFirstOrThrow();
    await t.db.updateTable('users').set({ is_active: 0 }).where('id', '=', Number(row.id)).execute();
    // نشست‌ها باطل می‌شوند
    const sessions = new (await import('../../src/modules/sessions/session.service')).SessionService(t.db, t.config);
    await sessions.revokeAllForUser(Number(row.id));
    const after = await agent.get('/');
    expect(after.status).toBe(302); // redirect به login
  });
});
