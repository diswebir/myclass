/**
 * ابزارهای تقویم شمسی — تبدیل، قالب‌بندی و محاسبات
 */
const jalaali = require('jalaali-js');

const MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const EN_DIGITS = '0123456789';

function toEnglishDigits(str) {
  return String(str == null ? '' : str)
    .replace(/[۰-۹]/g, (d) => EN_DIGITS[FA_DIGITS.indexOf(d)])
    .replace(/[٠-٩]/g, (d) => EN_DIGITS['٠١٢٣٤٥٦٧٨٩'.indexOf(d)]);
}

function toPersianDigits(str) {
  return String(str == null ? '' : str).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}

/** تاریخ میلادی (Date یا رشته YYYY-MM-DD) → رشته شمسی YYYY/MM/DD */
function toJalali(date, sep = '/') {
  if (!date) return '';
  let d = date;
  if (typeof d === 'string') {
    const s = d.trim().replace(/[^\d\-\/: ]/g, '').split(' ')[0].replace(/\//g, '-');
    const [y, m, day] = s.split('-').map((x) => parseInt(x, 10));
    if (!y || !m || !day) return '';
    d = new Date(y, m - 1, day);
  }
  if (!(d instanceof Date) || isNaN(d)) return '';
  const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${j.jy}${sep}${String(j.jm).padStart(2, '0')}${sep}${String(j.jd).padStart(2, '0')}`;
}

/** رشته شمسی (۱۴۰۳/۰۷/۰۱ یا 1403-07-01) → Date میلادی */
function jalaliToDate(str) {
  if (!str) return null;
  let s = toEnglishDigits(String(str).trim()).replace(/-/g, '/');
  const parts = s.split('/').map((x) => parseInt(x, 10));
  if (parts.length < 3 || parts.some(isNaN)) return null;
  let [jy, jm, jd] = parts;
  if (jy > 1700) {
    // تاریخ میلادی وارد شده
    return new Date(jy, jm - 1, jd);
  }
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) return null;
  const g = jalaali.toGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd);
}

/** رشته شمسی → رشته میلادی YYYY-MM-DD برای ذخیره در دیتابیس */
function jalaliToDb(str) {
  const d = jalaliToDate(str);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** تاریخ میلادی DB → شمسی فارسی زیبا مثل ۱ مهر ۱۴۰۳ */
function jalaliLong(date) {
  if (!date) return '';
  let d = date;
  if (typeof d === 'string') {
    const s = d.trim().split(' ')[0].replace(/\//g, '-');
    const [y, m, day] = s.split('-').map((x) => parseInt(x, 10));
    if (!y) return '';
    d = new Date(y, m - 1, day);
  }
  if (!(d instanceof Date) || isNaN(d)) return '';
  const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${toPersianDigits(j.jd)} ${MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`;
}

/** ساعت استخراج از datetime */
function timeFa(dateStr, withSeconds = false) {
  if (!dateStr) return '';
  const s = String(dateStr);
  const m = s.match(/(\d{2}):(\d{2})(:(\d{2}))?/);
  if (!m) return '';
  return toPersianDigits(withSeconds ? `${m[1]}:${m[2]}:${m[4] || '00'}` : `${m[1]}:${m[2]}`);
}

/** امروز به شمسی */
function todayJalali() {
  return toJalali(new Date());
}

/** آیا سال کبیسه؟ */
function isLeap(jy) {
  return jalaali.isLeapJalaaliYear(jy);
}

/** طول ماه شمسی */
function jMonthLength(jy, jm) {
  return jalaali.jalaaliMonthLength(jy, jm);
}

/** نام روز هفته از روی تاریخ میلادی (شنبه=0 ... جمعه=6) */
function weekdayIndex(date) {
  let d = date;
  if (typeof d === 'string') {
    const s = d.trim().split(' ')[0].replace(/\//g, '-');
    const [y, m, day] = s.split('-').map((x) => parseInt(x, 10));
    d = new Date(y, m - 1, day);
  }
  // JS: 0=Sunday ... 6=Saturday → تبدیل به شنبه=0
  return (d.getDay() + 1) % 7;
}

function weekdayName(date, short = false) {
  const idx = weekdayIndex(date);
  return short ? WEEKDAYS_SHORT[idx] : WEEKDAYS[idx];
}

/** تفاضل روزها */
function daysBetween(a, b) {
  const d1 = a instanceof Date ? a : jalaliToDate(a) || new Date(a);
  const d2 = b instanceof Date ? b : jalaliToDate(b) || new Date(b);
  return Math.round((d2 - d1) / 86400000);
}

/** افزودن روز به تاریخ */
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** تبدیل زمان HH:MM به دقیقه */
function timeToMinutes(t) {
  if (!t) return 0;
  const s = toEnglishDigits(String(t));
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** لیست روزهای هفته برای فرم‌ها */
function weekdaysList() {
  return WEEKDAYS.map((w, i) => ({ value: i, label: w }));
}

module.exports = {
  MONTHS,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  toEnglishDigits,
  toPersianDigits,
  toJalali,
  jalaliToDate,
  jalaliToDb,
  jalaliLong,
  timeFa,
  todayJalali,
  isLeap,
  jMonthLength,
  weekdayIndex,
  weekdayName,
  daysBetween,
  addDays,
  timeToMinutes,
  weekdaysList,
};
