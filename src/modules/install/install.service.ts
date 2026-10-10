import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../config/env';
import type { Database } from '../../db/database';
import { Migrator } from '../../db/migrator';
import { errors } from '../../lib/errors';
import { safeEqual } from '../../lib/crypto';
import { normalizeText, normalizeUsername } from '../../lib/persian';
import { MAX_PASSWORD_LENGTH } from '../auth/auth.service';
import { APP_VERSION } from '../../version';
import type { AuditService } from '../audit/audit.service';
import type { RbacService } from '../rbac/rbac.service';
import type { UsersService } from '../users/users.service';

export interface CheckResult {
  id: string;
  labelFa: string;
  ok: boolean;
  level: 'ok' | 'warning' | 'error';
  messageFa: string;
}

export interface InstallInput {
  token: string;
  fullName: string;
  username: string;
  email?: string;
  password: string;
  passwordConfirm: string;
  instituteName: string;
}

const MIN_TOKEN_LENGTH = 24;
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
/** Settings key written in the same transaction as the first admin; proves the install completed. */
export const INSTALL_MARKER = 'system.installed_at';

/**
 * Web installer. It is available only while storage/install.lock is absent.
 * Steps: environment checks (no secrets shown) → migrations → permission catalogue → first super admin
 * → institute name → lock file. The lock file is written last so a failed run can be retried.
 */
export class InstallService {
  private failedTokenAttempts = 0;
  private installing = false;

  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Database,
    private readonly rbac: RbacService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly migrationsDir: string,
    private readonly onInstalled: () => void,
  ) {}

  isInstalled(): boolean {
    return fs.existsSync(this.cfg.installLockFile);
  }

  async checks(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const major = Number(process.versions.node.split('.')[0]);
    results.push({
      id: 'node',
      labelFa: 'نسخه Node.js',
      ok: major >= 18,
      level: major >= 18 ? 'ok' : 'error',
      messageFa: `نسخه ${process.versions.node} (حداقل مورد نیاز: 18.18)`,
    });
    results.push(this.storageCheck());
    const envOk = Boolean(this.cfg.db.name && this.cfg.db.user);
    results.push({
      id: 'db_env',
      labelFa: 'متغیرهای اتصال پایگاه داده',
      ok: envOk,
      level: envOk ? 'ok' : 'error',
      messageFa: envOk ? 'تنظیم شده است.' : 'DB_NAME و DB_USER باید در تنظیمات محیطی برنامه تعریف شوند.',
    });
    try {
      await this.db.ping();
      results.push({ id: 'db_connect', labelFa: 'اتصال به پایگاه داده', ok: true, level: 'ok', messageFa: 'اتصال برقرار است.' });
    } catch {
      results.push({
        id: 'db_connect',
        labelFa: 'اتصال به پایگاه داده',
        ok: false,
        level: 'error',
        messageFa: 'اتصال برقرار نشد. مقادیر DB_HOST، DB_NAME، DB_USER و DB_PASSWORD را بررسی کنید.',
      });
    }
    const tokenOk = this.cfg.installToken.length >= MIN_TOKEN_LENGTH;
    results.push({
      id: 'install_token',
      labelFa: 'توکن نصب (INSTALL_TOKEN)',
      ok: tokenOk,
      level: tokenOk ? 'ok' : 'error',
      messageFa: tokenOk ? 'تنظیم شده است.' : `INSTALL_TOKEN باید حداقل ${MIN_TOKEN_LENGTH} نویسه تصادفی باشد.`,
    });
    if (this.cfg.isProduction && !this.cfg.cookieSecure) {
      results.push({
        id: 'cookie_secure',
        labelFa: 'کوکی امن (HTTPS)',
        ok: false,
        level: 'warning',
        messageFa: 'در محیط عملیاتی COOKIE_SECURE=true را تنظیم کنید و SSL را در cPanel فعال کنید.',
      });
    }
    return results;
  }

  private storageCheck(): CheckResult {
    try {
      fs.mkdirSync(this.cfg.storageDir, { recursive: true });
      const probe = path.join(this.cfg.storageDir, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { id: 'storage', labelFa: 'پوشه ذخیره‌سازی خصوصی', ok: true, level: 'ok', messageFa: 'قابل نوشتن است.' };
    } catch {
      return {
        id: 'storage',
        labelFa: 'پوشه ذخیره‌سازی خصوصی',
        ok: false,
        level: 'error',
        messageFa: 'پوشه storage قابل نوشتن نیست. مجوز پوشه را در File Manager بررسی کنید (معمولاً 755 یا 775).',
      };
    }
  }

  async install(input: InstallInput, ip: string | null): Promise<void> {
    if (this.isInstalled()) throw errors.conflict('نصب قبلاً انجام شده است.');
    if (this.installing) throw errors.conflict('نصب در حال انجام است. چند ثانیه صبر کنید.');
    if (this.failedTokenAttempts >= 10) throw errors.tooMany('تلاش‌های ناموفق زیاد بود. برای امنیت، برنامه را دوباره راه‌اندازی کنید.');
    if (this.cfg.installToken.length < MIN_TOKEN_LENGTH) {
      throw errors.badRequest('ابتدا INSTALL_TOKEN را در تنظیمات محیطی تعریف کنید.');
    }
    if (!safeEqual(input.token, this.cfg.installToken)) {
      this.failedTokenAttempts++;
      throw errors.badRequest('توکن نصب نادرست است.', { token: 'توکن نصب نادرست است.' });
    }
    this.installing = true;
    try {
      await this.runInstall(input, ip);
    } finally {
      this.installing = false;
    }
  }

  private async runInstall(input: InstallInput, ip: string | null): Promise<void> {
    const fe: Record<string, string> = {};
    if (normalizeText(input.fullName).length < 2) fe.fullName = 'نام مدیر را وارد کنید.';
    if (!USERNAME_RE.test(normalizeUsername(input.username))) fe.username = 'نام کاربری نامعتبر است (حروف انگلیسی، عدد، نقطه، خط تیره، زیرخط).';
    if (input.password.length < 10) fe.password = 'رمز عبور باید حداقل ۱۰ نویسه باشد.';
    else if (input.password.length > MAX_PASSWORD_LENGTH) fe.password = 'رمز عبور بیش از حد طولانی است.';
    if (input.password !== input.passwordConfirm) fe.passwordConfirm = 'تکرار رمز عبور با رمز عبور یکسان نیست.';
    if (normalizeText(input.instituteName).length < 2) fe.instituteName = 'نام رسمی مؤسسه را وارد کنید.';
    if (Object.keys(fe).length) throw errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);

    await new Migrator(this.db, this.migrationsDir).migrate();
    await this.rbac.syncCatalog();

    // Admin account, institute name and the "installed" marker are one transaction. If the lock file write
    // below fails, the marker still exists, so a retry can finish the install instead of getting stranded.
    const marker = await this.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM settings WHERE setting_key = ?`, [INSTALL_MARKER]);
    if (Number(marker[0]?.n ?? 0) === 0) {
      const [existing] = await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM users');
      if (Number(existing?.n ?? 0) > 0) {
        throw errors.conflict('کاربری در پایگاه داده وجود دارد اما نشانه نصب کامل نیست. با پشتیبان یا مدیر فنی تماس بگیرید.');
      }
      const adminId = await this.db.transaction(async (tx) => {
        const id = await this.users.createFirstSuperAdmin(tx, {
          username: input.username,
          fullName: input.fullName,
          email: input.email?.trim() || undefined,
          password: input.password,
        });
        await tx.execute(
          `INSERT INTO settings (setting_key, value_json, updated_by) VALUES ('institute.name_official', ?, ?)
           ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
          [JSON.stringify(normalizeText(input.instituteName)), id],
        );
        await tx.execute(
          `INSERT INTO settings (setting_key, value_json, updated_by) VALUES (?, ?, ?)`,
          [INSTALL_MARKER, JSON.stringify(new Date().toISOString()), id],
        );
        return id;
      });
      await this.audit.record({ action: 'system.installed', actorUserId: adminId, entityType: 'system', entityId: APP_VERSION, ip, details: { version: APP_VERSION } });
    }

    this.writeLockFile();
    this.onInstalled();
  }

  private writeLockFile(): void {
    fs.mkdirSync(this.cfg.storageDir, { recursive: true });
    try {
      fs.writeFileSync(
        this.cfg.installLockFile,
        JSON.stringify({ installedAt: new Date().toISOString(), version: APP_VERSION }, null, 2),
        { flag: 'wx' },
      );
    } catch (err) {
      if ((err as { code?: string }).code !== 'EEXIST') throw err;
    }
  }
}
