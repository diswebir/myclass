/**
 * درایور SQLite — بدون نیاز به کامپایل ماژول باینری
 * اولویت: node:sqlite (Node 22.5+) → node-sqlite3-wasm (هر نسخه Node)
 */
const fs = require('fs');
const path = require('path');

function openWasm(file) {
  const { Database } = require('node-sqlite3-wasm');
  return new Database(file);
}

function openNodeSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(file);
}

class SqliteDriver {
  constructor(file) {
    this.dialect = 'sqlite';
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.raw = openNodeSqlite(file);
      this.kind = 'node';
    } catch (e) {
      this.raw = openWasm(file);
      this.kind = 'wasm';
    }
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this._txDepth = 0;
  }

  async query(sql, params = []) {
    const stmt = this._prep(sql);
    const lower = sql.trim().toLowerCase();
    if (lower.startsWith('select') || lower.startsWith('pragma') || lower.startsWith('with')) {
      return this._all(stmt, params);
    }
    return this._run(stmt, params);
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0];
  }

  async exec(sql, params = []) {
    return this.query(sql, params);
  }

  async insert(table, data) {
    const keys = Object.keys(data);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const res = await this.query(sql, Object.values(data));
    return res.insertId;
  }

  async update(table, data, where, whereParams = []) {
    const keys = Object.keys(data);
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${where}`;
    const res = await this.query(sql, [...Object.values(data), ...whereParams]);
    return res.affectedRows;
  }

  async transaction(fn) {
    if (this._txDepth === 0) {
      this.raw.exec('BEGIN');
    } else {
      this.raw.exec(`SAVEPOINT sp_${this._txDepth}`);
    }
    this._txDepth++;
    try {
      const result = await fn(this);
      this._txDepth--;
      if (this._txDepth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE sp_${this._txDepth}`);
      return result;
    } catch (err) {
      this._txDepth--;
      try {
        if (this._txDepth === 0) this.raw.exec('ROLLBACK');
        else this.raw.exec(`ROLLBACK TO sp_${this._txDepth}`);
      } catch (_) {}
      throw err;
    }
  }

  async close() {
    try { this.raw.close(); } catch (_) {}
  }

  _prep(sql) { return sql; }

  _all(sql, params) {
    if (this.kind === 'node') {
      return this.raw.prepare(sql).all(...params).map((r) => ({ ...r }));
    }
    return this.raw.all(sql, params).map((r) => ({ ...r }));
  }

  _run(sql, params) {
    if (this.kind === 'node') {
      const info = this.raw.prepare(sql).run(...params);
      return { affectedRows: Number(info.changes), insertId: Number(info.lastInsertRowid) };
    }
    const info = this.raw.run(sql, params);
    return {
      affectedRows: Number(info.changes ?? 0),
      insertId: Number(info.lastInsertRowid ?? 0),
    };
  }
}

module.exports = SqliteDriver;
