'use strict';
/**
 * سرویس تنظیمات سیستم (ذخیره در جدول settings به صورت key/value با مقدار JSON)
 * پیش‌فرض‌ها از تعاریف تنظیمات ماژول‌ها خوانده می‌شوند.
 */
const { db } = require('./db');

let cache = null;
let cacheAt = 0;
const TTL = 10000; // ۱۰ ثانیه (برای هماهنگی بین پردازه‌های Passenger)
const defaults = {};

function registerDefaults(obj) {
  Object.assign(defaults, obj);
}

async function loadAll(force = false) {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  const rows = await db('settings').select('key', 'value');
  const map = {};
  for (const r of rows) {
    try { map[r.key] = JSON.parse(r.value); } catch (e) { map[r.key] = r.value; }
  }
  cache = map;
  cacheAt = Date.now();
  return map;
}

/** دریافت همزمان (از کش) - باید پس از loadAll در هر درخواست استفاده شود */
function get(key, fallback) {
  if (cache && Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  if (Object.prototype.hasOwnProperty.call(defaults, key)) return defaults[key];
  return fallback;
}

async function getAsync(key, fallback) {
  await loadAll();
  return get(key, fallback);
}

async function set(values) {
  const entries = Object.entries(values);
  await db.transaction(async (trx) => {
    for (const [key, val] of entries) {
      const value = JSON.stringify(val === undefined ? null : val);
      const exists = await trx('settings').where({ key }).first();
      if (exists) await trx('settings').where({ key }).update({ value });
      else await trx('settings').insert({ key, value });
    }
  });
  await loadAll(true);
}

function invalidate() {
  cache = null;
}

function all() {
  return Object.assign({}, defaults, cache || {});
}

module.exports = { registerDefaults, loadAll, get, getAsync, set, invalidate, all, defaults };
