import fs from 'fs';
import path from 'path';
import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { config } from '../../core/config';
import { logger } from '../../core/logger';
import { hashPassword, normalizeMobile } from '../../core/security';
import { runMigrations } from '../../core/migrator';
import { ConflictError, ValidationError } from '../../core/errors';

export interface EnvCheckResult {
  nodeVersion: string;
  nodeValid: boolean;
  storageWritable: boolean;
  publicWritable: boolean;
  dbConnected: boolean;
  dbError?: string;
  isAlreadyInstalled: boolean;
}

export class InstallerService {
  private lockFilePath: string;

  constructor(private db: Kysely<DatabaseSchema>) {
    this.lockFilePath = path.join(config.STORAGE_DIR, 'installed.lock');
  }

  async isInstalled(): Promise<boolean> {
    if (fs.existsSync(this.lockFilePath)) {
      return true;
    }
    try {
      const setting = await this.db
        .selectFrom('system_settings')
        .where('key', '=', 'installed')
        .select('value_json')
        .executeTakeFirst();
      if (setting && JSON.parse(setting.value_json) === true) {
        return true;
      }
    } catch {
      // If table doesn't exist, it's not installed
    }
    return false;
  }

  async checkEnvironment(): Promise<EnvCheckResult> {
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    const nodeValid = nodeMajor >= 18;

    let storageWritable = false;
    try {
      const testFile = path.join(config.STORAGE_DIR, '.write_test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      storageWritable = true;
    } catch {
      storageWritable = false;
    }

    let publicWritable = false;
    try {
      const testFile = path.join(config.PUBLIC_DIR, '.write_test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      publicWritable = true;
    } catch {
      publicWritable = false;
    }

    let dbConnected = false;
    let dbError: string | undefined;
    try {
      // Simple probe
      await this.db.selectFrom('system_settings').select('key').limit(1).execute();
      dbConnected = true;
    } catch (err: any) {
      // If table doesn't exist yet, we can check basic connection with raw probe
      try {
        const { sql } = require('kysely');
        await sql`SELECT 1`.execute(this.db);
        dbConnected = true;
      } catch (innerErr: any) {
        dbConnected = false;
        dbError = innerErr.message || 'عدم امکان اتصال به پایگاه داده';
      }
    }

    return {
      nodeVersion: process.version,
      nodeValid,
      storageWritable,
      publicWritable,
      dbConnected,
      dbError,
      isAlreadyInstalled: await this.isInstalled()
    };
  }

  async runInstall(adminData: {
    fullName: string;
    mobile: string;
    email?: string;
    password: string;
    institutionName?: string;
  }): Promise<{ message: string }> {
    if (await this.isInstalled()) {
      throw new ConflictError('سامانه قبلاً نصب شده است و دسترسی مجدد به نصب مسدود است.');
    }

    // 1. Run migrations and default seeds
    await runMigrations(this.db);

    // 2. Validate input
    const normalizedMobile = normalizeMobile(adminData.mobile);
    if (!normalizedMobile || normalizedMobile.length !== 11) {
      throw new ValidationError('شماره موبایل وارد شده نامعتبر است (الگوی صحیح: ۰۹۱۲۳۴۵۶۷۸۹).');
    }

    if (!adminData.password || adminData.password.length < 8) {
      throw new ValidationError('رمز عبور باید حداقل ۸ کاراکتر باشد.');
    }

    // 3. Find super_admin role
    const adminRole = await this.db
      .selectFrom('roles')
      .where('name', '=', 'super_admin')
      .selectAll()
      .executeTakeFirst();

    if (!adminRole) {
      throw new Error('نقش مدیر اصلی سامانه در دیتابیس یافت نشد.');
    }

    // 4. Create primary admin
    const passwordHash = await hashPassword(adminData.password);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const existingUser = await this.db
      .selectFrom('users')
      .where('mobile', '=', normalizedMobile)
      .select('id')
      .executeTakeFirst();

    if (!existingUser) {
      await this.db.insertInto('users').values({
        full_name: adminData.fullName,
        mobile: normalizedMobile,
        email: adminData.email || null,
        password_hash: passwordHash,
        role_id: adminRole.id!,
        status: 'active',
        avatar_path: null,
        must_change_password: 0,
        created_at: now,
        updated_at: now,
        deleted_at: null
      }).execute();
    }

    // 5. Update institution name if provided
    if (adminData.institutionName) {
      await this.db
        .updateTable('system_settings')
        .set({
          value_json: JSON.stringify(adminData.institutionName),
          updated_at: now
        })
        .where('key', '=', 'institution_name')
        .execute();
    }

    // 6. Mark installed in system_settings
    await this.db
      .updateTable('system_settings')
      .set({
        value_json: JSON.stringify(true),
        updated_at: now
      })
      .where('key', '=', 'installed')
      .execute();

    // 7. Write lock file
    try {
      fs.mkdirSync(path.dirname(this.lockFilePath), { recursive: true });
      fs.writeFileSync(
        this.lockFilePath,
        `INSTALLED_AT=${now}\nADMIN_MOBILE=${normalizedMobile}\nNODE_ENV=${config.NODE_ENV}\n`
      );
    } catch (err) {
      logger.error('Failed to create lock file in storage', err);
    }

    logger.info(`Installation completed successfully for admin: ${normalizedMobile}`);
    return { message: 'نصب با موفقیت انجام شد. اکنون می‌توانید با حساب مدیر وارد شوید.' };
  }
}
