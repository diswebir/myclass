/**
 * CLI اجرای مایگریشن — برای استقرار cPanel بدون SSH:
 *   node dist/core/db/migrate-cli.js
 * متغیرهای محیطی (یا فایل .env) توسط loadConfig خوانده می‌شوند.
 */
import { loadConfig } from '../config/env';
import { createDatabase } from './database';
import { migrateToLatest } from './migrate';
import { logger } from '../logger/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config);
  try {
    const result = await migrateToLatest(db);
    logger.info('مایگریشن انجام شد.', {
      dialect: result.dialect,
      ran: result.ran,
    });
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  logger.error('مایگریشن ناموفق بود:', err);
  process.exitCode = 1;
});
