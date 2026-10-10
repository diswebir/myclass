/**
 * اجرای‌کننده migration سفارشی (per spec §۲):
 * - نسخه‌بندی‌شده، قابل ردیابی (جدول `migrations`)
 * - فایل‌ها: migrations/NNNN_name.ts|js با `export async function up(db)`
 * - ترتیب الفبایی؛ run نشده‌ها اجرا می‌شوند.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { nowDb } from './time';
import { detectDialect, type DbDialectName } from './database';

export interface MigrateOptions {
  dir?: string;
  dialect?: DbDialectName;
}

export interface MigrateResult {
  ran: string[];
  dialect: DbDialectName;
}

function defaultMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'migrations'), // prod: dist/migrations
    path.join(__dirname, '..', '..', '..', 'migrations'), // dev/test: <root>/migrations (TS)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export async function ensureMigrationsTable(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('migrations')
    .ifNotExists()
    .addColumn('name', 'varchar(255)', (c) => c.primaryKey())
    .addColumn('executed_at', 'varchar(32)', (c) => c.notNull())
    .execute();
}

export async function listExecuted(db: Kysely<any>): Promise<Set<string>> {
  await ensureMigrationsTable(db);
  const rows = await db.selectFrom('migrations').select('name').execute();
  return new Set(rows.map((r) => r.name));
}

export async function migrateToLatest(
  db: Kysely<any>,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const dir = options.dir ?? defaultMigrationsDir();
  const dialect = options.dialect ?? detectDialect(db);
  const executed = await listExecuted(db);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+.*\.(ts|js)$/.test(f))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    const name = file.replace(/\.(ts|js)$/, '');
    if (executed.has(name)) continue;
    // مسیر نسبی/مطلق ساده — در CJS (dist) به require تبدیل می‌شود؛ file:// در CJS کار نمی‌کند
    const mod = (await import(path.join(dir, file))) as {
      up: (db: Kysely<any>, ctx: { dialect: DbDialectName }) => Promise<void>;
    };
    if (typeof mod.up !== 'function') {
      throw new Error(`migration ${file} تابع up ندارد`);
    }
    await mod.up(db, { dialect });
    await db.insertInto('migrations').values({ name, executed_at: nowDb() }).execute();
    ran.push(name);
  }
  return { ran, dialect };
}
