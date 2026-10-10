"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * SQLite-specific behaviour, run against a real temporary database file (no server, no MySQL).
 * Covers what the shared flow test does not: LIKE escaping, constraint error mapping, date round-trips,
 * rollback, durability across re-open, and the "not configured" state before the installer runs.
 */
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const bootstrap_1 = require("../../bootstrap");
const database_1 = require("../../db/database");
const sqlite_driver_1 = require("../../db/sqlite-driver");
const errors_1 = require("../../lib/errors");
const permissions_1 = require("../../rbac/permissions");
const root = node_path_1.default.resolve(__dirname, '..', '..', '..');
const TOKEN = 'sqlite-behaviour-token-0123456789abcdef';
const PW = 'Admin-Password-123';
(0, node_test_1.default)('sqlite: behaviour of queries, constraints, dates, transactions and durability', async (t) => {
    const storage = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'myclass-sqlite-'));
    const file = node_path_1.default.join(storage, 'behaviour.sqlite');
    const rt = (0, bootstrap_1.bootstrap)(root, {
        NODE_ENV: 'test',
        DB_DRIVER: 'sqlite',
        SQLITE_PATH: file,
        INSTALL_TOKEN: TOKEN,
        STORAGE_DIR: storage,
    });
    await rt.ready;
    const s = rt.services;
    await t.test('before any engine is chosen, queries fail with DB_NOT_CONFIGURED', async () => {
        const bare = new database_1.Database();
        strict_1.default.equal(bare.isConnected, false);
        await strict_1.default.rejects(() => bare.query('SELECT 1'), (e) => e instanceof database_1.DbNotConfiguredError && e.code === 'DB_NOT_CONFIGURED');
    });
    await s.install.install({ token: TOKEN, fullName: 'مدیر اصلی', username: 'admin', password: PW, passwordConfirm: PW, instituteName: 'موسسه' }, '127.0.0.1');
    const token = await s.auth.login({ username: 'admin', password: PW, ip: '10.0.0.1', userAgent: 'test' });
    const session = await s.auth.authenticate(token);
    strict_1.default.ok(session);
    const actor = { id: session.user.id, permissions: await s.rbac.permissionsForUser(session.user.id), ip: '10.0.0.1' };
    await t.test('dates come back as UTC Date objects, not local-time strings', async () => {
        const [row] = await s.db.query('SELECT created_at, expires_at FROM sessions LIMIT 1');
        strict_1.default.ok(row.expires_at instanceof Date, 'expires_at is a Date');
        strict_1.default.ok(row.created_at instanceof Date, 'created_at is a Date');
        const drift = Math.abs(row.expires_at.getTime() - (Date.now() + 8 * 3600 * 1000));
        strict_1.default.ok(drift < 60 * 1000, 'expiry is 8 hours from now (UTC instant), not shifted by the local timezone');
        const { rows } = await s.audit.list({ page: 1, pageSize: 5 });
        strict_1.default.ok(rows[0].occurred_at instanceof Date);
    });
    const roleBySlug = async (slug) => (await s.roles.list()).find((r) => r.slug === slug).id;
    const instituteRole = await roleBySlug('institute_admin');
    await t.test('user search escapes LIKE wildcards: "_" and "%" are literal characters', async () => {
        await s.users.create(actor, { username: 'a_b.user', fullName: 'کاربر یک', roleId: instituteRole, password: 'Long-Enough-Pass' });
        await s.users.create(actor, { username: 'axb.user', fullName: 'کاربر دو', roleId: instituteRole, password: 'Long-Enough-Pass' });
        const under = await s.users.list({ q: 'a_b', page: 1, pageSize: 50 });
        strict_1.default.deepEqual(under.rows.map((r) => r.username), ['a_b.user'], '"_" matches only itself');
        const pct = await s.users.list({ q: '%', page: 1, pageSize: 50 });
        strict_1.default.equal(pct.total, 0, '"%" matches nothing unless it is in a username');
    });
    await t.test('duplicate username gives the Persian conflict message (not a raw driver error)', async () => {
        await strict_1.default.rejects(() => s.users.create(actor, { username: 'a_b.user', fullName: 'تکراری', roleId: instituteRole, password: 'Long-Enough-Pass' }), (e) => e instanceof errors_1.AppError && e.status === 409 && e.message.includes('نام کاربری'));
    });
    await t.test('deleting a role that still has users is blocked by the foreign key (RESTRICT)', async () => {
        // The installer's admin holds the super-admin role. The service guards this with user_count; the database must too.
        const superRole = await roleBySlug(permissions_1.SUPER_ADMIN_ROLE);
        await strict_1.default.rejects(() => s.db.execute('DELETE FROM roles WHERE id = ?', [superRole]), (e) => e.code === 'ER_ROW_IS_REFERENCED_2');
    });
    await t.test('a failing transaction rolls back every statement in it', async () => {
        const before = (await s.db.query('SELECT COUNT(*) AS n FROM settings'))[0].n;
        await strict_1.default.rejects(() => s.db.transaction(async (tx) => {
            await tx.execute("INSERT INTO settings (setting_key, value_json) VALUES ('tmp.rollback', '1')");
            throw new Error('boom');
        }));
        const after = (await s.db.query('SELECT COUNT(*) AS n FROM settings'))[0].n;
        strict_1.default.equal(after, before, 'rolled-back insert is not visible');
    });
    await t.test('nested service calls inside a transaction join it (no deadlock on the single connection)', async () => {
        const roleId = await s.db.transaction(async () => {
            // roles.create opens its own transaction and writes audit rows; it must join this one.
            return s.roles.create(actor, { slug: 'nested_check', nameFa: 'بررسی تودرتو', permissions: ['users.view'] });
        });
        strict_1.default.ok(roleId > 0);
    });
    await t.test('settings upsert updates in place (one row per key)', async () => {
        await s.settings.update(actor, 'appearance.primary_color', '#111111');
        await s.settings.update(actor, 'appearance.primary_color', '#222222');
        const rows = await s.db.query("SELECT COUNT(*) AS n FROM settings WHERE setting_key = 'appearance.primary_color'");
        strict_1.default.equal(rows[0].n, 1);
        strict_1.default.equal(await s.settings.get('appearance.primary_color'), '#222222');
    });
    await t.test('dashboard counts are real and reflect the data written above', async () => {
        const stats = await s.dashboard.stats();
        strict_1.default.equal(stats.usersTotal, 3, 'admin + two created users');
        strict_1.default.ok(stats.activeSessions >= 1);
        strict_1.default.ok(stats.auditLast24h >= 1);
    });
    await t.test('data is durable: a fresh connection to the same file sees every committed write', async () => {
        await s.db.close();
        const driver = await sqlite_driver_1.SqliteDriver.open(file);
        const reopened = new database_1.Database();
        await reopened.attach(driver);
        const users = await reopened.query('SELECT COUNT(*) AS n FROM users');
        strict_1.default.equal(users[0].n, 3);
        const fk = await reopened.query('PRAGMA foreign_keys');
        strict_1.default.equal(fk[0].foreign_keys, 1, 'foreign keys stay enforced after reopen');
        await reopened.close();
    });
    node_fs_1.default.rmSync(storage, { recursive: true, force: true });
});
(0, node_test_1.default)('installer: an unreachable MySQL is refused with 503 and nothing is saved (no MySQL server needed)', async () => {
    const storage = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'myclass-mysqlfail-'));
    const rt = (0, bootstrap_1.bootstrap)(root, {
        NODE_ENV: 'test',
        DB_DRIVER: '',
        DB_HOST: '127.0.0.1',
        DB_PORT: '1', // nothing listens here: connection refused immediately
        DB_NAME: 'unused_db',
        DB_USER: 'unused_user',
        DB_PASSWORD: 'unused',
        INSTALL_TOKEN: TOKEN,
        STORAGE_DIR: storage,
    });
    await rt.ready;
    strict_1.default.equal(rt.services.install.defaultDriver(), 'mysql', 'DB_NAME and DB_USER preselect MySQL for existing setups');
    await strict_1.default.rejects(() => rt.services.install.install({ driver: 'mysql', token: TOKEN, fullName: 'مدیر', username: 'admin', password: PW, passwordConfirm: PW, instituteName: 'موسسه' }, null), (e) => e instanceof errors_1.AppError && e.status === 503 && e.code === 'DB_UNAVAILABLE' && !/127\.0\.0\.1|unused_/.test(e.message));
    strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(storage, 'db-config.json')), false, 'a failed connection is never persisted as the choice');
    strict_1.default.equal(rt.services.install.isInstalled(), false);
    await rt.services.db.close().catch(() => undefined);
    node_fs_1.default.rmSync(storage, { recursive: true, force: true });
});
