import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import { sqliteDialect } from './dialects';
import { fromDbDateText, toDbDateText } from './dates';
import type { Dialect, Driver, ExecResult, Queryable, SqlValue } from './types';

/**
 * SQLite driver built on sql.js (SQLite compiled to WebAssembly). It needs no native module and no
 * server process, which makes it installable on cPanel shared hosting without SSH.
 *
 * Model: one in-process database image. Every operation is queued, so statements never interleave.
 * After each write the image is exported and written atomically (temp file + rename), so a crash
 * leaves either the previous or the new file on disk. Intended for ONE Node process per database file.
 */

let wasmPromise: Promise<SqlJsStatic> | null = null;
function loadSqlJs(): Promise<SqlJsStatic> {
  wasmPromise ??= initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  return wasmPromise;
}

type Row = Record<string, unknown>;

function bindValue(v: SqlValue): string | number | Uint8Array | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return toDbDateText(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function bindAll(params: SqlValue[]): (string | number | Uint8Array | null)[] {
  return params.map(bindValue);
}

/** Maps SQLite constraint messages onto the MySQL error codes the services already understand. */
function normalizeError(err: unknown): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = e.message;
  const code = (e as { code?: string }).code;
  if (code === 'ER_DUP_ENTRY' || code === 'ER_ROW_IS_REFERENCED_2') return e;
  if (/UNIQUE constraint failed|PRIMARY KEY must be unique/.test(msg)) {
    (e as { code?: string }).code = 'ER_DUP_ENTRY';
  } else if (/FOREIGN KEY constraint failed/.test(msg)) {
    (e as { code?: string }).code = 'ER_ROW_IS_REFERENCED_2';
  }
  return e;
}

export class SqliteDriver implements Driver {
  readonly name = 'sqlite' as const;
  readonly dialect: Dialect = sqliteDialect;
  private db: SqlJsDatabase | null = null;
  private dirty = false;
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    db: SqlJsDatabase,
  ) {
    this.db = db;
    this.configure(db);
  }

  /** Opens (or creates) the database file. The parent directory must already exist and be writable. */
  static async open(filePath: string): Promise<SqliteDriver> {
    const SQL = await loadSqlJs();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const image = fs.existsSync(filePath) ? new Uint8Array(fs.readFileSync(filePath)) : undefined;
    const driver = new SqliteDriver(filePath, new SQL.Database(image));
    driver.dirty = !image;
    await driver.enqueue(async () => {
      if (driver.dirty) driver.persistNow();
    });
    return driver;
  }

  /** Foreign keys are off by default in SQLite and reset whenever the image is exported, so set them here. */
  private configure(db: SqlJsDatabase): void {
    db.run('PRAGMA foreign_keys = ON');
  }

  private get conn(): SqlJsDatabase {
    if (!this.db) throw new Error('پایگاه داده SQLite بسته شده است.');
    return this.db;
  }

  /** Serialises every operation; `persist` runs after each queued job that wrote something. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      try {
        return await job();
      } finally {
        if (this.dirty && this.db) this.persistNow();
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private persistNow(): void {
    const data = this.conn.export();
    this.configure(this.conn); // export() reopens the image and resets pragmas
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, Buffer.from(data), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    this.dirty = false;
  }

  private rawQuery<T>(sql: string, params: SqlValue[]): T[] {
    const stmt = this.conn.prepare(sql);
    try {
      stmt.bind(bindAll(params) as never);
      const rows: T[] = [];
      while (stmt.step()) {
        const raw = stmt.getAsObject() as Row;
        const row: Row = {};
        for (const [k, v] of Object.entries(raw)) {
          row[k] = k.endsWith('_at') ? fromDbDateText(v) : v;
        }
        rows.push(row as T);
      }
      return rows;
    } catch (err) {
      throw normalizeError(err);
    } finally {
      stmt.free();
    }
  }

  private rawExecute(sql: string, params: SqlValue[]): ExecResult {
    try {
      this.conn.run(sql, bindAll(params) as never);
    } catch (err) {
      throw normalizeError(err);
    }
    this.dirty = true;
    const [info] = this.conn.exec('SELECT last_insert_rowid() AS id, changes() AS n');
    const id = Number(info?.values[0]?.[0] ?? 0);
    const n = Number(info?.values[0]?.[1] ?? 0);
    return { insertId: id, affectedRows: n };
  }

  /** Queryable bound to the connection that currently holds the queue (used inside transactions). */
  private readonly direct: Queryable = {
    query: async <T>(sql: string, params: SqlValue[] = []) => this.rawQuery<T>(sql, params),
    execute: async (sql: string, params: SqlValue[] = []) => this.rawExecute(sql, params),
  };

  async query<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.enqueue(async () => this.rawQuery<T>(sql, params));
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    return this.enqueue(async () => this.rawExecute(sql, params));
  }

  async withConnection<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.enqueue(() => fn(this.direct));
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.rawExecute(this.dialect.beginSql, []);
      try {
        const result = await fn(this.direct);
        this.rawExecute('COMMIT', []);
        return result;
      } catch (err) {
        try {
          this.rawExecute('ROLLBACK', []);
        } catch {
          // The original error is more useful to the caller than a rollback failure.
        }
        throw err;
      }
    });
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.db) return;
      this.persistNow();
      this.db.close();
      this.db = null;
    });
  }
}
