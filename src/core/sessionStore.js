/**
 * استور جلسات (Session Store) روی پایگاه‌داده برنامه — سازگار با express-session
 */
const { Store } = require('express-session');
const db = require('./db');

class DbSessionStore extends Store {
  constructor(options = {}) {
    super(options);
    this.ttlMs = (options.ttlMinutes || 720) * 60000;
    this._ensured = false;
  }

  /** اطمینان از وجود جدول جلسات (حتی قبل از نصب) */
  async _ensure() {
    if (this._ensured) return;
    try {
      const schema = require('./db/schema');
      await db.exec(db.compileTable('sessions', schema.sessions, db.dialect));
      for (const idx of db.compileIndexes('sessions', schema.sessions, db.dialect)) {
        await db.exec(idx);
      }
      this._ensured = true;
    } catch (e) {
      // در صورت خطا، بعداً دوباره تلاش می‌شود
    }
  }

  get(sid, cb) {
    this._ensure()
      .then(() => db.one('SELECT data, expires_at FROM sessions WHERE sid = ?', [sid]))
      .then((row) => {
        if (!row) return cb(null, null);
        const exp = new Date(String(row.expires_at).replace(' ', 'T'));
        if (!isNaN(exp) && exp.getTime() < Date.now()) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        try {
          cb(null, JSON.parse(row.data));
        } catch {
          cb(null, null);
        }
      })
      .catch((e) => cb(null, null));
  }

  set(sid, session, cb) {
    const expires = new Date(Date.now() + (session.cookie && session.cookie.maxAge ? session.cookie.maxAge : this.ttlMs));
    const p = (n) => String(n).padStart(2, '0');
    const expStr = `${expires.getFullYear()}-${p(expires.getMonth() + 1)}-${p(expires.getDate())} ${p(expires.getHours())}:${p(expires.getMinutes())}:${p(expires.getSeconds())}`;
    this._ensure()
      .then(() => db.one('SELECT id FROM sessions WHERE sid = ?', [sid]))
      .then(async (row) => {
        const data = JSON.stringify(session);
        if (row) {
          await db.update('sessions', { data, expires_at: expStr }, 'id = ?', [row.id]);
        } else {
          await db.insert('sessions', { sid, data, expires_at: expStr });
        }
        cb(null);
      })
      .catch((e) => cb(e));
  }

  destroy(sid, cb) {
    db.exec('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }

  touch(sid, session, cb) {
    this.set(sid, session, cb || (() => {}));
  }

  clear(cb) {
    db.exec('DELETE FROM sessions')
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }

  length(cb) {
    db.one('SELECT COUNT(*) AS c FROM sessions')
      .then((r) => cb(null, Number(r.c)))
      .catch((e) => cb(e));
  }
}

module.exports = DbSessionStore;
