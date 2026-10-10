import { describe, expect, it } from 'vitest';
import { sanitizeCsvCell, sanitizeCsvRow } from '../../src/core/security/csvGuard';

describe('csvGuard — جلوگیری از Formula Injection (per spec §۶-پ)', () => {
  it('سلول‌های خطرناک با پیشوند \' بی‌اثر می‌شوند', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('+cmd')).toBe("'+cmd");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('سلول‌های بی‌خطر دست‌نخورده می‌مانند', () => {
    expect(sanitizeCsvCell('سلام')).toBe('سلام');
    expect(sanitizeCsvCell('123')).toBe('123');
    expect(sanitizeCsvCell('=x')).toBe("'=x");
  });
  it('null/undefined → رشته خالی', () => {
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(undefined)).toBe('');
  });
  it('sanitizeCsvRow', () => {
    expect(sanitizeCsvRow(['a', '=1+1', 5])).toEqual(['a', "'=1+1", '5']);
  });
});
