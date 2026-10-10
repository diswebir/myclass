/**
 * سرویس تنظیمات — کش در حافظه با بارگذاری از پایگاه‌داده
 */
const db = require('./db');

let cache = null;
let loadedAt = 0;
const TTL_MS = 30_000;

async function all(force = false) {
  if (!force && cache && Date.now() - loadedAt < TTL_MS) return cache;
  const rows = await db.query('SELECT setting_key, setting_value FROM settings');
  cache = {};
  for (const r of rows) cache[r.setting_key] = r.setting_value ?? '';
  loadedAt = Date.now();
  return cache;
}

async function get(key, def = '') {
  const s = await all();
  return s[key] !== undefined && s[key] !== '' ? s[key] : def;
}

async function set(key, value, group = 'general') {
  const now = db.now();
  const row = await db.one('SELECT id FROM settings WHERE setting_key = ?', [key]);
  if (row) {
    await db.update('settings', { setting_value: String(value ?? ''), updated_at: now }, 'id = ?', [row.id]);
  } else {
    await db.insert('settings', {
      setting_key: key,
      setting_value: String(value ?? ''),
      setting_group: group,
      updated_at: now,
    });
  }
  cache = null;
}

async function setMany(obj, group = 'general') {
  for (const [k, v] of Object.entries(obj)) {
    await set(k, v, group);
  }
  cache = null;
}

async function getJson(key, def = {}) {
  const raw = await get(key, '');
  if (!raw) return def;
  try {
    return JSON.parse(raw);
  } catch {
    return def;
  }
}

async function setJson(key, value, group = 'general') {
  return set(key, JSON.stringify(value), group);
}

/** تمام تنظیمات به‌صورت شیء با مقدارهای پیش‌فرض */
async function getMany(keys) {
  const s = await all();
  const out = {};
  for (const k of keys) out[k] = s[k] !== undefined ? s[k] : '';
  return out;
}

module.exports = { all, get, set, setMany, getJson, setJson, getMany };
