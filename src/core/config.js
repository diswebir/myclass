'use strict';
/**
 * مدیریت فایل پیکربندی (config/config.json)
 * این فایل توسط نصب‌کننده تحت وب ساخته می‌شود و نیازی به SSH نیست.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const paths = {
  root: ROOT,
  src: path.join(ROOT, 'src'),
  public: path.join(ROOT, 'public'),
  storage: path.join(ROOT, 'storage'),
  uploads: path.join(ROOT, 'storage', 'uploads'),
  logs: path.join(ROOT, 'storage', 'logs'),
  backups: path.join(ROOT, 'storage', 'backups'),
  tmp: path.join(ROOT, 'tmp'),
  configDir: CONFIG_DIR,
  configFile: CONFIG_FILE,
};

let cache = null;

function fromEnv() {
  // امکان تعریف اتصال پایگاه داده از طریق متغیرهای محیطی (Environment variables در سی‌پنل)
  if (!process.env.DB_CLIENT) return null;
  return {
    installed: process.env.APP_INSTALLED === '1',
    secret: process.env.APP_SECRET || null,
    db: {
      client: process.env.DB_CLIENT,
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      filename: process.env.DB_FILE,
    },
  };
}

function load(force = false) {
  if (cache && !force) return cache;
  let cfg = null;
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('[config] invalid config.json:', e.message);
      cfg = null;
    }
  }
  if (!cfg) cfg = fromEnv();
  cache = cfg;
  return cfg;
}

function save(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  cache = cfg;
}

function isInstalled() {
  const c = load();
  if (c && c.installed) return true;
  // در حالت چند پردازه‌ای (Passenger) ممکن است پردازه دیگری نصب را انجام داده باشد
  const fresh = load(true);
  return !!(fresh && fresh.installed);
}

function secret() {
  const c = load();
  return (c && c.secret) || process.env.APP_SECRET || 'myclass-temporary-installer-secret';
}

function generateSecret() {
  return crypto.randomBytes(48).toString('hex');
}

/** مسیر پایه برنامه (برای نصب در زیرپوشه مانند example.com/panel) */
function basePath() {
  const c = load();
  let b = (c && c.basePath) || process.env.PASSENGER_BASE_URI || process.env.BASE_PATH || '';
  b = String(b).trim();
  if (!b || b === '/') return '';
  if (!b.startsWith('/')) b = '/' + b;
  return b.replace(/\/+$/, '');
}

module.exports = { load, save, isInstalled, secret, generateSecret, basePath, paths };
