import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gregorianToJalali, jalaliToGregorian, isLeapJalaliYear, jalaliMonthLength, parseIsoDate, toIsoDate, formatJalali,
} from '../../lib/jalali';

test('known Nowruz dates convert correctly', () => {
  assert.deepEqual(gregorianToJalali(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 });
  assert.deepEqual(gregorianToJalali(2025, 3, 21), { jy: 1404, jm: 1, jd: 1 });
  assert.deepEqual(gregorianToJalali(1978, 3, 21), { jy: 1357, jm: 1, jd: 1 });
});

test('leap-year rules match the arithmetic calendar', () => {
  assert.equal(isLeapJalaliYear(1403), true);
  assert.equal(isLeapJalaliYear(1404), false);
  assert.equal(isLeapJalaliYear(1399), true);
  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
  assert.equal(jalaliMonthLength(1404, 7), 30);
});

test('Esfand 30 exists only in leap years (boundary)', () => {
  assert.deepEqual(jalaliToGregorian(1403, 12, 30), { gy: 2025, gm: 3, gd: 20 });
  assert.throws(() => jalaliToGregorian(1404, 12, 30), RangeError);
  assert.throws(() => jalaliToGregorian(1404, 13, 1), RangeError);
  assert.throws(() => jalaliToGregorian(1404, 1, 0), RangeError);
});

test('round trip and Intl cross-check for 1925..2100 (sampled every 3 days)', () => {
  const fmt = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  let checked = 0;
  for (let t = Date.UTC(1925, 0, 1); t < Date.UTC(2100, 0, 1); t += 3 * 86400000) {
    const d = new Date(t);
    const gy = d.getUTCFullYear();
    const gm = d.getUTCMonth() + 1;
    const gd = d.getUTCDate();
    const j = gregorianToJalali(gy, gm, gd);
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    assert.deepEqual(j, { jy: Number(parts.year), jm: Number(parts.month), jd: Number(parts.day) }, `${gy}-${gm}-${gd}`);
    assert.deepEqual(jalaliToGregorian(j.jy, j.jm, j.jd), { gy, gm, gd });
    checked++;
  }
  assert.ok(checked > 10000);
});

test('ISO date parsing rejects impossible dates and storage format is stable', () => {
  assert.equal(parseIsoDate('2025-02-30'), null);
  assert.equal(parseIsoDate('2025-3-1'), null);
  assert.deepEqual(parseIsoDate('2024-02-29'), { gy: 2024, gm: 2, gd: 29 });
  assert.equal(toIsoDate({ gy: 2025, gm: 3, gd: 1 }), '2025-03-01');
});

test('display formatting uses Persian digits and Jalali calendar', () => {
  assert.equal(formatJalali('2025-03-21'), '۱۴۰۴/۰۱/۰۱');
  assert.equal(formatJalali('2025-03-21', { persianDigits: false }), '1404/01/01');
  assert.equal(formatJalali('2025-03-21', { monthName: true, persianDigits: false }), '1 فروردین 1404');
  assert.equal(formatJalali('not-a-date'), '');
});
