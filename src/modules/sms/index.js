'use strict';
/**
 * ماژول پیامک (IPPanel Edge)
 * - پترن اختصاصی برای هر رویداد
 * - نگاشت متغیرهای پترن به داده‌های سیستم
 * - ارسال گروهی، گزارش ارسال، نمایش اعتبار
 */
const { tableOptions } = require('../../core/migrator');
const events = require('../../core/events');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');

/** رویدادهای داخلی که باید به کلید پیامک دیگری هم نگاشت شوند */
const ALIASES = {
  'payment.submitted': [{ key: 'payment.submitted_admin', when: () => settings.get('finance.notify_admin_receipt', true) }],
  'prereg.submitted': [{ key: 'prereg.admin', when: () => settings.get('prereg.notify_admin', true) }],
};

module.exports = {
  key: 'sms',
  name: 'پنل پیامک (IPPanel)',
  description: 'ارسال پیامک خودکار و گروهی از طریق IPPanel با پترن‌های اختصاصی و متغیرهای قابل تنظیم برای هر رویداد',
  icon: 'message-square-text',
  order: 60,

  permissions: [
    { key: 'sms.view', label: 'مشاهده گزارش پیامک‌ها و اعتبار' },
    { key: 'sms.send', label: 'ارسال پیامک گروهی' },
    { key: 'sms.patterns', label: 'تنظیم پترن‌ها و متغیرها' },
  ],

  menu: [
    { label: 'پیامک', icon: 'message-square-text', href: '/panel/sms', perm: ['sms.view', 'sms.send', 'sms.patterns'], section: 'communication', order: 10, match: ['/panel/sms'] },
  ],

  settingsTabs: [{ key: 'sms', label: 'پنل پیامک', icon: 'message-square-text', order: 50 }],
  settings: [
    { tab: 'sms', type: 'heading', label: 'اتصال به IPPanel', help: 'کلید API را از پنل کاربری IPPanel بخش «توسعه‌دهندگان ← کلیدهای دسترسی» دریافت کنید. آدرس وب‌سرویس: https://edge.ippanel.com/v1' },
    { tab: 'sms', key: 'sms.enabled', label: 'فعال بودن ارسال پیامک', type: 'toggle', default: false, col: 6 },
    { tab: 'sms', key: 'sms.provider', label: 'سرویس‌دهنده', type: 'select', default: 'ippanel', options: { ippanel: 'IPPanel (Edge API)', log: 'حالت آزمایشی (بدون ارسال واقعی، فقط ثبت در گزارش)' }, col: 6 },
    { tab: 'sms', key: 'sms.ippanel_api_key', label: 'کلید API (یا توکن)', type: 'password', default: '', col: 6, ltr: true, help: 'برای تغییر ندادن، خالی بگذارید' },
    { tab: 'sms', key: 'sms.from_number', label: 'شماره فرستنده', type: 'text', default: '', col: 6, ltr: true, help: 'مثال: +983000505 یا 3000505' },
    { tab: 'sms', key: 'sms.ippanel_base_url', label: 'آدرس پایه API', type: 'url', default: 'https://edge.ippanel.com/v1', col: 12, ltr: true },
    { tab: 'sms', type: 'heading', label: 'گیرندگان و تنظیمات تکمیلی' },
    { tab: 'sms', key: 'sms.admin_mobiles', label: 'شماره موبایل مدیران (برای اعلان‌های مدیریتی)', type: 'tags', default: [], col: 6, ltr: true, help: 'با کاما جدا کنید' },
    { tab: 'sms', key: 'sms.test_mobile', label: 'شماره پیش‌فرض برای ارسال آزمایشی', type: 'text', default: '', col: 6, ltr: true },
    { tab: 'sms', key: 'sms.log_retention_days', label: 'مدت نگهداری گزارش پیامک‌ها (روز)', type: 'number', default: 365, min: 7, max: 3650, col: 6 },
    { tab: 'sms', key: 'sms.bulk_delay_ms', label: 'فاصله بین ارسال‌های گروهی پترن (میلی‌ثانیه)', type: 'number', default: 150, min: 0, max: 5000, col: 6 },
  ],

  migrations: [
    {
      name: '0060_sms',
      async up(knex) {
        await knex.schema.createTable('sms_patterns', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.string('event_key', 100).notNullable().unique();
          t.string('pattern_code', 100).nullable();
          t.boolean('is_active').notNullable().defaultTo(false);
          t.text('variables').nullable();
          t.string('note', 255).nullable();
          t.integer('updated_by').unsigned().nullable();
          t.datetime('updated_at');
        });
        await knex.schema.createTable('sms_logs', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('user_id').unsigned().nullable().index();
          t.string('mobile', 20).nullable().index();
          t.string('event_key', 100).nullable().index();
          t.string('type', 20).nullable();
          t.string('pattern_code', 100).nullable();
          t.text('message').nullable();
          t.text('params').nullable();
          t.string('status', 20).notNullable().index();
          t.string('provider_id', 100).nullable();
          t.text('error').nullable();
          t.integer('created_by').unsigned().nullable();
          t.datetime('created_at').index();
        });
      },
      async down(knex) {
        await knex.schema.dropTableIfExists('sms_logs');
        await knex.schema.dropTableIfExists('sms_patterns');
      },
    },
  ],

  tasks: [
    {
      key: 'cleanup', label: 'پاک‌سازی گزارش‌های قدیمی پیامک', everyMinutes: 24 * 60,
      async run() {
        const { db } = require('../../core/db');
        const days = Number(settings.get('sms.log_retention_days', 365));
        return { deleted: await db('sms_logs').where('created_at', '<', jalali.addDays(jalali.today(), -days)).del() };
      },
    },
  ],

  userTabs: [
    {
      key: 'sms', label: 'پیامک‌ها', icon: 'message-square', order: 60, perm: 'sms.view',
      async load(req, user) {
        const { db } = require('../../core/db');
        const path = require('path');
        const list = await db('sms_logs').where('user_id', user.id).orWhere('mobile', user.mobile || '-').orderBy('id', 'desc').limit(50);
        const labels = { 'bulk.pattern': 'ارسال گروهی (پترن)', 'bulk.text': 'ارسال گروهی (متنی)' };
        require('../../core/modules').allSmsEvents().forEach((e) => { labels[e.key] = e.label; });
        list.forEach((l) => { l.event_label = labels[l.event_key] || l.event_key; });
        return { view: path.join(__dirname, 'views', 'user-tab.ejs'), data: { list }, count: list.length };
      },
    },
  ],

  /** اتصال رویدادهای سیستم به ارسال پیامک */
  async init() {
    const svc = require('./service');
    const handled = new Set();
    const handler = (smsKey) => async (payload) => {
      if (!registry.isEnabled('sms')) return;
      const ctx = await svc.resolveContext(smsKey, payload);
      return svc.dispatch(smsKey, ctx);
    };
    for (const e of registry.allSmsEvents()) {
      if (handled.has(e.key)) continue;
      handled.add(e.key);
      events.on(e.key, handler(e.key));
    }
    for (const [src, targets] of Object.entries(ALIASES)) {
      for (const t of targets) {
        events.on(src, async (payload) => { if (t.when()) return handler(t.key)(payload); });
      }
    }
    try { await svc.ensurePatterns(); } catch (e) { /* جدول هنوز ساخته نشده */ }
  },

  routes(r) {
    require('./routes')(r);
  },
};
