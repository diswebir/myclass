'use strict';
/**
 * ماژول پیش‌ثبت‌نام: صفحه عمومی معرفی دوره‌ها، فرم پیش‌ثبت‌نام، پیگیری و تبدیل به ثبت‌نام قطعی
 */
const { tableOptions } = require('../../core/migrator');
const { db } = require('../../core/db');
const { can } = require('../../core/auth');

module.exports = {
  key: 'preregistration',
  name: 'پیش‌ثبت‌نام آنلاین',
  description: 'صفحه عمومی دوره‌ها، فرم پیش‌ثبت‌نام با کد رهگیری، بررسی درخواست‌ها و تبدیل به ثبت‌نام قطعی',
  icon: 'clipboard-list',
  order: 30,
  requires: ['classes'],

  permissions: [
    { key: 'prereg.view', label: 'مشاهده پیش‌ثبت‌نام‌ها' },
    { key: 'prereg.manage', label: 'بررسی، تأیید و رد پیش‌ثبت‌نام‌ها' },
  ],

  menu: [
    { label: 'پیش‌ثبت‌نام‌ها', icon: 'clipboard-list', href: '/panel/preregistrations', perm: 'prereg.view', section: 'education', order: 40, badgeKey: 'pendingPrereg' },
  ],

  async menuBadges(req) {
    if (!can(req.user, 'prereg.view')) return {};
    return { pendingPrereg: Number((await db('preregistrations').where('status', 'pending').count({ c: '*' }).first()).c) };
  },

  settingsTabs: [{ key: 'prereg', label: 'پیش‌ثبت‌نام', icon: 'clipboard-list', order: 25 }],
  settings: [
    { tab: 'prereg', type: 'heading', label: 'عمومی' },
    { tab: 'prereg', key: 'prereg.enabled', label: 'فعال بودن فرم پیش‌ثبت‌نام', type: 'toggle', default: true, col: 6 },
    { tab: 'prereg', key: 'prereg.allow_general', label: 'امکان پیش‌ثبت‌نام بدون انتخاب کلاس (عمومی)', type: 'toggle', default: true, col: 6 },
    { tab: 'prereg', key: 'prereg.title', label: 'عنوان فرم', type: 'text', default: 'فرم پیش‌ثبت‌نام', col: 6 },
    { tab: 'prereg', key: 'prereg.show_price', label: 'نمایش شهریه در صفحه عمومی', type: 'toggle', default: true, col: 6 },
    { tab: 'prereg', key: 'prereg.intro', label: 'متن راهنمای بالای فرم', type: 'textarea', default: 'لطفاً اطلاعات خود را با دقت وارد کنید. پس از بررسی، کارشناسان ما با شما تماس خواهند گرفت.', rows: 2 },
    { tab: 'prereg', key: 'prereg.success_message', label: 'پیام پس از ثبت موفق', type: 'textarea', default: 'درخواست شما با موفقیت ثبت شد. کد رهگیری را برای پیگیری‌های بعدی نگه دارید.', rows: 2 },
    { tab: 'prereg', key: 'prereg.terms', label: 'قوانین و شرایط (در صورت پر بودن، تأیید آن الزامی است)', type: 'textarea', default: '', rows: 3 },
    { tab: 'prereg', type: 'heading', label: 'فیلدهای فرم' },
    { tab: 'prereg', key: 'prereg.require_national_code', label: 'کد ملی الزامی باشد', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.field_email', label: 'نمایش فیلد ایمیل', type: 'toggle', default: false, col: 4 },
    { tab: 'prereg', key: 'prereg.field_birth_date', label: 'نمایش تاریخ تولد', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.field_gender', label: 'نمایش جنسیت', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.field_education', label: 'نمایش تحصیلات / پایه', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.field_city', label: 'نمایش شهر', type: 'toggle', default: false, col: 4 },
    { tab: 'prereg', key: 'prereg.field_how_found', label: 'نحوه آشنایی با موسسه', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.field_payment', label: 'انتخاب روش پرداخت (نقدی/اقساطی)', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.how_found_options', label: 'گزینه‌های نحوه آشنایی', type: 'tags', default: ['اینستاگرام', 'معرفی دوستان', 'جستجوی اینترنتی', 'تبلیغات محیطی', 'سایر'], col: 12 },
    { tab: 'prereg', type: 'heading', label: 'امنیت و اطلاع‌رسانی' },
    { tab: 'prereg', key: 'prereg.captcha', label: 'کپچای ریاضی ضد ربات', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.notify_admin', label: 'پیامک به مدیران برای درخواست جدید', type: 'toggle', default: true, col: 4 },
    { tab: 'prereg', key: 'prereg.auto_create_account', label: 'ساخت خودکار حساب کاربری هنگام تأیید', type: 'toggle', default: true, col: 4 },
  ],

  smsEvents: [
    {
      key: 'prereg.submitted', label: 'دریافت پیش‌ثبت‌نام (به متقاضی)', group: 'پیش‌ثبت‌نام', recipient: 'متقاضی',
      tokens: ['name', 'first_name', 'class_title', 'tracking_code'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'code', value: '{tracking_code}' }],
    },
    {
      key: 'prereg.admin', label: 'پیش‌ثبت‌نام جدید (به مدیران)', group: 'پیش‌ثبت‌نام', recipient: 'مدیران',
      tokens: ['name', 'mobile', 'class_title', 'tracking_code'],
      defaultVars: [{ name: 'name', value: '{name}' }, { name: 'class', value: '{class_title}' }],
    },
    {
      key: 'prereg.approved', label: 'تأیید پیش‌ثبت‌نام', group: 'پیش‌ثبت‌نام', recipient: 'متقاضی',
      tokens: ['name', 'first_name', 'class_title', 'username', 'password', 'login_url'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }],
    },
    {
      key: 'prereg.rejected', label: 'رد پیش‌ثبت‌نام', group: 'پیش‌ثبت‌نام', recipient: 'متقاضی',
      tokens: ['name', 'first_name', 'class_title', 'reason'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }],
    },
  ],

  migrations: [
    {
      name: '0030_preregistrations',
      async up(knex) {
        await knex.schema.createTable('preregistrations', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('class_id').unsigned().nullable().references('id').inTable('classes').onDelete('SET NULL');
          t.string('first_name', 100).notNullable();
          t.string('last_name', 100).notNullable();
          t.string('mobile', 20).notNullable().index();
          t.string('national_code', 20).nullable();
          t.string('email', 191).nullable();
          t.date('birth_date').nullable();
          t.string('gender', 10).nullable();
          t.string('education', 100).nullable();
          t.string('city', 100).nullable();
          t.string('how_found', 100).nullable();
          t.string('payment_preference', 20).nullable();
          t.text('message').nullable();
          t.string('status', 20).notNullable().defaultTo('pending').index();
          t.string('tracking_code', 20).notNullable().unique();
          t.text('admin_note').nullable();
          t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
          t.integer('reviewed_by').unsigned().nullable();
          t.datetime('reviewed_at').nullable();
          t.string('ip', 45).nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
        });
      },
      async down(knex) {
        await knex.schema.dropTableIfExists('preregistrations');
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
