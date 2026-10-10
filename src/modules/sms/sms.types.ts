/** Types + error chung cho SmsProvider       import crculo (REQ-P6-01). */
export interface SmsMessage {
  recipient: string; // normalized recipient phone
  patternCode: string;
  variables: Record<string, string>;
  originator?: string | null;
  dedupeKey: string;
}

export interface SmsSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  sendPattern(msg: SmsMessage): Promise<SmsSendResult>;
}

export class SmsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsProviderError';
  }
}
