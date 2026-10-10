"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDbInstance = createDbInstance;
exports.getDb = getDb;
exports.reconnectDb = reconnectDb;
exports.testDbConnection = testDbConnection;
exports.setTestDb = setTestDb;
exports.closeDb = closeDb;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const kysely_1 = require("kysely");
const mysql2_1 = __importDefault(require("mysql2"));
const config_1 = require("./config");
const logger_1 = require("./logger");
let dbInstance = null;
function createDbInstance(dbConf) {
    const effectiveConfig = dbConf || (0, config_1.getEffectiveDbConfig)();
    if (effectiveConfig.dialect === 'mysql') {
        const mysqlConf = effectiveConfig.mysql || {
            host: config_1.config.DB_HOST,
            port: config_1.config.DB_PORT,
            user: config_1.config.DB_USER,
            password: config_1.config.DB_PASSWORD,
            database: config_1.config.DB_NAME
        };
        logger_1.logger.info(`Connecting to MySQL/MariaDB at ${mysqlConf.host}:${mysqlConf.port}/${mysqlConf.database}...`);
        const pool = mysql2_1.default.createPool({
            host: mysqlConf.host,
            port: mysqlConf.port,
            user: mysqlConf.user,
            password: mysqlConf.password,
            database: mysqlConf.database,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: 'utf8mb4',
            dateStrings: true
        });
        return new kysely_1.Kysely({
            dialect: new kysely_1.MysqlDialect({ pool: pool })
        });
    }
    else {
        // SQLite mode using Node 22 built-in DatabaseSync
        const { DatabaseSync } = require('node:sqlite');
        // In automated tests, only use a file if explicitly specified in dbConf.sqlitePath
        let dbTarget = ':memory:';
        if (process.env.NODE_ENV === 'test') {
            if (dbConf?.sqlitePath && dbConf.sqlitePath !== ':memory:') {
                dbTarget = dbConf.sqlitePath;
                fs_1.default.mkdirSync(path_1.default.dirname(dbTarget), { recursive: true });
            }
            else {
                dbTarget = ':memory:';
            }
        }
        else {
            const sqlitePath = effectiveConfig.sqlitePath || path_1.default.join(config_1.config.STORAGE_DIR, 'database.sqlite');
            fs_1.default.mkdirSync(path_1.default.dirname(sqlitePath), { recursive: true });
            dbTarget = sqlitePath;
        }
        const localRawDb = new DatabaseSync(dbTarget);
        localRawDb.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
        const normalizeParam = (p) => {
            if (p === undefined)
                return null;
            if (typeof p === 'boolean')
                return p ? 1 : 0;
            return p;
        };
        const mapParams = (params) => {
            if (!params || !Array.isArray(params))
                return [];
            return params.map(normalizeParam);
        };
        return new kysely_1.Kysely({
            dialect: new kysely_1.SqliteDialect({
                database: {
                    prepare: (querySql) => {
                        const stmt = localRawDb.prepare(querySql);
                        const isSelect = !querySql.trim().match(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK|PRAGMA)/i);
                        return {
                            reader: isSelect,
                            all: (params) => stmt.all(...mapParams(params)),
                            run: (params) => {
                                const info = stmt.run(...mapParams(params));
                                return {
                                    changes: info.changes,
                                    lastInsertRowid: info.lastInsertRowid
                                };
                            },
                            iterate: (params) => stmt.iterate ? stmt.iterate(...mapParams(params)) : stmt.all(...mapParams(params))[Symbol.iterator]()
                        };
                    },
                    close: () => {
                        try {
                            localRawDb.close();
                        }
                        catch {
                            // Ignored
                        }
                    }
                }
            })
        });
    }
}
function getDb() {
    if (!dbInstance) {
        dbInstance = createDbInstance();
    }
    return dbInstance;
}
async function reconnectDb(newConfig) {
    if (dbInstance) {
        await dbInstance.destroy();
        dbInstance = null;
    }
    dbInstance = createDbInstance(newConfig);
    return dbInstance;
}
async function testDbConnection(dbConf) {
    let tempDb = null;
    try {
        tempDb = createDbInstance(dbConf);
        await (0, kysely_1.sql) `SELECT 1`.execute(tempDb);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message || 'خطا در برقراری اتصال به پایگاه داده' };
    }
    finally {
        if (tempDb) {
            await tempDb.destroy();
        }
    }
}
function setTestDb(db) {
    dbInstance = db;
}
async function closeDb() {
    if (dbInstance) {
        await dbInstance.destroy();
        dbInstance = null;
    }
}
