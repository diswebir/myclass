import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { SettingsService } from '../src/modules/settings/settings.service';
import { SmsService } from '../src/modules/sms/sms.service';
import { FakeSmsProvider } from '../src/modules/sms/fake.provider';
import { IppanelProvider } from '../src/modules/sms/ippanel.provider';

describe('Phase 6: IPPanel SMS Integration, Pattern Mapping & Queue Processing', () => {
  const db = getDb();
  const settingsService = new SettingsService(db);
  const fakeProvider = new FakeSmsProvider();
  const smsService = new SmsService(db, settingsService, fakeProvider);

  beforeAll(async () => {
    await runMigrations(db);
    fakeProvider.clear();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('1. Pattern Mapping & Variable Validation', () => {
    it('enqueues pattern SMS with mapped variables successfully', async () => {
      // prereg_received mapping: { name: 'applicant_name', code: 'tracking_code', class: 'class_title' }
      const res = await smsService.enqueuePatternSms({
        eventKey: 'prereg_received',
        recipientMobile: '09121112233',
        internalVariables: {
          applicant_name: 'امیر رضایی',
          tracking_code: 'PR-9988',
          class_title: 'کلاس پایتون'
        },
        idempotencyKey: 'IDEM-SMS-001'
      });

      expect(res.queued).toBe(true);
    });

    it('rejects enqueueing if a required pattern variable is missing', async () => {
      // class_title is missing
      const res = await smsService.enqueuePatternSms({
        eventKey: 'prereg_received',
        recipientMobile: '09121112233',
        internalVariables: {
          applicant_name: 'امیر رضایی',
          tracking_code: 'PR-9988'
          // class_title is omitted!
        },
        idempotencyKey: 'IDEM-SMS-002'
      });

      expect(res.queued).toBe(false);
      expect(res.reason).toContain('متغیرهای ضروری پترن موجود نیستند');
    });

    it('rejects duplicate SMS with same idempotency key', async () => {
      const res = await smsService.enqueuePatternSms({
        eventKey: 'prereg_received',
        recipientMobile: '09121112233',
        internalVariables: {
          applicant_name: 'امیر رضایی',
          tracking_code: 'PR-9988',
          class_title: 'کلاس پایتون'
        },
        idempotencyKey: 'IDEM-SMS-001' // duplicate!
      });

      expect(res.queued).toBe(false);
      expect(res.reason).toContain('پیامک تکراری');
    });
  });

  describe('2. Queue Processing & Provider Dispatching', () => {
    it('processes queued messages, updates status to sent and saves messageId', async () => {
      expect(fakeProvider.sentMessages.length).toBe(0);

      const processResult = await smsService.processQueue(10);
      expect(processResult.processed).toBe(1);
      expect(processResult.successCount).toBe(1);
      expect(processResult.failureCount).toBe(0);

      // Verify provider received mapped pattern variables
      expect(fakeProvider.sentMessages.length).toBe(1);
      const sent = fakeProvider.sentMessages[0];
      expect(sent.recipient).toBe('09121112233');
      expect(sent.patternCode).toBe('p_prereg_received');
      expect(sent.variables.name).toBe('امیر رضایی');
      expect(sent.variables.code).toBe('PR-9988');
      expect(sent.variables.class).toBe('کلاس پایتون');

      // Verify db log record
      const logs = await smsService.listLogs({ mobile: '09121112233' });
      expect(logs.logs.length).toBe(1);
      expect(logs.logs[0].status).toBe('sent');
      expect(logs.logs[0].provider_message_id).toBeDefined();
    });
  });

  describe('3. IPPanel Provider Edge API Structure', () => {
    it('initializes IPPanel provider and handles network/auth safely', async () => {
      const provider = new IppanelProvider('test_invalid_api_key');
      expect(provider.name).toBe('ippanel');

      // Attempt to send with dummy key against Edge API
      const result = await provider.sendPattern({
        recipient: '09120000000',
        patternCode: 'p_test',
        variables: { name: 'Ali' }
      });

      // Because the key is test or no network outbound to live edge is allowed, it cleanly fails with error message without crashing
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
    });
  });
});
