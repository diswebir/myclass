import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from '../../db/database';
import { Migrator } from '../../db/migrator';
import { AuthService, MAX_PASSWORD_LENGTH } from '../../modules/auth/auth.service';
import { AuditService } from '../../modules/audit/audit.service';
import { UsersService } from '../../modules/users/users.service';
import { RolesService } from '../../modules/roles/roles.service';
import { normalizeUsername } from '../../lib/persian';
import { PERMISSIONS, SUPER_ADMIN_ROLE } from '../../rbac/permissions';
import { fakeDb } from './fake-db';

const asDb = (x: unknown) => x as unknown as Database;

// ---------- Migrator: the named lock must be taken and released on ONE connection ----------

function migrationsDir(files: Record<string, string>): string {
  // Migrator reads <root>/<engine>; the fake database reports the MySQL dialect.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myclass-mig-'));
  const dir = path.join(root, 'mysql');
  fs.mkdirSync(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return root;
}

test('migrator: GET_LOCK, every statement and RELEASE_LOCK run on the same pooled connection', async () => {
  const dir = migrationsDir({ '001_a.sql': 'CREATE TABLE a (id INT);\n-- @@\nCREATE TABLE a2 (id INT);\n', '002_b.sql': 'CREATE TABLE b (id INT);\n' });
  const db = fakeDb((sql) => (sql.includes('GET_LOCK') ? [{ got: 1 }] : []));
  const result = await new Migrator(asDb(db), dir).migrate();
  assert.deepEqual(result.applied, ['001_a.sql', '002_b.sql']);

  const lockCalls = db.calls.filter((c) => c.sql.includes('GET_LOCK') || c.sql.includes('RELEASE_LOCK'));
  assert.equal(lockCalls.length, 2);
  const conns = new Set(db.calls.filter((c) => c.conn !== 0).map((c) => c.conn));
  assert.equal(conns.size, 1, 'a session-scoped lock must not be split across connections');
  assert.deepEqual(db.events, ['acquire:1', 'release:1']);
  // Migration statements ran in order on that connection, and each applied file was recorded.
  const ddl = db.calls
    .filter((c) => c.sql.startsWith('CREATE TABLE') && !c.sql.includes('schema_migrations'))
    .map((c) => /CREATE TABLE (\w+)/.exec(c.sql)![1]);
  assert.deepEqual(ddl, ['a', 'a2', 'b']);
  assert.equal(db.calls.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations')).length, 2);
});

test('migrator: the lock is released even when a migration statement fails', async () => {
  const dir = migrationsDir({ '001_a.sql': 'CREATE TABLE a (id INT);\n-- @@\nCREATE TABLE broken (id INT);\n' });
  const db = fakeDb((sql) => {
    if (sql.includes('GET_LOCK')) return [{ got: 1 }];
    if (sql.includes('CREATE TABLE broken')) throw new Error('ER_SYNTAX_ERROR (simulated)');
    return [];
  });
  await assert.rejects(() => new Migrator(asDb(db), dir).migrate(), /simulated/);
  assert.ok(db.calls.some((c) => c.sql.includes('RELEASE_LOCK')), 'RELEASE_LOCK must run on failure');
  assert.deepEqual(db.events, ['acquire:1', 'release:1']);
  assert.ok(!db.calls.some((c) => c.sql.startsWith('INSERT INTO schema_migrations')), 'failed migration is not recorded');
});

test('migrator: a busy lock stops the run before any DDL', async () => {
  const dir = migrationsDir({ '001_a.sql': 'CREATE TABLE a (id INT);\n' });
  const db = fakeDb((sql) => (sql.includes('GET_LOCK') ? [{ got: 0 }] : []));
  await assert.rejects(() => new Migrator(asDb(db), dir).migrate(), /در حال انجام/);
  assert.ok(!db.calls.some((c) => c.sql.startsWith('CREATE TABLE a')));
});

// ---------- Auth: idle timeout, password length, expiry as a real Date ----------

function sessionRow(overrides: Record<string, unknown>) {
  const now = Date.now();
  return {
    session_id: 7,
    last_seen_at: new Date(now - 60_000),
    expires_at: new Date(now + 5 * 3600_000),
    revoked_at: null,
    id: 1,
    username: 'admin',
    full_name: 'مدیر',
    role_id: 1,
    role_slug: SUPER_ADMIN_ROLE,
    status: 'active',
    must_change_password: 0,
    password_hash: 'x',
    ...overrides,
  };
}

test('auth: a session idle longer than the idle timeout is rejected before its absolute expiry', async () => {
  const db = fakeDb((sql) => (sql.includes('FROM sessions s') ? [sessionRow({ last_seen_at: new Date(Date.now() - 3 * 3600_000) })] : []));
  const auth = new AuthService(asDb(db), new AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5, sessionIdleMinutes: 120 });
  assert.equal(await auth.authenticate('some-token'), null);
});

test('auth: an active session inside the idle window is accepted', async () => {
  const db = fakeDb((sql) => (sql.includes('FROM sessions s') ? [sessionRow({})] : []));
  const auth = new AuthService(asDb(db), new AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5, sessionIdleMinutes: 120 });
  const s = await auth.authenticate('some-token');
  assert.equal(s?.sessionId, 7);
});

test('auth: session expiry is computed in JavaScript as a Date, not with INTERVAL ? in a prepared statement', async () => {
  const db = fakeDb();
  const auth = new AuthService(asDb(db), new AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5 });
  await auth.createSession(1, '10.0.0.1', 'ua');
  const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO sessions'))!;
  assert.ok(!/INTERVAL/i.test(insert.sql));
  const expires = insert.params[4] as Date;
  assert.ok(expires instanceof Date);
  const hours = (expires.getTime() - Date.now()) / 3600_000;
  assert.ok(hours > 7.9 && hours <= 8.01, `expected ~8h, got ${hours}`);
});

test('auth: an over-long password is rejected without touching the database (no silent truncation)', async () => {
  const db = fakeDb();
  const auth = new AuthService(asDb(db), new AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5 });
  await assert.rejects(
    () => auth.login({ username: 'admin', password: 'a'.repeat(MAX_PASSWORD_LENGTH + 1), ip: '1.2.3.4', userAgent: null }),
    (e: unknown) => (e as { status?: number }).status === 401,
  );
  assert.equal(db.calls.length, 0);
});

// ---------- Users: consistent usernames, digit-folded search, password cap ----------

test('usernames are normalised the same way everywhere (case, spaces, Persian digits)', () => {
  assert.equal(normalizeUsername('  Admin.User  '), 'admin.user');
  assert.equal(normalizeUsername('user۱۲'), 'user12');
  assert.equal(normalizeUsername('user\u0661\u0662'), 'user12');
});

test('user search folds Persian digits and ignores separators, so ۰۹۱۲-۱۲۳ finds 0912123', async () => {
  const db = fakeDb((sql) => (sql.startsWith('SELECT COUNT') ? [{ n: 0 }] : []));
  const audit = new AuditService(asDb(db));
  const auth = new AuthService(asDb(db), audit, { sessionTtlHours: 8, maxFailures: 5 });
  const users = new UsersService(asDb(db), audit, auth, async () => 10);
  await users.list({ q: '۰۹۱۲-۱۲۳', page: 1, pageSize: 20 });
  const count = db.calls.find((c) => c.sql.includes('COUNT(*)'))!;
  assert.ok(count.params.includes('%0912123%'), JSON.stringify(count.params));
});

test('user creation rejects passwords longer than the cap before any database work', async () => {
  const db = fakeDb();
  const audit = new AuditService(asDb(db));
  const auth = new AuthService(asDb(db), audit, { sessionTtlHours: 8, maxFailures: 5 });
  const users = new UsersService(asDb(db), audit, auth, async () => 10);
  const actor = { id: 1, permissions: new Set(['users.create']), ip: null };
  await assert.rejects(
    () => users.create(actor, { username: 'newuser', fullName: 'کاربر جدید', roleId: 2, password: 'a'.repeat(MAX_PASSWORD_LENGTH + 1) }),
    (e: unknown) => (e as { status?: number }).status === 400,
  );
  assert.equal(db.calls.length, 0);
});

// ---------- Roles: no editing rights you do not hold; super-admin catalogue is exact ----------

function roleResponder(slug: string, current: string[]) {
  return (sql: string) => {
    if (sql.includes('FROM roles r WHERE r.id')) return [{ id: 5, slug, name_fa: 'نقش', description: null, is_system: 0, is_active: 1, user_count: 0, permission_count: current.length }];
    if (sql.includes('JOIN permissions p')) return current.map((code) => ({ code }));
    return [];
  };
}

test('roles: a manager cannot edit a role to strip permissions they do not hold', async () => {
  const db = fakeDb(roleResponder('registrar', ['users.view', 'users.create']));
  const audit = new AuditService(asDb(db));
  const roles = new RolesService(asDb(db), audit);
  const actor = { id: 2, permissions: new Set(['roles.manage', 'users.view']), ip: null };
  await assert.rejects(
    () => roles.update(actor, 5, { nameFa: 'ثبت‌نام', permissions: ['users.view'] }),
    (e: unknown) => (e as { status?: number }).status === 403,
  );
  assert.ok(!db.calls.some((c) => c.sql.startsWith('DELETE FROM role_permissions')), 'no permission rows may change');
});

test('roles: the super administrator catalogue must match exactly, even if the count is equal', async () => {
  const full = PERMISSIONS.map((p) => p.code);
  const db = fakeDb(roleResponder(SUPER_ADMIN_ROLE, full));
  const audit = new AuditService(asDb(db));
  const roles = new RolesService(asDb(db), audit);
  const actor = { id: 1, permissions: new Set(full), ip: null };
  const tampered = [...full.slice(1), 'bogus.permission'];
  await assert.rejects(
    () => roles.update(actor, 5, { nameFa: 'مدیر اصلی', permissions: tampered }),
    (e: unknown) => (e as { code?: string }).code === 'LOCKED_ROLE',
  );
});
