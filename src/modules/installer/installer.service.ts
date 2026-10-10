/** سرویس installer — compat check، اجرای نصب (migrate + seed + admin + قفل)، وضعیت. */
import fs from 'node:fs';
import path from 'node:path';
import { Kysely, MysqlDialect, sql } from 'kysely';
import { createPool } from 'mysql2'; // callback pool — Kysely's MysqlDialect به API callback نیاز دارد
import { DEV_DEFAULT_ENCRYPTION_KEY, DEV_DEFAULT_SESSION_SECRET, type Config } from '../../core/config/env';
import { migrateToLatest } from '../../core/db/migrate';
import { hashPassword, validatePasswordPolicy } from '../../core/security/password';
import { nowDb } from '../../core/db/time';
import { randomToken } from '../../core/security/tokens';
import { RbacService } from '../rbac/rbac.service';
import { SettingsService } from '../settings/settings.service';
import { INSTALL_LOCK_FILENAME } from '../../core/http/middleware/installGate';
import { upsertByKey } from '../../core/db/upsert';

export interface InstallInput {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  appBaseUrl: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName: string;
}

export interface CheckResult {
  ok: boolean;
  label: string;
  detail: string;
}

export class InstallerService {
  constructor(private readonly config: Config) {}

  private connect(input: InstallInput): Kysely<any> {
    const pool = createPool({
      host: input.dbHost,
      port: input.dbPort,
      database: input.dbName,
      user: input.dbUser,
      password: input.dbPassword,
      connectionLimit: 3,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      timezone: 'Z',
      charset: 'utf8mb4',
    });
    // خطای pool (مثلاً اتصال refused) نباید پروسس را crash کند — به‌صورت خطای نصب گزارش می‌شود
    pool.on('error', () => {});
    // mysql2 (callback pool) در runtime با Kysely سازگار است؛ شکل overloadهای typings differs → cast
    type KyselyMysqlPool = ConstructorParameters<typeof MysqlDialect>[0]['pool'];
    return new Kysely<any>({
      dialect: new MysqlDialect({ pool: pool as unknown as KyselyMysqlPool }),
    });
  }

  /** بررسی‌های سازگاری — نتایج به‌صورت فارسی. */
  async runChecks(input: InstallInput): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    results.push({
      ok: nodeMajor >= 18,
      label: 'نسخه Node.js',
      detail: `نسخه فعلی: ${process.versions.node} (حداقل ۱۸ لازم است)`,
    });
    // نوشتن‌پذیری STORAGE_DIR
    const storageDir = path.isAbsolute(this.config.STORAGE_DIR)
      ? this.config.STORAGE_DIR
      : path.join(process.cwd(), this.config.STORAGE_DIR);
    let storageOk = false;
    let storageDetail = '';
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      const probe = path.join(storageDir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      storageOk = true;
      storageDetail = 'مسیر storage قابل نوشتن است';
    } catch (err) {
      storageDetail = `مسیر storage قابل نوشتن نیست: ${(err as Error).message}`;
    }
    results.push({ ok: storageOk, label: 'نوشتن‌پذیری storage', detail: storageDetail });

    // اتصال DB
    let db: Kysely<any> | null = null;
    try {
      db = this.connect(input);
      await sql`select 1`.execute(db);
      results.push({ ok: true, label: 'اتصال پایگاه داده', detail: `متصل شد: ${input.dbName}@${input.dbHost}` });
    } catch (err) {
      results.push({ ok: false, label: 'اتصال پایگاه داده', detail: 'اتصال برقرار نشد — لطفاً اطلاعات اتصال را بررسی کنید: ' + (err as Error).message.slice(0, 200) });
    }

    // متغیرهای محیطی
    results.push({
      ok: this.config.SESSION_SECRET !== DEV_DEFAULT_SESSION_SECRET,
      label: 'SESSION_SECRET',
      detail:
        this.config.SESSION_SECRET !== DEV_DEFAULT_SESSION_SECRET
          ? 'مقداردهی شده'
          : 'از مقدار پیش‌فرض استفاده می‌شود — installer مقدار تصادفی می‌سازد',
    });
    results.push({
      ok: this.config.ENCRYPTION_KEY !== DEV_DEFAULT_ENCRYPTION_KEY,
      label: 'ENCRYPTION_KEY',
      detail:
        this.config.ENCRYPTION_KEY !== DEV_DEFAULT_ENCRYPTION_KEY
          ? 'مقداردهی شده'
          : 'از مقدار پیش‌فرض استفاده می‌شود — installer مقدار تصادفی می‌سازد',
    });

    if (db) await db.destroy();
    return results;
  }

  /** اجرای نصب کامل: migrate → seed → admin → .env → قفل */
  async runInstall(input: InstallInput): Promise<{ adminId: number }> {
    const policy = validatePasswordPolicy(input.adminPassword);
    if (!policy.ok) throw new Error(policy.errors.join(' '));
    if (input.adminUsername.trim().length < 3) throw new Error('نام کاربری مدیر حداقل ۳ کاراکتر باشد.');

    const db = this.connect(input);
    try {
      // 1. migrations
      await migrateToLatest(db);
      // 2. seed — RBAC + settings
      const rbac = new RbacService(db);
      await rbac.syncPermissions();
      await rbac.seedSystemRoles();
      const settings = new SettingsService(db, this.config);
      await settings.seedDefaults();
      // 3. متدهای پرداخت پیش‌فرض
      const methods = [
        { name: 'نقدی', type: 'cash' },
        { name: 'کارت‌به‌کارت', type: 'card' },
        { name: 'آنلاین (درگاه)', type: 'online' },
      ];
      for (const m of methods) {
        const exists = await db.selectFrom('payment_methods').select('id').where('name', '=', m.name).executeTakeFirst();
        if (!exists) {
          await db.insertInto('payment_methods').values({ name: m.name, type: m.type, created_at: nowDb() }).execute();
        }
      }
      // 4. کاربر admin
      const existing = await db
        .selectFrom('users')
        .select('id')
        .where('username', '=', input.adminUsername.trim().toLowerCase())
        .executeTakeFirst();
      let adminId: number;
      const hash = await hashPassword(input.adminPassword, this.config.BCRYPT_ROUNDS);
      if (existing) {
        adminId = Number(existing.id);
        await db
          .updateTable('users')
          .set({ password_hash: hash, full_name: input.adminFullName, is_active: 1, deleted_at: null, updated_at: nowDb() })
          .where('id', '=', adminId)
          .execute();
      } else {
        const res = await db
          .insertInto('users')
          .values({
            username: input.adminUsername.trim().toLowerCase(),
            email: null,
            phone: null,
            password_hash: hash,
            full_name: input.adminFullName,
            is_active: 1,
            must_change_password: 0,
            created_at: nowDb(),
            updated_at: nowDb(),
          })
          .executeTakeFirstOrThrow();
        adminId = Number(res.insertId);
      }
      const superAdmin = await rbac.repo.findRoleBySlug('super_admin');
      if (superAdmin) {
        await rbac.assignRoles({ id: adminId, permissions: [], roles: [] } as never, adminId, [Number(superAdmin.id)], { allowSelf: true });
      }
      // 5. system_state — installed
      await upsertByKey(db, 'system_state', 'key', 'installed', { value: '1', updated_at: nowDb() });
      await upsertByKey(db, 'system_state', 'key', 'installed_at', { value: nowDb(), updated_at: nowDb() });
      await upsertByKey(db, 'system_state', 'key', 'version', { value: '0.1.0', updated_at: nowDb() });
      return { adminId };
    } catch (err) {
      // خطای اتصال/مایگریشن — با پیام فارسی (installers admin-only است، جزئیات برای رفع اشکال لازم است)
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`نصب پایگاه داده ناموفق بود: ${msg.slice(0, 300)}`);
    } finally {
      await db.destroy();
    }
  }

  /** نوشتن .env (خارج از webroot اگر ممکن باشد) + قفل نصب */
  writeEnvAndLock(input: InstallInput): { envPath: string; lockPath: string } {
    const sessionSecret = this.config.SESSION_SECRET !== DEV_DEFAULT_SESSION_SECRET ? this.config.SESSION_SECRET : randomToken(32);
    const encKey = this.config.ENCRYPTION_KEY !== DEV_DEFAULT_ENCRYPTION_KEY ? this.config.ENCRYPTION_KEY : randomToken(32);
    const lines = [
      '# myclass — generated by installer',
      `NODE_ENV=production`,
      `APP_BASE_URL=${input.appBaseUrl.replace(/\/$/, '')}`,
      `DB_DRIVER=mysql`,
      `DB_HOST=${input.dbHost}`,
      `DB_PORT=${input.dbPort}`,
      `DB_NAME=${input.dbName}`,
      `DB_USER=${input.dbUser}`,
      `DB_PASSWORD=${input.dbPassword}`,
      `SESSION_SECRET=${sessionSecret}`,
      `ENCRYPTION_KEY=${encKey}`,
      `COOKIE_SECURE=auto`,
      `SMS_CRON_TOKEN=${randomToken(24)}`,
      `INSTALL_ALLOW_REINSTALL=0`,
    ];
    // تلاش برای نوشتن در ../.env (خارج از webroot)، در غیر این صورت ./.env
    const candidates = [path.join(process.cwd(), '..', '.env'), path.join(process.cwd(), '.env')];
    let envPath = candidates[1];
    for (const c of candidates) {
      try {
        fs.writeFileSync(c, lines.join('\n') + '\n', { mode: 0o600 });
        envPath = c;
        break;
      } catch {
        // کاندید بعدی
      }
    }
    // قفل نصب
    const storageDir = path.isAbsolute(this.config.STORAGE_DIR)
      ? this.config.STORAGE_DIR
      : path.join(process.cwd(), this.config.STORAGE_DIR);
    fs.mkdirSync(storageDir, { recursive: true });
    const lockPath = path.join(storageDir, INSTALL_LOCK_FILENAME);
    fs.writeFileSync(lockPath, JSON.stringify({ installedAt: nowDb(), version: '0.1.0' }) + '\n', { mode: 0o600 });
    return { envPath, lockPath };
  }

  isInstalled(): boolean {
    const storageDir = path.isAbsolute(this.config.STORAGE_DIR)
      ? this.config.STORAGE_DIR
      : path.join(process.cwd(), this.config.STORAGE_DIR);
    return fs.existsSync(path.join(storageDir, INSTALL_LOCK_FILENAME));
  }
}
