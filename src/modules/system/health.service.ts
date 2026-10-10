import fs from 'node:fs';
import type { AppConfig } from '../../config/env';
import type { Database } from '../../db/database';
import { Migrator, type MigrationStatus } from '../../db/migrator';
import { APP_VERSION } from '../../version';
import { MODULES } from '../registry';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  nodeVersion: string;
  uptimeSeconds: number;
  installed: boolean;
  database: { ok: boolean; latencyMs: number | null; message: string };
  migrations: { appliedCount: number; pending: string[]; modified: string[] } | null;
  storageWritable: boolean;
  modules: { id: string; nameFa: string; version: string; dependencies: string[]; core: boolean }[];
  warnings: string[];
}

/** Health report. Never includes secrets, connection strings or stack traces. */
export class HealthService {
  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Database,
    private readonly migrationsDir: string,
    private readonly isInstalled: () => boolean,
  ) {}

  async report(): Promise<HealthReport> {
    const warnings: string[] = [];
    let database: HealthReport['database'] = { ok: false, latencyMs: null, message: 'اتصال برقرار نیست.' };
    let migrations: HealthReport['migrations'] = null;
    const started = Date.now();
    try {
      await this.db.ping();
      database = { ok: true, latencyMs: Date.now() - started, message: 'اتصال برقرار است.' };
      const status: MigrationStatus = await new Migrator(this.db, this.migrationsDir).status();
      migrations = { appliedCount: status.applied.length, pending: status.pending, modified: status.modified };
      if (status.pending.length) warnings.push('migration‌های در انتظار اجرا وجود دارد.');
      if (status.modified.length) warnings.push('یک فایل migration اعمال‌شده تغییر کرده است.');
    } catch {
      warnings.push('خطا در ارتباط با پایگاه داده.');
    }
    let storageWritable = true;
    try {
      fs.mkdirSync(this.cfg.storageDir, { recursive: true });
      fs.accessSync(this.cfg.storageDir, fs.constants.W_OK);
    } catch {
      storageWritable = false;
      warnings.push('پوشه ذخیره‌سازی قابل نوشتن نیست.');
    }
    const installed = this.isInstalled();
    if (installed && this.cfg.installToken) {
      warnings.push('INSTALL_TOKEN هنوز در تنظیمات محیطی است؛ پس از نصب آن را حذف کنید.');
    }
    if (this.cfg.isProduction && !this.cfg.cookieSecure) warnings.push('COOKIE_SECURE فعال نیست.');
    const status: HealthReport['status'] = !database.ok ? 'error' : warnings.length ? 'degraded' : 'ok';
    return {
      status,
      version: APP_VERSION,
      nodeVersion: process.versions.node,
      uptimeSeconds: Math.round(process.uptime()),
      installed,
      database,
      migrations,
      storageWritable,
      modules: MODULES.map((m) => ({ id: m.id, nameFa: m.nameFa, version: m.version, dependencies: m.dependencies, core: m.core })),
      warnings,
    };
  }
}
