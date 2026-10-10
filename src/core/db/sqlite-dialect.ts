/**
 * Kysely Dialect برای SQLite — با ماژول داخلی `node:sqlite` (Node >= 22.5).
 * فقط برای تست/توسعه — Production از MySQL (mysql2) استفاده می‌کند. JS خالص، بدون addon native.
 */
import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
} from 'kysely';
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely';

// --- لود ماژول داخلی node:sqlite (بدون import استاتیک — vite/tsc آن را resolve نمی‌کنند) ---
interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}
type DatabaseSyncCtor = new (path: string) => SqliteDatabase;

function loadDatabaseSync(): DatabaseSyncCtor {
  const proc = process as unknown as { getBuiltinModule?: (id: string) => unknown };
  if (typeof proc.getBuiltinModule === 'function') {
    return (proc.getBuiltinModule('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  }
  // fallback برای Nodeهای قدیمی‌تر (CJS)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
}

const DatabaseSync = loadDatabaseSync();

function normalizeParam(p: unknown): null | number | bigint | string | Uint8Array {
  if (p === null || p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p instanceof Date) return p.toISOString();
  if (p instanceof Uint8Array) return p;
  if (typeof p === 'object') return JSON.stringify(p);
  return p as null | number | bigint | string | Uint8Array;
}

class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: SqliteDatabase) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const stmt = this.db.prepare(compiledQuery.sql);
    const params = compiledQuery.parameters.map(normalizeParam);
    const isRead = /^\s*(select|pragma|with|explain|show)/i.test(compiledQuery.sql);
    if (isRead) {
      const rows = stmt.all(...(params as never[])) as R[];
      return { rows };
    }
    const res = stmt.run(...(params as never[]));
    return {
      rows: [],
      numAffectedRows: BigInt(res.changes),
      insertId: BigInt(res.lastInsertRowid),
    };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming در این dialect پشتیبانی نمی‌شود.');
  }
}

class NodeSqliteDriver implements Driver {
  private readonly db: SqliteDatabase;
  private readonly conn: NodeSqliteConnection;
  private txDepth = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.conn = new NodeSqliteConnection(this.db);
  }

  async init(): Promise<void> {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = OFF');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.conn;
  }

  async releaseConnection(): Promise<void> {
    // یک اتصال تکی — کاری برای آزادسازی نیست
  }

  async beginTransaction(): Promise<void> {
    if (this.txDepth === 0) this.db.exec('BEGIN');
    else this.db.exec(`SAVEPOINT sp${this.txDepth}`);
    this.txDepth++;
  }

  async commitTransaction(): Promise<void> {
    this.txDepth--;
    if (this.txDepth === 0) this.db.exec('COMMIT');
    else this.db.exec(`RELEASE SAVEPOINT sp${this.txDepth}`);
  }

  async rollbackTransaction(): Promise<void> {
    this.txDepth--;
    if (this.txDepth === 0) this.db.exec('ROLLBACK');
    else this.db.exec(`ROLLBACK TO SAVEPOINT sp${this.txDepth}`);
  }

  async destroy(): Promise<void> {
    this.db.close();
  }
}

export class NodeSqliteDialect implements Dialect {
  constructor(private readonly path: string) {}

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new NodeSqliteDriver(this.path);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}
