'use strict';
/**
 * ذخیره‌ساز نشست (Session) در پایگاه داده
 * مناسب محیط چندپردازه‌ای Passenger در سی‌پنل؛ امکان خروج اجباری کاربر از همه دستگاه‌ها.
 */
const session = require('express-session');
const { db } = require('./db');

class KnexSessionStore extends session.Store {
  constructor() {
    super();
    this.lastPrune = 0;
  }

  async _prune() {
    if (Date.now() - this.lastPrune < 15 * 60 * 1000) return;
    this.lastPrune = Date.now();
    try { await db('sessions').where('expires', '<', Date.now()).del(); } catch (e) { /* ignore */ }
  }

  get(sid, cb) {
    (async () => {
      if (!db.isReady()) return null;
      const row = await db('sessions').where({ sid }).first();
      if (!row) return null;
      if (Number(row.expires) < Date.now()) {
        await db('sessions').where({ sid }).del();
        return null;
      }
      return JSON.parse(row.sess);
    })().then((s) => cb(null, s), (e) => cb(e));
  }

  set(sid, sess, cb) {
    (async () => {
      if (!db.isReady()) return;
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      const expires = Date.now() + maxAge;
      const data = { sess: JSON.stringify(sess), expires, user_id: sess.userId || null };
      const updated = await db('sessions').where({ sid }).update(data);
      if (!updated) {
        try {
          await db('sessions').insert(Object.assign({ sid }, data));
        } catch (e) {
          await db('sessions').where({ sid }).update(data);
        }
      }
      this._prune();
    })().then(() => cb && cb(null), (e) => cb && cb(e));
  }

  touch(sid, sess, cb) {
    (async () => {
      if (!db.isReady()) return;
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      await db('sessions').where({ sid }).update({ expires: Date.now() + maxAge });
    })().then(() => cb && cb(null), (e) => cb && cb(e));
  }

  destroy(sid, cb) {
    (async () => {
      if (!db.isReady()) return;
      await db('sessions').where({ sid }).del();
    })().then(() => cb && cb(null), (e) => cb && cb(e));
  }
}

/** پایان دادن به همه نشست‌های یک کاربر (به جز نشست جاری در صورت نیاز) */
async function destroyUserSessions(userId, exceptSid) {
  const q = db('sessions').where({ user_id: userId });
  if (exceptSid) q.whereNot({ sid: exceptSid });
  return q.del();
}

module.exports = { KnexSessionStore, destroyUserSessions };
