import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, maskSecret } from '../../src/core/security/crypto';
import { randomToken, safeEqual, sha256hex } from '../../src/core/security/tokens';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../../src/core/security/password';

const KEY = 'a'.repeat(64); // ۳۲ بایت hex

describe('crypto — AES-256-GCM', () => {
  it('رمزنگاری و رمزگشایی round-trip', () => {
    const ct = encryptSecret('s3cr3t-key', KEY);
    expect(ct).not.toContain('s3cr3t-key');
    expect(decryptSecret(ct, KEY)).toBe('s3cr3t-key');
  });
  it('کلید اشتباه → خطا', () => {
    const ct = encryptSecret('x', KEY);
    expect(() => decryptSecret(ct, 'b'.repeat(64))).toThrow();
  });
  it('کلید کوتاه → خطا', () => {
    expect(() => encryptSecret('x', 'abcd')).toThrow();
  });
  it('maskSecret', () => {
    expect(maskSecret('abcdef123456')).toBe('****3456');
    expect(maskSecret('')).toBe('');
    expect(maskSecret('ab')).toBe('****');
  });
});

describe('tokens', () => {
  it('randomToken — hex به طول ۶۴', () => {
    expect(randomToken(32)).toHaveLength(64);
    expect(randomToken(8)).toHaveLength(16);
  });
  it('sha256hex — پایدار', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('password — bcryptjs', () => {
  it('hash و verify', async () => {
    const hash = await hashPassword('Secret123', 4);
    expect(hash).not.toBe('Secret123');
    expect(await verifyPassword('Secret123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
  it('validatePasswordPolicy', () => {
    expect(validatePasswordPolicy('Abcdef12').ok).toBe(true);
    expect(validatePasswordPolicy('short').ok).toBe(false);
    expect(validatePasswordPolicy('alllowercase').ok).toBe(false); // بدون عدد
    expect(validatePasswordPolicy('NoDigitsHere').ok).toBe(false);
  });
});
