'use strict';
/**
 * لایه اتصال به پایگاه داده (Knex)
 * پشتیبانی از MySQL/MariaDB (پیشنهادی برای سی‌پنل) و SQLite
 * تمام کوئری‌ها به صورت Parameterized اجرا می‌شوند تا از SQL Injection جلوگیری شود.
 */
const path = require('path');
const knexLib = require('knex');
const { paths } = require('./config');

let instance = null;
let currentClient = null;

function sqliteDriver() {
  try {
    require.resolve('better-sqlite3');
    require('better-sqlite3');
    return 'better-sqlite3';
  } catch (e) {
    const { isAvailable } = require('./node-sqlite-client');
    return isAvailable() ? 'node-sqlite' : null;
  }
}

function buildKnexConfig(db) {
  if (!db) throw new Error('پیکربندی پایگاه داده یافت نشد');
  if (db.client === 'mysql' || db.client === 'mysql2') {
    return {
      client: 'mysql2',
      connection: {
        host: db.host || 'localhost',
        port: Number(db.port || 3306),
        user: db.user,
        password: db.password,
        database: db.database,
        charset: 'utf8mb4',
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: false,
        multipleStatements: false,
      },
      pool: { min: 0, max: 8, idleTimeoutMillis: 30000 },
      acquireConnectionTimeout: 15000,
    };
  }
  if (db.client === 'sqlite') {
    const filename = path.isAbsolute(db.filename || '')
      ? db.filename
      : path.join(paths.storage, db.filename || 'database.sqlite');
    const driver = sqliteDriver();
    if (!driver) throw new Error('هیچ درایور SQLite در دسترس نیست (Node.js 22.5+ یا better-sqlite3 لازم است)');
    if (driver === 'node-sqlite') {
      const { Client_NodeSQLite } = require('./node-sqlite-client');
      return {
        client: Client_NodeSQLite,
        connection: { filename },
        useNullAsDefault: true,
        pool: { min: 1, max: 1 },
      };
    }
    return {
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
        afterCreate: (conn, done) => {
          conn.pragma('foreign_keys = ON');
          conn.pragma('journal_mode = WAL');
          done();
        },
      },
    };
  }
  throw new Error('نوع پایگاه داده پشتیبانی نمی‌شود: ' + db.client);
}

function init(dbConfig) {
  if (instance) {
    instance.destroy().catch(() => {});
  }
  instance = knexLib(buildKnexConfig(dbConfig));
  currentClient = dbConfig.client === 'sqlite' ? 'sqlite' : 'mysql';
  return instance;
}

async function testConnection(dbConfig) {
  const k = knexLib(buildKnexConfig(dbConfig));
  try {
    await k.raw('select 1 as ok');
    if (dbConfig.client !== 'sqlite') {
      const [rows] = await k.raw('select version() as v');
      return { ok: true, version: rows && rows[0] && rows[0].v };
    }
    return { ok: true, version: 'SQLite' };
  } finally {
    await k.destroy().catch(() => {});
  }
}

function get() {
  if (!instance) throw new Error('پایگاه داده هنوز مقداردهی نشده است');
  return instance;
}

/**
 * Proxy برای دسترسی راحت: db('users').where(...) ، db.transaction(...) ، db.raw(...)
 */
const db = new Proxy(function () {}, {
  apply(_t, _this, args) {
    return get()(...args);
  },
  get(_t, prop) {
    if (prop === 'isReady') return () => !!instance;
    if (prop === 'client_type') return currentClient;
    const k = get();
    const v = k[prop];
    return typeof v === 'function' ? v.bind(k) : v;
  },
});

/** درج و بازگرداندن شناسه رکورد جدید (سازگار با MySQL و SQLite) */
async function insertId(table, data, trx) {
  const q = trx ? trx(table) : get()(table);
  const r = await q.insert(data);
  const first = Array.isArray(r) ? r[0] : r;
  return typeof first === 'object' && first !== null ? Number(first.id) : Number(first);
}

/** شمارش رکوردها */
async function count(qb) {
  const row = await qb.clone().clearSelect().clearOrder().count({ c: '*' }).first();
  return Number((row && row.c) || 0);
}

/** صفحه‌بندی */
async function paginate(qb, page = 1, perPage = 20) {
  page = Math.max(1, parseInt(page, 10) || 1);
  perPage = Math.min(200, Math.max(1, parseInt(perPage, 10) || 20));
  const total = await count(qb);
  const rows = await qb.clone().limit(perPage).offset((page - 1) * perPage);
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

function isMysql() {
  return currentClient === 'mysql';
}

/** عبارت SQL نام کامل (سازگار با MySQL و SQLite) */
function fullNameSql(alias = 'u') {
  return isMysql()
    ? `CONCAT(${alias}.first_name, ' ', ${alias}.last_name)`
    : `(${alias}.first_name || ' ' || ${alias}.last_name)`;
}

module.exports = { db, init, get, testConnection, insertId, count, paginate, isMysql, fullNameSql, sqliteDriver, buildKnexConfig };
