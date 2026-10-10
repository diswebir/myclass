/** Helper — ساخت DB تست (SQLite in-memory) + migration + seed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { loadConfig, type Config } from '../../src/core/config/env';
import { createDatabase } from '../../src/core/db/database';
import { migrateToLatest } from '../../src/core/db/migrate';
import type { Database } from '../../src/core/db/types';
import { hashPassword } from '../../src/core/security/password';
import { nowDb } from '../../src/core/db/time';
import { RbacService } from '../../src/modules/rbac/rbac.service';
import { SettingsService } from '../../src/modules/settings/settings.service';

export interface TestDb {
  db: Kysely<Database>;
  config: Config;
  storageDir: string;
  cleanup: () => Promise<void>;
}

export async function createTestDb(overrides: Record<string, string> = {}): Promise<TestDb> {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myclass-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    DB_SQLITE_PATH: ':memory:',
    STORAGE_DIR: storageDir,
    BCRYPT_ROUNDS: '4', // سرعت تست
    ...overrides,
  });
  const db = createDatabase(config);
  await migrateToLatest(db);

  // seed
  const rbac = new RbacService(db);
  await rbac.syncPermissions();
  await rbac.seedSystemRoles();
  const settings = new SettingsService(db, config);
  await settings.seedDefaults();
  for (const m of [
    { name: 'نقدی', type: 'cash' },
    { name: 'کارت‌به‌کارت', type: 'card' },
  ]) {
    await db.insertInto('payment_methods').values({ name: m.name, type: m.type, created_at: nowDb() }).execute();
  }

  return {
    db,
    config,
    storageDir,
    cleanup: async () => {
      await db.destroy();
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

export const TEST_ADMIN = {
  username: 'admin',
  password: 'Admin12345',
  fullName: 'مدیر تست',
};

/** ساخت کاربر admin +returns id */
export async function createAdminUser(db: Kysely<Database>, config: Config): Promise<number> {
  const hash = await hashPassword(TEST_ADMIN.password, config.BCRYPT_ROUNDS);
  const res = await db
    .insertInto('users')
    .values({
      username: TEST_ADMIN.username,
      email: null,
      phone: null,
      password_hash: hash,
      full_name: TEST_ADMIN.fullName,
      is_active: 1,
      must_change_password: 0,
      created_at: nowDb(),
      updated_at: nowDb(),
    })
    .executeTakeFirstOrThrow();
  const userId = Number(res.insertId);
  const rbac = new RbacService(db);
  const superAdmin = await rbac.repo.findRoleBySlug('super_admin');
  if (superAdmin) {
    await db.insertInto('user_roles').values({ user_id: userId, role_id: Number(superAdmin.id) }).execute();
  }
  return userId;
}

/** نوشتن قفل نصب (برای تست‌های اپلیکیشن کامل) */
export function writeInstallLock(storageDir: string): void {
  fs.writeFileSync(path.join(storageDir, '.installed'), JSON.stringify({ installedAt: nowDb() }) + '\n');
}
