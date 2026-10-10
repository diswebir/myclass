/** Parameter values accepted by the data layer. Dates are always bound as JS Date (UTC instant). */
export type SqlValue = string | number | bigint | boolean | Date | null | undefined;

export type DriverName = 'mysql' | 'sqlite';

/** Result of a write statement, normalised across drivers. */
export interface ExecResult {
  insertId: number;
  affectedRows: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<ExecResult>;
}

/** SQL fragments that differ between engines. Application code uses these instead of hard-coding one dialect. */
export interface Dialect {
  name: DriverName;
  /** Prefix for an insert that silently skips duplicate-key rows, e.g. "INSERT IGNORE". */
  insertIgnore: string;
  /** Suffix for a row-locking read, or '' when the engine serialises writers anyway. */
  forUpdate: string;
  /** Clause to append to a LIKE predicate so that backslash escapes work. */
  likeEscape: string;
  /** Assignment that copies the value that would have been inserted (used inside an upsert). */
  incoming(column: string): string;
  /** Upsert tail appended to an INSERT. `conflict` is the unique key columns, `assignments` the SET list. */
  upsert(conflict: string[], assignments: string[]): string;
  beginSql: string;
  migrationsTableDdl: string;
}

/** A connected database engine. Implementations must queue or pin connections as their engine requires. */
export interface Driver extends Queryable {
  readonly name: DriverName;
  readonly dialect: Dialect;
  /** Runs `fn` on ONE connection; session-scoped state (named locks) stays on that connection. */
  withConnection<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Runs `fn` inside a transaction on one connection; rolls back on any thrown error. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
