"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlDriver = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const dialects_1 = require("./dialects");
/** mysql2 marks connection-level failures with fatal: true; ordinary SQL errors keep the connection usable. */
function isFatal(err) {
    return Boolean(err?.fatal);
}
/** mysql2 rejects `undefined` bind values; the data layer treats them as SQL NULL. */
function bind(params) {
    return params.map((v) => (v === undefined ? null : v));
}
/** Pure JavaScript MySQL/MariaDB driver (mysql2). No native build, so it runs on cPanel shared hosting. */
class MysqlDriver {
    name = 'mysql';
    dialect = dialects_1.mysqlDialect;
    pool;
    constructor(cfg) {
        this.pool = promise_1.default.createPool({
            host: cfg.host,
            port: cfg.port,
            database: cfg.name,
            user: cfg.user,
            password: cfg.password,
            waitForConnections: true,
            connectionLimit: cfg.connectionLimit,
            charset: 'utf8mb4',
            timezone: 'Z', // DATETIME values are stored and read as UTC
            dateStrings: false,
            namedPlaceholders: false,
        });
    }
    async query(sql, params = []) {
        const [rows] = await this.pool.query(sql, bind(params));
        return rows;
    }
    async execute(sql, params = []) {
        const [res] = await this.pool.execute(sql, bind(params));
        const h = res;
        return { insertId: Number(h.insertId), affectedRows: Number(h.affectedRows) };
    }
    async withConnection(fn) {
        const conn = await this.pool.getConnection();
        let broken = false;
        const q = {
            query: async (sql, params = []) => {
                try {
                    const [rows] = await conn.query(sql, bind(params));
                    return rows;
                }
                catch (err) {
                    if (isFatal(err))
                        broken = true;
                    throw err;
                }
            },
            execute: async (sql, params = []) => {
                try {
                    const [res] = await conn.execute(sql, bind(params));
                    const h = res;
                    return { insertId: Number(h.insertId), affectedRows: Number(h.affectedRows) };
                }
                catch (err) {
                    if (isFatal(err))
                        broken = true;
                    throw err;
                }
            },
        };
        try {
            return await fn(q);
        }
        finally {
            // A connection that failed at protocol level is destroyed so session state cannot leak to later requests.
            if (broken)
                conn.destroy();
            else
                conn.release();
        }
    }
    async transaction(fn) {
        return this.withConnection(async (q) => {
            await q.query(this.dialect.beginSql);
            try {
                const result = await fn(q);
                await q.query('COMMIT');
                return result;
            }
            catch (err) {
                await q.query('ROLLBACK').catch(() => undefined);
                throw err;
            }
        });
    }
    async ping() {
        await this.pool.query('SELECT 1');
    }
    async close() {
        await this.pool.end();
    }
}
exports.MysqlDriver = MysqlDriver;
