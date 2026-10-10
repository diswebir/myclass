import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  formatMoney,
  isNegativeMoney,
  isZeroMoney,
  maxMoney,
  minMoney,
  mulMoney,
  parseMoneyInput,
  subMoney,
  toMajor,
  ZERO,
} from '../../src/core/security/money';

describe('money — parseMoneyInput', () => {
  it('ارقام فارسی را می‌پذیرد', () => {
    expect(parseMoneyInput('۱۲۳۴۵')).toBe('12345');
  });
  it('ارقام عربی را می‌پذیرد', () => {
    expect(parseMoneyInput('١٢٣٤٥')).toBe('12345');
  });
  it('جداکننده هزارگان فارسی/ویرگول/فاصله را حذف می‌کند', () => {
    expect(parseMoneyInput('۱۲٬۳۴۵')).toBe('12345');
    expect(parseMoneyInput('12,345')).toBe('12345');
    expect(parseMoneyInput('12 345')).toBe('12345');
  });
  it('مقادیر نامعتبر را null می‌دهد', () => {
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('12.5')).toBeNull(); // فقط عدد صحیح
    expect(parseMoneyInput('-5')).toBeNull(); // منفی در ورودی مجاز نیست
    expect(parseMoneyInput('')).toBeNull();
  });
  it('with minorPerMajor=10 (ریال)', () => {
    expect(parseMoneyInput('100', 10)).toBe('1000');
  });
});

describe('money — عملیات ریاضی (BigInt — بدون FLOAT)', () => {
  it('جمع و تفریق', () => {
    expect(addMoney('1000000000001', '2')).toBe('1000000000003');
    expect(subMoney('5', '8')).toBe('-3');
  });
  it('ضرب و تقسیم', () => {
    expect(mulMoney('3', 7)).toBe('21');
    expect(subMoney('10', '3')).toBe('7');
  });
  it('مقایسه', () => {
    expect(compareMoney('5', '5')).toBe(0);
    expect(compareMoney('4', '5')).toBe(-1);
    expect(compareMoney('6', '5')).toBe(1);
    expect(maxMoney('4', '9')).toBe('9');
    expect(minMoney('4', '9')).toBe('4');
  });
  it('صفر و منفی', () => {
    expect(isZeroMoney(ZERO)).toBe(true);
    expect(isZeroMoney('1')).toBe(false);
    expect(isNegativeMoney('-1')).toBe(true);
    expect(isNegativeMoney('0')).toBe(false);
  });
  it('toMajor', () => {
    expect(toMajor('1500', 10)).toBe(150);
  });
});

describe('money — formatMoney', () => {
  it('جداکننده هزارگان + رقم فارسی', () => {
    expect(formatMoney('1234567')).toBe('۱٬۲۳۴٬۵۶۷');
  });
  it('رقم انگلیسی', () => {
    expect(formatMoney('1234567', { faDigits: false })).toBe('1٬234٬567');
  });
  it('با واحد', () => {
    expect(formatMoney('5000', { withUnit: true })).toBe('۵٬۰۰۰ تومان');
  });
  it('منفی', () => {
    expect(formatMoney('-1234')).toBe('−۱٬۲۳۴');
  });
});
