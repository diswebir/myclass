/**
 * تست شکل‌دهنده فارسی — در برابر fixtureهای تولیدشده با HarfBuzz (per spike).
 * این تست نیازی به harfbuzzjs ندارد (dev-only) — fixtureها از قبل ذخیره شده‌اند.
 */
import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/shaping-cases.json';
import { shapeLogical, shapeRtl, stringToCps, toHex, toVisualOrder } from '../../src/core/text/shape';

describe('shaping — تطابق با HarfBuzz (fixture)', () => {
  for (const fx of fixtures) {
    it(`shapeLogical(${fx.input})`, () => {
      const got = stringToCps(shapeLogical(fx.input));
      expect(toHex(got)).toBe(toHex(fx.expected));
    });
  }
});

describe('shaping — موارد خاص', () => {
  it('سلام → SEEN initial + LAM-ALEF final + MEEM (base)', () => {
    const cps = stringToCps(shapeLogical('سلام'));
    expect(cps[0]).toBe(0xfeb3); // SEEN initial
    expect(cps[1]).toBe(0xfefc); // LAM-ALEF final ligature
    expect(cps[2]).toBe(0x0645); // MEEM isolated → کد پایه
  });
  it('ZWNJ (نیم‌فاصله) — اتصال را می‌شکند', () => {
    // «برنامه‌نویسی» با نیم‌فاصله: ه و ن به هم متصل نمی‌شوند
    const cps = stringToCps(shapeLogical('ه\u200cن'));
    expect(cps).toContain(0x200c);
  });
  it('حذف harakat', () => {
    const withHarakat = stringToCps(shapeLogical('سَلام'));
    const without = stringToCps(shapeLogical('سلام'));
    expect(toHex(withHarakat)).toBe(toHex(without));
  });
});

describe('bidi — ترتیب دیداری', () => {
  it('متن RTL — ترتیب دیداری', () => {
    // 'سلام 123 test' → 'test 123 مالس' ( ترتیب دیداری برای رسم چپ‌به‌راست)
    expect(toVisualOrder('سلام 123 test', 'rtl')).toBe('test 123 مالس');
  });
  it('shapeRtl — متن مختلط', () => {
    const visual = shapeRtl('شماره گواهی: MC-1403-00123');
    expect(visual).toContain('MC-1403-00123'); // LTR حفظ ترتیب
    // بخش فارسی به فرم‌های presentation شکل‌دهی و معکوس شده است
    expect(visual.length).toBeGreaterThan(10);
    expect(visual).not.toContain('گواهی'); // متن منطقی در خروجی دیداری نیست
  });
  it('متن Wider LTR — پایه ltr', () => {
    expect(toVisualOrder('Hello world', 'ltr')).toBe('Hello world');
  });
});
