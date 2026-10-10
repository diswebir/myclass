'use strict';
/**
 * ماژول مالی: فاکتور، پرداخت نقدی و اقساطی، کارت به کارت، یادآوری اقساط
 */
const path = require('path');
const { tableOptions } = require('../../core/migrator');
const { db } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { can } = require('../../core/auth');

module.exports = {
  key: 'finance',
  name: 'امور مالی و شهریه',
  description: 'صدور فاکتور، پرداخت نقدی و اقساطی، کارت به کارت با ارسال رسید، یادآوری خودکار اقساط و گزارش‌های مالی',
  icon: 'wallet',
  order: 40,

  permissions: [
    { key: 'finance.view', label: 'مشاهده امور مالی' },
    { key: 'finance.invoices', label: 'صدور و ویرایش فاکتور و اقساط' },
    { key: 'finance.payments', label: 'ثبت پرداخت' },
    { key: 'finance.review', label: 'بررسی و تأیید رسیدهای کارت به کارت' },
    { key: 'finance.delete', label: 'حذف پرداخت و ابطال فاکتور' },
    { key: 'finance.reports', label: 'گزارش‌ها و نمودارهای مالی' },
  ],

  menu: [
    { label: 'داشبورد مالی', icon: 'chart-pie', href: '/panel/finance', perm: 'finance.reports', section: 'finance', order: 1 },
    { label: 'فاکتورها', icon: 'receipt', href: '/panel/invoices', perm: 'finance.view', section: 'finance', order: 10 },
    { label: 'پرداخت‌ها', icon: 'banknote', href: '/panel/payments', perm: 'finance.view', section: 'finance', order: 20, badgeKey: 'pendingPayments' },
    { label: 'اقساط', icon: 'calendar-clock', href: '/panel/installments', perm: 'finance.view', section: 'finance', order: 30, badgeKey: 'overdueInstallments' },
  ],

  async menuBadges(req) {
    const out = {};
    if (can(req.user, 'finance.review')) {
      out.pendingPayments = Number((await db('payments').where('status', 'pending').count({ c: '*' }).first()).c);
    }
    if (can(req.user, 'finance.view')) {
      out.overdueInstallments = Number((await db('installments as i').join('invoices as v', 'v.id', 'i.invoice_id').whereNot('v.status', 'canceled')
        .whereIn('i.status', ['pending', 'partial', 'overdue']).where('i.due_date', '<', jalali.today()).count({ c: '*' }).first()).c);
    }
    return out;
  },

  settingsTabs: [{ key: 'finance', label: 'مالی و پرداخت', icon: 'wallet', order: 30 }],
  settings: [
    { tab: 'finance', type: 'heading', label: 'عمومی' },
    { tab: 'finance', key: 'finance.currency', label: 'واحد پول', type: 'select', default: 'تومان', options: { 'تومان': 'تومان', 'ریال': 'ریال' }, col: 4 },
    { tab: 'finance', key: 'finance.invoice_prefix', label: 'پیشوند شماره فاکتور', type: 'text', default: 'INV-', ltr: true, col: 4 },
    { tab: 'finance', key: 'finance.round_to', label: 'گرد کردن مبلغ اقساط به', type: 'number', default: 1000, min: 1, max: 1000000, col: 4 },
    { tab: 'finance', key: 'finance.invoice_footer', label: 'متن پایین فاکتور چاپی', type: 'textarea', default: 'از حسن اعتماد شما سپاسگزاریم.', rows: 2 },
    { tab: 'finance', type: 'heading', label: 'پرداخت اقساطی' },
    { tab: 'finance', key: 'finance.installments_enabled', label: 'امکان پرداخت اقساطی', type: 'toggle', default: true, col: 3 },
    { tab: 'finance', key: 'finance.max_installments', label: 'حداکثر تعداد اقساط', type: 'number', default: 6, min: 2, max: 48, col: 3 },
    { tab: 'finance', key: 'finance.min_down_percent', label: 'حداقل پیش‌پرداخت (درصد)', type: 'number', default: 30, min: 0, max: 100, col: 3 },
    { tab: 'finance', key: 'finance.installment_interval', label: 'فاصله اقساط', type: 'select', default: '1', options: { 1: 'ماهانه', 2: 'هر دو ماه', 3: 'هر سه ماه' }, col: 3 },
    { tab: 'finance', type: 'heading', label: 'کارت به کارت', help: 'دانشجویان می‌توانند از پنل خود مبلغ را کارت به کارت کرده و تصویر رسید را بارگذاری کنند.' },
    { tab: 'finance', key: 'finance.card_enabled', label: 'فعال‌سازی پرداخت کارت به کارت', type: 'toggle', default: true, col: 6 },
    { tab: 'finance', key: 'finance.receipt_required', label: 'الزام بارگذاری تصویر رسید', type: 'toggle', default: true, col: 6 },
    {
      tab: 'finance', key: 'finance.cards', label: 'حساب‌ها / کارت‌های مقصد', type: 'repeater', default: [],
      fields: [
        { key: 'bank', label: 'نام بانک' }, { key: 'card_number', label: 'شماره کارت', ltr: true },
        { key: 'sheba', label: 'شماره شبا', ltr: true }, { key: 'holder', label: 'نام صاحب حساب' },
        { key: 'active', label: 'فعال', type: 'toggle' },
      ],
    },
    { tab: 'finance', key: 'finance.card_instructions', label: 'راهنمای پرداخت کارت به کارت', type: 'textarea', default: 'لطفاً پس از واریز، تصویر رسید و شماره پیگیری را ثبت کنید. پرداخت شما پس از بررسی کارشناس مالی تأیید می‌شود.', rows: 2 },
    { tab: 'finance', type: 'heading', label: 'یادآوری اقساط (پیامک)' },
    { tab: 'finance', key: 'finance.reminder_enabled', label: 'یادآوری خودکار قبل از سررسید', type: 'toggle', default: true, col: 4 },
    { tab: 'finance', key: 'finance.reminder_days', label: 'روزهای یادآوری قبل از سررسید', type: 'tags', default: ['3', '0'], col: 4, help: 'با کاما جدا کنید. ۰ = روز سررسید' },
    { tab: 'finance', key: 'finance.reminder_hour', label: 'ساعت ارسال یادآوری', type: 'number', default: 10, min: 0, max: 23, col: 4 },
    { tab: 'finance', key: 'finance.overdue_notice', label: 'ارسال اخطار اقساط معوق', type: 'toggle', default: true, col: 6 },
    { tab: 'finance', key: 'finance.overdue_days_after', label: 'چند روز پس از سررسید', type: 'number', default: 2, min: 0, max: 60, col: 6 },
    { tab: 'finance', key: 'finance.notify_admin_receipt', label: 'اطلاع پیامکی رسید جدید به مدیران مالی', type: 'toggle', default: true, col: 6 },
  ],

  smsEvents: [
    {
      key: 'invoice.created', label: 'صدور فاکتور شهریه', group: 'مالی', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'invoice_no', 'amount', 'class_title', 'installments_count', 'first_due_date'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'amount', value: '{amount}' }, { name: 'class', value: '{class_title}' }],
    },
    {
      key: 'installment.reminder', label: 'یادآوری سررسید قسط', group: 'مالی', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'amount', 'due_date', 'installment_no', 'class_title', 'invoice_no', 'days_left'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'amount', value: '{amount}' }, { name: 'date', value: '{due_date}' }],
    },
    {
      key: 'installment.overdue', label: 'اخطار قسط معوق', group: 'مالی', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'amount', 'due_date', 'installment_no', 'class_title', 'invoice_no', 'days_late'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'amount', value: '{amount}' }, { name: 'date', value: '{due_date}' }],
    },
    {
      key: 'payment.approved', label: 'تأیید دریافت پرداخت', group: 'مالی', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'amount', 'remaining', 'invoice_no', 'class_title', 'tracking_code'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'amount', value: '{amount}' }, { name: 'remaining', value: '{remaining}' }],
    },
    {
      key: 'payment.rejected', label: 'رد رسید پرداخت', group: 'مالی', recipient: 'دانشجو',
      tokens: ['name', 'first_name', 'amount', 'reason', 'invoice_no'],
      defaultVars: [{ name: 'name', value: '{first_name}' }, { name: 'amount', value: '{amount}' }, { name: 'reason', value: '{reason}' }],
    },
    {
      key: 'payment.submitted_admin', label: 'رسید کارت به کارت جدید (به مدیر)', group: 'مالی', recipient: 'مدیران',
      tokens: ['name', 'amount', 'invoice_no', 'class_title', 'tracking_code'],
      defaultVars: [{ name: 'name', value: '{name}' }, { name: 'amount', value: '{amount}' }],
    },
  ],

  migrations: [
    {
      name: '0040_finance',
      async up(knex) {
        await knex.schema.createTable('invoices', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.string('invoice_no', 30).notNullable().unique();
          t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
          t.integer('class_id').unsigned().nullable().references('id').inTable('classes').onDelete('SET NULL');
          t.integer('enrollment_id').unsigned().nullable().references('id').inTable('enrollments').onDelete('SET NULL');
          t.string('title', 191).notNullable();
          t.bigInteger('amount').notNullable().defaultTo(0);
          t.bigInteger('discount').notNullable().defaultTo(0);
          t.bigInteger('total').notNullable().defaultTo(0);
          t.bigInteger('paid').notNullable().defaultTo(0);
          t.string('payment_type', 20).notNullable().defaultTo('cash');
          t.string('status', 20).notNullable().defaultTo('unpaid').index();
          t.date('issue_date').nullable();
          t.date('due_date').nullable();
          t.text('notes').nullable();
          t.integer('created_by').unsigned().nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
          t.index(['user_id']);
          t.index(['class_id']);
        });
        await knex.schema.createTable('installments', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('invoice_id').unsigned().notNullable().references('id').inTable('invoices').onDelete('CASCADE');
          t.integer('seq').notNullable().defaultTo(1);
          t.bigInteger('amount').notNullable().defaultTo(0);
          t.bigInteger('paid_amount').notNullable().defaultTo(0);
          t.date('due_date').notNullable().index();
          t.string('status', 20).notNullable().defaultTo('pending');
          t.datetime('paid_at').nullable();
          t.datetime('reminded_at').nullable();
          t.string('reminded_days', 50).nullable();
          t.datetime('overdue_notified_at').nullable();
          t.index(['invoice_id']);
        });
        await knex.schema.createTable('payments', (t) => {
          tableOptions(knex, t);
          t.increments('id');
          t.integer('invoice_id').unsigned().notNullable().references('id').inTable('invoices').onDelete('CASCADE');
          t.integer('installment_id').unsigned().nullable().references('id').inTable('installments').onDelete('SET NULL');
          t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
          t.bigInteger('amount').notNullable();
          t.string('method', 30).notNullable().defaultTo('cash');
          t.string('status', 20).notNullable().defaultTo('approved').index();
          t.string('tracking_code', 100).nullable();
          t.string('payer_card', 30).nullable();
          t.string('payer_name', 100).nullable();
          t.string('dest_account', 100).nullable();
          t.date('paid_date').nullable();
          t.string('receipt_path', 255).nullable();
          t.text('note').nullable();
          t.string('reject_reason', 255).nullable();
          t.integer('created_by').unsigned().nullable();
          t.integer('reviewed_by').unsigned().nullable();
          t.datetime('reviewed_at').nullable();
          t.datetime('created_at');
          t.datetime('updated_at');
          t.index(['user_id']);
          t.index(['paid_date']);
        });
      },
      async down(knex) {
        for (const t of ['payments', 'installments', 'invoices']) await knex.schema.dropTableIfExists(t);
      },
    },
  ],

  tasks: [
    {
      key: 'installment_reminders',
      label: 'یادآوری و اخطار اقساط',
      everyMinutes: 60,
      async run() {
        const today = jalali.today();
        const hour = Number(jalali.nowTime().slice(0, 2));
        let reminded = 0, overdue = 0;
        // به‌روزرسانی وضعیت معوق
        await db('installments').whereIn('status', ['pending', 'partial']).where('due_date', '<', today).update({ status: 'overdue' });
        if (hour < Number(settings.get('finance.reminder_hour', 10))) return { waiting: true };
        const base = () => db('installments as i').join('invoices as v', 'v.id', 'i.invoice_id').whereNotIn('v.status', ['canceled', 'paid'])
          .select('i.*', 'v.user_id', 'v.class_id', 'v.invoice_no');
        if (settings.get('finance.reminder_enabled', true)) {
          const days = (settings.get('finance.reminder_days', ['3', '0']) || []).map(Number).filter((d) => d >= 0 && d <= 60);
          for (const d of days) {
            const target = jalali.addDays(today, d);
            const list = await base().where('i.due_date', target).whereIn('i.status', ['pending', 'partial']).limit(200);
            for (const it of list) {
              const sent = String(it.reminded_days || '').split(',');
              const tag = `${target}:${d}`;
              if (sent.includes(tag)) continue;
              await db('installments').where({ id: it.id }).update({ reminded_at: jalali.now(), reminded_days: [...sent.filter(Boolean).slice(-3), tag].join(',').slice(0, 50) });
              events.emit('installment.reminder', { installmentId: it.id, extra: { days_left: d } });
              reminded++;
            }
          }
        }
        if (settings.get('finance.overdue_notice', true)) {
          const after = Number(settings.get('finance.overdue_days_after', 2));
          const list = await base().where('i.due_date', '<=', jalali.addDays(today, -after)).where('i.status', 'overdue').whereNull('i.overdue_notified_at').limit(200);
          for (const it of list) {
            await db('installments').where({ id: it.id }).update({ overdue_notified_at: jalali.now() });
            events.emit('installment.overdue', { installmentId: it.id, extra: { days_late: jalali.diffDays(it.due_date, today) } });
            overdue++;
          }
        }
        return { reminded, overdue };
      },
    },
  ],

  classTabs: [
    {
      key: 'finance', label: 'مالی', icon: 'wallet', order: 40, perm: 'finance.view',
      async load(req, cls) {
        const invoices = await db('invoices as i').join('users as u', 'u.id', 'i.user_id').where('i.class_id', cls.id)
          .select('i.*', 'u.first_name', 'u.last_name').orderBy('i.id', 'desc');
        const sum = (k) => invoices.filter((x) => x.status !== 'canceled').reduce((a, b) => a + Number(b[k]), 0);
        return { view: path.join(__dirname, 'views', 'class-tab.ejs'), data: { invoices, totals: { total: sum('total'), paid: sum('paid'), discount: sum('discount') } } };
      },
    },
  ],

  userTabs: [
    {
      key: 'finance', label: 'مالی', icon: 'wallet', order: 30, perm: 'finance.view', kinds: ['student'],
      async load(req, user) {
        const invoices = await db('invoices as i').leftJoin('classes as c', 'c.id', 'i.class_id').where('i.user_id', user.id)
          .select('i.*', 'c.title as class_title').orderBy('i.id', 'desc');
        const payments = await db('payments').where({ user_id: user.id }).orderBy('id', 'desc').limit(30);
        return { view: path.join(__dirname, 'views', 'user-tab.ejs'), data: { invoices, payments }, count: invoices.length };
      },
    },
  ],

  routes(r) {
    require('./routes')(r);
  },
};
