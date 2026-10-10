import { describe, expect, it } from 'vitest';
import {
  formatJalaali,
  fromJalaali,
  isJalaaliLeap,
  jalaaliMonthLength,
  parseJalaali,
  toJalaali,
} from '../../src/core/text/jalaali';
import { toDbDate } from '../../src/core/db/time';

describe('jalaali — تبدیل تاریخ', () => {
  it(' تبدیل ۱۴۰۳/۰۱/۰۱ → ۲۰۲۴/۰۳/۲۰ (UTC)', () => {
    const d = fromJalaali(1403, 1, 1);
    expect(toDbDate(d)).toBe('2024-03-20');
  });
  it(' تبدیل معکوس', () => {
    const j = toJalaali(new Date(Date.UTC(2024, 2, 20)));
    expect([j.jy, j.jm, j.jd]).toEqual([1403, 1, 1]);
  });
  it('قالب نمایشی با رقم فارسی', () => {
    expect(formatJalaali(fromJalaali(1403, 7, 19))).toBe('۱۴۰۳/۰۷/۱۹');
  });
});

describe('jalaali — سال کبیسه (per spec — تست الزامی)', () => {
  it('۱۴۰۳ کبیسه است', () => {
    expect(isJalaaliLeap(1403)).toBe(true);
  });
  it('۱۴۰۲ کبیسه نیست', () => {
    expect(isJalaaliLeap(1402)).toBe(false);
  });
  it('اسفند سال کبیسه ۳۰ روز است', () => {
    expect(jalaaliMonthLength(1403, 12)).toBe(30);
    expect(jalaaliMonthLength(1402, 12)).toBe(29);
  });
});

describe('jalaali — parseJalaali (ورودی کاربر)', () => {
  it('رقم فارسی و جداکننده‌های مختلف', () => {
    expect(toDbDate(parseJalaali('۱۴۰۳/۰۷/۱۹')!)).toBe('2024-10-10');
    expect(toDbDate(parseJalaali('1403-07-19')!)).toBe('2024-10-10');
    expect(toDbDate(parseJalaali('1403.07.19')!)).toBe('2024-10-10');
  });
  it('margin month — روز نامعتبر → null', () => {
    expect(parseJalaali('1403/13/01')).toBeNull(); // ماه ۱۳
    expect(parseJalaali('1403/07/31')).toBeNull(); // مهر ۳۰ روز است
    expect(parseJalaali('1402/12/30')).toBeNull(); // اسفند ۱۴۰۲ ۲۹ روز است
    expect(parseJalaali('1403/12/30')).not.toBeNull(); // اسفند ۱۴۰۳ ۳۰ روز است
  });
  it('فرمت اشتباه → null', () => {
    expect(parseJalaali('1403')).toBeNull();
    expect(parseJalaali('')).toBeNull();
  });
});
