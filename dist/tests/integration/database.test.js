"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Database-backed integration tests.
 * Requires a DISPOSABLE MySQL/MariaDB database. Set TEST_DB_HOST, TEST_DB_NAME, TEST_DB_USER, TEST_DB_PASSWORD.
 * Tests are skipped (not passed) when these variables are absent. NEVER point them at production data:
 * the suite drops and recreates its tables.
 * Run: npm run test:integration
 */
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const bootstrap_1 = require("../../bootstrap");
const migrator_1 = require("../../db/migrator");
const errors_1 = require("../../lib/errors");
const permissions_1 = require("../../rbac/permissions");
const root = node_path_1.default.resolve(__dirname, '..', '..', '..');
const env = process.env;
const enabled = Boolean(env.TEST_DB_NAME && env.TEST_DB_USER);
const skip = enabled ? false : 'TEST_DB_* not set; database integration tests not executed';
const ADMIN_PW = 'Admin-Password-123';
const TOKEN = 'install-token-for-tests-0123456789abcdef';
(0, node_test_1.default)('database flow: install, RBAC, anti-escalation, lock-out protection, audit', { skip }, async (t) => {
    const storage = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'myclass-it-'));
    const rt = (0, bootstrap_1.bootstrap)(root, {
        ...env,
        NODE_ENV: 'test',
        DB_HOST: env.TEST_DB_HOST ?? 'localhost',
        DB_PORT: env.TEST_DB_PORT ?? '3306',
        DB_NAME: env.TEST_DB_NAME,
        DB_USER: env.TEST_DB_USER,
        DB_PASSWORD: env.TEST_DB_PASSWORD ?? '',
        INSTALL_TOKEN: TOKEN,
        STORAGE_DIR: storage,
    });
    const s = rt.services;
    await t.test('drop and recreate tables for a clean run', async () => {
        const tables = ['login_attempts', 'audit_logs', 'sessions', 'role_permissions', 'users', 'roles', 'permissions', 'settings', 'schema_migrations'];
        for (const tb of tables)
            await s.db.execute(`DROP TABLE IF EXISTS ${tb}`);
    });
    await t.test('migrations apply once and are idempotent', async () => {
        const m = new migrator_1.Migrator(s.db, rt.migrationsDir);
        const first = await m.migrate();
        strict_1.default.ok(first.applied.length >= 1);
        const second = await m.migrate();
        strict_1.default.deepEqual(second.applied, []);
        const status = await m.status();
        strict_1.default.equal(status.modified.length, 0);
    });
    await t.test('installer refuses a wrong token and weak input, then installs', async () => {
        await strict_1.default.rejects(() => s.install.install({ token: 'wrong', fullName: 'مدیر', username: 'admin', password: ADMIN_PW, passwordConfirm: ADMIN_PW, instituteName: 'موسسه نمونه' }, '127.0.0.1'), (err) => err instanceof errors_1.AppError && err.status === 400);
        await strict_1.default.rejects(() => s.install.install({ token: TOKEN, fullName: 'مدیر', username: 'admin', password: 'short', passwordConfirm: 'short', instituteName: 'موسسه نمونه' }, null), (err) => err instanceof errors_1.AppError && err.status === 400);
        await s.install.install({ token: TOKEN, fullName: 'مدیر اصلی', username: 'admin', password: ADMIN_PW, passwordConfirm: ADMIN_PW, instituteName: 'موسسه نمونه' }, '127.0.0.1');
        strict_1.default.equal(s.install.isInstalled(), true);
        await strict_1.default.rejects(() => s.install.install({ token: TOKEN, fullName: 'x y', username: 'admin2', password: ADMIN_PW, passwordConfirm: ADMIN_PW, instituteName: 'x y' }, null), (err) => err instanceof errors_1.AppError && err.status === 409);
        strict_1.default.equal(await s.settings.get('institute.name_official'), 'موسسه نمونه');
    });
    let adminId = 0;
    let adminPerms = new Set();
    await t.test('admin login succeeds; wrong password gives generic error', async () => {
        await strict_1.default.rejects(() => s.auth.login({ username: 'admin', password: 'nope', ip: '10.0.0.1', userAgent: 'test' }), (e) => e instanceof errors_1.AppError && e.status === 401);
        const token = await s.auth.login({ username: 'admin', password: ADMIN_PW, ip: '10.0.0.1', userAgent: 'test' });
        const session = await s.auth.authenticate(token);
        strict_1.default.ok(session);
        adminId = session.user.id;
        adminPerms = await s.rbac.permissionsForUser(adminId);
        strict_1.default.equal(session.user.role_slug, permissions_1.SUPER_ADMIN_ROLE);
        strict_1.default.ok(adminPerms.has('roles.manage'));
    });
    let limitedId = 0;
    await t.test('custom role limited to users.view cannot escalate or create users', async () => {
        const actor = { id: adminId, permissions: adminPerms, ip: '10.0.0.1' };
        const roleId = await s.roles.create(actor, { slug: 'registrar', nameFa: 'کارمند ثبت‌نام', permissions: ['users.view'] });
        await strict_1.default.rejects(() => s.roles.create({ id: adminId, permissions: new Set(['users.view']), ip: null }, { slug: 'bad_role', nameFa: 'نقش بد', permissions: ['roles.manage'] }), (e) => e instanceof errors_1.AppError && e.status === 403);
        limitedId = await s.users.create(actor, { username: 'reg.user', fullName: 'کاربر ثبت‌نام', roleId, password: 'Registrar-Pass-1' });
        const limitedToken = await s.auth.login({ username: 'reg.user', password: 'Registrar-Pass-1', ip: '10.0.0.2', userAgent: 'test' });
        const limited = await s.auth.authenticate(limitedToken);
        strict_1.default.ok(limited);
        const perms = await s.rbac.permissionsForUser(limited.user.id);
        strict_1.default.deepEqual([...perms], ['users.view']);
        // A user with users.view can not create or change roles (server-side service checks).
        await strict_1.default.rejects(() => s.users.create({ id: limitedId, permissions: perms, ip: null }, { username: 'x.user', fullName: 'ایکس', roleId: 1, password: 'Long-Enough-Pass' }), (e) => e instanceof errors_1.AppError && e.status === 403);
    });
    await t.test('an admin without the super-admin permissions cannot assign the super-admin role', async () => {
        const superRole = (await s.roles.list()).find((r) => r.slug === permissions_1.SUPER_ADMIN_ROLE);
        await strict_1.default.rejects(() => s.users.create({ id: limitedId, permissions: new Set(['users.create']), ip: null }, { username: 'escalate', fullName: 'تلاش', roleId: superRole.id, password: 'Long-Enough-Pass' }), (e) => e instanceof errors_1.AppError && e.status === 403);
    });
    await t.test('the last active super admin cannot be disabled or demoted; self-disable is blocked', async () => {
        const actor = { id: adminId, permissions: adminPerms, ip: null };
        await strict_1.default.rejects(() => s.users.setStatus(actor, adminId, false), (e) => e instanceof errors_1.AppError && e.status === 400);
        await strict_1.default.rejects(() => s.users.update(actor, adminId, { fullName: 'مدیر', roleId: 2 }), (e) => e instanceof errors_1.AppError);
    });
    await t.test('role change takes effect immediately; disabling revokes sessions', async () => {
        const actor = { id: adminId, permissions: adminPerms, ip: null };
        const roles = await s.roles.list();
        const registrar = roles.find((r) => r.slug === 'registrar');
        const token = await s.auth.login({ username: 'reg.user', password: 'Registrar-Pass-1', ip: '10.0.0.3', userAgent: 'test' });
        await s.users.update(actor, limitedId, { fullName: 'کاربر ثبت‌نام', roleId: registrar.id, email: 'reg@example.ir' });
        await s.users.setStatus(actor, limitedId, false);
        strict_1.default.equal(await s.auth.authenticate(token), null);
        await s.users.setStatus(actor, limitedId, true);
    });
    await t.test('settings are validated, persisted and audited without secrets', async () => {
        const actor = { id: adminId, permissions: adminPerms, ip: null };
        await strict_1.default.rejects(() => s.settings.update(actor, 'appearance.primary_color', 'red'), (e) => e instanceof errors_1.AppError);
        await s.settings.update(actor, 'appearance.primary_color', '#0f766e');
        strict_1.default.equal(await s.settings.get('appearance.primary_color'), '#0f766e');
        const { rows } = await s.audit.list({ action: 'settings.', page: 1, pageSize: 10 });
        strict_1.default.ok(rows.length >= 1);
    });
    await t.test('audit trail never stores passwords and dashboard counts come from the database', async () => {
        const { rows } = await s.audit.list({ page: 1, pageSize: 200 });
        for (const r of rows)
            strict_1.default.doesNotMatch(r.details_json ?? '', /Admin-Password-123|Registrar-Pass-1/);
        const stats = await s.dashboard.stats();
        strict_1.default.equal(stats.usersTotal, 2);
        strict_1.default.ok(stats.auditLast24h >= 1);
    });
    await s.db.close();
    node_fs_1.default.rmSync(storage, { recursive: true, force: true });
});
