/**
 * PaymentGateway interface — ready for a real gateway (phase 4/7).
 * - Default: FakeGateway (test/dev — a real gateway stays "not configured").
 * - Implementations: Iranian gateways (Zarinpal/...). API keys only server-side
 *   (read from env), never logged.
 */
import type { Config } from '../../core/config/env';
import type { Money } from '../../core/security/money';
import { AppError } from '../../core/errors/AppError';

export interface PaymentSession {
  sessionId: string;
  url: string;
  amount: Money;
}

export interface VerifyResult {
  ok: boolean;
  refId: string | null;
  amount: Money | null;
}

export interface PaymentGateway {
  readonly name: string;
  /** Create a payment session — user is redirected to the gateway url. */
  createSession(opts: { amount: Money; description: string; callbackUrl: string; mobile?: string }): Promise<PaymentSession>;
  /** Verify a payment after the user returns from the gateway. */
  verify(opts: { sessionId: string; authority?: string }): Promise<VerifyResult>;
}

/** Fake gateway — deterministic for tests (opens no network connection). */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';

  async createSession(opts: { amount: Money; description: string; callbackUrl: string }): Promise<PaymentSession> {
    const sessionId = `fake-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      sessionId,
      url: `${opts.callbackUrl}?fake_session=${sessionId}`,
      amount: opts.amount,
    };
  }

  async verify(opts: { sessionId: string; authority?: string }): Promise<VerifyResult> {
    return { ok: true, refId: opts.authority ?? `fake-ref-${opts.sessionId}`, amount: null };
  }
}

/** Select the gateway — for now only Fake; a real gateway stays "not configured". */
export function getGateway(_config: Config): PaymentGateway {
  return new FakeGateway();
}

/** Error for not-yet-configured gateways. */
export function gatewayNotConfigured(name: string): AppError {
  return AppError.badRequest(`درگاه پرداخت «${name}» هنوز پیکربندی نشده است.`);
}
