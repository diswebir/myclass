import { AsyncLocalStorage } from 'node:async_hooks';
import type { Dialect, Driver, DriverName, ExecResult, Queryable, SqlValue } from './types';

export type { Dialect, Driver, DriverName, ExecResult, Queryable, SqlValue } from './types';

/** Raised when a query runs before an engine has been chosen and connected (fresh install). */
export class DbNotConfiguredError extends Error {
  readonly code = 'DB_NOT_CONFIGURED';
  constructor() {
    super('پایگاه داده هنوز انتخاب یا متصل نشده است.');
    this.name = 'DbNotConfiguredError';
  }
}

/**
 * Engine-independent facade used by every service. It forwards to the attached driver and keeps
 * nested calls inside a transaction or withConnection on the SAME connection. This matters for SQLite:
 * its single queued connection would otherwise wait on itself. All application SQL MUST use `?` placeholders.
 */
export class Database implements Queryable {
  private driver: Driver | null = null;
  private readonly scope = new AsyncLocalStorage<Queryable>();

  /** Attaches a connected driver. The previous driver, if any, is closed first. */
  async attach(driver: Driver): Promise<void> {
    const previous = this.driver;
    this.driver = driver;
    if (previous && previous !== driver) await previous.close().catch(() => undefined);
  }

  get isConnected(): boolean {
    return this.driver !== null;
  }

  get driverName(): DriverName | null {
    return this.driver?.name ?? null;
  }

  get dialect(): Dialect {
    return this.requireDriver().dialect;
  }

  private requireDriver(): Driver {
    if (!this.driver) throw new DbNotConfiguredError();
    return this.driver;
  }

  async query<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const scoped = this.scope.getStore();
    if (scoped) return scoped.query<T>(sql, params);
    return this.requireDriver().query<T>(sql, params);
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    const scoped = this.scope.getStore();
    if (scoped) return scoped.execute(sql, params);
    return this.requireDriver().execute(sql, params);
  }

  /** Runs `fn` on ONE connection. Session-scoped state such as a named lock stays on that connection. */
  async withConnection<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const scoped = this.scope.getStore();
    if (scoped) return fn(scoped);
    return this.requireDriver().withConnection(async (q) => this.scope.run(q, () => fn(q)));
  }

  /** Runs `fn` inside a transaction; rolls back on any thrown error. Nested calls join the outer transaction. */
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const scoped = this.scope.getStore();
    if (scoped) return fn(scoped);
    return this.requireDriver().transaction(async (tx) => this.scope.run(tx, () => fn(tx)));
  }

  async ping(): Promise<void> {
    await this.requireDriver().ping();
  }

  async close(): Promise<void> {
    const driver = this.driver;
    this.driver = null;
    if (driver) await driver.close();
  }
}
