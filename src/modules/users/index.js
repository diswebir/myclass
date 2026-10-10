'use strict';
/**
 * ماژول کاربران، نقش‌ها و احراز هویت
 */
const { tableOptions } = require('../../core/migrator');

const DEFAULT_ROLES = [
  {
    slug: 'super_admin', name: 'مدیر کل', kind: 'admin', data_scope: 'all', is_super: true, is_system: true, color: '#dc2626',
    description: 'دسترسی کامل و نامحدود به تمام بخش‌های سامانه', perms: [],
  },
  {
    slug: 'manager', name: 'مدیر آموزش', kind: 'staff', data_scope: 'all', color: '#7c3aed',
    description: 'مدیریت کامل آموزش، کلاس‌ها، کاربران و امور مالی (بدون تنظیمات سیستم)',
    perms: '*', except: ['settings.manage', 'system.manage', 'roles.manage', 'portal.access'],
  },
  {
    slug: 'accountant', name: 'حسابدار', kind: 'staff', data_scope: 'all', color: '#059669',
    description: 'مدیریت فاکتورها، اقساط، پرداخت‌ها و بررسی رسیدهای کارت به کارت',
    perms: ['dashboard.stats', 'finance.view', 'finance.invoices', 'finance.payments', 'finance.review', 'finance.reports', 'users.view', 'classes.view', 'sms.send', 'sms.view'],
  },
  {
    slug: 'teacher', name: 'استاد', kind: 'teacher', data_scope: 'assigned', is_system: true, color: '#2563eb',
    description: 'دسترسی فقط به کلاس‌های تخصیص‌یافته و دانشجویان همان کلاس‌ها',
    perms: ['classes.view', 'classes.sessions', 'attendance.view', 'attendance.manage', 'users.view', 'certificates.view'],
  },
  {
    slug: 'student', name: 'دانشجو / دانش‌آموز', kind: 'student', data_scope: 'own', is_system: true, color: '#0891b2',
    description: 'دسترسی به پنل کاربری شخصی: کلاس‌ها، حضور و غیاب، پرداخت‌ها و مدارک',
    perms: ['portal.access'],
  },
];

module.exports = {
  key: 'users',
  name: 'کاربران و سطوح دسترسی',
  description: 'مدیریت کاربران (مدیران، اساتید، دانشجویان)، نقش‌ها و مجوزها، ورود و بازیابی رمز',
  icon: 'users',
  core: true,
  order: 2,
  DEFAULT_ROLES,

  permissions: [
    { key: 'users.view', label: 'مشاهده کاربران' },
    { key: 'users.create', label: 'افزودن کاربر' },
    { key: 'users.edit', label: 'ویرایش کاربر' },
    { key: 'users.delete', label: 'حذف کاربر' },
    { key: 'users.import', label: 'ورود گروهی کاربران (CSV)' },
    { key: 'users.export', label: 'خروجی اکسل کاربران' },
    { key: 'roles.manage', label: 'مدیریت نقش‌ها و سطوح دسترسی' },
  ],

  menu: [
    { label: 'دانشجویان', icon: 'graduation-cap', href: '/panel/students', perm: 'users.view', section: 'education', order: 30 },
    { label: 'اساتید', icon: 'presentation', href: '/panel/teachers', perm: 'users.view', section: 'education', order: 35, hideForKinds: ['teacher'] },
    { label: 'همه کاربران', icon: 'users', href: '/panel/users', perm: 'users.view', section: 'system', order: 1, hideForKinds: ['teacher'] },
    { label: 'نقش‌ها و دسترسی‌ها', icon: 'shield-check', href: '/panel/roles', perm: 'roles.manage', section: 'system', order: 2 },
  ],

  migrations: [
    {
      name: '0002_users_roles',
      async up(knex) {
        await knex.schema.createTable('roles', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.string('name', 100).notNullable();
          t.string('slug', 100).notNullable().unique();
          t.string('description', 255).nullable();
          t.string('kind', 20).notNullable().defaultTo('staff');
          t.string('data_scope', 20).notNullable().defaultTo('assigned');
          t.boolean('is_system').notNullable().defaultTo(false);
          t.boolean('is_super').notNullable().defaultTo(false);
          t.string('color', 20).nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
        });
        await knex.schema.createTable('role_permissions', (t) => {
          tableOptions(knex, t);
          t.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
          t.string('permission', 100).notNullable();
          t.primary(['role_id', 'permission']);
        });
        await knex.schema.createTable('users', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('RESTRICT');
          t.string('first_name', 100).notNullable();
          t.string('last_name', 100).notNullable();
          t.string('username', 100).notNullable().unique();
          t.string('mobile', 20).nullable().unique();
          t.string('national_code', 20).nullable().unique();
          t.string('email', 191).nullable();
          t.string('password_hash', 255).notNullable();
          t.string('gender', 10).nullable();
          t.string('father_name', 100).nullable();
          t.date('birth_date').nullable();
          t.string('education', 100).nullable();
          t.string('job', 100).nullable();
          t.string('phone', 20).nullable();
          t.string('postal_code', 20).nullable();
          t.text('address').nullable();
          t.string('avatar', 255).nullable();
          t.text('notes').nullable();
          t.boolean('is_active').notNullable().defaultTo(true);
          t.boolean('must_change_password').notNullable().defaultTo(false);
          t.integer('failed_logins').notNullable().defaultTo(0);
          t.datetime('locked_until').nullable();
          t.datetime('last_login_at').nullable();
          t.string('last_login_ip', 45).nullable();
          t.datetime('password_changed_at').nullable();
          t.integer('created_by').unsigned().nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
          t.index(['last_name']);
        });
        await knex.schema.createTable('otp_codes', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
          t.string('purpose', 30).notNullable();
          t.string('code_hash', 64).notNullable();
          t.datetime('expires_at').notNullable();
          t.integer('attempts').notNullable().defaultTo(0);
          t.boolean('used').notNullable().defaultTo(false);
          t.datetime('created_at');
          t.index(['user_id', 'purpose']);
        });
      },
      async down(knex) {
        await knex.schema.dropTableIfExists('otp_codes');
        await knex.schema.dropTableIfExists('users');
        await knex.schema.dropTableIfExists('role_permissions');
        await knex.schema.dropTableIfExists('roles');
      },
    },
  ],

  smsEvents: [
    {
      key: 'auth.otp', label: 'کد بازیابی رمز عبور', group: 'حساب کاربری', recipient: 'کاربر',
      tokens: ['code', 'name'], defaultVars: [{ name: 'code', value: '{code}' }],
    },
    {
      key: 'user.welcome', label: 'ارسال اطلاعات ورود به کاربر جدید', group: 'حساب کاربری', recipient: 'کاربر',
      tokens: ['name', 'first_name', 'username', 'password', 'login_url'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'username', value: '{username}' }, { name: 'password', value: '{password}' }],
    },
    {
      key: 'user.password_reset', label: 'رمز جدید (بازنشانی توسط مدیر)', group: 'حساب کاربری', recipient: 'کاربر',
      tokens: ['name', 'first_name', 'username', 'password', 'login_url'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'password', value: '{password}' }],
    },
  ],

  userTabs: [],

  routes(r) {
    require('./routes/profile')(r);
    require('./routes/users')(r);
    require('./routes/roles')(r);
  },
  publicRoutes(r) {
    require('./routes/auth')(r);
  },
};
