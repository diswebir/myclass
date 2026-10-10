/**
 * درایور MySQL / MariaDB — از طریق mysql2 (بدون ماژول باینری)
 * مناسب هاست‌های سی‌پنل
 */
class MysqlDriver {
  constructor(cfg) {
    this.dialect = 'mysql';
    this.pool = require('mysql2/promise').createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.name,
      charset: cfg.charset || 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
      supportBigNumbers: true,
      decimalNumbers: true,
    });
  }

  async query(sql, params = []) {
    const [rows, fields] = await this.pool.query(sql, params);
    if (Array.isArray(rows)) return rows;
    return {
      affectedRows: rows.affectedRows || 0,
      insertId: Number(rows.insertId || 0),
    };
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return Array.isArray(rows) ? rows[0] : undefined;
  }

  async exec(sql, params = []) {
    return this.query(sql, params);
  }

  async insert(table, data) {
    const keys = Object.keys(data);
    const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const res = await this.query(sql, Object.values(data));
    return res.insertId;
  }

  async update(table, data, where, whereParams = []) {
    const keys = Object.keys(data);
    const sql = `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE ${where}`;
    const res = await this.query(sql, [...Object.values(data), ...whereParams]);
    return res.affectedRows;
  }

  async transaction(fn) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx = {
        dialect: 'mysql',
        query: async (sql, params = []) => {
          const [rows] = await conn.query(sql, params);
          if (Array.isArray(rows)) return rows;
          return { affectedRows: rows.affectedRows || 0, insertId: Number(rows.insertId || 0) };
        },
        one: async (sql, params = []) => {
          const rows = await tx.query(sql, params);
          return Array.isArray(rows) ? rows[0] : undefined;
        },
        exec: async (sql, params = []) => tx.query(sql, params),
        insert: async (table, data) => {
          const keys = Object.keys(data);
          const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
          const res = await tx.query(sql, Object.values(data));
          return res.insertId;
        },
        update: async (table, data, where, whereParams = []) => {
          const keys = Object.keys(data);
          const sql = `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE ${where}`;
          const res = await tx.query(sql, [...Object.values(data), ...whereParams]);
          return res.affectedRows;
        },
        transaction: async (fn2) => fn2(tx),
      };
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = MysqlDriver;
