import fs from 'fs';
import path from 'path';
import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { config, saveEffectiveDbConfig, getEffectiveDbConfig, DbConfig } from '../../core/config';
import { logger } from '../../core/logger';
import { hashPassword, normalizeMobile } from '../../core/security';
import { runMigrations } from '../../core/migrator';
import { ConflictError, ValidationError } from '../../core/errors';
import { reconnectDb, testDbConnection } from '../../core/db';

export interface EnvCheckResult {
  nodeVersion: string;
  nodeValid: boolean;
  storageWritable: boolean;
  publicWritable: boolean;
  dbConnected: boolean;
  dbError?: string;
  currentDialect: 'mysql' | 'sqlite';
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
    const currentConfig = getEffectiveDbConfig();

    try {
      const testRes = await testDbConnection(currentConfig);
      dbConnected = testRes.success;
      if (!testRes.success) {
        dbError = testRes.error;
      }
    } catch (err: any) {
      dbConnected = false;
      dbError = err.message || 'خطا در اتصال به پایگاه داده';
    }

    return {
      nodeVersion: process.version,
      nodeValid,
      storageWritable,
      publicWritable,
      dbConnected,
      dbError,
      currentDialect: currentConfig.dialect,
      isAlreadyInstalled: await this.isInstalled()
    };
  }

  async runInstall(adminData: {
    fullName: string;
    mobile: string;
    email?: string;
    password: string;
    institutionName?: string;
    dbDialect?: 'mysql' | 'sqlite';
    mysqlHost?: string;
    mysqlPort?: number;
    mysqlDatabase?: string;
    mysqlUser?: string;
    mysqlPassword?: string;
    sqlitePath?: string;
  }): Promise<{ message: string; dialectUsed: string }> {
    if (await this.isInstalled()) {
      throw new ConflictError('سامانه قبلاً نصب شده است و دسترسی مجدد به نصب مسدود است.');
    }

    // 1. Determine and configure database choice (MySQL vs SQLite)
    const dialect = adminData.dbDialect || (adminData.mysqlDatabase ? 'mysql' : 'sqlite');
    let dbConfigToSave: DbConfig;

    if (dialect === 'mysql') {
      const host = adminData.mysqlHost || config.DB_HOST || 'localhost';
      const port = Number(adminData.mysqlPort || config.DB_PORT || 3306);
      const database = adminData.mysqlDatabase || config.DB_NAME;
      const user = adminData.mysqlUser || config.DB_USER;
      const password = adminData.mysqlPassword !== undefined ? adminData.mysqlPassword : config.DB_PASSWORD;

      if (!database || !user) {
        throw new ValidationError('برای نصب با پایگاه داده MySQL، وارد کردن نام دیتابیس و نام کاربری الزامی است.');
      }

      dbConfigToSave = {
        dialect: 'mysql',
        mysql: { host, port, database, user, password }
      };

      // Test connection before applying
      const testRes = await testDbConnection(dbConfigToSave);
      if (!testRes.success) {
        throw new ValidationError(`عدم امکان برقراری ارتباط با MySQL: ${testRes.error}`);
      }
    } else {
      // SQLite
      const sqliteFile = adminData.sqlitePath || (process.env.NODE_ENV === 'test' ? ':memory:' : path.join(config.STORAGE_DIR, 'database.sqlite'));
      if (sqliteFile !== ':memory:') {
        fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
      }

      dbConfigToSave = {
        dialect: 'sqlite',
        sqlitePath: sqliteFile
      };
    }

    // Save choice to storage/db-config.json
    if (process.env.NODE_ENV !== 'test' || adminData.sqlitePath) {
      saveEffectiveDbConfig(dbConfigToSave);
    }

    // Determine if we need to reconnect db
    const currentConfig = getEffectiveDbConfig();
    const isTest = process.env.NODE_ENV === 'test';
    let activeDb = this.db;

    if (!isTest && currentConfig.dialect !== dialect) {
      activeDb = await reconnectDb(dbConfigToSave);
      this.db = activeDb;
    } else if (isTest && adminData.sqlitePath) {
      activeDb = await reconnectDb(dbConfigToSave);
      this.db = activeDb;
    }

    // 2. Run migrations and default seeds on active database
    await runMigrations(activeDb);

    // 3. Validate user input
    const normalizedMobile = normalizeMobile(adminData.mobile);
    if (!normalizedMobile || normalizedMobile.length !== 11) {
      throw new ValidationError('شماره موبایل وارد شده نامعتبر است (الگوی صحیح: ۰۹۱۲۳۴۵۶۷۸۹).');
    }

    if (!adminData.password || adminData.password.length < 8) {
      throw new ValidationError('رمز عبور باید حداقل ۸ کاراکتر باشد.');
    }

    // 4. Find super_admin role
    const adminRole = await activeDb
      .selectFrom('roles')
      .where('name', '=', 'super_admin')
      .selectAll()
      .executeTakeFirst();

    if (!adminRole) {
      throw new Error('نقش مدیر اصلی سامانه در دیتابیس یافت نشد.');
    }

    // 5. Create primary admin
    const passwordHash = await hashPassword(adminData.password);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const existingUser = await activeDb
      .selectFrom('users')
      .where('mobile', '=', normalizedMobile)
      .select('id')
      .executeTakeFirst();

    if (!existingUser) {
      await activeDb.insertInto('users').values({
        full_name: adminData.fullName.trim(),
        mobile: normalizedMobile,
        email: adminData.email ? adminData.email.trim().toLowerCase() : null,
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

    // 6. Update institution name if provided
    if (adminData.institutionName) {
      await activeDb
        .updateTable('system_settings')
        .set({
          value_json: JSON.stringify(adminData.institutionName.trim()),
          updated_at: now
        })
        .where('key', '=', 'institution_name')
        .execute();
    }

    // 7. Mark installed in system_settings
    await activeDb
      .updateTable('system_settings')
      .set({
        value_json: JSON.stringify(true),
        updated_at: now
      })
      .where('key', '=', 'installed')
      .execute();

    // 8. Write lock file
    try {
      fs.mkdirSync(path.dirname(this.lockFilePath), { recursive: true });
      fs.writeFileSync(
        this.lockFilePath,
        `INSTALLED_AT=${now}\nADMIN_MOBILE=${normalizedMobile}\nDB_DIALECT=${dialect}\nNODE_ENV=${config.NODE_ENV}\n`
      );
    } catch (err) {
      logger.error('Failed to create lock file in storage', err);
    }

    logger.info(`Installation completed successfully for admin: ${normalizedMobile} (Dialect: ${dialect})`);
    return {
      message: `سامانه با موفقیت روی پایگاه داده (${dialect.toUpperCase()}) نصب شد. اکنون می‌توانید با حساب مدیر وارد شوید.`,
      dialectUsed: dialect
    };
  }
}
