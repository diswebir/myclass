const SENSITIVE_KEY = /pass|secret|token|api[_-]?key|hash|otp|authorization|cookie|csrf/i;
const MAX_STRING = 500;

/**
 * Removes secrets from objects before they are written to logs or the audit trail.
 * Keys matching SENSITIVE_KEY are replaced by "[REDACTED]"; long strings are truncated.
 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[DEPTH]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitizeForLog(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
