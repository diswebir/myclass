'use strict';
/**
 * گذرگاه رویداد (Event Bus) - ارتباط سست بین ماژول‌ها
 * مثال: ماژول کلاس‌ها رویداد enrollment.created را منتشر می‌کند و ماژول پیامک به آن گوش می‌دهد.
 */
const listeners = new Map();

function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(handler);
}

/** انتشار رویداد بدون مسدود کردن پاسخ کاربر */
function emit(event, payload = {}) {
  const hs = [...(listeners.get(event) || []), ...(listeners.get('*') || [])];
  for (const h of hs) {
    Promise.resolve()
      .then(() => h(payload, event))
      .catch((e) => console.error(`[events] ${event} handler failed:`, e.message));
  }
}

/** انتشار رویداد و انتظار برای اتمام شنونده‌ها */
async function emitAsync(event, payload = {}) {
  const hs = [...(listeners.get(event) || []), ...(listeners.get('*') || [])];
  const results = [];
  for (const h of hs) {
    try { results.push(await h(payload, event)); } catch (e) {
      console.error(`[events] ${event} handler failed:`, e.message);
      results.push({ error: e.message });
    }
  }
  return results;
}

module.exports = { on, emit, emitAsync };
