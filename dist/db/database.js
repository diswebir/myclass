"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
/** mysql2 marks connection-level failures with fatal: true; ordinary SQL errors keep the connection usable. */
function isFatal(err) {
    return Boolean(err?.fatal);
}
/**
 * Thin data-access wrapper over mysql2 (pure JavaScript driver, no native build).
 * All application SQL MUST use `?` placeholders; string concatenation of user input is forbidden.
 */
class Database {
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
        const [rows] = await this.pool.query(sql, params);
        return rows;
    }
    async execute(sql, params = []) {
        const [res] = await this.pool.execute(sql, params);
        return res;
    }
    /**
     * Runs `fn` on ONE pooled connection. Required for session-scoped state such as GET_LOCK/RELEASE_LOCK.
     * If any statement fails, the connection is destroyed instead of returned to the pool, so session
     * state (like a named lock) cannot leak into later requests.
     */
    async withConnection(fn) {
        const conn = await this.pool.getConnection();
        let broken = false;
        const q = {
            query: async (sql, params = []) => {
                try {
                    const [rows] = await conn.query(sql, params);
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
                    const [res] = await conn.execute(sql, params);
                    return res;
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
            if (broken)
                conn.destroy();
            else
                conn.release();
        }
    }
    /** Runs `fn` inside a transaction; rolls back on any thrown error. */
    async transaction(fn) {
        return this.withConnection(async (q) => {
            // The transaction runs on the same pinned connection.
            await q.query('START TRANSACTION');
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
exports.Database = Database;
