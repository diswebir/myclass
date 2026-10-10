import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb, closeDb } from '../src/core/db';
import { InstallerService } from '../src/modules/installer/installer.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { config, getEffectiveDbConfig } from '../src/core/config';

describe('SQLite Installation & Dynamic Engine Selection', () => {
  const testSqlitePath = path.join(config.STORAGE_DIR, 'test-custom.sqlite');
  const lockPath = path.join(config.STORAGE_DIR, 'installed.lock');
  const dbConfigFile = path.join(config.STORAGE_DIR, 'db-config.json');

  beforeAll(() => {
    if (fs.existsSync(testSqlitePath)) fs.unlinkSync(testSqlitePath);
    if (fs.existsSync(`${testSqlitePath}-wal`)) fs.unlinkSync(`${testSqlitePath}-wal`);
    if (fs.existsSync(`${testSqlitePath}-shm`)) fs.unlinkSync(`${testSqlitePath}-shm`);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    if (fs.existsSync(dbConfigFile)) fs.unlinkSync(dbConfigFile);
  });

  afterAll(async () => {
    await closeDb();
    if (fs.existsSync(testSqlitePath)) fs.unlinkSync(testSqlitePath);
    if (fs.existsSync(`${testSqlitePath}-wal`)) fs.unlinkSync(`${testSqlitePath}-wal`);
    if (fs.existsSync(`${testSqlitePath}-shm`)) fs.unlinkSync(`${testSqlitePath}-shm`);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    if (fs.existsSync(dbConfigFile)) fs.unlinkSync(dbConfigFile);
  });

  it('installs the platform targeting a dedicated SQLite database file', async () => {
    const rawDb = getDb();
    const installer = new InstallerService(rawDb);

    const installResult = await installer.runInstall({
      dbDialect: 'sqlite',
      sqlitePath: testSqlitePath,
      institutionName: 'مؤسسه آموزشی مبتنی بر SQLite',
      fullName: 'مدیر تست اس‌کیولایت',
      mobile: '09129990001',
      email: 'sqlite_admin@example.com',
      password: 'SqlitePassword123!'
    });

    expect(installResult.message).toContain('موفقیت');
    expect(installResult.dialectUsed).toBe('sqlite');

    // Verify SQLite file was physically created in storage directory
    expect(fs.existsSync(testSqlitePath)).toBe(true);
    const fileStat = fs.statSync(testSqlitePath);
    expect(fileStat.size).toBeGreaterThan(1024); // Contains tables and seed data

    // Verify configuration was persisted in storage/db-config.json
    const effectiveConf = getEffectiveDbConfig();
    expect(effectiveConf.dialect).toBe('sqlite');
    expect(effectiveConf.sqlitePath).toBe(testSqlitePath);

    // Verify admin can login on this SQLite file database
    const authService = new AuthService(getDb());
    const login = await authService.login('09129990001', 'SqlitePassword123!', '127.0.0.1', 'Vitest');
    expect(login.user.full_name).toBe('مدیر تست اس‌کیولایت');
    expect(login.user.role_name).toBe('super_admin');
  });

  it('rejects re-installation when locked', async () => {
    const installer = new InstallerService(getDb());
    await expect(
      installer.runInstall({
        dbDialect: 'sqlite',
        fullName: 'نفوذگر',
        mobile: '09120000000',
        password: 'Password123!'
      })
    ).rejects.toThrow(/قبلاً نصب شده است/);
  });
});
