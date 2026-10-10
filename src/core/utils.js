'use strict';
/** توابع کمکی عمومی */
const crypto = require('crypto');
const { toEnDigits, toFaDigits } = require('./jalali');

class HttpError extends Error {
  constructor(status, message) {
    super(message || 'خطا');
    this.status = status;
  }
}

const httpError = (status, message) => new HttpError(status, message);

/** نرمال‌سازی متن فارسی (ی و ک عربی، فاصله‌ها) */
function normalizeFa(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200f|\u200e/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function str(v, max = 255) {
  return normalizeFa(v).slice(0, max);
}

function text(v, max = 10000) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().slice(0, max);
}

function int(v, def = 0) {
  const n = parseInt(toEnDigits(v).replace(/[,،\s]/g, ''), 10);
  return Number.isFinite(n) ? n : def;
}

function num(v, def = 0) {
  const n = parseFloat(toEnDigits(v).replace(/[,،\s]/g, ''));
  return Number.isFinite(n) ? n : def;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'on' || v === 'true' || v === 'yes';
}

/** نرمال‌سازی شماره موبایل به فرمت 09xxxxxxxxx */
function normalizeMobile(v) {
  let s = toEnDigits(v).replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
  else if (s.startsWith('9') && s.length === 10) s = '0' + s;
  return s;
}

function isMobile(v) {
  return /^09\d{9}$/.test(normalizeMobile(v));
}

/** تبدیل موبایل به فرمت E.164 مورد نیاز IPPanel */
function toE164(mobile) {
  const m = normalizeMobile(mobile);
  if (!/^09\d{9}$/.test(m)) return null;
  return '+98' + m.slice(1);
}

/** اعتبارسنجی کد ملی ایران */
function isNationalCode(v) {
  const code = toEnDigits(v).replace(/\D/g, '');
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const check = +code[9];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +code[i] * (10 - i);
  const r = sum % 11;
  return (r < 2 && check === r) || (r >= 2 && check === 11 - r);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += crypto.randomInt(0, 10);
  return s;
}

function randomAlnum(len = 10, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
  return s;
}

function randomPassword(len = 10) {
  return randomAlnum(len, 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** قالب‌بندی مبلغ با جداکننده هزارگان */
function formatNumber(n, fa = true) {
  const v = Math.round(Number(n) || 0);
  const s = v.toLocaleString('en-US');
  return fa ? toFaDigits(s).replace(/,/g, '٬') : s;
}

/** جایگزینی توکن‌های {name} در متن */
function fillTemplate(tpl, data) {
  return String(tpl || '').replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, k) => {
    const v = data[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** تولید فایل CSV با BOM برای نمایش صحیح فارسی در اکسل */
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map((h) => esc(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(typeof h.value === 'function' ? h.value(r) : r[h.key])).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

function sendCsv(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

/** خواندن ساده CSV */
function parseCsv(content) {
  const s = String(content).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

function safeJson(s, def = null) {
  if (s === null || s === undefined || s === '') return def;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return def; }
}

function isTime(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
}

function normTime(v) {
  const s = toEnDigits(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function timeToMinutes(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : 0;
}

function percent(a, b) {
  if (!b) return 0;
  return Math.round((Number(a) / Number(b)) * 100);
}

module.exports = {
  HttpError, httpError, normalizeFa, str, text, int, num, bool, normalizeMobile, isMobile, toE164,
  isNationalCode, isEmail, randomToken, randomCode, randomAlnum, randomPassword, sha256, safeEqual,
  formatNumber, fillTemplate, toCsv, sendCsv, parseCsv, pick, safeJson, isTime, normTime, timeToMinutes,
  percent, toEnDigits, toFaDigits,
};
