'use strict';
/**
 * ماژول صدور مدرک / گواهینامه با قالب قابل طراحی، شماره سریال و استعلام آنلاین با QR
 */
const path = require('path');
const { tableOptions } = require('../../core/migrator');
const { db } = require('../../core/db');

module.exports = {
  key: 'certificates',
  name: 'صدور مدرک و گواهینامه',
  description: 'طراحی قالب گواهینامه، بررسی شرایط (حضور، پرداخت، نمره)، صدور گروهی، چاپ و استعلام آنلاین با QR',
  icon: 'award',
  order: 50,
  requires: ['classes'],

  permissions: [
    { key: 'certificates.view', label: 'مشاهده مدارک' },
    { key: 'certificates.issue', label: 'صدور مدرک' },
    { key: 'certificates.revoke', label: 'ابطال مدرک' },
    { key: 'certificates.templates', label: 'طراحی قالب مدارک' },
  ],

  menu: [
    { label: 'مدارک و گواهینامه‌ها', icon: 'award', href: '/panel/certificates', perm: 'certificates.view', section: 'education', order: 50 },
    { label: 'قالب‌های مدرک', icon: 'layout-template', href: '/panel/certificate-templates', perm: 'certificates.templates', section: 'education', order: 55 },
  ],

  settingsTabs: [{ key: 'certificates', label: 'مدارک', icon: 'award', order: 40 }],
  settings: [
    { tab: 'certificates', type: 'heading', label: 'شماره‌گذاری و استعلام' },
    { tab: 'certificates', key: 'certificates.serial_prefix', label: 'پیشوند شماره سریال', type: 'text', default: 'CRT-', ltr: true, col: 6 },
    { tab: 'certificates', key: 'certificates.verify_enabled', label: 'فعال بودن صفحه استعلام عمومی مدرک', type: 'toggle', default: true, col: 6 },
    { tab: 'certificates', type: 'heading', label: 'شرایط صدور', help: 'در صورت عدم احراز شرایط، کاربر دارای مجوز صدور می‌تواند با «نادیده گرفتن شرایط» مدرک صادر کند.' },
    { tab: 'certificates', key: 'certificates.check_attendance', label: 'بررسی حداقل درصد حضور', type: 'toggle', default: true, col: 4 },
    { tab: 'certificates', key: 'certificates.require_payment', label: 'الزام تسویه کامل شهریه', type: 'toggle', default: true, col: 4 },
    { tab: 'certificates', key: 'certificates.min_grade', label: 'حداقل نمره قبولی (۰ = بدون شرط)', type: 'number', default: 0, min: 0, max: 100, col: 4 },
    { tab: 'certificates', type: 'heading', label: 'پنل دانشجو' },
    { tab: 'certificates', key: 'certificates.student_download', label: 'امکان مشاهده و چاپ مدرک توسط دانشجو', type: 'toggle', default: true, col: 6 },
    { tab: 'certificates', key: 'certificates.complete_enrollment', label: 'تغییر وضعیت ثبت‌نام به «فارغ‌التحصیل» پس از صدور', type: 'toggle', default: true, col: 6 },
  ],

  smsEvents: [
    {
      key: 'certificate.issued', label: 'صدور مدرک', group: 'مدارک', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'serial', 'verify_code', 'verify_url'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'code', value: '{verify_code}' }],
    },
  ],

  migrations: [
    {
      name: '0050_certificates',
      async up(knex) {
        await knex.schema.createTable('certificate_templates', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.string('name', 100).notNullable();
          t.text('design', 'mediumtext').nullable();
          t.boolean('is_default').notNullable().defaultTo(false);
          t.datetime('created_at');
          t.datetime('updated_at');
        });
        await knex.schema.createTable('certificates', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('enrollment_id').unsigned().nullable().references('id').inTable('enrollments').onDelete('SET NULL');
          t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
          t.integer('class_id').unsigned().nullable().references('id').inTable('classes').onDelete('SET NULL');
          t.integer('template_id').unsigned().nullable().references('id').inTable('certificate_templates').onDelete('SET NULL');
          t.string('serial', 50).notNullable().unique();
          t.string('verify_code', 40).notNullable().unique();
          t.string('grade', 20).nullable();
          t.date('issued_date').notNullable();
          t.string('status', 20).notNullable().defaultTo('valid');
          t.string('revoked_reason', 255).nullable();
          t.text('snapshot', 'mediumtext').nullable();
          t.integer('issued_by').unsigned().nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
          t.index(['user_id']);
          t.index(['class_id']);
        });
      },
      async down(knex) {
        await knex.schema.dropTableIfExists('certificates');
        await knex.schema.dropTableIfExists('certificate_templates');
      },
    },
  ],

  classTabs: [
    {
      key: 'certificates', label: 'مدارک', icon: 'award', order: 50, perm: 'certificates.view',
      async load(req, cls) {
        const list = await db('certificates as c').join('users as u', 'u.id', 'c.user_id').where('c.class_id', cls.id)
          .select('c.*', 'u.first_name', 'u.last_name').orderBy('c.id', 'desc');
        return { view: path.join(__dirname, 'views', 'class-tab.ejs'), data: { list } };
      },
    },
  ],

  userTabs: [
    {
      key: 'certificates', label: 'مدارک', icon: 'award', order: 40, perm: 'certificates.view', kinds: ['student'],
      async load(req, user) {
        const list = await db('certificates as c').leftJoin('classes as cl', 'cl.id', 'c.class_id').where('c.user_id', user.id)
          .select('c.*', 'cl.title as class_title').orderBy('c.id', 'desc');
        return { view: path.join(__dirname, 'views', 'user-tab.ejs'), data: { list }, count: list.length };
      },
    },
  ],

  routes(r) {
    require('./routes').panel(r);
  },
  publicRoutes(r) {
    require('./routes').public(r);
  },
};
