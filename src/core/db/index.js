/**
 * لایه پایگاه‌داده — Facade با پشتیبانی از SQLite و MySQL
 * نگاشت نوع‌های قابل حمل، تراکنش‌ها و کوئری‌های پارامتری
 */
const config = require('../config');

let driver = null;

function getDriver() {
  if (!driver) {
    if (config.db.client === 'mysql') {
      const MysqlDriver = require('./dialects/mysql');
      driver = new MysqlDriver(config.db);
    } else {
      const SqliteDriver = require('./dialects/sqlite');
      driver = new SqliteDriver(config.db.file);
    }
  }
  return driver;
}

/** زمان جاری به قالب MySQL/SQLite: YYYY-MM-DD HH:mm:ss */
function nowStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function dateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const db = {
  get dialect() {
    return getDriver().dialect;
  },
  get raw() {
    return getDriver();
  },

  async query(sql, params = []) {
    return getDriver().query(sql, params);
  },
  async one(sql, params = []) {
    return getDriver().one(sql, params);
  },
  async exec(sql, params = []) {
    return getDriver().exec(sql, params);
  },
  async insert(table, data) {
    return getDriver().insert(table, data);
  },
  async update(table, data, where, whereParams = []) {
    return getDriver().update(table, data, where, whereParams);
  },
  async transaction(fn) {
    return getDriver().transaction(fn);
  },
  async close() {
    if (driver) await driver.close();
    driver = null;
  },

  /** صفحه‌بندی: بازگشت { rows, total, page, pages, perPage } */
  async paginate(sql, params, page = 1, perPage = 20, countSql = null) {
    page = Math.max(1, parseInt(page, 10) || 1);
    perPage = Math.min(200, Math.max(5, parseInt(perPage, 10) || 20));
    const offset = (page - 1) * perPage;
    let total = 0;
    const cSql = countSql || `SELECT COUNT(*) AS c FROM (${sql}) AS _cnt`;
    const cRow = await this.one(cSql, params);
    total = Number((cRow && (cRow.c ?? cRow.C)) || 0);
    const rows = await this.query(`${sql} LIMIT ${perPage} OFFSET ${offset}`, params);
    return {
      rows,
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
    };
  },

  now: nowStr,
  today: dateStr,
};

/**
 * کامپایلر طرح‌واره قابل حمل (SQLite / MySQL)
 * نمونه:
 *  compileTable('users', def, 'sqlite')
 */
function compileColumn(name, c, dialect) {
  let type;
  switch (c.type) {
    case 'pk':
      return dialect === 'sqlite'
        ? `${name} INTEGER PRIMARY KEY AUTOINCREMENT`
        : `${name} INT UNSIGNED AUTO_INCREMENT PRIMARY KEY`;
    case 'id':
      type = dialect === 'sqlite' ? 'INTEGER' : 'INT UNSIGNED';
      break;
    case 'bigint':
      type = dialect === 'sqlite' ? 'INTEGER' : 'BIGINT UNSIGNED';
      break;
    case 'int':
      type = dialect === 'sqlite' ? 'INTEGER' : 'INT';
      break;
    case 'bool':
      type = dialect === 'sqlite' ? 'INTEGER' : 'TINYINT(1)';
      break;
    case 'string':
      type = dialect === 'sqlite' ? 'TEXT' : `VARCHAR(${c.size || 191})`;
      break;
    case 'text':
      type = 'TEXT';
      break;
    case 'longtext':
      type = dialect === 'sqlite' ? 'TEXT' : 'LONGTEXT';
      break;
    case 'json':
      type = dialect === 'sqlite' ? 'TEXT' : 'LONGTEXT';
      break;
    case 'date':
      type = dialect === 'sqlite' ? 'TEXT' : 'DATE';
      break;
    case 'datetime':
      type = dialect === 'sqlite' ? 'TEXT' : 'DATETIME';
      break;
    case 'time':
      type = dialect === 'sqlite' ? 'TEXT' : 'TIME';
      break;
    case 'decimal':
      type = dialect === 'sqlite' ? 'NUMERIC' : `DECIMAL(${c.precision || 14},${c.scale || 2})`;
      break;
    default:
      type = 'TEXT';
  }
  let out = `${name} ${type}`;
  if (c.null === false) out += ' NOT NULL';
  if (c.default !== undefined) {
    if (c.default === null) out += ' DEFAULT NULL';
    else if (typeof c.default === 'boolean') out += ` DEFAULT ${c.default ? 1 : 0}`;
    else if (typeof c.default === 'number') out += ` DEFAULT ${c.default}`;
    else if (c.default === 'now') {
      out += dialect === 'sqlite' ? ` DEFAULT CURRENT_TIMESTAMP` : ` DEFAULT CURRENT_TIMESTAMP`;
    } else out += ` DEFAULT '${String(c.default).replace(/'/g, "''")}'`;
  }
  return out;
}

function compileTable(name, def, dialect) {
  const cols = Object.entries(def.columns).map(([colName, colDef]) =>
    compileColumn(colName, colDef, dialect)
  );
  if (def.foreignKeys) {
    def.foreignKeys.forEach((fk, i) => {
      const onDel = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
      const onUpd = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
      cols.push(
        `CONSTRAINT fk_${name}_${i} FOREIGN KEY (${fk.column}) REFERENCES ${fk.ref}${onDel}${onUpd}`
      );
    });
  }
  const suffix =
    dialect === 'mysql'
      ? ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      : '';
  return `CREATE TABLE IF NOT EXISTS ${name} (\n  ${cols.join(',\n  ')}\n)${suffix}`;
}

/** ایندکس‌ها به‌صورت جداگانه (سازگار با SQLite و MySQL) */
function compileIndexes(name, def, dialect) {
  const out = [];
  if (!def.indexes) return out;
  def.indexes.forEach((idx, i) => {
    const uniq = idx.unique ? 'UNIQUE ' : '';
    const colsSql = idx.columns.join(', ');
    out.push(`CREATE ${uniq}INDEX IF NOT EXISTS idx_${name}_${i} ON ${name} (${colsSql})`);
  });
  return out;
}

db.compileTable = compileTable;
db.compileIndexes = compileIndexes;

module.exports = db;
