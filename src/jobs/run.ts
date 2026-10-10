import { getDb, closeDb } from '../core/db';
import { SettingsService } from '../modules/settings/settings.service';
import { SmsService } from '../modules/sms/sms.service';
import { logger } from '../core/logger';

async function main() {
  logger.info('Starting cron job processing run...');
  const start = Date.now();

  try {
    const db = getDb();
    const settingsService = new SettingsService(db);
    const smsService = new SmsService(db, settingsService);

    // 1. Process SMS Queue
    const smsResult = await smsService.processQueue(50);
    logger.info(`Processed SMS queue: ${smsResult.processed} messages (${smsResult.successCount} sent, ${smsResult.failureCount} failed).`);

    // 2. Overdue Installments Check
    const todayStr = new Date().toISOString().substring(0, 10);
    const overdueRes = await db
      .updateTable('installments')
      .set({ status: 'overdue' })
      .where('status', '=', 'pending')
      .where('due_date', '<', todayStr)
      .execute();

    logger.info(`Updated overdue installments. Duration: ${Date.now() - start}ms`);
  } catch (err) {
    logger.error('Error executing cron background job', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main();
}

export { main };
