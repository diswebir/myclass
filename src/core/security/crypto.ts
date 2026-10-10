/**
 * رمزنگاری متقارن AES-256-GCM برای مقادیر حساس در DB (مثلاً API Key پیامک).
 * کلید از env (ENCRYPTION_KEY — ۳۲ بایت به‌صورت hex) می‌آید؛ هرگز در DB/لاگ ذخیره نمی‌شود.
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function keyFromHex(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY باید ۳۲ بایت (۶۴ کاراکتر hex) باشد.');
  }
  return key;
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('hex'), ct.toString('hex'), tag.toString('hex')].join(':');
}

export function decryptSecret(payload: string, keyHex: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('فرمت مقدار رمزنگاری‌شده نامعتبر است.');
  }
  const key = keyFromHex(keyHex);
  const [, ivHex, ctHex, tagHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

/** ماسک برای نمایش در UI (مثلاً کلید API): فقط ۴ کاراکتر آخر. */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}
