"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDotEnv = loadDotEnv;
exports.loadConfig = loadConfig;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
/**
 * Loads KEY=VALUE pairs from a .env file (if present) without overriding
 * variables already defined by the host (cPanel "Environment variables").
 * Dependency-free on purpose: shared hosts should not need extra packages.
 */
function loadDotEnv(filePath, target = process.env) {
    if (!node_fs_1.default.existsSync(filePath))
        return false;
    const lines = node_fs_1.default.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = line.indexOf('=');
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (target[key] === undefined)
            target[key] = value;
    }
    return true;
}
const boolish = zod_1.z
    .union([zod_1.z.boolean(), zod_1.z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.string().default('development'),
    PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(3000),
    DB_HOST: zod_1.z.string().default('localhost'),
    DB_PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(3306),
    DB_NAME: zod_1.z.string().default(''),
    DB_USER: zod_1.z.string().default(''),
    DB_PASSWORD: zod_1.z.string().default(''),
    DB_CONNECTION_LIMIT: zod_1.z.coerce.number().int().min(1).max(20).default(5),
    INSTALL_TOKEN: zod_1.z.string().default(''),
    STORAGE_DIR: zod_1.z.string().default(''),
    SESSION_TTL_HOURS: zod_1.z.coerce.number().int().min(1).max(720).default(8),
    COOKIE_SECURE: boolish.default(false),
    TRUST_PROXY: zod_1.z.coerce.number().int().min(0).max(5).default(1),
});
/** Builds a validated, immutable configuration. Secrets are never logged. */
function loadConfig(appRoot, env = process.env) {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
        const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
        throw new Error(`تنظیمات محیطی نامعتبر است: ${fields}`);
    }
    const e = parsed.data;
    const storageDir = e.STORAGE_DIR ? node_path_1.default.resolve(e.STORAGE_DIR) : node_path_1.default.join(appRoot, 'storage');
    return Object.freeze({
        nodeEnv: e.NODE_ENV,
        isProduction: e.NODE_ENV === 'production',
        port: e.PORT,
        appRoot,
        storageDir,
        installLockFile: node_path_1.default.join(storageDir, 'install.lock'),
        migrationsDir: node_path_1.default.join(appRoot, 'migrations'),
        db: {
            host: e.DB_HOST,
            port: e.DB_PORT,
            name: e.DB_NAME,
            user: e.DB_USER,
            password: e.DB_PASSWORD,
            connectionLimit: e.DB_CONNECTION_LIMIT,
        },
        installToken: e.INSTALL_TOKEN,
        sessionTtlHours: e.SESSION_TTL_HOURS,
        cookieSecure: e.COOKIE_SECURE,
        trustProxy: e.TRUST_PROXY,
    });
}
