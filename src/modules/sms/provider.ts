/**
 * SmsProvider — abstraction for SMS sending (REQ-P6-01).
 * Implementations: FakeSmsProvider (tests/default — no network) and IPanelSmsProvider (edge.ippanel.com).
 * Rule: tests never send real SMS unless SMS_LIVE_TESTS=1 (REQ-P6-05).
 */
import type { Config } from '../../core/config/env';
import { IPanelSmsProvider } from './ippanel.adapter';
import { SmsProviderError, type SmsMessage, type SmsProvider, type SmsSendResult } from './sms.types';

export { SmsProviderError };
export type { SmsMessage, SmsProvider, SmsSendResult };

/** Fake provider — in-memory outbox for tests, no network. */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  /** Shared outbox (tests read/reset). */
  static readonly outbox: SmsMessage[] = [];
  /** Artificial consecutive failures (for backoff tests). */
  static failuresRemaining = 0;
  /** Simulated send latency (ms). */
  static latencyMs = 0;

  static reset(): void {
    FakeSmsProvider.outbox.length = 0;
    FakeSmsProvider.failuresRemaining = 0;
    FakeSmsProvider.latencyMs = 0;
  }

  static failNext(n: number): void {
    FakeSmsProvider.failuresRemaining = n;
  }

  async sendPattern(msg: SmsMessage): Promise<SmsSendResult> {
    if (FakeSmsProvider.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, FakeSmsProvider.latencyMs));
    }
    if (FakeSmsProvider.failuresRemaining > 0) {
      FakeSmsProvider.failuresRemaining -= 1;
      return { ok: false, error: 'fake provider failure (simulated)' };
    }
    FakeSmsProvider.outbox.push(msg);
    return { ok: true, providerMessageId: `fake-${FakeSmsProvider.outbox.length}` };
  }
}

/**
 * Provider selection — main rule REQ-P6-05:
 * unless SMS_LIVE_TESTS=1, always Fake (even with provider=ippanel) — tests/cron never hit the real network.
 */
export function getSmsProvider(
  config: Config,
  opts: { apiKey?: string; baseUrl?: string; originator?: string | null },
): SmsProvider {
  const live = config.SMS_LIVE_TESTS === '1';
  const provider = config.SMS_PROVIDER || 'ippanel';
  if (live && provider === 'ippanel') {
    if (!opts.apiKey) throw new SmsProviderError('کلید API پیامک تنظیم نشده است.');
    return new IPanelSmsProvider(opts.baseUrl ?? config.IP_PANEL_BASE_URL, opts.apiKey, opts.originator ?? null);
  }
  return new FakeSmsProvider();
}
