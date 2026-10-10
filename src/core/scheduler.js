'use strict';
/**
 * زمان‌بند وظایف (یادآوری اقساط، یادآوری جلسات، ...)
 * دو روش اجرا:
 *   ۱) داخلی: هر چند دقیقه در پردازه برنامه (در صورت فعال بودن)
 *   ۲) Cron Job سی‌پنل: فراخوانی آدرس /cron/{کلید} با wget یا curl (پیشنهادی؛ چون Passenger ممکن است پردازه بیکار را متوقف کند)
 * قفل‌گذاری در پایگاه داده از اجرای همزمان در چند پردازه جلوگیری می‌کند.
 */
const registry = require('./modules');
const settings = require('./settings');
const { db } = require('./db');
const jalali = require('./jalali');

let timer = null;
let running = false;

async function acquireLock(name, ttlSeconds) {
  const key = `lock.${name}`;
  const nowMs = Date.now();
  const row = await db('settings').where({ key }).first();
  if (row) {
    const until = Number(JSON.parse(row.value || '0'));
    if (until > nowMs) return false;
    const n = await db('settings').where({ key, value: row.value }).update({ value: JSON.stringify(nowMs + ttlSeconds * 1000) });
    return n > 0;
  }
  try {
    await db('settings').insert({ key, value: JSON.stringify(nowMs + ttlSeconds * 1000) });
    return true;
  } catch (e) {
    return false;
  }
}

async function releaseLock(name) {
  await db('settings').where({ key: `lock.${name}` }).update({ value: '0' });
}

/** اجرای همه وظایف ماژول‌های فعال */
async function runAll(trigger = 'internal') {
  if (running) return { skipped: true };
  running = true;
  const results = [];
  try {
    await settings.loadAll(true);
    if (!(await acquireLock('scheduler', 300))) return { skipped: true, reason: 'locked' };
    const state = settings.get('scheduler.state', {}) || {};
    for (const m of registry.enabled()) {
      for (const task of m.tasks) {
        const key = `${m.key}.${task.key}`;
        const last = state[key] ? Number(state[key].at) : 0;
        const every = (task.everyMinutes || 60) * 60 * 1000;
        if (Date.now() - last < every - 30000) continue;
        if (task.hourAfter !== undefined) {
          const h = Number(jalali.nowTime().slice(0, 2));
          const target = Number(settings.get(task.hourSetting, task.hourAfter));
          if (h < target) continue;
        }
        const t0 = Date.now();
        try {
          const out = await task.run();
          state[key] = { at: Date.now(), ok: true, result: out || null, ms: Date.now() - t0, trigger, ranAt: jalali.now() };
          results.push({ task: key, ok: true, result: out });
        } catch (e) {
          state[key] = { at: Date.now(), ok: false, error: e.message, trigger, ranAt: jalali.now() };
          results.push({ task: key, ok: false, error: e.message });
          console.error(`[scheduler] ${key} failed:`, e);
        }
      }
    }
    await settings.set({ 'scheduler.state': state, 'scheduler.last_run': { at: jalali.now(), trigger } });
    await releaseLock('scheduler');
    return { ok: true, results };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    if (settings.get('system.internal_scheduler', true) === false) return;
    runAll('internal').catch((e) => console.error('[scheduler]', e.message));
  }, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { start, runAll };
