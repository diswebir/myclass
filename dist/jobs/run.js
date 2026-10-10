"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const db_1 = require("../core/db");
const settings_service_1 = require("../modules/settings/settings.service");
const sms_service_1 = require("../modules/sms/sms.service");
const logger_1 = require("../core/logger");
async function main() {
    logger_1.logger.info('Starting cron job processing run...');
    const start = Date.now();
    try {
        const db = (0, db_1.getDb)();
        const settingsService = new settings_service_1.SettingsService(db);
        const smsService = new sms_service_1.SmsService(db, settingsService);
        // 1. Process SMS Queue
        const smsResult = await smsService.processQueue(50);
        logger_1.logger.info(`Processed SMS queue: ${smsResult.processed} messages (${smsResult.successCount} sent, ${smsResult.failureCount} failed).`);
        // 2. Overdue Installments Check
        const todayStr = new Date().toISOString().substring(0, 10);
        const overdueRes = await db
            .updateTable('installments')
            .set({ status: 'overdue' })
            .where('status', '=', 'pending')
            .where('due_date', '<', todayStr)
            .execute();
        logger_1.logger.info(`Updated overdue installments. Duration: ${Date.now() - start}ms`);
    }
    catch (err) {
        logger_1.logger.error('Error executing cron background job', err);
        process.exitCode = 1;
    }
    finally {
        await (0, db_1.closeDb)();
    }
}
if (require.main === module) {
    main();
}
