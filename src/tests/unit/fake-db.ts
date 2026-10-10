/**
 * In-memory stand-in for the Database wrapper, used by unit tests of service logic that need to observe
 * the SQL issued and the connection each statement ran on. It is NOT a SQL engine: each test supplies
 * the rows a query should return.
 */
export interface RecordedCall {
  conn: number;
  kind: 'query' | 'execute';
  sql: string;
  params: unknown[];
}

import { mysqlDialect } from '../../db/dialects';

export type Responder = (sql: string, params: unknown[]) => unknown[] | { affectedRows?: number; insertId?: number } | undefined;

export function fakeDb(respond: Responder = () => []) {
  const calls: RecordedCall[] = [];
  const events: string[] = [];
  let nextConn = 1;

  const run = (conn: number, kind: 'query' | 'execute', sql: string, params: unknown[]) => {
    calls.push({ conn, kind, sql, params });
    const out = respond(sql, params);
    if (kind === 'query') return Promise.resolve(Array.isArray(out) ? out : []);
    return Promise.resolve(out && !Array.isArray(out) ? { affectedRows: out.affectedRows ?? 0, insertId: out.insertId ?? 0 } : { affectedRows: 0, insertId: 0 });
  };

  const makeQueryable = (conn: number) => ({
    query: (sql: string, params: unknown[] = []) => run(conn, 'query', sql, params),
    execute: (sql: string, params: unknown[] = []) => run(conn, 'execute', sql, params),
  });

  const db = {
    calls,
    events,
    ...makeQueryable(0),
    dialect: mysqlDialect,
    driverName: 'mysql' as const,
    ping: async () => undefined,
    withConnection: async <T>(fn: (q: ReturnType<typeof makeQueryable>) => Promise<T>): Promise<T> => {
      const conn = nextConn++;
      events.push(`acquire:${conn}`);
      try {
        return await fn(makeQueryable(conn));
      } finally {
        events.push(`release:${conn}`);
      }
    },
    transaction: async <T>(fn: (q: ReturnType<typeof makeQueryable>) => Promise<T>): Promise<T> =>
      db.withConnection(async (q) => {
        await q.query('START TRANSACTION');
        const result = await fn(q);
        await q.query('COMMIT');
        return result;
      }),
  };
  return db;
}
