import { SmsProvider, SmsSendPatternInput, SmsSendResult } from './sms-provider.interface';

export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  public sentMessages: SmsSendPatternInput[] = [];

  async sendPattern(input: SmsSendPatternInput): Promise<SmsSendResult> {
    this.sentMessages.push(input);
    return {
      success: true,
      messageId: `FAKE-MSG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      rawResponse: { status: 'mocked_ok' }
    };
  }

  clear() {
    this.sentMessages = [];
  }
}
