import { formatJalali } from '../lib/jalali';
import { toPersianDigits } from '../lib/persian';

const TEHRAN = 'Asia/Tehran';

// Gregorian parts in Tehran time; conversion to Jalali is done explicitly by formatJalali (single source of truth).
const dateTimeFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TEHRAN,
  numberingSystem: 'latn',
});

/** Presentation-only conversion: database stores UTC; users see Tehran local time in Persian digits. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = Object.fromEntries(dateTimeFormatter.formatToParts(d).map((p) => [p.type, p.value]));
  const gy = Number(parts.year);
  const gm = Number(parts.month);
  const gd = Number(parts.day);
  const iso = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  return `${formatJalali(iso)} ${toPersianDigits(`${parts.hour}:${parts.minute}`)}`;
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return formatJalali(value);
}

export function num(value: number | bigint): string {
  return toPersianDigits(String(value));
}

export const ROLE_LABELS: Record<string, string> = {
  active: 'فعال',
  disabled: 'غیرفعال',
};
