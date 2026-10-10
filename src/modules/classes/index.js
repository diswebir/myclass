'use strict';
/**
 * ماژول کلاس‌ها: تعریف کلاس، زمان‌بندی، جلسات، اساتید و ثبت‌نام دانشجویان
 */
const path = require('path');
const { tableOptions } = require('../../core/migrator');
const { db } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');

module.exports = {
  key: 'classes',
  name: 'کلاس‌ها و دوره‌ها',
  description: 'تعریف کلاس با زمان شروع و پایان، روزهای برگزاری، جلسات، تخصیص استاد و ثبت‌نام دانشجویان',
  icon: 'school',
  order: 10,

  permissions: [
    { key: 'classes.view', label: 'مشاهده کلاس‌ها' },
    { key: 'classes.create', label: 'ایجاد کلاس' },
    { key: 'classes.edit', label: 'ویرایش کلاس و تخصیص استاد' },
    { key: 'classes.delete', label: 'حذف کلاس' },
    { key: 'classes.students', label: 'مدیریت دانشجویان کلاس (ثبت‌نام/حذف/نمره)' },
    { key: 'classes.sessions', label: 'مدیریت جلسات کلاس' },
    { key: 'classes.categories', label: 'مدیریت دسته‌بندی‌ها' },
  ],

  menu: [
    { label: 'کلاس‌ها', icon: 'school', href: '/panel/classes', perm: 'classes.view', section: 'education', order: 10 },
    { label: 'تقویم جلسات', icon: 'calendar-days', href: '/panel/calendar', perm: 'classes.view', section: 'education', order: 15 },
    { label: 'دسته‌بندی‌ها', icon: 'tags', href: '/panel/categories', perm: 'classes.categories', section: 'education', order: 60 },
  ],

  settingsTabs: [{ key: 'classes', label: 'کلاس‌ها و جلسات', icon: 'school', order: 10 }],
  settings: [
    { tab: 'classes', type: 'heading', label: 'پیش‌فرض‌های کلاس' },
    { tab: 'classes', key: 'classes.code_prefix', label: 'پیشوند کد کلاس', type: 'text', default: 'CL-', col: 4, ltr: true },
    { tab: 'classes', key: 'classes.default_capacity', label: 'ظرفیت پیش‌فرض', type: 'number', default: 20, min: 0, max: 10000, col: 4, help: '۰ یعنی نامحدود' },
    { tab: 'classes', key: 'classes.default_start_time', label: 'ساعت شروع پیش‌فرض', type: 'time', default: '16:00', col: 2 },
    { tab: 'classes', key: 'classes.default_end_time', label: 'ساعت پایان پیش‌فرض', type: 'time', default: '18:00', col: 2 },
    { tab: 'classes', key: 'classes.allow_over_capacity', label: 'اجازه ثبت‌نام بیش از ظرفیت', type: 'toggle', default: false, col: 6 },
    { tab: 'classes', key: 'classes.auto_generate_sessions', label: 'تولید خودکار جلسات هنگام ایجاد کلاس', type: 'toggle', default: true, col: 6 },
    { tab: 'classes', key: 'classes.auto_status', label: 'تغییر خودکار وضعیت کلاس (شروع/پایان) بر اساس تاریخ', type: 'toggle', default: true, col: 6 },
    { tab: 'classes', key: 'classes.teacher_sees_contacts', label: 'نمایش شماره تماس دانشجویان به استاد', type: 'toggle', default: true, col: 6 },
    { tab: 'classes', type: 'heading', label: 'یادآوری جلسات (پیامک)' },
    { tab: 'classes', key: 'classes.session_reminder', label: 'ارسال یادآوری جلسه به دانشجویان', type: 'toggle', default: false, col: 4 },
    { tab: 'classes', key: 'classes.session_reminder_days', label: 'چند روز قبل از جلسه', type: 'number', default: 1, min: 0, max: 7, col: 4 },
    { tab: 'classes', key: 'classes.session_reminder_hour', label: 'ساعت ارسال (۰ تا ۲۳)', type: 'number', default: 17, min: 0, max: 23, col: 4 },
  ],

  smsEvents: [
    {
      key: 'enrollment.created', label: 'ثبت‌نام قطعی در کلاس', group: 'کلاس‌ها', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'class_code', 'start_date', 'start_time', 'week_days', 'location'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'date', value: '{start_date}' }],
    },
    {
      key: 'session.reminder', label: 'یادآوری جلسه کلاس', group: 'کلاس‌ها', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'session_date', 'session_time', 'session_no', 'location'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'date', value: '{session_date}' }, { name: 'time', value: '{session_time}' }],
    },
    {
      key: 'session.canceled', label: 'لغو جلسه کلاس', group: 'کلاس‌ها', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'session_date', 'session_time'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'date', value: '{session_date}' }],
    },
  ],

  migrations: [
    {
      name: '0010_classes',
      async up(knex) {
        await knex.schema.createTable('categories', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.string('name', 100).notNullable();
          t.string('color', 20).nullable();
          t.integer('sort').notNullable().defaultTo(0);
          t.datetime('created_at');
        });
        await knex.schema.createTable('classes', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('category_id').unsigned().nullable().references('id').inTable('categories').onDelete('SET NULL');
          t.string('title', 191).notNullable();
          t.string('code', 50).notNullable().unique();
          t.text('description').nullable();
          t.integer('capacity').notNullable().defaultTo(0);
          t.bigInteger('price').notNullable().defaultTo(0);
          t.date('start_date').nullable();
          t.date('end_date').nullable();
          t.string('start_time', 5).nullable();
          t.string('end_time', 5).nullable();
          t.string('week_days', 30).nullable();
          t.string('location', 255).nullable();
          t.string('online_link', 255).nullable();
          t.string('level', 50).nullable();
          t.string('status', 20).notNullable().defaultTo('draft').index();
          t.boolean('is_public').notNullable().defaultTo(true);
          t.boolean('prereg_enabled').notNullable().defaultTo(true);
          t.integer('min_attendance').nullable();
          t.integer('total_hours').nullable();
          t.string('color', 20).nullable();
          t.text('notes').nullable();
          t.integer('created_by').unsigned().nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
        });
        await knex.schema.createTable('class_teachers', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('class_id').unsigned().notNullable().references('id').inTable('classes').onDelete('CASCADE');
          t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
          t.string('title', 50).nullable();
          t.unique(['class_id', 'user_id']);
          t.index(['user_id']);
        });
        await knex.schema.createTable('enrollments', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('class_id').unsigned().notNullable().references('id').inTable('classes').onDelete('CASCADE');
          t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
          t.string('status', 20).notNullable().defaultTo('active');
          t.decimal('grade', 5, 2).nullable();
          t.date('enrolled_at').nullable();
          t.string('source', 20).nullable();
          t.text('notes').nullable();
          t.integer('created_by').unsigned().nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
          t.unique(['class_id', 'user_id']);
          t.index(['user_id']);
        });
        await knex.schema.createTable('class_sessions', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('class_id').unsigned().notNullable().references('id').inTable('classes').onDelete('CASCADE');
          t.integer('session_no').nullable();
          t.date('date').notNullable();
          t.string('start_time', 5).nullable();
          t.string('end_time', 5).nullable();
          t.string('topic', 255).nullable();
          t.string('status', 20).notNullable().defaultTo('scheduled');
          t.text('notes').nullable();
          t.datetime('reminded_at').nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
          t.index(['class_id', 'date']);
          t.index(['date']);
        });
      },
      async down(knex) {
        for (const t of ['class_sessions', 'enrollments', 'class_teachers', 'classes', 'categories']) await knex.schema.dropTableIfExists(t);
      },
    },
  ],

  tasks: [
    {
      key: 'auto_status',
      label: 'به‌روزرسانی خودکار وضعیت کلاس‌ها',
      everyMinutes: 60,
      async run() {
        if (!settings.get('classes.auto_status', true)) return { skipped: true };
        const today = jalali.today();
        const started = await db('classes').where('status', 'open').whereNotNull('start_date').where('start_date', '<=', today).update({ status: 'running', updated_at: jalali.now() });
        const finished = await db('classes').where('status', 'running').whereNotNull('end_date').where('end_date', '<', today).update({ status: 'finished', updated_at: jalali.now() });
        return { started, finished };
      },
    },
    {
      key: 'session_reminder',
      label: 'یادآوری پیامکی جلسات',
      everyMinutes: 30,
      async run() {
        if (!settings.get('classes.session_reminder', false)) return { skipped: true };
        const hour = Number(jalali.nowTime().slice(0, 2));
        if (hour < Number(settings.get('classes.session_reminder_hour', 17))) return { waiting: true };
        const target = jalali.addDays(jalali.today(), Number(settings.get('classes.session_reminder_days', 1)));
        const sessions = await db('class_sessions as s').join('classes as c', 'c.id', 's.class_id')
          .where('s.date', target).where('s.status', 'scheduled').whereNull('s.reminded_at').whereIn('c.status', ['open', 'running'])
          .select('s.*', 'c.title as class_title', 'c.location', 'c.code as class_code').limit(50);
        let sent = 0;
        for (const s of sessions) {
          await db('class_sessions').where({ id: s.id }).update({ reminded_at: jalali.now() });
          const students = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', s.class_id).where('e.status', 'active').select('u.*');
          const cls = await db('classes').where({ id: s.class_id }).first();
          for (const u of students) {
            events.emit('session.reminder', { user: u, cls, session: s });
            sent++;
          }
        }
        return { sessions: sessions.length, sent };
      },
    },
  ],

  /** تب‌های پروفایل کاربر */
  userTabs: [
    {
      key: 'classes', label: 'کلاس‌ها', icon: 'school', order: 10, perm: 'classes.view',
      async load(req, user) {
        const { scopeClassIds, applyClassScope } = require('../../core/auth');
        const ids = await scopeClassIds(req);
        const enrolled = await applyClassScope(db('enrollments as e').join('classes as c', 'c.id', 'e.class_id')
          .where('e.user_id', user.id).select('e.*', 'c.title', 'c.code', 'c.status as class_status', 'c.start_date', 'c.end_date').orderBy('e.id', 'desc'), 'c.id', ids);
        const teaching = await applyClassScope(db('class_teachers as ct').join('classes as c', 'c.id', 'ct.class_id')
          .where('ct.user_id', user.id).select('c.*').orderBy('c.id', 'desc'), 'c.id', ids);
        // درصد حضور
        const att = {};
        if (enrolled.length) {
          const rows = await db('attendances').whereIn('enrollment_id', enrolled.map((e) => e.id)).groupBy('enrollment_id', 'status').select('enrollment_id', 'status').count({ c: '*' }).catch(() => []);
          rows.forEach((r) => { att[r.enrollment_id] = att[r.enrollment_id] || {}; att[r.enrollment_id][r.status] = Number(r.c); });
        }
        return { view: path.join(__dirname, 'views', 'user-tab.ejs'), data: { enrolled, teaching, att }, count: enrolled.length + teaching.length };
      },
    },
  ],

  classTabs: [],

  routes(r) {
    require('./routes')(r);
  },
};
