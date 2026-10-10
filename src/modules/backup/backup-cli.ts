/**
 * CLI پشتیبان‌گیری — برای cron روی cPanel (بدون SSH):
 *   node dist/modules/backup/backup-cli.js     (یا: npm run backup:cli)
 * فایل .env خوانده می‌شود؛ ACL/مجوز فقط برای UI است (CLI روی سرور اجرا می‌شود).
 */
import { loadConfig, loadDotEnv } from '../../core/config/env';
import { createDatabase } from '../../core/db/database';
import { logger } from '../../core/logger/logger';
import { BackupService } from './backup.service';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = createDatabase(config);
  try {
    const service = new BackupService(db, config);
    const { id, meta } = await service.createBackup(null);
    logger.info('پشتیبان‌گیری انجام شد.', {
      id,
      rows: meta.rows,
      files: meta.files,
      bytes: meta.bytes,
    });
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  logger.error('پشتیبان‌گیری ناموفق بود:', err);
  process.exitCode = 1;
});
