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
const env_1 = require("../../config/env");
const registry_1 = require("../../settings/registry");
const migrator_1 = require("../../db/migrator");
const format_1 = require("../../http/format");
const root = node_path_1.default.resolve(__dirname, '..', '..', '..');
(0, node_test_1.default)('settings: values are typed, validated and defaulted', () => {
    const minLen = (0, registry_1.findSetting)('security.password_min_length');
    strict_1.default.deepEqual((0, registry_1.validateSettingValue)(minLen, '12'), { ok: true, value: 12 });
    strict_1.default.equal((0, registry_1.validateSettingValue)(minLen, '4').ok, false);
    strict_1.default.equal((0, registry_1.validateSettingValue)(minLen, '999').ok, false);
    const color = (0, registry_1.findSetting)('appearance.primary_color');
    strict_1.default.equal((0, registry_1.validateSettingValue)(color, '#1D4ED8').ok, true);
    strict_1.default.equal((0, registry_1.validateSettingValue)(color, 'red').ok, false);
    strict_1.default.equal((0, registry_1.validateSettingValue)(color, '<script>').ok, false);
    const website = (0, registry_1.findSetting)('institute.website');
    strict_1.default.equal((0, registry_1.validateSettingValue)(website, 'https://example.ir').ok, true);
    strict_1.default.equal((0, registry_1.validateSettingValue)(website, 'javascript:alert(1)').ok, false);
    const email = (0, registry_1.findSetting)('institute.email');
    strict_1.default.equal((0, registry_1.validateSettingValue)(email, 'info@example.ir').ok, true);
    strict_1.default.equal((0, registry_1.validateSettingValue)(email, 'not-an-email').ok, false);
    const cal = (0, registry_1.findSetting)('datetime.calendar');
    strict_1.default.equal((0, registry_1.validateSettingValue)(cal, 'lunar').ok, false);
});
(0, node_test_1.default)('settings: every default satisfies its own schema and keys are unique', () => {
    const keys = new Set();
    for (const def of registry_1.SETTINGS) {
        strict_1.default.equal(keys.has(def.key), false, `duplicate ${def.key}`);
        keys.add(def.key);
        const r = def.schema.safeParse(def.defaultValue);
        strict_1.default.equal(r.success, true, def.key);
    }
});
(0, node_test_1.default)('API keys are masked for display', () => {
    strict_1.default.equal((0, registry_1.maskSecret)('abcdefgh1234'), '••••••••1234');
    strict_1.default.equal((0, registry_1.maskSecret)('abc'), '••••');
    strict_1.default.equal((0, registry_1.maskSecret)(''), '');
});
(0, node_test_1.default)('config: validates environment and applies defaults', () => {
    const cfg = (0, env_1.loadConfig)('/app', { NODE_ENV: 'production', PORT: '8080', COOKIE_SECURE: 'true' });
    strict_1.default.equal(cfg.port, 8080);
    strict_1.default.equal(cfg.isProduction, true);
    strict_1.default.equal(cfg.cookieSecure, true);
    strict_1.default.equal(cfg.storageDir, node_path_1.default.join('/app', 'storage'));
    strict_1.default.equal(cfg.sessionTtlHours, 8);
    strict_1.default.throws(() => (0, env_1.loadConfig)('/app', { PORT: 'abc' }), /تنظیمات محیطی نامعتبر/);
});
(0, node_test_1.default)('config: .env loader never overrides host-provided variables', () => {
    const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'env-'));
    const file = node_path_1.default.join(dir, '.env');
    node_fs_1.default.writeFileSync(file, '# comment\nDB_NAME=from_file\nDB_USER="quoted_user"\nEMPTY=\n');
    const target = { DB_NAME: 'from_host' };
    strict_1.default.equal((0, env_1.loadDotEnv)(file, target), true);
    strict_1.default.equal(target.DB_NAME, 'from_host');
    strict_1.default.equal(target.DB_USER, 'quoted_user');
    strict_1.default.equal((0, env_1.loadDotEnv)(node_path_1.default.join(dir, 'missing'), target), false);
    node_fs_1.default.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.default)('migrations: files are discovered in order with stable checksums and statements', () => {
    const migrations = (0, migrator_1.loadMigrations)(node_path_1.default.join(root, 'migrations', 'mysql'));
    strict_1.default.ok(migrations.length >= 1);
    strict_1.default.equal(migrations[0].version, '001');
    strict_1.default.equal(migrations[0].statements.length, 8, 'foundation migration has 8 statements');
    for (const s of migrations[0].statements)
        strict_1.default.match(s, /^CREATE TABLE/);
    strict_1.default.equal((0, migrator_1.loadMigrations)(node_path_1.default.join(root, 'migrations', 'mysql'))[0].checksum, migrations[0].checksum);
});
(0, node_test_1.default)('migrations: MySQL and SQLite foundation schemas define the same tables and versions', () => {
    const tablesOf = (engine) => (0, migrator_1.loadMigrations)(node_path_1.default.join(root, 'migrations', engine))
        .flatMap((m) => m.statements)
        .flatMap((s) => [...s.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))
        .sort();
    strict_1.default.deepEqual(tablesOf('sqlite'), tablesOf('mysql'));
    const versions = (engine) => (0, migrator_1.loadMigrations)(node_path_1.default.join(root, 'migrations', engine)).map((m) => m.version);
    strict_1.default.deepEqual(versions('sqlite'), versions('mysql'));
});
(0, node_test_1.default)('migrations: duplicate versions are rejected', () => {
    const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'mig-'));
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, '001_a.sql'), 'SELECT 1;');
    node_fs_1.default.writeFileSync(node_path_1.default.join(dir, '001_b.sql'), 'SELECT 2;');
    strict_1.default.throws(() => (0, migrator_1.loadMigrations)(dir), /تکراری/);
    node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    strict_1.default.ok(migrator_1.Migrator);
});
(0, node_test_1.default)('dates: UTC instants are shown in Tehran local time with Jalali calendar', () => {
    // 2025-03-21T00:00Z is 03:30 in Tehran on 1404/01/01.
    strict_1.default.equal((0, format_1.formatDateTime)(new Date('2025-03-21T00:00:00Z')), '۱۴۰۴/۰۱/۰۱ ۰۳:۳۰');
    // Late evening UTC rolls over into the next Tehran day (UTC+3:30).
    strict_1.default.equal((0, format_1.formatDateTime)(new Date('2025-03-20T21:00:00Z')), '۱۴۰۴/۰۱/۰۱ ۰۰:۳۰');
    strict_1.default.equal((0, format_1.formatDateTime)(null), '—');
});
