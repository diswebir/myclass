/**
 * Money is stored as an integer count of the base currency unit (IRR rial) in BIGINT columns.
 * Never use floating point for stored amounts.
 */
import { toEnglishDigits } from './persian';

export const MAX_AMOUNT = 10n ** 15n; // one quadrillion rials: far above any tuition, guards overflow.

export function parseMoney(input: string | number | bigint): bigint | null {
  if (typeof input === 'bigint') return input >= 0n && input <= MAX_AMOUNT ? input : null;
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) return null;
    return parseMoney(BigInt(input));
  }
  const cleaned = toEnglishDigits(input).replace(/[,\s٬]/g, '');
  if (!/^\d{1,16}$/.test(cleaned)) return null;
  const value = BigInt(cleaned);
  return value <= MAX_AMOUNT ? value : null;
}

/** Formats an integer amount with thousands separators (ASCII digits; locale-free). */
export function formatMoney(amount: bigint): string {
  const s = amount.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Sums amounts exactly. */
export function sumMoney(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n);
}
