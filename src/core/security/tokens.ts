/** توکن‌ها و هش — هیچ توکن/کلیدی در لاگ یا DB به‌صورت خام ذخیره نمی‌شود ( جز session token که hash می‌شود). */
import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** هش توکن نشست برای ذخیره در DB (chterm: فقط hash ذخیره می‌شود). */
export function hashSessionToken(token: string): string {
  return sha256hex(`session:${token}`);
}

/** مقایسه timing-safe برای توکن‌ها. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
