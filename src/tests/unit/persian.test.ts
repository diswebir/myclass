import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIranMobile, normalizeText, toEnglishDigits, toPersianDigits } from '../../lib/persian';
import { parseMoney, formatMoney, sumMoney } from '../../lib/money';

test('Persian and Arabic digits convert to ASCII and back', () => {
  assert.equal(toEnglishDigits('۰۹۱۲-۱۲۳٤'.replace('٤', '4')), '0912-1234');
  assert.equal(toEnglishDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(toPersianDigits(1404), '۱۴۰۴');
});

test('mobile numbers normalise to 09XXXXXXXXX', () => {
  assert.equal(normalizeIranMobile('09121234567'), '09121234567');
  assert.equal(normalizeIranMobile('۰۹۱۲ ۱۲۳ ۴۵۶۷'), '09121234567');
  assert.equal(normalizeIranMobile('+989121234567'), '09121234567');
  assert.equal(normalizeIranMobile('00989121234567'), '09121234567');
  assert.equal(normalizeIranMobile('9121234567'), '09121234567');
  assert.equal(normalizeIranMobile('0912-123-4567'), '09121234567');
});

test('invalid mobile numbers are rejected', () => {
  for (const v of ['0812123456', '091212345', '09121234567890', 'abc', '+981212345678', '']) {
    assert.equal(normalizeIranMobile(v), null, v);
  }
});

test('Persian keyboard letters are normalised', () => {
  assert.equal(normalizeText('  علي   كريمي  '), 'علی کریمی');
});

test('money parses exact integers and rejects decimals or negatives', () => {
  assert.equal(parseMoney('۱,۲۵۰,۰۰۰'), 1250000n);
  assert.equal(parseMoney('1 000 000'), 1000000n);
  assert.equal(parseMoney('1.5'), null);
  assert.equal(parseMoney('-10'), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(1.5), null);
  assert.equal(parseMoney(2n ** 60n), null);
});

test('money sums are exact (no floating-point drift)', () => {
  const values = Array.from({ length: 10 }, () => parseMoney('100000')!);
  assert.equal(sumMoney(values), 1000000n);
  assert.equal(formatMoney(1234567890n), '1,234,567,890');
  assert.equal(formatMoney(0n), '0');
});
