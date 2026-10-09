import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadDotEnv } from '../../config/env';
import { findSetting, maskSecret, validateSettingValue, SETTINGS } from '../../settings/registry';
import { Migrator, loadMigrations } from '../../db/migrator';
import { formatDateTime } from '../../http/format';

const root = path.resolve(__dirname, '..', '..', '..');

test('settings: values are typed, validated and defaulted', () => {
  const minLen = findSetting('security.password_min_length')!;
  assert.deepEqual(validateSettingValue(minLen, '12'), { ok: true, value: 12 });
  assert.equal(validateSettingValue(minLen, '4').ok, false);
  assert.equal(validateSettingValue(minLen, '999').ok, false);

  const color = findSetting('appearance.primary_color')!;
  assert.equal(validateSettingValue(color, '#1D4ED8').ok, true);
  assert.equal(validateSettingValue(color, 'red').ok, false);
  assert.equal(validateSettingValue(color, '<script>').ok, false);

  const website = findSetting('institute.website')!;
  assert.equal(validateSettingValue(website, 'https://example.ir').ok, true);
  assert.equal(validateSettingValue(website, 'javascript:alert(1)').ok, false);

  const email = findSetting('institute.email')!;
  assert.equal(validateSettingValue(email, 'info@example.ir').ok, true);
  assert.equal(validateSettingValue(email, 'not-an-email').ok, false);

  const cal = findSetting('datetime.calendar')!;
  assert.equal(validateSettingValue(cal, 'lunar').ok, false);
});

test('settings: every default satisfies its own schema and keys are unique', () => {
  const keys = new Set<string>();
  for (const def of SETTINGS) {
    assert.equal(keys.has(def.key), false, `duplicate ${def.key}`);
    keys.add(def.key);
    const r = def.schema.safeParse(def.defaultValue);
    assert.equal(r.success, true, def.key);
  }
});

test('API keys are masked for display', () => {
  assert.equal(maskSecret('abcdefgh1234'), '••••••••1234');
  assert.equal(maskSecret('abc'), '••••');
  assert.equal(maskSecret(''), '');
});

test('config: validates environment and applies defaults', () => {
  const cfg = loadConfig('/app', { NODE_ENV: 'production', PORT: '8080', COOKIE_SECURE: 'true' } as NodeJS.ProcessEnv);
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.isProduction, true);
  assert.equal(cfg.cookieSecure, true);
  assert.equal(cfg.storageDir, path.join('/app', 'storage'));
  assert.equal(cfg.sessionTtlHours, 8);
  assert.throws(() => loadConfig('/app', { PORT: 'abc' } as NodeJS.ProcessEnv), /تنظیمات محیطی نامعتبر/);
});

test('config: .env loader never overrides host-provided variables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, '# comment\nDB_NAME=from_file\nDB_USER="quoted_user"\nEMPTY=\n');
  const target: NodeJS.ProcessEnv = { DB_NAME: 'from_host' };
  assert.equal(loadDotEnv(file, target), true);
  assert.equal(target.DB_NAME, 'from_host');
  assert.equal(target.DB_USER, 'quoted_user');
  assert.equal(loadDotEnv(path.join(dir, 'missing'), target), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrations: files are discovered in order with stable checksums and statements', () => {
  const migrations = loadMigrations(path.join(root, 'migrations'));
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].version, '001');
  assert.equal(migrations[0].statements.length, 8, 'foundation migration has 8 statements');
  for (const s of migrations[0].statements) assert.match(s, /^CREATE TABLE/);
  assert.equal(loadMigrations(path.join(root, 'migrations'))[0].checksum, migrations[0].checksum);
});

test('migrations: duplicate versions are rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, '001_b.sql'), 'SELECT 2;');
  assert.throws(() => loadMigrations(dir), /تکراری/);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(Migrator);
});

test('dates: UTC instants are shown in Tehran local time with Jalali calendar', () => {
  // 2025-03-21T00:00Z is 03:30 in Tehran on 1404/01/01.
  assert.equal(formatDateTime(new Date('2025-03-21T00:00:00Z')), '۱۴۰۴/۰۱/۰۱ ۰۳:۳۰');
  // Late evening UTC rolls over into the next Tehran day (UTC+3:30).
  assert.equal(formatDateTime(new Date('2025-03-20T21:00:00Z')), '۱۴۰۴/۰۱/۰۱ ۰۰:۳۰');
  assert.equal(formatDateTime(null), '—');
});
