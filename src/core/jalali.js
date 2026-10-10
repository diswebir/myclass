'use strict';
/**
 * ابزارهای تاریخ شمسی (جلالی)
 * تاریخ‌ها در پایگاه داده به صورت میلادی (YYYY-MM-DD) ذخیره و در رابط کاربری به صورت شمسی نمایش داده می‌شوند.
 */
const jalaali = require('jalaali-js');

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
// اندیس بر اساس getDay جاوااسکریپت: 0 = یکشنبه
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
// ترتیب هفته ایرانی (شنبه تا جمعه) بر حسب getDay
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

let TZ = 'Asia/Tehran';
function setTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    TZ = tz;
  } catch (e) { /* invalid tz */ }
}

const pad = (n) => String(n).padStart(2, '0');

function toEnDigits(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function toFaDigits(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** اجزای تاریخ/زمان فعلی در منطقه زمانی تنظیم‌شده */
function nowParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

/** تاریخ میلادی امروز: YYYY-MM-DD */
function today() {
  const p = nowParts();
  return `${p.year}-${p.month}-${p.day}`;
}

/** تاریخ و زمان: YYYY-MM-DD HH:mm:ss در منطقه زمانی سامانه */
function stamp(date = new Date()) {
  const p = nowParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function now() {
  return stamp();
}

/** زمان n دقیقه بعد */
function later(minutes) {
  return stamp(new Date(Date.now() + minutes * 60000));
}

function nowTime() {
  const p = nowParts();
  return `${p.hour}:${p.minute}`;
}

function parseG(g) {
  if (!g) return null;
  if (g instanceof Date) return { y: g.getFullYear(), m: g.getMonth() + 1, d: g.getDate() };
  const m = String(g).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** میلادی به شمسی: '2024-03-20' => '1403/01/01' */
function toJalali(g, sep = '/') {
  const p = parseG(g);
  if (!p) return '';
  const j = jalaali.toJalaali(p.y, p.m, p.d);
  return `${j.jy}${sep}${pad(j.jm)}${sep}${pad(j.jd)}`;
}

function toJalaliParts(g) {
  const p = parseG(g);
  if (!p) return null;
  return jalaali.toJalaali(p.y, p.m, p.d);
}

/** شمسی به میلادی: '1403/01/01' => '2024-03-20' ، در صورت نامعتبر بودن null */
function fromJalali(j) {
  if (!j) return null;
  const s = toEnDigits(j).trim().replace(/[-.]/g, '/');
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) return null;
  const g = jalaali.toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

function jalaliToGregorian(jy, jm, jd) {
  const g = jalaali.toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

function monthLength(jy, jm) {
  return jalaali.jalaaliMonthLength(jy, jm);
}

/** نمایش خوانا: '۱ فروردین ۱۴۰۳' */
function format(g, style = 'short') {
  const j = toJalaliParts(g);
  if (!j) return '';
  if (style === 'long') {
    const w = WEEKDAYS[weekday(g)];
    return `${w} ${j.jd} ${MONTHS[j.jm - 1]} ${j.jy}`;
  }
  if (style === 'medium') return `${j.jd} ${MONTHS[j.jm - 1]} ${j.jy}`;
  if (style === 'month') return `${MONTHS[j.jm - 1]} ${j.jy}`;
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

function formatDateTime(dt) {
  if (!dt) return '';
  const s = String(dt);
  const date = s.slice(0, 10);
  const time = s.length > 10 ? s.slice(11, 16) : '';
  return `${toJalali(date)}${time ? ' - ' + time : ''}`;
}

function toDate(g) {
  const p = parseG(g);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

function fromDate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(g, n) {
  const d = toDate(g);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return fromDate(d);
}

/** افزودن ماه شمسی (برای سررسید اقساط) */
function addJalaliMonths(g, n) {
  const j = toJalaliParts(g);
  let jy = j.jy, jm = j.jm + Number(n);
  while (jm > 12) { jm -= 12; jy++; }
  while (jm < 1) { jm += 12; jy--; }
  const jd = Math.min(j.jd, monthLength(jy, jm));
  return jalaliToGregorian(jy, jm, jd);
}

function diffDays(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

/** روز هفته به سبک getDay (0=یکشنبه) */
function weekday(g) {
  return toDate(g).getUTCDay();
}

function weekdayName(n) {
  return WEEKDAYS[n] || '';
}

/** لیست n ماه شمسی اخیر (از قدیم به جدید) */
function lastJalaliMonths(n = 12) {
  const t = toJalaliParts(today());
  const out = [];
  let jy = t.jy, jm = t.jm;
  for (let i = 0; i < n; i++) {
    out.unshift({
      jy, jm,
      key: `${jy}-${pad(jm)}`,
      label: `${MONTHS[jm - 1]}`,
      fullLabel: `${MONTHS[jm - 1]} ${jy}`,
      start: jalaliToGregorian(jy, jm, 1),
      end: jalaliToGregorian(jy, jm, monthLength(jy, jm)),
    });
    jm--;
    if (jm < 1) { jm = 12; jy--; }
  }
  return out;
}

function jalaliMonthKey(g) {
  const j = toJalaliParts(g);
  return j ? `${j.jy}-${pad(j.jm)}` : null;
}

function currentJalaliMonthRange() {
  const m = lastJalaliMonths(1)[0];
  return { start: m.start, end: m.end, label: m.fullLabel };
}

/** نمایش نسبی زمان: «۳ روز پیش» */
function relative(dt) {
  if (!dt) return '';
  const s = String(dt);
  const date = s.slice(0, 10);
  const d = diffDays(date, today());
  if (d === 0) return s.length > 10 ? `امروز ${s.slice(11, 16)}` : 'امروز';
  if (d === 1) return 'دیروز';
  if (d === -1) return 'فردا';
  if (d > 1 && d < 30) return `${d} روز پیش`;
  if (d < -1 && d > -30) return `${-d} روز دیگر`;
  return toJalali(date);
}

module.exports = {
  MONTHS, WEEKDAYS, WEEK_ORDER, setTimezone, toEnDigits, toFaDigits,
  today, now, stamp, later, nowTime, toJalali, toJalaliParts, fromJalali, jalaliToGregorian, monthLength,
  format, formatDateTime, addDays, addJalaliMonths, diffDays, weekday, weekdayName,
  lastJalaliMonths, jalaliMonthKey, currentJalaliMonthRange, relative, pad,
  getTimezone: () => TZ,
};
