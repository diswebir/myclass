import { describe, expect, it } from 'vitest';
import {
  normalizeDigits,
  normalizePhone,
  normalizeText,
  toArabicDigits,
  toPersianDigits,
} from '../../src/core/security/normalize';

describe('normalizeDigits', () => {
  it('فارسی → انگلیسی', () => {
    expect(normalizeDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
  });
  it('عربی → انگلیسی', () => {
    expect(normalizeDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
  });
  it('حروف و کاراکترهای دیگر را دست‌نخورده می‌گذارد', () => {
    expect(normalizeDigits('۱۲۳abc')).toBe('123abc');
  });
});

describe('toPersianDigits / toArabicDigits', () => {
  it('انگلیسی → فارسی', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
    expect(toPersianDigits(42)).toBe('۴۲');
  });
  it('انگلیسی → عربی', () => {
    expect(toArabicDigits('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });
});

describe('normalizePhone', () => {
  it('09xxxxxxxxx می‌پذیرد', () => {
    expect(normalizePhone('09123456789')).toBe('09123456789');
  });
  it('+98 را به 0 تبدیل می‌کند', () => {
    expect(normalizePhone('+989123456789')).toBe('09123456789');
  });
  it('0098 را به 0 تبدیل می‌کند', () => {
    expect(normalizePhone('00989123456789')).toBe('09123456789');
  });
  it('98 بدون صفر را می‌پذیرد', () => {
    expect(normalizePhone('989123456789')).toBe('09123456789');
  });
  it('ارقام فارسی را نرمال می‌کند', () => {
    expect(normalizePhone('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
  });
  it('فاصله و خط تیره را حذف می‌کند', () => {
    expect(normalizePhone('0912-345-6789')).toBe('09123456789');
  });
  it('نامعتبر → null', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('08123456789')).toBeNull();
    expect(normalizePhone('091234567890')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('normalizeText', () => {
  it('trim و نرمال‌سازی فاصله', () => {
    expect(normalizeText('  سلام   دنیا  ')).toBe('سلام دنیا');
  });
});
