"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteDriver = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const sql_js_1 = __importDefault(require("sql.js"));
const dialects_1 = require("./dialects");
const dates_1 = require("./dates");
/**
 * SQLite driver built on sql.js (SQLite compiled to WebAssembly). It needs no native module and no
 * server process, which makes it installable on cPanel shared hosting without SSH.
 *
 * Model: one in-process database image. Every operation is queued, so statements never interleave.
 * After each write the image is exported and written atomically (temp file + rename), so a crash
 * leaves either the previous or the new file on disk. Intended for ONE Node process per database file.
 */
let wasmPromise = null;
function loadSqlJs() {
    wasmPromise ??= (0, sql_js_1.default)({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    return wasmPromise;
}
function bindValue(v) {
    if (v === undefined || v === null)
        return null;
    if (v instanceof Date)
        return (0, dates_1.toDbDateText)(v);
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (typeof v === 'bigint')
        return v.toString();
    return v;
}
function bindAll(params) {
    return params.map(bindValue);
}
/** Maps SQLite constraint messages onto the MySQL error codes the services already understand. */
function normalizeError(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const msg = e.message;
    const code = e.code;
    if (code === 'ER_DUP_ENTRY' || code === 'ER_ROW_IS_REFERENCED_2')
        return e;
    if (/UNIQUE constraint failed|PRIMARY KEY must be unique/.test(msg)) {
        e.code = 'ER_DUP_ENTRY';
    }
    else if (/FOREIGN KEY constraint failed/.test(msg)) {
        e.code = 'ER_ROW_IS_REFERENCED_2';
    }
    return e;
}
class SqliteDriver {
    filePath;
    name = 'sqlite';
    dialect = dialects_1.sqliteDialect;
    db = null;
    dirty = false;
    chain = Promise.resolve();
    constructor(filePath, db) {
        this.filePath = filePath;
        this.db = db;
        this.configure(db);
    }
    /** Opens (or creates) the database file. The parent directory must already exist and be writable. */
    static async open(filePath) {
        const SQL = await loadSqlJs();
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
        const image = node_fs_1.default.existsSync(filePath) ? new Uint8Array(node_fs_1.default.readFileSync(filePath)) : undefined;
        const driver = new SqliteDriver(filePath, new SQL.Database(image));
        driver.dirty = !image;
        await driver.enqueue(async () => {
            if (driver.dirty)
                driver.persistNow();
        });
        return driver;
    }
    /** Foreign keys are off by default in SQLite and reset whenever the image is exported, so set them here. */
    configure(db) {
        db.run('PRAGMA foreign_keys = ON');
    }
    get conn() {
        if (!this.db)
            throw new Error('پایگاه داده SQLite بسته شده است.');
        return this.db;
    }
    /** Serialises every operation; `persist` runs after each queued job that wrote something. */
    enqueue(job) {
        const run = this.chain.then(async () => {
            try {
                return await job();
            }
            finally {
                if (this.dirty && this.db)
                    this.persistNow();
            }
        });
        this.chain = run.catch(() => undefined);
        return run;
    }
    persistNow() {
        const data = this.conn.export();
        this.configure(this.conn); // export() reopens the image and resets pragmas
        const tmp = `${this.filePath}.tmp-${process.pid}`;
        node_fs_1.default.writeFileSync(tmp, Buffer.from(data), { mode: 0o600 });
        node_fs_1.default.renameSync(tmp, this.filePath);
        this.dirty = false;
    }
    rawQuery(sql, params) {
        const stmt = this.conn.prepare(sql);
        try {
            stmt.bind(bindAll(params));
            const rows = [];
            while (stmt.step()) {
                const raw = stmt.getAsObject();
                const row = {};
                for (const [k, v] of Object.entries(raw)) {
                    row[k] = k.endsWith('_at') ? (0, dates_1.fromDbDateText)(v) : v;
                }
                rows.push(row);
            }
            return rows;
        }
        catch (err) {
            throw normalizeError(err);
        }
        finally {
            stmt.free();
        }
    }
    rawExecute(sql, params) {
        try {
            this.conn.run(sql, bindAll(params));
        }
        catch (err) {
            throw normalizeError(err);
        }
        this.dirty = true;
        const [info] = this.conn.exec('SELECT last_insert_rowid() AS id, changes() AS n');
        const id = Number(info?.values[0]?.[0] ?? 0);
        const n = Number(info?.values[0]?.[1] ?? 0);
        return { insertId: id, affectedRows: n };
    }
    /** Queryable bound to the connection that currently holds the queue (used inside transactions). */
    direct = {
        query: async (sql, params = []) => this.rawQuery(sql, params),
        execute: async (sql, params = []) => this.rawExecute(sql, params),
    };
    async query(sql, params = []) {
        return this.enqueue(async () => this.rawQuery(sql, params));
    }
    async execute(sql, params = []) {
        return this.enqueue(async () => this.rawExecute(sql, params));
    }
    async withConnection(fn) {
        return this.enqueue(() => fn(this.direct));
    }
    async transaction(fn) {
        return this.enqueue(async () => {
            this.rawExecute(this.dialect.beginSql, []);
            try {
                const result = await fn(this.direct);
                this.rawExecute('COMMIT', []);
                return result;
            }
            catch (err) {
                try {
                    this.rawExecute('ROLLBACK', []);
                }
                catch {
                    // The original error is more useful to the caller than a rollback failure.
                }
                throw err;
            }
        });
    }
    async ping() {
        await this.query('SELECT 1');
    }
    async close() {
        await this.enqueue(async () => {
            if (!this.db)
                return;
            this.persistNow();
            this.db.close();
            this.db = null;
        });
    }
}
exports.SqliteDriver = SqliteDriver;
