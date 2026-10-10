'use strict';
/**
 * پنل کاربری دانشجو: کلاس‌ها، برنامه جلسات، حضور و غیاب، وضعیت مالی، ارسال رسید کارت به کارت، مدارک
 * همه کوئری‌ها به user_id کاربر جاری محدود هستند.
 */
const path = require('path');
const { db } = require('../../core/db');
const registry = require('../../core/modules');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const { requirePerm } = require('../../core/auth');
const { uploader } = require('../../core/upload');
const { str, text, int, num, httpError, toEnDigits } = require('../../core/utils');

const v = (name) => path.join(__dirname, 'views', name);
const P = requirePerm('portal.access');

async function myEnrollments(userId) {
  return db('enrollments as e').join('classes as c', 'c.id', 'e.class_id').leftJoin('categories as cat', 'cat.id', 'c.category_id')
    .where('e.user_id', userId).select('c.*', 'e.id as enrollment_id', 'e.status as enroll_status', 'e.grade', 'e.enrolled_at', 'cat.name as category_name')
    .orderBy('c.start_date', 'desc');
}

async function attendanceSummary(userId, classIds) {
  if (!registry.isEnabled('attendance') || !classIds.length) return {};
  const { rate } = require('../attendance/service');
  const rows = await db('attendances as a').join('enrollments as e', 'e.id', 'a.enrollment_id').where('e.user_id', userId)
    .whereIn('e.class_id', classIds).groupBy('e.class_id', 'a.status').select('e.class_id', 'a.status').count({ c: '*' });
  const out = {};
  rows.forEach((r) => { out[r.class_id] = out[r.class_id] || {}; out[r.class_id][r.status] = Number(r.c); });
  Object.keys(out).forEach((k) => { out[k].rate = rate(out[k]); });
  return out;
}

module.exports = {
  key: 'portal',
  name: 'پنل دانشجو',
  description: 'پنل کاربری اختصاصی هر دانشجو برای مشاهده کلاس‌ها، حضور و غیاب، اقساط، ارسال رسید و مدارک',
  icon: 'user-round',
  order: 80,
  requires: ['classes'],

  permissions: [{ key: 'portal.access', label: 'دسترسی به پنل دانشجو' }],
  menu: [
    { label: 'پیشخوان من', icon: 'layout-dashboard', href: '/panel/my', perm: 'portal.access', section: 'portal', order: 1, kinds: ['student'], match: ['/panel/my'] },
    { label: 'کلاس‌های من', icon: 'book-open', href: '/panel/my/classes', perm: 'portal.access', section: 'portal', order: 2, kinds: ['student'] },
    { label: 'امور مالی من', icon: 'wallet', href: '/panel/my/finance', perm: 'portal.access', section: 'portal', order: 3, kinds: ['student'], module: 'finance' },
    { label: 'مدارک من', icon: 'award', href: '/panel/my/certificates', perm: 'portal.access', section: 'portal', order: 4, kinds: ['student'], module: 'certificates' },
  ],

  settingsTabs: [{ key: 'portal', label: 'پنل دانشجو', icon: 'user-round', order: 45 }],
  settings: [
    { tab: 'portal', key: 'portal.welcome', label: 'پیام خوش‌آمد پیشخوان دانشجو', type: 'textarea', default: 'به پنل کاربری خود خوش آمدید. از این بخش می‌توانید وضعیت کلاس‌ها، حضور و غیاب و پرداخت‌های خود را مشاهده کنید.', col: 12 },
    { tab: 'portal', key: 'portal.show_classmates_count', label: 'نمایش تعداد هم‌کلاسی‌ها', type: 'toggle', default: true, col: 4 },
    { tab: 'portal', key: 'portal.show_teacher_mobile', label: 'نمایش شماره تماس استاد', type: 'toggle', default: false, col: 4 },
    { tab: 'portal', key: 'portal.show_session_topics', label: 'نمایش موضوع جلسات', type: 'toggle', default: true, col: 4 },
    { tab: 'portal', key: 'portal.allow_profile_edit', label: 'امکان ویرایش اطلاعات تماس توسط دانشجو', type: 'toggle', default: true, col: 6 },
  ],

  routes(r) {
    r.get('/my', P, async (req, res) => {
      const uid = req.user.id;
      const classes = await myEnrollments(uid);
      const activeIds = classes.filter((c) => c.enroll_status === 'active').map((c) => c.id);
      const att = await attendanceSummary(uid, classes.map((c) => c.id));
      const today = jalali.today();
      const upcoming = activeIds.length ? await db('class_sessions as s').join('classes as c', 'c.id', 's.class_id').whereIn('s.class_id', activeIds)
        .where('s.date', '>=', today).whereNot('s.status', 'canceled').select('s.*', 'c.title as class_title', 'c.location', 'c.online_link', 'c.color')
        .orderBy('s.date').orderBy('s.start_time').limit(6) : [];
      let finance = null;
      if (registry.isEnabled('finance')) {
        const inv = await db('invoices').where({ user_id: uid }).whereNot('status', 'canceled').select(db.raw('SUM(total) as t'), db.raw('SUM(paid) as p')).first();
        const next = await db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').where('i.user_id', uid).whereNot('i.status', 'canceled')
          .whereIn('it.status', ['pending', 'partial', 'overdue']).select('it.*', 'i.invoice_no', 'i.title as invoice_title').orderBy('it.due_date').first();
        const pending = await db('payments').where({ user_id: uid, status: 'pending' }).count({ c: '*' }).first();
        finance = { total: Number(inv.t || 0), paid: Number(inv.p || 0), next, pending: Number(pending.c) };
      }
      let certCount = 0;
      if (registry.isEnabled('certificates')) certCount = Number((await db('certificates').where({ user_id: uid, status: 'valid' }).count({ c: '*' }).first()).c);
      const rates = Object.values(att).map((a) => a.rate).filter((x) => x !== null && x !== undefined);
      res.page(v('home'), {
        title: 'پیشخوان من', classes, att, upcoming, finance, certCount,
        overallRate: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
      });
    });

    r.get('/my/classes', P, async (req, res) => {
      const classes = await myEnrollments(req.user.id);
      const att = await attendanceSummary(req.user.id, classes.map((c) => c.id));
      const teachers = {};
      if (classes.length) {
        (await db('class_teachers as ct').join('users as u', 'u.id', 'ct.user_id').whereIn('ct.class_id', classes.map((c) => c.id))
          .select('ct.class_id', 'u.first_name', 'u.last_name')).forEach((t) => { (teachers[t.class_id] = teachers[t.class_id] || []).push(`${t.first_name} ${t.last_name}`); });
      }
      const { weekDaysLabel } = require('../classes/service');
      res.page(v('classes'), { title: 'کلاس‌های من', classes, att, teachers, weekDaysLabel, breadcrumbs: [{ label: 'کلاس‌های من' }] });
    });

    r.get('/my/classes/:id', P, async (req, res, next) => {
      const cls = (await myEnrollments(req.user.id)).find((c) => c.id === int(req.params.id));
      if (!cls) return next(httpError(404, 'کلاس یافت نشد.'));
      const sessions = await db('class_sessions').where({ class_id: cls.id }).orderBy('date').orderBy('start_time');
      const records = {};
      if (registry.isEnabled('attendance')) {
        (await db('attendances').where({ enrollment_id: cls.enrollment_id })).forEach((a) => { records[a.session_id] = a; });
      }
      const teachers = await db('class_teachers as ct').join('users as u', 'u.id', 'ct.user_id').where('ct.class_id', cls.id)
        .select('u.first_name', 'u.last_name', 'u.mobile', 'u.avatar', 'ct.title');
      const classmates = settings.get('portal.show_classmates_count', true)
        ? Number((await db('enrollments').where({ class_id: cls.id, status: 'active' }).count({ c: '*' }).first()).c) : null;
      const att = (await attendanceSummary(req.user.id, [cls.id]))[cls.id] || {};
      const { weekDaysLabel } = require('../classes/service');
      res.page(v('class'), {
        title: cls.title, cls, sessions, records, teachers, classmates, att, weekDaysLabel, today: jalali.today(),
        breadcrumbs: [{ label: 'کلاس‌های من', href: '/panel/my/classes' }, { label: cls.title }],
      });
    });

    /* ------------------------------ مالی ------------------------------ */
    const financeOn = (req, res, next) => (registry.isEnabled('finance') ? next() : next(httpError(404)));

    r.get('/my/finance', P, financeOn, async (req, res) => {
      const uid = req.user.id;
      const invoices = await db('invoices as i').leftJoin('classes as c', 'c.id', 'i.class_id').where('i.user_id', uid).whereNot('i.status', 'canceled')
        .select('i.*', 'c.title as class_title').orderBy('i.id', 'desc');
      const ids = invoices.map((i) => i.id);
      const installments = ids.length ? await db('installments').whereIn('invoice_id', ids).orderBy('due_date') : [];
      const payments = await db('payments').where({ user_id: uid }).orderBy('id', 'desc');
      const fsvc = require('../finance/service');
      const open = installments.filter((it) => it.status !== 'paid');
      res.page(v('finance'), {
        title: 'امور مالی من', invoices, installments, payments, cards: fsvc.activeCards(), open,
        cardEnabled: settings.get('finance.card_enabled', true), receiptRequired: settings.get('finance.receipt_required', true),
        preInvoice: int(req.query.invoice) || null, preInstallment: int(req.query.installment) || null,
        breadcrumbs: [{ label: 'امور مالی من' }],
      });
    });

    const receiptUpload = uploader('receipts', { types: ['jpg', 'png', 'webp', 'pdf'], maxMB: 5, field: 'receipt' });
    r.post('/my/finance/receipt', P, financeOn, ...receiptUpload, async (req, res) => {
      if (!settings.get('finance.card_enabled', true)) throw httpError(403, 'پرداخت کارت به کارت غیرفعال است.');
      const inv = await db('invoices').where({ id: int(req.body.invoice_id), user_id: req.user.id }).first();
      if (!inv || inv.status === 'canceled') return req.backWithErrors({ invoice_id: 'فاکتور انتخاب‌شده معتبر نیست.' });
      const amount = Math.round(num(toEnDigits(String(req.body.amount || '')).replace(/[,٬\s]/g, '')));
      const errors = {};
      const remaining = Number(inv.total) - Number(inv.paid);
      if (amount <= 0) errors.amount = 'مبلغ واریزی را وارد کنید.';
      else if (amount > remaining) errors.amount = 'مبلغ واریزی بیشتر از مانده بدهی است.';
      const tracking = str(toEnDigits(req.body.tracking_code || ''), 50);
      if (!tracking) errors.tracking_code = 'شماره پیگیری / مرجع تراکنش را وارد کنید.';
      const paidDate = jalali.fromJalali(req.body.paid_date);
      if (!paidDate) errors.paid_date = 'تاریخ واریز را وارد کنید.';
      else if (paidDate > jalali.today()) errors.paid_date = 'تاریخ واریز نمی‌تواند در آینده باشد.';
      if (settings.get('finance.receipt_required', true) && !req.file) errors.receipt = 'بارگذاری تصویر رسید الزامی است.';
      const dup = tracking ? await db('payments').where({ tracking_code: tracking, invoice_id: inv.id }).whereNot('status', 'rejected').first() : null;
      if (dup) errors.tracking_code = 'رسیدی با این شماره پیگیری قبلاً ثبت شده است.';
      if (Object.keys(errors).length) {
        if (req.file) require('../../core/upload').removeFile(req.file.relPath);
        return req.backWithErrors(errors, '/panel/my/finance');
      }
      const installmentId = int(req.body.installment_id) || null;
      if (installmentId && !(await db('installments').where({ id: installmentId, invoice_id: inv.id }).first())) throw httpError(422, 'قسط نامعتبر است.');
      await require('../finance/service').addPayment({
        invoiceId: inv.id, installmentId, amount, method: 'card_to_card', status: 'pending', trackingCode: tracking,
        payerCard: str(toEnDigits(req.body.payer_card || ''), 30).replace(/\D/g, '').slice(-4) || null, payerName: str(req.body.payer_name, 100) || null,
        destAccount: str(req.body.dest_account, 100) || null, paidDate, receiptPath: req.file ? req.file.relPath : null,
        note: text(req.body.note, 500) || null, actorId: req.user.id,
      });
      require('../../core/audit').audit(req, 'portal.receipt_submit', 'invoice', inv.id, { amount, tracking });
      req.flash('success', 'رسید شما ثبت شد و پس از بررسی واحد مالی تأیید خواهد شد.');
      res.go('/panel/my/finance');
    });

    r.get('/my/invoices/:id/print', P, financeOn, async (req, res, next) => {
      const inv = await db('invoices as i').leftJoin('classes as c', 'c.id', 'i.class_id').join('users as u', 'u.id', 'i.user_id')
        .where('i.id', int(req.params.id)).where('i.user_id', req.user.id)
        .select('i.*', 'c.title as class_title', 'c.code as class_code', 'u.first_name', 'u.last_name', 'u.mobile', 'u.national_code').first();
      if (!inv) return next(httpError(404));
      const installments = await db('installments').where({ invoice_id: inv.id }).orderBy('seq');
      const payments = await db('payments').where({ invoice_id: inv.id, status: 'approved' }).orderBy('paid_date');
      res.render(path.join(__dirname, '..', 'finance', 'views', 'invoice-print.ejs'), { inv, installments, payments, cards: require('../finance/service').activeCards(), title: `فاکتور ${inv.invoice_no}` });
    });

    /* ------------------------------ مدارک ------------------------------ */
    r.get('/my/certificates', P, async (req, res, next) => {
      if (!registry.isEnabled('certificates')) return next(httpError(404));
      const list = await db('certificates as c').leftJoin('classes as cl', 'cl.id', 'c.class_id').where('c.user_id', req.user.id)
        .select('c.*', 'cl.title as class_title').orderBy('c.id', 'desc');
      res.page(v('certificates'), { title: 'مدارک من', list, canDownload: settings.get('certificates.student_download', true), breadcrumbs: [{ label: 'مدارک من' }] });
    });

    r.get('/my/certificates/:id/print', P, async (req, res, next) => {
      if (!registry.isEnabled('certificates') || !settings.get('certificates.student_download', true)) return next(httpError(404));
      const croutes = require('../certificates/routes');
      const cert = await db('certificates').where({ id: int(req.params.id), user_id: req.user.id, status: 'valid' }).first();
      if (!cert) return next(httpError(404, 'مدرک یافت نشد.'));
      await croutes.renderCertificate(req, res, cert);
    });
  },
};
