import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './database';
import type { Queryable } from './types';

export interface MigrationFile {
  version: string; // e.g. "001"
  name: string; // e.g. "foundation"
  file: string;
  checksum: string;
  statements: string[];
}

/**
 * Migration files live in /migrations as NNN_name.sql.
 * Statements are separated by a line containing exactly `-- @@` so the runner never has to parse SQL.
 * MySQL performs implicit commits for DDL, so every statement must be idempotent-friendly and
 * the migration is recorded only after all its statements succeed.
 */
export function loadMigrations(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const seen = new Set<string>();
  return files.map((f) => {
    const version = f.slice(0, 3);
    if (seen.has(version)) throw new Error(`شماره migration تکراری است: ${version}`);
    seen.add(version);
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const statements = content
      .split(/^-- @@\s*$/m)
      .map((s) => s.replace(/^(\s*--[^\n]*(\n|$))+/, '').trim())
      .filter((s) => s.length > 0);
    return {
      version,
      name: f.slice(4, -4),
      file: f,
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
      statements,
    };
  });
}

export interface MigrationStatus {
  applied: { version: string; name: string; checksum: string; appliedAt: string }[];
  pending: string[];
  modified: string[];
}

const LOCK_NAME = 'myclass_migrations';

export class Migrator {
  /** @param root the migrations directory; the engine's own subfolder (mysql/ or sqlite/) is used. */
  constructor(
    private readonly db: Database,
    private readonly root: string,
  ) {}

  private get dir(): string {
    return path.join(this.root, this.db.dialect.name);
  }

  private async ensureTable(): Promise<void> {
    await this.db.execute(this.db.dialect.migrationsTableDdl);
  }

  async status(): Promise<MigrationStatus> {
    await this.ensureTable();
    return this.statusOn(this.db);
  }

  private async statusOn(q: Queryable): Promise<MigrationStatus> {
    const files = loadMigrations(this.dir);
    const rows = await q.query<{ version: string; name: string; checksum: string; applied_at: Date }>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    );
    const appliedMap = new Map(rows.map((r) => [r.version, r]));
    const modified = files
      .filter((f) => appliedMap.has(f.version) && appliedMap.get(f.version)!.checksum !== f.checksum)
      .map((f) => f.file);
    return {
      applied: rows.map((r) => ({
        version: r.version,
        name: r.name,
        checksum: r.checksum,
        appliedAt: new Date(r.applied_at).toISOString(),
      })),
      pending: files.filter((f) => !appliedMap.has(f.version)).map((f) => f.file),
      modified,
    };
  }

  /**
   * Applies all pending migrations. Refuses to run if an applied migration file was edited.
   * The named lock (MySQL), the status read and every statement run on ONE connection: GET_LOCK is
   * session-scoped, so releasing it on a different connection would leave the lock held.
   */
  async migrate(): Promise<{ applied: string[] }> {
    await this.ensureTable();
    // MySQL needs an explicit named lock across processes. SQLite is one file per process and its driver
    // already serialises statements, so no lock is taken there.
    const useLock = this.db.dialect.name === 'mysql';
    return this.db.withConnection(async (q) => {
      if (useLock) {
        const lock = await q.query<{ got: number | null }>('SELECT GET_LOCK(?, 10) AS got', [LOCK_NAME]);
        if (!lock[0] || lock[0].got !== 1) throw new Error('اجرای migration در حال انجام است. کمی بعد دوباره تلاش کنید.');
      }
      try {
        const status = await this.statusOn(q);
        if (status.modified.length > 0) {
          throw new Error(`فایل migration تغییر کرده است: ${status.modified.join(', ')}`);
        }
        const files = loadMigrations(this.dir);
        const applied: string[] = [];
        for (const m of files) {
          if (status.applied.some((a) => a.version === m.version)) continue;
          await this.applyOne(q, m);
          applied.push(m.file);
        }
        return { applied };
      } finally {
        if (useLock) await q.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
      }
    });
  }

  private async applyOne(q: Queryable, m: MigrationFile): Promise<void> {
    const started = Date.now();
    for (const stmt of m.statements) {
      await q.execute(stmt);
    }
    const elapsed = Math.min(Date.now() - started, 4294967295);
    await q.execute(
      'INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES (?, ?, ?, ?)',
      [m.version, m.name, m.checksum, elapsed],
    );
  }
}

export type { Queryable };
