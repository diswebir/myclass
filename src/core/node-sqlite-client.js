'use strict';
/**
 * درایور SQLite داخلی Node.js (node:sqlite) برای Knex
 * بدون نیاز به کامپایل ماژول بومی؛ مناسب هاست‌هایی که better-sqlite3 روی آن‌ها نصب نمی‌شود.
 * نیازمند Node.js نسخه 22.5 به بالا.
 */
const Client_BetterSQLite3 = require('knex/lib/dialects/better-sqlite3');

// جلوگیری از چاپ هشدار آزمایشی بودن SQLite
const origEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && msg.includes('SQLite is an experimental feature')) return;
  return origEmitWarning.call(process, warning, ...args);
};

function isAvailable() {
  try {
    require('node:sqlite');
    return true;
  } catch (e) {
    return false;
  }
}

class Client_NodeSQLite extends Client_BetterSQLite3 {
  _driver() {
    return require('node:sqlite');
  }

  async acquireRawConnection() {
    const { DatabaseSync } = this.driver;
    const db = new DatabaseSync(this.connectionSettings.filename);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    return db;
  }

  async destroyRawConnection(connection) {
    try { connection.close(); } catch (e) { /* ignore */ }
  }

  async _query(connection, obj) {
    if (!obj.sql) throw new Error('The query is empty');
    if (!connection) throw new Error('No connection provided');
    const statement = connection.prepare(obj.sql);
    const bindings = this._formatBindings(obj.bindings);
    let isReader = false;
    try {
      isReader = typeof statement.columns === 'function' ? statement.columns().length > 0 : /^\s*(select|pragma|with)/i.test(obj.sql);
    } catch (e) {
      isReader = /^\s*(select|pragma|with)/i.test(obj.sql);
    }
    if (isReader) {
      const rows = statement.all(...bindings);
      obj.response = rows.map((r) => Object.assign({}, r));
      return obj;
    }
    const response = statement.run(...bindings);
    obj.response = response;
    obj.context = {
      lastID: Number(response.lastInsertRowid),
      changes: Number(response.changes),
    };
    return obj;
  }

  _formatBindings(bindings) {
    if (!bindings) return [];
    return bindings.map((b) => {
      if (b instanceof Date) return b.valueOf();
      if (typeof b === 'boolean') return Number(b);
      if (b === undefined) return null;
      return b;
    });
  }
}

Object.assign(Client_NodeSQLite.prototype, { driverName: 'node-sqlite' });

module.exports = { Client_NodeSQLite, isAvailable };
