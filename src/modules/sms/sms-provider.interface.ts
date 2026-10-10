export interface SmsSendPatternInput {
  recipient: string;
  patternCode: string;
  variables: Record<string, string | number>;
  originator?: string;
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  errorMessage?: string;
  rawResponse?: any;
}

export interface SmsProvider {
  readonly name: string;
  sendPattern(input: SmsSendPatternInput): Promise<SmsSendResult>;
  checkBalance?(): Promise<{ balance: number; currency: string }>;
}
