/**
 * مهاجرت‌ها (Migrations) — اجرای خودکار و امن با جدول ثبت مهاجرت‌ها
 */
const fs = require('fs');
const path = require('path');

async function ensureMigrationsTable(db) {
  const schema = require('./schema');
  await db.exec(db.compileTable('_migrations', schema._migrations, db.dialect));
}

async function runMigrations(db, logger = console) {
  await ensureMigrationsTable(db);
  const dir = path.join(__dirname, '..', '..', '..', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort();

  for (const file of files) {
    const name = path.basename(file, '.js');
    const done = await db.one('SELECT id FROM _migrations WHERE name = ?', [name]);
    if (done) continue;
    const mod = require(path.join(dir, file));
    logger.log(`[migrate] applying ${name} ...`);
    await db.transaction(async (trx) => {
      // ابزارهای کامپایل طرح‌واره + دیالکت روی تراکنش
      const runner = Object.create(trx);
      runner.dialect = db.dialect;
      runner.compileTable = db.compileTable;
      runner.compileIndexes = db.compileIndexes;
      runner.now = db.now;
      runner.today = db.today;
      await mod.up(runner);
      await runner.insert('_migrations', { name, applied_at: db.now() });
    });
    logger.log(`[migrate] done ${name}`);
  }
  return true;
}

module.exports = { runMigrations };
