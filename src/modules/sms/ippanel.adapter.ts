/**
 * IPPanel Edge adapter  https://edge.ippanel.com/v1 (REQ-P6-01).
 *
 * UNVERIFIED (blocker B2): the sandbox cannot reach ippanelcom.github.io/Edge-Document,
 * so the exact request/response shapes below follow the common IPPanel Edge "pattern send"
 * contract and are ISOLATED in this single file  per spec 3, fix paths/body/response
 * parsing here only, after reading the official docs. No other code depends on the wire format.
 *
 * Security: the API key is sent ONLY as the `apikey` header; it is never logged
 * (errors carry status + response excerpt, never the key).
 */
import { SmsProviderError, type SmsMessage, type SmsProvider, type SmsSendResult } from './sms.types';

interface IPanelPatternSendResponse {
  status?: string | number;
  message?: string;
  data?: { bulk_id?: string | number; message_id?: string | number } | Array<{ bulk_id?: string | number; message_id?: string | number }>;
  result?: { bulk_id?: string | number };
}

export class IPanelSmsProvider implements SmsProvider {
  readonly name = 'ippanel';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly originator: string | null,
  ) {}

  /** POST {base}/sms/pattern/send  UNVERIFIED shape (see header note). */
  async sendPattern(msg: SmsMessage): Promise<SmsSendResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/sms/pattern/send`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        body: JSON.stringify({
          pattern_code: msg.patternCode,
          originator: msg.originator ?? this.originator,
          recipient: msg.recipient,
          values: msg.variables,
        }),
      });
    } catch (err) {
      // network error — message only, never the key
      throw new SmsProviderError(`خطای شبکه در ارتباط با پنل پیامک: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      // never include request headers (which carry the key) in the error
      throw new SmsProviderError(`پنل پیامک خطا داد (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    let body: IPanelPatternSendResponse = {};
    try {
      body = JSON.parse(text) as IPanelPatternSendResponse;
    } catch {
      throw new SmsProviderError('پاسخ نامعتبر از پنل پیامک.');
    }
    const dataObj = Array.isArray(body.data) ? body.data[0] : body.data;
    const id = dataObj?.bulk_id ?? dataObj?.message_id ?? body.result?.bulk_id;
    const okStatus = body.status === 'success' || body.status === 1 || body.status === '1' || res.status === 200;
    if (!okStatus) {
      return { ok: false, error: body.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, providerMessageId: id != null ? String(id) : undefined };
  }
}
