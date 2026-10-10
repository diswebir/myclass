/**
 * گزارش رویدادها (Audit Log) — ثبت اقدامات حساس
 */
const db = require('./db');

async function log(req, action, entityType = '', entityId = '', details = '') {
  try {
    await db.insert('audit_logs', {
      user_id: req.user ? req.user.id : null,
      action,
      entity_type: entityType,
      entity_id: entityId !== null && entityId !== undefined ? String(entityId) : '',
      details: typeof details === 'string' ? details : JSON.stringify(details),
      ip: (req.ip || '').replace('::ffff:', ''),
      user_agent: (req.get('user-agent') || '').slice(0, 255),
      created_at: db.now(),
    });
  } catch (e) {
    // خطا در ثبت لاگ نباید فرآیند اصلی را متوقف کند
  }
}

module.exports = { log };
