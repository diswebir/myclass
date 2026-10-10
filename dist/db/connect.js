"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDriverChoice = resolveDriverChoice;
exports.writeDriverChoice = writeDriverChoice;
exports.createDriver = createDriver;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const mysql_driver_1 = require("./mysql-driver");
const sqlite_driver_1 = require("./sqlite-driver");
/**
 * Which engine this installation uses, in priority order:
 *   1. storage/db-config.json, written by the installer when the administrator chose an engine;
 *   2. DB_DRIVER from the environment;
 *   3. MySQL, if DB_NAME and DB_USER are set (installations made before SQLite support existed).
 * Returns null on a fresh install with nothing chosen yet.
 */
function resolveDriverChoice(cfg) {
    const fromFile = readDriverFile(cfg.dbConfigFile);
    if (fromFile)
        return fromFile;
    if (cfg.dbDriverEnv)
        return cfg.dbDriverEnv;
    if (cfg.db.name && cfg.db.user)
        return 'mysql';
    return null;
}
function readDriverFile(file) {
    if (!node_fs_1.default.existsSync(file))
        return null;
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
        return parsed.driver === 'mysql' || parsed.driver === 'sqlite' ? parsed.driver : null;
    }
    catch {
        return null;
    }
}
/** Persists the chosen engine atomically. The file contains no secrets (credentials stay in the environment). */
function writeDriverChoice(cfg, choice) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(cfg.dbConfigFile), { recursive: true });
    const tmp = `${cfg.dbConfigFile}.tmp-${process.pid}`;
    node_fs_1.default.writeFileSync(tmp, JSON.stringify({ driver: choice, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    node_fs_1.default.renameSync(tmp, cfg.dbConfigFile);
}
/** Opens a driver for the given engine. SQLite creates the file on first use; MySQL connects lazily. */
async function createDriver(cfg, choice) {
    if (choice === 'mysql')
        return new mysql_driver_1.MysqlDriver(cfg.db);
    return sqlite_driver_1.SqliteDriver.open(cfg.sqlitePath);
}
