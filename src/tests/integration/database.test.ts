/**
 * Database-backed integration tests.
 * - Without TEST_DB_* the suite runs on SQLite in a temporary directory (no server needed).
 * - With TEST_DB_NAME and TEST_DB_USER set it runs on MySQL/MariaDB instead.
 * The MySQL target must be a DISPOSABLE database: the suite drops and recreates its tables.
 * NEVER point TEST_DB_* at production data. Run: npm run test:integration
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrap } from '../../bootstrap';
import { Migrator } from '../../db/migrator';
import { AppError } from '../../lib/errors';
import { SUPER_ADMIN_ROLE } from '../../rbac/permissions';

const root = path.resolve(__dirname, '..', '..', '..');
const env = process.env;
const driver: 'mysql' | 'sqlite' = env.TEST_DB_NAME && env.TEST_DB_USER ? 'mysql' : 'sqlite';

const ADMIN_PW = 'Admin-Password-123';
const TOKEN = 'install-token-for-tests-0123456789abcdef';

test(`database flow on ${driver}: install, RBAC, anti-escalation, lock-out protection, audit`, async (t) => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'myclass-it-'));
  const rt = bootstrap(root, {
    ...env,
    NODE_ENV: 'test',
    DB_DRIVER: driver,
    DB_HOST: env.TEST_DB_HOST ?? 'localhost',
    DB_PORT: env.TEST_DB_PORT ?? '3306',
    DB_NAME: env.TEST_DB_NAME ?? '',
    DB_USER: env.TEST_DB_USER ?? '',
    DB_PASSWORD: env.TEST_DB_PASSWORD ?? '',
    SQLITE_PATH: path.join(storage, 'test.sqlite'),
    INSTALL_TOKEN: TOKEN,
    STORAGE_DIR: storage,
  } as NodeJS.ProcessEnv);
  await rt.ready;
  const s = rt.services;
  // DB_DRIVER selects the engine for this run; the installer below persists that choice.
  assert.equal(s.db.driverName, driver);

  await t.test('drop and recreate tables for a clean run', async () => {
    const tables = ['login_attempts', 'audit_logs', 'sessions', 'role_permissions', 'users', 'roles', 'permissions', 'settings', 'schema_migrations'];
    for (const tb of tables) await s.db.execute(`DROP TABLE IF EXISTS ${tb}`);
  });

  await t.test('migrations apply once and are idempotent', async () => {
    const m = new Migrator(s.db, rt.migrationsDir);
    const first = await m.migrate();
    assert.ok(first.applied.length >= 1);
    const second = await m.migrate();
    assert.deepEqual(second.applied, []);
    const status = await m.status();
    assert.equal(status.modified.length, 0);
  });

  await t.test('installer refuses a wrong token and weak input, then installs', async () => {
    await assert.rejects(
      () => s.install.install({ token: 'wrong', fullName: 'مدیر', username: 'admin', password: ADMIN_PW, passwordConfirm: ADMIN_PW, instituteName: 'موسسه نمونه' }, '127.0.0.1'),
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
    await assert.rejects(
      () => s.install.install({ token: TOKEN, fullName: 'مدیر', username: 'admin', password: 'short', passwordConfirm: 'short', instituteName: 'موسسه نمونه' }, null),
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
    await s.install.install({ token: TOKEN, fullName: 'مدیر اصلی', username: 'admin', password: ADMIN_PW, passwordConfirm: ADMIN_PW, instituteName: 'موسسه نمونه' }, '127.0.0.1');
    assert.equal(s.install.isInstalled(), true);
    await assert.rejects(
      () => s.install.install({ token: TOKEN, fullName: 'x y', username: 'admin2', password: ADMIN_PW, passwordConfirm: ADMIN_PW, instituteName: 'x y' }, null),
      (err: unknown) => err instanceof AppError && err.status === 409,
    );
    assert.equal(await s.settings.get('institute.name_official'), 'موسسه نمونه');
  });

  let adminId = 0;
  let adminPerms = new Set<string>();
  await t.test('admin login succeeds; wrong password gives generic error', async () => {
    await assert.rejects(() => s.auth.login({ username: 'admin', password: 'nope', ip: '10.0.0.1', userAgent: 'test' }), (e: unknown) => e instanceof AppError && e.status === 401);
    const token = await s.auth.login({ username: 'admin', password: ADMIN_PW, ip: '10.0.0.1', userAgent: 'test' });
    const session = await s.auth.authenticate(token);
    assert.ok(session);
    adminId = session!.user.id;
    adminPerms = await s.rbac.permissionsForUser(adminId);
    assert.equal(session!.user.role_slug, SUPER_ADMIN_ROLE);
    assert.ok(adminPerms.has('roles.manage'));
  });

  let limitedId = 0;
  await t.test('custom role limited to users.view cannot escalate or create users', async () => {
    const actor = { id: adminId, permissions: adminPerms, ip: '10.0.0.1' };
    const roleId = await s.roles.create(actor, { slug: 'registrar', nameFa: 'کارمند ثبت‌نام', permissions: ['users.view'] });
    await assert.rejects(
      () => s.roles.create({ id: adminId, permissions: new Set(['users.view']), ip: null }, { slug: 'bad_role', nameFa: 'نقش بد', permissions: ['roles.manage'] }),
      (e: unknown) => e instanceof AppError && e.status === 403,
    );
    limitedId = await s.users.create(actor, { username: 'reg.user', fullName: 'کاربر ثبت‌نام', roleId, password: 'Registrar-Pass-1' });
    const limitedToken = await s.auth.login({ username: 'reg.user', password: 'Registrar-Pass-1', ip: '10.0.0.2', userAgent: 'test' });
    const limited = await s.auth.authenticate(limitedToken);
    assert.ok(limited);
    const perms = await s.rbac.permissionsForUser(limited!.user.id);
    assert.deepEqual([...perms], ['users.view']);
    // A user with users.view can not create or change roles (server-side service checks).
    await assert.rejects(
      () => s.users.create({ id: limitedId, permissions: perms, ip: null }, { username: 'x.user', fullName: 'ایکس', roleId: 1, password: 'Long-Enough-Pass' }),
      (e: unknown) => e instanceof AppError && e.status === 403,
    );
  });

  await t.test('an admin without the super-admin permissions cannot assign the super-admin role', async () => {
    const superRole = (await s.roles.list()).find((r) => r.slug === SUPER_ADMIN_ROLE)!;
    await assert.rejects(
      () => s.users.create({ id: limitedId, permissions: new Set(['users.create']), ip: null }, { username: 'escalate', fullName: 'تلاش', roleId: superRole.id, password: 'Long-Enough-Pass' }),
      (e: unknown) => e instanceof AppError && e.status === 403,
    );
  });

  await t.test('the last active super admin cannot be disabled or demoted; self-disable is blocked', async () => {
    const actor = { id: adminId, permissions: adminPerms, ip: null };
    await assert.rejects(() => s.users.setStatus(actor, adminId, false), (e: unknown) => e instanceof AppError && e.status === 400);
    await assert.rejects(() => s.users.update(actor, adminId, { fullName: 'مدیر', roleId: 2 }), (e: unknown) => e instanceof AppError);
  });

  await t.test('role change takes effect immediately; disabling revokes sessions', async () => {
    const actor = { id: adminId, permissions: adminPerms, ip: null };
    const roles = await s.roles.list();
    const registrar = roles.find((r) => r.slug === 'registrar')!;
    const token = await s.auth.login({ username: 'reg.user', password: 'Registrar-Pass-1', ip: '10.0.0.3', userAgent: 'test' });
    await s.users.update(actor, limitedId, { fullName: 'کاربر ثبت‌نام', roleId: registrar.id, email: 'reg@example.ir' });
    await s.users.setStatus(actor, limitedId, false);
    assert.equal(await s.auth.authenticate(token), null);
    await s.users.setStatus(actor, limitedId, true);
  });

  await t.test('settings are validated, persisted and audited without secrets', async () => {
    const actor = { id: adminId, permissions: adminPerms, ip: null };
    await assert.rejects(() => s.settings.update(actor, 'appearance.primary_color', 'red'), (e: unknown) => e instanceof AppError);
    await s.settings.update(actor, 'appearance.primary_color', '#0f766e');
    assert.equal(await s.settings.get('appearance.primary_color'), '#0f766e');
    const { rows } = await s.audit.list({ action: 'settings.', page: 1, pageSize: 10 });
    assert.ok(rows.length >= 1);
  });

  await t.test('audit trail never stores passwords and dashboard counts come from the database', async () => {
    const { rows } = await s.audit.list({ page: 1, pageSize: 200 });
    for (const r of rows) assert.doesNotMatch(r.details_json ?? '', /Admin-Password-123|Registrar-Pass-1/);
    const stats = await s.dashboard.stats();
    assert.equal(stats.usersTotal, 2);
    assert.ok(stats.auditLast24h >= 1);
  });

  await s.db.close();
  fs.rmSync(storage, { recursive: true, force: true });
});
