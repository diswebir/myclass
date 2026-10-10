/**
 * اسکریپت Cron — dist/jobs/run.js
 * پردازش صف پیامک + پاکسازی — قابل اجرا با Cron گرافیکی cPanel:
 *   node dist/jobs/run.js
 */
import { loadConfig, loadDotEnv } from '../core/config/env';
import { createDatabase } from '../core/db/database';
import { logger } from '../core/logger/logger';
import { SessionService } from '../modules/sessions/session.service';
import { purgeExpiredRateLimits } from '../core/http/middleware/rateLimit';
import { SmsService } from '../modules/sms/sms.service';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const db = createDatabase(config);
  try {
    // پاکسازی نشست‌های منقضی
    const sessions = new SessionService(db, config);
    const purgedSessions = await sessions.purgeExpired();
    // پاکسازی rate limitهای منقضی
    const purgedRate = await purgeExpiredRateLimits(db);
    // پردازش صف پیامک (rate limit + backoff — با Fake Provider مگر SMS_LIVE_TESTS=1)
    const sms = new SmsService(db, config);
    const smsResult = await sms.processPending();
    logger.info('cron اجرا شد', { purgedSessions, purgedRate, sms: smsResult });
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  logger.error('خطای اجرای cron:', err);
  process.exit(1);
});
