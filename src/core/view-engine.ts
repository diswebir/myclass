import jalaali from 'jalaali-js';

export function toJalaliDate(dateInput: string | Date | null | undefined, includeTime = false): string {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const year = j.jy;
  const month = String(j.jm).padStart(2, '0');
  const day = String(j.jd).padStart(2, '0');

  let result = `${year}/${month}/${day}`;
  if (includeTime) {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    result += ` ${hours}:${minutes}`;
  }
  return result;
}

export function formatCurrency(amount: number | string | null | undefined, unit = 'تومان'): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '۰ ' + unit;
  const num = Number(amount);
  const formatted = num.toLocaleString('fa-IR');
  return `${formatted} ${unit}`;
}

export function getStatusBadge(status: string): { label: string; class: string } {
  const map: Record<string, { label: string; class: string }> = {
    // Classes
    draft: { label: 'پیش‌نویس', class: 'badge-gray' },
    open_for_prereg: { label: 'پیش‌ثبت‌نام فعال', class: 'badge-blue' },
    enrolling: { label: 'در حال ثبت‌نام', class: 'badge-blue' },
    capacity_full: { label: 'تکمیل ظرفیت', class: 'badge-yellow' },
    in_progress: { label: 'در حال برگزاری', class: 'badge-green' },
    completed: { label: 'پایان‌یافته', class: 'badge-purple' },
    cancelled: { label: 'لغوشده', class: 'badge-red' },

    // Attendance
    present: { label: 'حاضر', class: 'badge-green' },
    absent: { label: 'غایب', class: 'badge-red' },
    late: { label: 'تأخیر', class: 'badge-yellow' },
    excused: { label: 'غیبت موجه', class: 'badge-blue' },
    unrecorded: { label: 'ثبت‌نشده', class: 'badge-gray' },

    // Payments & Pre-registration
    pending: { label: 'در انتظار بررسی', class: 'badge-yellow' },
    approved: { label: 'تأیید شده', class: 'badge-green' },
    rejected: { label: 'رد شده', class: 'badge-red' },
    needs_correction: { label: 'نیازمند اصلاح', class: 'badge-yellow' },

    // Installments
    paid: { label: 'پرداخت شده', class: 'badge-green' },
    overdue: { label: 'معوق', class: 'badge-red' },
    partially_paid: { label: 'پرداخت جزئی', class: 'badge-yellow' },

    // Certificates
    active: { label: 'معتبر و فعال', class: 'badge-green' },
    revoked: { label: 'ابطال‌شده', class: 'badge-red' },
  };

  return map[status] || { label: status, class: 'badge-gray' };
}
