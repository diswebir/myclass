"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.getDbConfigFile = getDbConfigFile;
exports.getEffectiveDbConfig = getEffectiveDbConfig;
exports.saveEffectiveDbConfig = saveEffectiveDbConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.coerce.number().default(3000),
    HOST: zod_1.z.string().default('0.0.0.0'),
    APP_SECRET: zod_1.z.string().min(16).default('myclass_super_secret_app_key_default_32ch'),
    SESSION_COOKIE_NAME: zod_1.z.string().default('myclass_session'),
    DB_DIALECT: zod_1.z.enum(['mysql', 'sqlite']).default('sqlite'),
    DB_HOST: zod_1.z.string().default('localhost'),
    DB_PORT: zod_1.z.coerce.number().default(3306),
    DB_USER: zod_1.z.string().default('root'),
    DB_PASSWORD: zod_1.z.string().default(''),
    DB_NAME: zod_1.z.string().default('myclass_db'),
    STORAGE_DIR: zod_1.z.string().default(path_1.default.resolve(process.cwd(), 'storage')),
    PUBLIC_DIR: zod_1.z.string().default(path_1.default.resolve(process.cwd(), 'public')),
    CRON_SECRET: zod_1.z.string().default('cron_secret_token_change_in_production'),
    SMS_LIVE_TESTS: zod_1.z.coerce.number().default(0),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid configuration variables:', parsed.error.format());
    throw new Error('Invalid environment variables');
}
exports.config = parsed.data;
function getDbConfigFile() {
    return path_1.default.join(exports.config.STORAGE_DIR, 'db-config.json');
}
function getEffectiveDbConfig() {
    const configFile = getDbConfigFile();
    if (fs_1.default.existsSync(configFile)) {
        try {
            const content = fs_1.default.readFileSync(configFile, 'utf8');
            const loaded = JSON.parse(content);
            if (loaded && (loaded.dialect === 'mysql' || loaded.dialect === 'sqlite')) {
                return loaded;
            }
        }
        catch {
            // Fallback to env
        }
    }
    return {
        dialect: exports.config.DB_DIALECT,
        sqlitePath: path_1.default.join(exports.config.STORAGE_DIR, 'database.sqlite'),
        mysql: {
            host: exports.config.DB_HOST,
            port: exports.config.DB_PORT,
            user: exports.config.DB_USER,
            password: exports.config.DB_PASSWORD,
            database: exports.config.DB_NAME
        }
    };
}
function saveEffectiveDbConfig(newConfig) {
    fs_1.default.mkdirSync(exports.config.STORAGE_DIR, { recursive: true });
    fs_1.default.writeFileSync(getDbConfigFile(), JSON.stringify(newConfig, null, 2), 'utf8');
    // Update in-memory config object
    exports.config.DB_DIALECT = newConfig.dialect;
    if (newConfig.mysql) {
        if (newConfig.mysql.host)
            exports.config.DB_HOST = newConfig.mysql.host;
        if (newConfig.mysql.port)
            exports.config.DB_PORT = newConfig.mysql.port;
        if (newConfig.mysql.user)
            exports.config.DB_USER = newConfig.mysql.user;
        if (newConfig.mysql.password !== undefined)
            exports.config.DB_PASSWORD = newConfig.mysql.password;
        if (newConfig.mysql.database)
            exports.config.DB_NAME = newConfig.mysql.database;
    }
}
