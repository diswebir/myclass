/**
 * Backup/Restore — دامپ DB با Node خالص (بدون mysqldump) + کپی فایل‌های ضروری + فهرست نسخه‌ها +
 * چک سازگاری بازیابی. (REQ-P7-02)
 * Layout: <STORAGE_DIR>/backups/<id>/{meta.json, dump.json, files/}
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { AuthUser } from '../../core/http/context';
import type { Config } from '../../core/config/env';
import { AppError } from '../../core/errors/AppError';
import { AuditService } from '../audit/audit.service';
import { nowDb } from '../../core/db/time';

/** Insert order (parents before children) — derived from FK dependencies. */
const TABLES: string[] = [
  'settings',
  'system_state',
  'modules_registry',
  'audit_log',
  'rate_limits',
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'user_sessions',
  'files',
  'teachers',
  'students',
  'courses',
  'classes',
  'class_teachers',
  'class_sessions',
  'prereg_forms',
  'preregistrations',
  'enrollments',
  'attendance',
  'payment_methods',
  'payments',
  'installments',
  'ledger_entries',
  'card_receipts',
  'certificate_templates',
  'certificates',
  'sms_patterns',
  'sms_events',
  'sms_queue',
  'notifications',
];

const BACKUP_FORMAT_VERSION = 1;
const ID_RE = /^[0-9]{8}-[0-9]{6}$/;
const INSERT_CHUNK = 100;

export interface BackupMeta {
  version: number;
  app: string;
  createdAt: string;
  dialect: string;
  schemaVersion: string;
  tables: number;
  rows: number;
  files: number;
  bytes: number;
}

export class BackupService {
  private readonly audit: AuditService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.audit = new AuditService(db);
  }

  private backupsDir(): string {
    return path.join(this.config.STORAGE_DIR, 'backups');
  }

  private async schemaVersion(): Promise<string> {
    // جدول migrations در typeهای Kysely نیست — raw SQL
    const res = (await sql`SELECT name FROM migrations ORDER BY name DESC LIMIT 1`.execute(this.db as never)) as unknown as {
      rows: Array<{ name: string }>;
    };
    return res.rows[0]?.name ?? 'none';
  }

  /** دامپ کامل DB به JSON — BIGINT به‌صورت string (بدون از دست رفتن دقت). */
  private async dumpDatabase(): Promise<{ tables: Record<string, Record<string, unknown>[]>; rows: number }> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    let rows = 0;
    for (const table of TABLES) {
      const data = (await sql`SELECT * FROM ${sql.table(table)}`.execute(this.db as never)) as unknown as {
        rows: Record<string, unknown>[];
      };
      tables[table] = data.rows ?? [];
      rows += tables[table].length;
    }
    return { tables, rows };
  }

  private copyDir(src: string, dest: string, skip: string[] = []): number {
    if (!fs.existsSync(src)) return 0;
    fs.mkdirSync(dest, { recursive: true });
    let count = 0;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (skip.includes(entry.name)) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) count += this.copyDir(s, d);
      else {
        fs.copyFileSync(s, d);
        count += 1;
      }
    }
    return count;
  }

  private removeDirContents(dir: string, keep: string[] = []): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (keep.includes(entry.name)) continue;
      fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    }
  }

  /** ساخت پشتیبان — DB + فایل‌ها. */
  async createBackup(actor: AuthUser): Promise<{ id: string; meta: BackupMeta }> {
    const id = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace(/T/, '-')
      .slice(0, 15); // YYYYMMDD-HHMMSS
    const dir = path.join(this.backupsDir(), id);
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });

    const { tables, rows } = await this.dumpDatabase();
    const schemaVersion = await this.schemaVersion();
    const dump = {
      meta: {
        version: BACKUP_FORMAT_VERSION,
        app: 'myclass',
        createdAt: nowDb(),
        dialect: this.config.DB_DRIVER,
        schemaVersion,
      },
      tables,
    };
    const dumpJson = JSON.stringify(dump);
    fs.writeFileSync(path.join(dir, 'dump.json'), dumpJson, 'utf8');
    const filesCount = this.copyDir(this.config.STORAGE_DIR, path.join(dir, 'files'), ['backups']);
    const bytes = fs.statSync(path.join(dir, 'dump.json')).size;
    const meta: BackupMeta = {
      version: BACKUP_FORMAT_VERSION,
      app: 'myclass',
      createdAt: dump.meta.createdAt,
      dialect: this.config.DB_DRIVER,
      schemaVersion,
      tables: TABLES.length,
      rows,
      files: filesCount,
      bytes,
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    await this.audit.log({
      actorId: actor.id,
      action: 'backup_created',
      module: 'backup',
      entityType: 'backup',
      entityId: 0,
      meta: { id, rows, files: filesCount, schemaVersion },
    });
    return { id, meta };
  }

  /** فهرست نسخه‌های پشتیبان. */
  async listBackups(): Promise<Array<{ id: string; meta: BackupMeta }>> {
    const dir = this.backupsDir();
    if (!fs.existsSync(dir)) return [];
    const out: Array<{ id: string; meta: BackupMeta }> = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => b.name.localeCompare(a.name))) {
      if (!entry.isDirectory()) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, entry.name, 'meta.json'), 'utf8')) as BackupMeta;
        out.push({ id: entry.name, meta });
      } catch {
        // پوشه ناقص — رد می‌شود
      }
    }
    return out;
  }

  /** بازیابی — چک سازگاری (نسخه قالب + نسخه اسکیما) → پاک‌سازی + درج + فایل‌ها. */
  async restoreBackup(actor: AuthUser, id: string): Promise<{ id: string; rows: number; files: number }> {
    if (!ID_RE.test(id)) throw AppError.badRequest('شناسه پشتیبان نامعتبر است.');
    const dir = path.join(this.backupsDir(), id);
    if (!fs.existsSync(dir)) throw AppError.notFound('پشتیبان یافت نشد.');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as BackupMeta;
    const currentSchema = await this.schemaVersion();
    if (meta.version !== BACKUP_FORMAT_VERSION) {
      throw AppError.conflict('قالب نسخه پشتیبان با نسخه فعلی سازگار نیست.');
    }
    if (meta.schemaVersion !== currentSchema) {
      throw AppError.conflict(
        `نسخه اسکیما سازگار نیست: پشتیبان ${meta.schemaVersion}، فعلی ${currentSchema}. ابتدا migration را اجرا کنید.`,
      );
    }
    const dump = JSON.parse(fs.readFileSync(path.join(dir, 'dump.json'), 'utf8')) as {
      tables: Record<string, Record<string, unknown>[]>;
    };

    // desligar FK — خارج از تراکنش (sqlite)
    if (this.config.DB_DRIVER === 'sqlite') {
      await sql`PRAGMA foreign_keys = OFF`.execute(this.db as never);
    } else {
      await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(this.db as never);
    }
    let rows = 0;
    try {
      await this.db.transaction().execute(async (trx) => {
        // پاک‌سازی — فرزند قبل از والد
        for (const table of [...TABLES].reverse()) {
          await sql`DELETE FROM ${sql.table(table)}`.execute(trx as never);
        }
        // درج — والد قبل از فرزند
        for (const table of TABLES) {
          const tableRows = dump.tables[table] ?? [];
          for (let i = 0; i < tableRows.length; i += INSERT_CHUNK) {
            const chunk = tableRows.slice(i, i + INSERT_CHUNK);
            if (chunk.length > 0) {
              await (trx as unknown as Kysely<Database>).insertInto(table as never).values(chunk as never).execute();
            }
          }
          rows += tableRows.length;
        }
      });
    } finally {
      if (this.config.DB_DRIVER === 'sqlite') {
        await sql`PRAGMA foreign_keys = ON`.execute(this.db as never);
      } else {
        await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(this.db as never);
      }
    }

    // بازیابی فایل‌ها — حذف محتوای فعلی (به‌جز backups) + کپی از پشتیبان
    const filesCount = this.copyDir(path.join(dir, 'files'), this.config.STORAGE_DIR, ['backups']);
    await this.audit.log({
      actorId: actor.id,
      action: 'backup_restored',
      module: 'backup',
      entityType: 'backup',
      entityId: 0,
      meta: { id, rows, files: filesCount, schemaVersion: meta.schemaVersion },
    });
    return { id, rows, files: filesCount };
  }
}
