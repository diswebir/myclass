"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
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
    /** Runs `fn` inside a transaction; rolls back on any thrown error. */
    async transaction(fn) {
        const conn = await this.pool.getConnection();
        try {
            await conn.beginTransaction();
            const tx = {
                query: async (sql, params = []) => {
                    const [rows] = await conn.query(sql, params);
                    return rows;
                },
                execute: async (sql, params = []) => {
                    const [res] = await conn.execute(sql, params);
                    return res;
                },
            };
            const result = await fn(tx);
            await conn.commit();
            return result;
        }
        catch (err) {
            await conn.rollback();
            throw err;
        }
        finally {
            conn.release();
        }
    }
    async ping() {
        await this.pool.query('SELECT 1');
    }
    async close() {
        await this.pool.end();
    }
}
exports.Database = Database;
