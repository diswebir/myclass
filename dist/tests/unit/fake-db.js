"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fakeDb = fakeDb;
const dialects_1 = require("../../db/dialects");
function fakeDb(respond = () => []) {
    const calls = [];
    const events = [];
    let nextConn = 1;
    const run = (conn, kind, sql, params) => {
        calls.push({ conn, kind, sql, params });
        const out = respond(sql, params);
        if (kind === 'query')
            return Promise.resolve(Array.isArray(out) ? out : []);
        return Promise.resolve(out && !Array.isArray(out) ? { affectedRows: out.affectedRows ?? 0, insertId: out.insertId ?? 0 } : { affectedRows: 0, insertId: 0 });
    };
    const makeQueryable = (conn) => ({
        query: (sql, params = []) => run(conn, 'query', sql, params),
        execute: (sql, params = []) => run(conn, 'execute', sql, params),
    });
    const db = {
        calls,
        events,
        ...makeQueryable(0),
        dialect: dialects_1.mysqlDialect,
        driverName: 'mysql',
        ping: async () => undefined,
        withConnection: async (fn) => {
            const conn = nextConn++;
            events.push(`acquire:${conn}`);
            try {
                return await fn(makeQueryable(conn));
            }
            finally {
                events.push(`release:${conn}`);
            }
        },
        transaction: async (fn) => db.withConnection(async (q) => {
            await q.query('START TRANSACTION');
            const result = await fn(q);
            await q.query('COMMIT');
            return result;
        }),
    };
    return db;
}
