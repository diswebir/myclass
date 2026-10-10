/**
 * Logger — سطوح error/warn/info. **هیچ secret (password، API key، token) ثبت نمی‌شود.**
 * با masking برای مقادیر حساس.
 */
type Level = 'error' | 'warn' | 'info';

const SENSITIVE_KEYS = [
  'password', 'password_hash', 'passwordhash', 'secret', 'token', 'csrf', 'csrf_token',
  'api_key', 'apikey', 'api-key', 'authorization', 'cookie', 'session', 'session_secret',
  'encryption_key', 'private_key', 'credential', 'otp', 'pin',
];

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // heuristics: مقادیر hex بلند (کلید/توکن) ماسک شوند
    if (value.length >= 24 && /^[a-f0-9]+$/i.test(value)) return '***REDACTED***';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lk.includes(s))) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function write(level: Level, args: unknown[]): void {
  const payload = args.map(redact);
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${payload
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  error: (...args: unknown[]) => write('error', args),
  warn: (...args: unknown[]) => write('warn', args),
  info: (...args: unknown[]) => write('info', args),
  /** رویداد audit — verte separat (بدون stack) */
  audit: (action: string, meta?: unknown) => write('info', [`AUDIT ${action}`, meta ?? {}]),
};
