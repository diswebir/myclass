import { SmsProvider, SmsSendPatternInput, SmsSendResult } from './sms-provider.interface';
import { logger } from '../../core/logger';

export class IppanelProvider implements SmsProvider {
  readonly name = 'ippanel';
  private baseUrl = 'https://edge.ippanel.com/v1';

  constructor(private apiKey: string, private defaultOriginator = '+983000505') {}

  async sendPattern(input: SmsSendPatternInput): Promise<SmsSendResult> {
    if (!this.apiKey) {
      return {
        success: false,
        errorMessage: 'کلید API پنل پیامک IPPanel تنظیم نشده است.'
      };
    }

    const url = `${this.baseUrl}/messages/patterns/send`;
    const originator = input.originator || this.defaultOriginator;

    // Convert all values to string for pattern compatibility
    const formattedValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.variables)) {
      formattedValues[k] = String(v);
    }

    const payload = {
      pattern_code: input.patternCode,
      originator,
      recipient: input.recipient,
      values: formattedValues
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      const data: any = await response.json();

      if (!response.ok) {
        const errorMsg = data?.message || data?.error || `HTTP ${response.status}`;
        logger.error('IPPanel sendPattern failed', { errorMsg, status: response.status });
        return {
          success: false,
          errorMessage: errorMsg,
          rawResponse: data
        };
      }

      // Successful IPPanel response contains message_id or tracking id
      const messageId = String(data?.data?.message_id || data?.message_id || data?.id || '');
      return {
        success: true,
        messageId,
        rawResponse: data
      };
    } catch (err: any) {
      logger.error('Network exception connecting to IPPanel API', err);
      return {
        success: false,
        errorMessage: err.message || 'خطای شبکه در اتصال به سرویس پیامک IPPanel'
      };
    }
  }
}
