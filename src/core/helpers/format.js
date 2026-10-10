/**
 * ابزارهای قالب‌بندی نمایشی — اعداد فارسی، مبلغ، درصد و ...
 */
const { toPersianDigits, toEnglishDigits } = require('./jalali');

/** عدد با جداکننده هزارگان فارسی */
function numberFa(n, withDigits = true) {
  if (n === null || n === undefined || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(toEnglishDigits(n)) : n;
  if (isNaN(num)) return '—';
  const fixed = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.00$/, '');
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '،');
  const out = decPart ? `${withSep}.${decPart}` : withSep;
  return withDigits ? toPersianDigits(out) : out;
}

/** مبلغ + واحد پول */
function moneyFa(n, currency = 'تومان') {
  if (n === null || n === undefined || n === '') return '—';
  return `${numberFa(n)} ${currency}`;
}

/** درصد */
function percentFa(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${toPersianDigits(Number(n).toFixed(1).replace(/\.0$/, ''))}٪`;
}

/** حذف تگ‌های HTML (برای پیش‌نمایش امن) */
function stripHtml(str) {
  return String(str || '').replace(/<[^>]*>/g, '');
}

/** متن کوتاه‌شده */
function truncate(str, len = 80) {
  const s = String(str || '');
  return s.length > len ? s.slice(0, len) + '…' : s;
}

/** نام کامل کاربر */
function fullName(user) {
  if (!user) return '—';
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || '—';
}

/** وضعیت‌های فارسی */
const STATUS_FA = {
  // کلاس
  draft: 'پیش‌نویس',
  open: 'ثبت‌نام باز',
  in_progress: 'در حال برگزاری',
  completed: 'پایان‌یافته',
  cancelled: 'لغو شده',
  // جلسه
  scheduled: 'برنامه‌ریزی شده',
  held: 'برگزار شده',
  // حضور
  present: 'حاضر',
  absent: 'غایب',
  late: 'تاخیر',
  excused: 'غیبت موجه',
  // ثبت‌نام
  pending: 'در انتظار بررسی',
  approved: 'تایید شده',
  rejected: 'رد شده',
  // پرداخت
  paid: 'پرداخت شده',
  unpaid: 'پرداخت نشده',
  overdue: 'معوق',
  // مدرک
  issued: 'صادر شده',
  revoked: 'ابطال شده',
  // متفرقه
  active: 'فعال',
  finished: 'پایان‌یافته',
  dropped: 'انصراف',
  sent: 'ارسال شده',
  failed: 'ناموفق',
  skipped: 'ارسال نشده',
  // روش پرداخت
  cash: 'نقدی',
  card_to_card: 'کارت به کارت',
  online: 'آنلاین',
  other: 'سایر',
};

function statusFa(status) {
  return STATUS_FA[status] || status || '—';
}

/** کلاس رنگی برگه وضعیت */
function statusClass(status) {
  const map = {
    open: 'success', approved: 'success', paid: 'success', present: 'success',
    issued: 'success', active: 'success', held: 'success', sent: 'info',
    pending: 'warning', late: 'warning', in_progress: 'info', scheduled: 'info',
    draft: 'muted', excused: 'info',
    rejected: 'danger', absent: 'danger', overdue: 'danger', cancelled: 'danger',
    failed: 'danger', dropped: 'danger', revoked: 'danger', unpaid: 'warning',
    completed: 'muted', finished: 'muted', skipped: 'muted', other: 'muted',
  };
  return map[status] || 'muted';
}

module.exports = {
  numberFa,
  moneyFa,
  percentFa,
  stripHtml,
  truncate,
  fullName,
  statusFa,
  statusClass,
  STATUS_FA,
};
