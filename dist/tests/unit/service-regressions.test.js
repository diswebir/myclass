"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const migrator_1 = require("../../db/migrator");
const auth_service_1 = require("../../modules/auth/auth.service");
const audit_service_1 = require("../../modules/audit/audit.service");
const users_service_1 = require("../../modules/users/users.service");
const roles_service_1 = require("../../modules/roles/roles.service");
const persian_1 = require("../../lib/persian");
const permissions_1 = require("../../rbac/permissions");
const fake_db_1 = require("./fake-db");
const asDb = (x) => x;
// ---------- Migrator: the named lock must be taken and released on ONE connection ----------
function migrationsDir(files) {
    // Migrator reads <root>/<engine>; the fake database reports the MySQL dialect.
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'myclass-mig-'));
    const dir = node_path_1.default.join(root, 'mysql');
    node_fs_1.default.mkdirSync(dir);
    for (const [name, body] of Object.entries(files))
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, name), body);
    return root;
}
(0, node_test_1.default)('migrator: GET_LOCK, every statement and RELEASE_LOCK run on the same pooled connection', async () => {
    const dir = migrationsDir({ '001_a.sql': 'CREATE TABLE a (id INT);\n-- @@\nCREATE TABLE a2 (id INT);\n', '002_b.sql': 'CREATE TABLE b (id INT);\n' });
    const db = (0, fake_db_1.fakeDb)((sql) => (sql.includes('GET_LOCK') ? [{ got: 1 }] : []));
    const result = await new migrator_1.Migrator(asDb(db), dir).migrate();
    strict_1.default.deepEqual(result.applied, ['001_a.sql', '002_b.sql']);
    const lockCalls = db.calls.filter((c) => c.sql.includes('GET_LOCK') || c.sql.includes('RELEASE_LOCK'));
    strict_1.default.equal(lockCalls.length, 2);
    const conns = new Set(db.calls.filter((c) => c.conn !== 0).map((c) => c.conn));
    strict_1.default.equal(conns.size, 1, 'a session-scoped lock must not be split across connections');
    strict_1.default.deepEqual(db.events, ['acquire:1', 'release:1']);
    // Migration statements ran in order on that connection, and each applied file was recorded.
    const ddl = db.calls
        .filter((c) => c.sql.startsWith('CREATE TABLE') && !c.sql.includes('schema_migrations'))
        .map((c) => /CREATE TABLE (\w+)/.exec(c.sql)[1]);
    strict_1.default.deepEqual(ddl, ['a', 'a2', 'b']);
    strict_1.default.equal(db.calls.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations')).length, 2);
});
(0, node_test_1.default)('migrator: the lock is released even when a migration statement fails', async () => {
    const dir = migrationsDir({ '001_a.sql': 'CREATE TABLE a (id INT);\n-- @@\nCREATE TABLE broken (id INT);\n' });
    const db = (0, fake_db_1.fakeDb)((sql) => {
        if (sql.includes('GET_LOCK'))
            return [{ got: 1 }];
        if (sql.includes('CREATE TABLE broken'))
            throw new Error('ER_SYNTAX_ERROR (simulated)');
        return [];
    });
    await strict_1.default.rejects(() => new migrator_1.Migrator(asDb(db), dir).migrate(), /simulated/);
    strict_1.default.ok(db.calls.some((c) => c.sql.includes('RELEASE_LOCK')), 'RELEASE_LOCK must run on failure');
    strict_1.default.deepEqual(db.events, ['acquire:1', 'release:1']);
    strict_1.default.ok(!db.calls.some((c) => c.sql.startsWith('INSERT INTO schema_migrations')), 'failed migration is not recorded');
});
(0, node_test_1.default)('migrator: a busy lock stops the run before any DDL', async () => {
    const dir = migrationsDir({ '001_a.sql': 'CREATE TABLE a (id INT);\n' });
    const db = (0, fake_db_1.fakeDb)((sql) => (sql.includes('GET_LOCK') ? [{ got: 0 }] : []));
    await strict_1.default.rejects(() => new migrator_1.Migrator(asDb(db), dir).migrate(), /در حال انجام/);
    strict_1.default.ok(!db.calls.some((c) => c.sql.startsWith('CREATE TABLE a')));
});
// ---------- Auth: idle timeout, password length, expiry as a real Date ----------
function sessionRow(overrides) {
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
        role_slug: permissions_1.SUPER_ADMIN_ROLE,
        status: 'active',
        must_change_password: 0,
        password_hash: 'x',
        ...overrides,
    };
}
(0, node_test_1.default)('auth: a session idle longer than the idle timeout is rejected before its absolute expiry', async () => {
    const db = (0, fake_db_1.fakeDb)((sql) => (sql.includes('FROM sessions s') ? [sessionRow({ last_seen_at: new Date(Date.now() - 3 * 3600_000) })] : []));
    const auth = new auth_service_1.AuthService(asDb(db), new audit_service_1.AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5, sessionIdleMinutes: 120 });
    strict_1.default.equal(await auth.authenticate('some-token'), null);
});
(0, node_test_1.default)('auth: an active session inside the idle window is accepted', async () => {
    const db = (0, fake_db_1.fakeDb)((sql) => (sql.includes('FROM sessions s') ? [sessionRow({})] : []));
    const auth = new auth_service_1.AuthService(asDb(db), new audit_service_1.AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5, sessionIdleMinutes: 120 });
    const s = await auth.authenticate('some-token');
    strict_1.default.equal(s?.sessionId, 7);
});
(0, node_test_1.default)('auth: session expiry is computed in JavaScript as a Date, not with INTERVAL ? in a prepared statement', async () => {
    const db = (0, fake_db_1.fakeDb)();
    const auth = new auth_service_1.AuthService(asDb(db), new audit_service_1.AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5 });
    await auth.createSession(1, '10.0.0.1', 'ua');
    const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO sessions'));
    strict_1.default.ok(!/INTERVAL/i.test(insert.sql));
    const expires = insert.params[4];
    strict_1.default.ok(expires instanceof Date);
    const hours = (expires.getTime() - Date.now()) / 3600_000;
    strict_1.default.ok(hours > 7.9 && hours <= 8.01, `expected ~8h, got ${hours}`);
});
(0, node_test_1.default)('auth: an over-long password is rejected without touching the database (no silent truncation)', async () => {
    const db = (0, fake_db_1.fakeDb)();
    const auth = new auth_service_1.AuthService(asDb(db), new audit_service_1.AuditService(asDb(db)), { sessionTtlHours: 8, maxFailures: 5 });
    await strict_1.default.rejects(() => auth.login({ username: 'admin', password: 'a'.repeat(auth_service_1.MAX_PASSWORD_LENGTH + 1), ip: '1.2.3.4', userAgent: null }), (e) => e.status === 401);
    strict_1.default.equal(db.calls.length, 0);
});
// ---------- Users: consistent usernames, digit-folded search, password cap ----------
(0, node_test_1.default)('usernames are normalised the same way everywhere (case, spaces, Persian digits)', () => {
    strict_1.default.equal((0, persian_1.normalizeUsername)('  Admin.User  '), 'admin.user');
    strict_1.default.equal((0, persian_1.normalizeUsername)('user۱۲'), 'user12');
    strict_1.default.equal((0, persian_1.normalizeUsername)('user\u0661\u0662'), 'user12');
});
(0, node_test_1.default)('user search folds Persian digits and ignores separators, so ۰۹۱۲-۱۲۳ finds 0912123', async () => {
    const db = (0, fake_db_1.fakeDb)((sql) => (sql.startsWith('SELECT COUNT') ? [{ n: 0 }] : []));
    const audit = new audit_service_1.AuditService(asDb(db));
    const auth = new auth_service_1.AuthService(asDb(db), audit, { sessionTtlHours: 8, maxFailures: 5 });
    const users = new users_service_1.UsersService(asDb(db), audit, auth, async () => 10);
    await users.list({ q: '۰۹۱۲-۱۲۳', page: 1, pageSize: 20 });
    const count = db.calls.find((c) => c.sql.includes('COUNT(*)'));
    strict_1.default.ok(count.params.includes('%0912123%'), JSON.stringify(count.params));
});
(0, node_test_1.default)('user creation rejects passwords longer than the cap before any database work', async () => {
    const db = (0, fake_db_1.fakeDb)();
    const audit = new audit_service_1.AuditService(asDb(db));
    const auth = new auth_service_1.AuthService(asDb(db), audit, { sessionTtlHours: 8, maxFailures: 5 });
    const users = new users_service_1.UsersService(asDb(db), audit, auth, async () => 10);
    const actor = { id: 1, permissions: new Set(['users.create']), ip: null };
    await strict_1.default.rejects(() => users.create(actor, { username: 'newuser', fullName: 'کاربر جدید', roleId: 2, password: 'a'.repeat(auth_service_1.MAX_PASSWORD_LENGTH + 1) }), (e) => e.status === 400);
    strict_1.default.equal(db.calls.length, 0);
});
// ---------- Roles: no editing rights you do not hold; super-admin catalogue is exact ----------
function roleResponder(slug, current) {
    return (sql) => {
        if (sql.includes('FROM roles r WHERE r.id'))
            return [{ id: 5, slug, name_fa: 'نقش', description: null, is_system: 0, is_active: 1, user_count: 0, permission_count: current.length }];
        if (sql.includes('JOIN permissions p'))
            return current.map((code) => ({ code }));
        return [];
    };
}
(0, node_test_1.default)('roles: a manager cannot edit a role to strip permissions they do not hold', async () => {
    const db = (0, fake_db_1.fakeDb)(roleResponder('registrar', ['users.view', 'users.create']));
    const audit = new audit_service_1.AuditService(asDb(db));
    const roles = new roles_service_1.RolesService(asDb(db), audit);
    const actor = { id: 2, permissions: new Set(['roles.manage', 'users.view']), ip: null };
    await strict_1.default.rejects(() => roles.update(actor, 5, { nameFa: 'ثبت‌نام', permissions: ['users.view'] }), (e) => e.status === 403);
    strict_1.default.ok(!db.calls.some((c) => c.sql.startsWith('DELETE FROM role_permissions')), 'no permission rows may change');
});
(0, node_test_1.default)('roles: the super administrator catalogue must match exactly, even if the count is equal', async () => {
    const full = permissions_1.PERMISSIONS.map((p) => p.code);
    const db = (0, fake_db_1.fakeDb)(roleResponder(permissions_1.SUPER_ADMIN_ROLE, full));
    const audit = new audit_service_1.AuditService(asDb(db));
    const roles = new roles_service_1.RolesService(asDb(db), audit);
    const actor = { id: 1, permissions: new Set(full), ip: null };
    const tampered = [...full.slice(1), 'bogus.permission'];
    await strict_1.default.rejects(() => roles.update(actor, 5, { nameFa: 'مدیر اصلی', permissions: tampered }), (e) => e.code === 'LOCKED_ROLE');
});
