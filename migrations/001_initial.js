/**
 * مهاجرت اولیه — ساخت تمام جدول‌های سیستم
 */
const schema = require('../src/core/db/schema');

const ORDER = [
  'sessions',
  'settings',
  'system_modules',
  'permissions',
  'roles',
  'role_permissions',
  'users',
  'login_attempts',
  'teacher_profiles',
  'student_profiles',
  'classes',
  'class_students',
  'class_sessions',
  'attendance',
  'enrollments',
  'installment_plans',
  'installments',
  'payments',
  'certificates',
  'sms_patterns',
  'sms_logs',
  'audit_logs',
];

module.exports = {
  async up(db) {
    for (const table of ORDER) {
      await db.exec(db.compileTable(table, schema[table], db.dialect));
      for (const idxSql of db.compileIndexes(table, schema[table], db.dialect)) {
        await db.exec(idxSql);
      }
    }
  },
};
