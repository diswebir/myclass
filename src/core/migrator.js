'use strict';
/**
 * اجرای مهاجرت‌های پایگاه داده (Migrations) جمع‌آوری‌شده از همه ماژول‌ها
 * به‌روزرسانی ساختار جداول از طریق پنل مدیریت و بدون نیاز به SSH انجام می‌شود.
 */
const { get } = require('./db');
const registry = require('./modules');

class ModuleMigrationSource {
  getMigrations() {
    return Promise.resolve(registry.migrations());
  }
  getMigrationName(m) {
    return m.name;
  }
  getMigration(m) {
    return { up: m.up, down: m.down || (async () => {}) };
  }
}

const opts = () => ({ migrationSource: new ModuleMigrationSource(), tableName: 'knex_migrations' });

async function latest() {
  const [batch, log] = await get().migrate.latest(opts());
  return { batch, log };
}

async function status() {
  const [completed, pending] = await get().migrate.list(opts());
  return {
    completed: completed.map((c) => (typeof c === 'string' ? c : c.name)),
    pending: pending.map((p) => p.name),
  };
}

/** تنظیمات جدول برای MySQL (موتور InnoDB و کاراکترست utf8mb4 برای پشتیبانی کامل فارسی) */
function tableOptions(knex, t) {
  if (String(knex.client.dialect || '').startsWith('mysql')) {
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  }
}

module.exports = { latest, status, tableOptions };
