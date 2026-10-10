/**
 * پیکربندی مرکزی برنامه — بارگذاری از متغیرهای محیطی (.env)
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'production',
  isProd: (process.env.NODE_ENV || 'production') === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  basePath: (process.env.BASE_PATH || '').replace(/\/+$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'myclass-dev-secret-change-me',
  sessionTtlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '720', 10),
  loginMaxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '8', 10),
  loginLockMinutes: parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  db: {
    client: (process.env.DB_CLIENT || 'sqlite').toLowerCase(), // sqlite | mysql
    file: process.env.DB_FILE || './data/myclass.sqlite',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    charset: process.env.DB_CHARSET || 'utf8mb4',
    collation: process.env.DB_COLLATION || 'utf8mb4_unicode_ci',
  },
  upload: {
    dir: process.env.UPLOAD_DIR || './src/public/uploads',
    maxMb: parseFloat(process.env.MAX_UPLOAD_MB || '8'),
  },
  installedFlag: path.join(ROOT, 'data', 'installed.lock'),
  envFile: path.join(ROOT, '.env'),

  /** آیا برنامه نصب و راه‌اندازی شده است؟ */
  isInstalled() {
    return fs.existsSync(this.installedFlag) && fs.existsSync(this.envFile);
  },
};

config.upload.dir = path.isAbsolute(config.upload.dir)
  ? config.upload.dir
  : path.join(ROOT, config.upload.dir);
config.db.file = path.isAbsolute(config.db.file)
  ? config.db.file
  : path.join(ROOT, config.db.file);

module.exports = config;
