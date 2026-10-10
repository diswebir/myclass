import { Kysely } from 'kysely';
import { DatabaseSchema, AuthUser } from '../../core/types';
import { SmsProvider } from './sms-provider.interface';
import { FakeSmsProvider } from './fake.provider';
import { IppanelProvider } from './ippanel.provider';
import { SettingsService } from '../settings/settings.service';
import { normalizeMobile, isValidIranianMobile } from '../../core/security';
import { ValidationError, NotFoundError } from '../../core/errors';
import { logger } from '../../core/logger';
import { config } from '../../core/config';

export class SmsService {
  private provider: SmsProvider;

  constructor(
    private db: Kysely<DatabaseSchema>,
    private settingsService: SettingsService,
    customProvider?: SmsProvider
  ) {
    if (customProvider) {
      this.provider = customProvider;
    } else if (config.SMS_LIVE_TESTS === 1) {
      // In production/live mode, instantiate IPPanel provider with key from settings
      this.provider = new IppanelProvider(process.env.IPPANEL_API_KEY || '');
    } else {
      this.provider = new FakeSmsProvider();
    }
  }

  setProvider(provider: SmsProvider) {
    this.provider = provider;
  }

  getProvider(): SmsProvider {
    return this.provider;
  }

  // 1. Enqueue pattern SMS for an event
  async enqueuePatternSms(params: {
    eventKey: string;
    recipientMobile: string;
    internalVariables: Record<string, any>;
    idempotencyKey: string;
  }): Promise<{ queued: boolean; reason?: string }> {
    const mobile = normalizeMobile(params.recipientMobile);
    if (!isValidIranianMobile(mobile)) {
      return { queued: false, reason: 'شماره همراه گیرنده نامعتبر است.' };
    }

    // Check duplicate
    const existing = await this.db
      .selectFrom('sms_logs')
      .where('idempotency_key', '=', params.idempotencyKey)
      .select('id')
      .executeTakeFirst();

    if (existing) {
      return { queued: false, reason: 'پیامک تکراری با این کلید قبلاً ثبت شده است.' };
    }

    // Find SMS template
    const template = await this.db
      .selectFrom('sms_templates')
      .where('event_key', '=', params.eventKey)
      .selectAll()
      .executeTakeFirst();

    if (!template || !template.is_active) {
      return { queued: false, reason: 'الگوی پیامک برای این رویداد فعال نمی‌باشد.' };
    }

    let mappings: Record<string, string> = {};
    try {
      mappings = JSON.parse(template.variable_mappings_json);
    } catch {
      mappings = {};
    }

    // Map internal variables to pattern variables
    // E.g. mappings = { "name": "student_name", "code": "tracking_code" }
    const patternPayload: Record<string, string> = {};
    const missingVars: string[] = [];

    for (const [patternVarName, internalVarName] of Object.entries(mappings)) {
      const val = params.internalVariables[internalVarName];
      if (val !== undefined && val !== null && String(val).trim().length > 0) {
        patternPayload[patternVarName] = String(val);
      } else {
        missingVars.push(patternVarName);
      }
    }

    if (missingVars.length > 0) {
      const errorMsg = `متغیرهای ضروری پترن موجود نیستند: ${missingVars.join(', ')}`;
      logger.warn(`Cannot send SMS for ${params.eventKey}: ${errorMsg}`);
      return { queued: false, reason: errorMsg };
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    await this.db.insertInto('sms_logs').values({
      event_key: params.eventKey,
      recipient_mobile: mobile,
      pattern_code: template.ippanel_pattern_code,
      payload_json: JSON.stringify(patternPayload),
      status: 'queued',
      provider_message_id: null,
      error_message: null,
      idempotency_key: params.idempotencyKey,
      attempts: 0,
      scheduled_at: now,
      sent_at: null,
      created_at: now
    }).execute();

    return { queued: true };
  }

  // 2. Process Queue (called by cron script or webhook)
  async processQueue(batchSize = 25): Promise<{ processed: number; successCount: number; failureCount: number }> {
    const queue = await this.db
      .selectFrom('sms_logs')
      .where('status', '=', 'queued')
      .where('attempts', '<', 3)
      .selectAll()
      .orderBy('id', 'asc')
      .limit(batchSize)
      .execute();

    let successCount = 0;
    let failureCount = 0;
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    for (const item of queue) {
      let variables: Record<string, string> = {};
      try {
        variables = JSON.parse(item.payload_json);
      } catch {
        variables = {};
      }

      const result = await this.provider.sendPattern({
        recipient: item.recipient_mobile,
        patternCode: item.pattern_code,
        variables
      });

      if (result.success) {
        successCount++;
        await this.db
          .updateTable('sms_logs')
          .set({
            status: 'sent',
            provider_message_id: result.messageId || null,
            sent_at: now,
            attempts: item.attempts + 1
          })
          .where('id', '=', item.id!)
          .execute();
      } else {
        failureCount++;
        await this.db
          .updateTable('sms_logs')
          .set({
            status: item.attempts + 1 >= 3 ? 'failed' : 'queued',
            error_message: result.errorMessage || 'ارسال ناموفق',
            attempts: item.attempts + 1
          })
          .where('id', '=', item.id!)
          .execute();
      }
    }

    return { processed: queue.length, successCount, failureCount };
  }

  // 3. Send Test SMS
  async sendTestSms(mobile: string, user: AuthUser) {
    const norm = normalizeMobile(mobile);
    if (!isValidIranianMobile(norm)) {
      throw new ValidationError('شماره همراه آزمایشی نامعتبر است.');
    }

    const testIdem = `TEST-${Date.now()}-${norm}`;
    const enqueueRes = await this.enqueuePatternSms({
      eventKey: 'prereg_received',
      recipientMobile: norm,
      internalVariables: {
        applicant_name: user.full_name || 'کاربر گرامی',
        tracking_code: 'TEST-1234',
        class_title: 'کلاس تست سیستم'
      },
      idempotencyKey: testIdem
    });

    if (!enqueueRes.queued) {
      throw new ValidationError(enqueueRes.reason || 'خطا در صف‌بندی پیامک تستی');
    }

    // Process immediately
    const proc = await this.processQueue(5);
    return {
      message: proc.successCount > 0 ? 'پیامک تستی با موفقیت ارسال شد.' : 'ارسال پیامک تستی با خطا مواجه شد.',
      details: proc
    };
  }

  // 4. Templates & Logs Management
  async listTemplates() {
    return this.db.selectFrom('sms_templates').selectAll().orderBy('id', 'asc').execute();
  }

  async updateTemplate(eventKey: string, data: { patternCode?: string; variableMappings?: Record<string, string>; isActive?: boolean }) {
    const tmpl = await this.db.selectFrom('sms_templates').where('event_key', '=', eventKey).selectAll().executeTakeFirst();
    if (!tmpl) throw new NotFoundError('الگوی پیامک یافت نشد.');

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updates: any = { updated_at: now };
    if (data.patternCode) updates.ippanel_pattern_code = data.patternCode.trim();
    if (data.variableMappings) updates.variable_mappings_json = JSON.stringify(data.variableMappings);
    if (data.isActive !== undefined) updates.is_active = data.isActive ? 1 : 0;

    await this.db.updateTable('sms_templates').set(updates).where('event_key', '=', eventKey).execute();
  }

  async listLogs(options: { mobile?: string; status?: string; limit?: number; offset?: number }) {
    const limit = options.limit || 30;
    const offset = options.offset || 0;

    let query = this.db.selectFrom('sms_logs');
    if (options.mobile) {
      query = query.where('recipient_mobile', 'like', `%${normalizeMobile(options.mobile)}%`);
    }
    if (options.status) {
      query = query.where('status', '=', options.status as any);
    }

    const countRes = await query.select(this.db.fn.count('id').as('count')).executeTakeFirst();
    const total = Number(countRes?.count || 0);

    const logs = await query.selectAll().orderBy('id', 'desc').limit(limit).offset(offset).execute();
    return { logs, total, limit, offset };
  }
}
