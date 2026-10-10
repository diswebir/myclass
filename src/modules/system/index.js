'use strict';
/**
 * ماژول هسته سیستم: تنظیمات جامع، ابزارهای سیستمی، گزارش فعالیت‌ها و Cron
 */
const { tableOptions } = require('../../core/migrator');
const routes = require('./routes');

module.exports = {
  key: 'system',
  name: 'هسته سیستم و تنظیمات',
  description: 'تنظیمات جامع، مدیریت ماژول‌ها، پشتیبان‌گیری، به‌روزرسانی پایگاه داده و گزارش فعالیت‌ها',
  icon: 'settings',
  core: true,
  order: 1,

  permissions: [
    { key: 'settings.manage', label: 'مدیریت تنظیمات سیستم' },
    { key: 'system.manage', label: 'ابزارهای سیستم (پشتیبان‌گیری، به‌روزرسانی، ماژول‌ها)' },
    { key: 'audit.view', label: 'مشاهده گزارش فعالیت‌ها' },
  ],

  menu: [
    { label: 'تنظیمات', icon: 'settings', href: '/panel/settings', perm: 'settings.manage', section: 'system', order: 10 },
    { label: 'ابزارهای سیستم', icon: 'server', href: '/panel/system', perm: 'system.manage', section: 'system', order: 20 },
    { label: 'گزارش فعالیت‌ها', icon: 'history', href: '/panel/audit', perm: 'audit.view', section: 'system', order: 30 },
  ],

  settingsTabs: [
    { key: 'general', label: 'اطلاعات موسسه', icon: 'building-2', order: 1 },
    { key: 'appearance', label: 'ظاهر و قالب', icon: 'palette', order: 2 },
    { key: 'security', label: 'امنیت و ورود', icon: 'shield', order: 80 },
    { key: 'system', label: 'سیستم و زمان‌بندی', icon: 'cpu', order: 90 },
    { key: 'modules', label: 'ماژول‌ها', icon: 'puzzle', order: 95, custom: true },
  ],

  settings: [
    { tab: 'general', type: 'heading', label: 'مشخصات موسسه', help: 'این اطلاعات در سربرگ‌ها، مدارک، فاکتورها و پیامک‌ها استفاده می‌شود.' },
    { tab: 'general', key: 'general.institute_name', label: 'نام موسسه', type: 'text', default: 'آموزشگاه من', required: true, col: 6 },
    { tab: 'general', key: 'general.institute_short_name', label: 'نام کوتاه', type: 'text', default: '', col: 6 },
    { tab: 'general', key: 'general.slogan', label: 'شعار / زیرعنوان', type: 'text', default: 'سامانه مدیریت آموزش', col: 6 },
    { tab: 'general', key: 'general.manager_name', label: 'نام مدیر موسسه', type: 'text', default: '', col: 6 },
    { tab: 'general', key: 'general.license_no', label: 'شماره مجوز / ثبت', type: 'text', default: '', col: 4 },
    { tab: 'general', key: 'general.phone', label: 'تلفن ثابت', type: 'text', default: '', col: 4, ltr: true },
    { tab: 'general', key: 'general.mobile', label: 'تلفن همراه', type: 'text', default: '', col: 4, ltr: true },
    { tab: 'general', key: 'general.email', label: 'ایمیل', type: 'email', default: '', col: 4, ltr: true },
    { tab: 'general', key: 'general.website', label: 'وب‌سایت', type: 'url', default: '', col: 4, ltr: true },
    { tab: 'general', key: 'general.postal_code', label: 'کد پستی', type: 'text', default: '', col: 4, ltr: true },
    { tab: 'general', key: 'general.address', label: 'نشانی', type: 'textarea', default: '', rows: 2 },
    { tab: 'general', key: 'general.about', label: 'درباره موسسه', type: 'textarea', default: '', rows: 3 },
    { tab: 'general', type: 'heading', label: 'لوگو و نشان' },
    { tab: 'general', key: 'general.logo', label: 'لوگوی موسسه', type: 'image', default: '', col: 6, help: 'PNG یا JPG، ترجیحاً مربعی و با پس‌زمینه شفاف' },
    { tab: 'general', key: 'general.favicon', label: 'آیکون مرورگر (Favicon)', type: 'image', default: '', col: 6 },
    { tab: 'general', type: 'heading', label: 'منطقه زمانی و نمایش' },
    {
      tab: 'general', key: 'general.timezone', label: 'منطقه زمانی', type: 'select', default: 'Asia/Tehran', col: 4,
      options: { 'Asia/Tehran': 'تهران (ایران)', 'Asia/Kabul': 'کابل', 'Asia/Dubai': 'دبی', 'Europe/Istanbul': 'استانبول', UTC: 'UTC' },
    },
    { tab: 'general', key: 'general.persian_digits', label: 'نمایش اعداد به صورت فارسی', type: 'toggle', default: true, col: 4 },
    { tab: 'general', key: 'general.items_per_page', label: 'تعداد ردیف در هر صفحه', type: 'number', default: 20, min: 5, max: 200, col: 4 },

    { tab: 'appearance', type: 'heading', label: 'رنگ‌بندی و قالب پنل' },
    { tab: 'appearance', key: 'appearance.primary_color', label: 'رنگ اصلی', type: 'color', default: '#4f46e5', col: 4 },
    { tab: 'appearance', key: 'appearance.sidebar_style', label: 'سبک منوی کناری', type: 'select', default: 'dark', options: { dark: 'تیره', light: 'روشن', primary: 'رنگ اصلی' }, col: 4 },
    { tab: 'appearance', key: 'appearance.default_theme', label: 'حالت پیش‌فرض', type: 'select', default: 'light', options: { light: 'روشن', dark: 'تیره', auto: 'مطابق سیستم کاربر' }, col: 4 },
    { tab: 'appearance', key: 'appearance.radius', label: 'گردی گوشه‌ها', type: 'select', default: 'md', options: { sm: 'کم', md: 'متوسط', lg: 'زیاد' }, col: 4 },
    { tab: 'appearance', key: 'appearance.density', label: 'تراکم نمایش', type: 'select', default: 'comfortable', options: { comfortable: 'راحت', compact: 'فشرده' }, col: 4 },
    { tab: 'appearance', type: 'heading', label: 'صفحه ورود و صفحه اصلی عمومی' },
    { tab: 'appearance', key: 'appearance.login_title', label: 'عنوان صفحه ورود', type: 'text', default: 'به پنل خوش آمدید', col: 6 },
    { tab: 'appearance', key: 'appearance.login_subtitle', label: 'متن زیر عنوان ورود', type: 'text', default: 'برای ادامه وارد حساب کاربری خود شوید', col: 6 },
    { tab: 'appearance', key: 'appearance.home_enabled', label: 'نمایش صفحه اصلی عمومی (لیست دوره‌ها)', type: 'toggle', default: true, col: 12 },
    { tab: 'appearance', key: 'appearance.home_title', label: 'عنوان بخش معرفی صفحه اصلی', type: 'text', default: 'یادگیری را از همین امروز شروع کنید', col: 6 },
    { tab: 'appearance', key: 'appearance.home_text', label: 'متن معرفی صفحه اصلی', type: 'textarea', default: 'دوره‌های آموزشی ما با بهترین اساتید و به‌روزترین سرفصل‌ها برگزار می‌شود. همین حالا پیش‌ثبت‌نام کنید.', rows: 2, col: 6 },
    { tab: 'appearance', key: 'appearance.footer_text', label: 'متن پاورقی', type: 'text', default: '', col: 12 },
    { tab: 'appearance', key: 'appearance.custom_css', label: 'CSS سفارشی', type: 'textarea', default: '', rows: 4, ltr: true, help: 'برای شخصی‌سازی پیشرفته ظاهر (اختیاری)' },

    { tab: 'security', type: 'heading', label: 'ورود و نشست' },
    { tab: 'security', key: 'security.login_with', label: 'ورود با', type: 'select', default: 'any', options: { any: 'نام کاربری، موبایل یا کد ملی', username: 'فقط نام کاربری', mobile: 'فقط موبایل', national_code: 'فقط کد ملی' }, col: 6 },
    { tab: 'security', key: 'security.session_minutes', label: 'مدت اعتبار نشست (دقیقه)', type: 'number', default: 240, min: 10, max: 43200, col: 6, help: 'تغییر پس از راه‌اندازی مجدد برنامه اعمال می‌شود' },
    { tab: 'security', key: 'security.max_login_attempts', label: 'حداکثر تلاش ناموفق ورود', type: 'number', default: 5, min: 2, max: 50, col: 6 },
    { tab: 'security', key: 'security.lockout_minutes', label: 'مدت قفل حساب (دقیقه)', type: 'number', default: 15, min: 1, max: 1440, col: 6 },
    { tab: 'security', type: 'heading', label: 'رمز عبور' },
    { tab: 'security', key: 'security.password_min', label: 'حداقل طول رمز عبور', type: 'number', default: 8, min: 6, max: 64, col: 4 },
    { tab: 'security', key: 'security.password_strong', label: 'الزام رمز قوی (حرف و عدد)', type: 'toggle', default: true, col: 4 },
    { tab: 'security', key: 'security.force_change_initial', label: 'الزام تغییر رمز اولیه در اولین ورود', type: 'toggle', default: true, col: 4 },
    { tab: 'security', key: 'security.default_password', label: 'رمز اولیه کاربران جدید', type: 'select', default: 'national_code', options: { national_code: 'کد ملی', mobile: 'شماره موبایل', random: 'تصادفی (ارسال با پیامک)' }, col: 6 },
    { tab: 'security', key: 'security.forgot_password_sms', label: 'بازیابی رمز با کد پیامکی', type: 'toggle', default: true, col: 6 },
    { tab: 'security', type: 'heading', label: 'نگهداری داده‌ها' },
    { tab: 'security', key: 'security.audit_retention_days', label: 'مدت نگهداری گزارش فعالیت‌ها (روز)', type: 'number', default: 365, min: 7, max: 3650, col: 6 },

    { tab: 'system', type: 'heading', label: 'حالت تعمیر و نگهداری' },
    { tab: 'system', key: 'system.maintenance', label: 'فعال‌سازی حالت تعمیر (فقط مدیر کل دسترسی دارد)', type: 'toggle', default: false },
    { tab: 'system', key: 'system.maintenance_message', label: 'پیام حالت تعمیر', type: 'textarea', default: 'سامانه در حال به‌روزرسانی است. لطفاً دقایقی دیگر مراجعه کنید.', rows: 2 },
    { tab: 'system', type: 'heading', label: 'آدرس سامانه' },
    { tab: 'system', key: 'system.base_url', label: 'آدرس کامل سامانه', type: 'url', default: '', ltr: true, help: 'برای لینک‌های داخل پیامک و QR مدارک. مثال: https://panel.example.com' },
    { tab: 'system', type: 'heading', label: 'زمان‌بندی خودکار (یادآورها)' },
    { tab: 'system', key: 'system.internal_scheduler', label: 'اجرای زمان‌بند داخلی (هر ۵ دقیقه)', type: 'toggle', default: true, help: 'برای اطمینان بیشتر، Cron Job سی‌پنل را نیز طبق راهنمای زیر تنظیم کنید.' },
    { tab: 'system', key: 'system.cron_key', label: 'کلید امنیتی Cron', type: 'cron', default: '' },
  ],

  migrations: [
    {
      name: '0001_system_core',
      async up(knex) {
        await knex.schema.createTable('settings', (t) => {
          tableOptions(knex, t);
          t.string('key', 191).primary();
          t.text('value', 'mediumtext');
        });
        await knex.schema.createTable('sessions', (t) => {
          tableOptions(knex, t);
          t.string('sid', 191).primary();
          t.text('sess', 'mediumtext').notNullable();
          t.bigInteger('expires').notNullable().index();
          t.integer('user_id').unsigned().nullable().index();
        });
        await knex.schema.createTable('audit_logs', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('user_id').unsigned().nullable().index();
          t.string('action', 100).notNullable().index();
          t.string('entity', 50).nullable();
          t.integer('entity_id').nullable();
          t.text('details').nullable();
          t.string('ip', 45).nullable();
          t.string('user_agent', 255).nullable();
          t.datetime('created_at').index();
        });
      },
      async down(knex) {
        await knex.schema.dropTableIfExists('audit_logs');
        await knex.schema.dropTableIfExists('sessions');
        await knex.schema.dropTableIfExists('settings');
      },
    },
  ],

  tasks: [
    {
      key: 'cleanup',
      label: 'پاک‌سازی نشست‌ها و گزارش‌های قدیمی',
      everyMinutes: 24 * 60,
      async run() {
        const { db } = require('../../core/db');
        const settings = require('../../core/settings');
        const jalali = require('../../core/jalali');
        const s = await db('sessions').where('expires', '<', Date.now()).del();
        const days = Number(settings.get('security.audit_retention_days', 365));
        const a = await db('audit_logs').where('created_at', '<', jalali.addDays(jalali.today(), -days)).del();
        return { sessions: s, audit: a };
      },
    },
  ],

  routes: routes.panel,
  publicRoutes: routes.public,
};
