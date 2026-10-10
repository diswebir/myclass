'use strict';
/**
 * ماژول حضور و غیاب
 */
const path = require('path');
const { tableOptions } = require('../../core/migrator');
const { db } = require('../../core/db');
const { rate } = require('./service');

module.exports = {
  key: 'attendance',
  name: 'حضور و غیاب',
  description: 'ثبت حضور، غیاب، تأخیر و غیبت موجه برای هر جلسه، گزارش ماتریسی و اطلاع‌رسانی پیامکی',
  icon: 'clipboard-check',
  order: 20,
  requires: ['classes'],

  permissions: [
    { key: 'attendance.view', label: 'مشاهده حضور و غیاب و گزارش‌ها' },
    { key: 'attendance.manage', label: 'ثبت حضور و غیاب' },
    { key: 'attendance.edit_past', label: 'ویرایش حضور و غیاب جلسات قدیمی (خارج از بازه مجاز)' },
  ],

  menu: [
    { label: 'حضور و غیاب', icon: 'clipboard-check', href: '/panel/attendance', perm: ['attendance.view', 'attendance.manage'], section: 'education', order: 20 },
  ],

  settingsTabs: [{ key: 'attendance', label: 'حضور و غیاب', icon: 'clipboard-check', order: 20 }],
  settings: [
    { tab: 'attendance', type: 'heading', label: 'قوانین محاسبه' },
    { tab: 'attendance', key: 'attendance.late_counts_present', label: 'تأخیر به عنوان حضور محاسبه شود', type: 'toggle', default: true, col: 6 },
    { tab: 'attendance', key: 'attendance.excused_mode', label: 'نحوه محاسبه غیبت موجه', type: 'select', default: 'exclude', options: { exclude: 'در محاسبه درصد لحاظ نشود', present: 'به عنوان حضور', absent: 'به عنوان غیبت' }, col: 6 },
    { tab: 'attendance', key: 'attendance.default_status', label: 'وضعیت پیش‌فرض در فرم ثبت', type: 'select', default: 'present', options: { present: 'حاضر', absent: 'غایب', none: 'بدون انتخاب' }, col: 6 },
    { tab: 'attendance', key: 'attendance.min_percent', label: 'حداقل درصد حضور (پیش‌فرض برای صدور مدرک)', type: 'number', default: 75, min: 0, max: 100, col: 6 },
    { tab: 'attendance', type: 'heading', label: 'محدودیت‌های ثبت' },
    { tab: 'attendance', key: 'attendance.edit_days', label: 'مهلت ثبت/ویرایش حضور و غیاب (روز پس از جلسه)', type: 'number', default: 3, min: 0, max: 365, col: 6, help: 'کاربرانی که مجوز «ویرایش جلسات قدیمی» دارند از این محدودیت مستثنی هستند' },
    { tab: 'attendance', key: 'attendance.allow_future', label: 'اجازه ثبت برای جلسات آینده', type: 'toggle', default: false, col: 6 },
    { tab: 'attendance', type: 'heading', label: 'اطلاع‌رسانی پیامکی' },
    { tab: 'attendance', key: 'attendance.notify_absent', label: 'ارسال پیامک به غایبین (پیش‌فرض فرم)', type: 'toggle', default: true, col: 4 },
    { tab: 'attendance', key: 'attendance.notify_late', label: 'ارسال پیامک تأخیر', type: 'toggle', default: false, col: 4 },
    { tab: 'attendance', key: 'attendance.warning_threshold', label: 'ارسال اخطار پس از چند غیبت', type: 'number', default: 3, min: 0, max: 100, col: 4, help: '۰ = غیرفعال' },
  ],

  smsEvents: [
    {
      key: 'attendance.absent', label: 'اطلاع غیبت در جلسه', group: 'حضور و غیاب', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'session_date', 'session_no', 'absent_count'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'date', value: '{session_date}' }],
    },
    {
      key: 'attendance.late', label: 'اطلاع تأخیر در جلسه', group: 'حضور و غیاب', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'session_date'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'date', value: '{session_date}' }],
    },
    {
      key: 'attendance.warning', label: 'اخطار تعداد غیبت‌های مجاز', group: 'حضور و غیاب', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'class_title', 'absent_count'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'class', value: '{class_title}' }, { name: 'count', value: '{absent_count}' }],
    },
  ],

  migrations: [
    {
      name: '0020_attendance',
      async up(knex) {
        await knex.schema.createTable('attendances', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('session_id').unsigned().notNullable().references('id').inTable('class_sessions').onDelete('CASCADE');
          t.integer('enrollment_id').unsigned().notNullable().references('id').inTable('enrollments').onDelete('CASCADE');
          t.string('status', 20).notNullable();
          t.string('note', 255).nullable();
          t.integer('recorded_by').unsigned().nullable();
          t.datetime('recorded_at');
          t.unique(['session_id', 'enrollment_id']);
          t.index(['enrollment_id']);
        });
      },
      async down(knex) {
        await knex.schema.dropTableIfExists('attendances');
      },
    },
  ],

  classTabs: [
    {
      key: 'attendance', label: 'حضور و غیاب', icon: 'clipboard-check', order: 30, perm: ['attendance.view', 'attendance.manage'],
      async load(req, cls) {
        const matrix = await require('./routes').buildMatrix(cls.id);
        return { view: path.join(__dirname, 'views', 'class-tab.ejs'), data: matrix };
      },
    },
  ],

  userTabs: [
    {
      key: 'attendance', label: 'حضور و غیاب', icon: 'clipboard-check', order: 20, perm: 'attendance.view', kinds: ['student'],
      async load(req, user) {
        const { scopeClassIds, applyClassScope } = require('../../core/auth');
        const ids = await scopeClassIds(req);
        const rows = await applyClassScope(db('attendances as a').join('enrollments as e', 'e.id', 'a.enrollment_id')
          .join('class_sessions as s', 's.id', 'a.session_id').join('classes as c', 'c.id', 'e.class_id')
          .where('e.user_id', user.id).select('a.*', 's.date', 's.session_no', 'c.title as class_title', 'c.id as class_id')
          .orderBy('s.date', 'desc').limit(100), 'c.id', ids);
        const counts = {};
        rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
        return { view: path.join(__dirname, 'views', 'user-tab.ejs'), data: { rows, counts, rateValue: rate(counts) }, count: rows.length };
      },
    },
  ],

  routes(r) {
    require('./routes').mount(r);
  },
};
