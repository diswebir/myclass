#!/usr/bin/env node
/**
 * نقطه شروع سرور — MyClass Platform
 * سازگار با هاست سی‌پنل (Phusion Passenger / Node.js Selector)
 */
const path = require('path');
const fs = require('fs');
const config = require('./src/core/config');

// اطمینان از وجود پوشه‌های لازم
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

async function main() {
  const { createApp } = require('./src/app');
  const db = require('./src/core/db');

  // نصب خودکار مهاجرت‌ها پس از نصب بودن برنامه
  if (config.isInstalled()) {
    try {
      const { runMigrations } = require('./src/core/db/migrate');
      const { runSeeds } = require('./seeds');
      await runMigrations(db);
      await runSeeds(db);
    } catch (e) {
      console.error('[boot] migration error:', e.message);
    }
  }

  const app = createApp();
  const port = config.port;

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n  MyClass Platform is running`);
    console.log(`  → http://localhost:${port}${config.basePath}\n`);
  });

  // خروج تمیز
  const shutdown = async () => {
    console.log('\n[boot] shutting down ...');
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[boot] fatal:', e);
  process.exit(1);
});
