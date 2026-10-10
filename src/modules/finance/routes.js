'use strict';
const path = require('path');
const fs = require('fs');
const { db, paginate } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { requirePerm, can, scopeClassIds, applyClassScope, assertClassAccess } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { filePath } = require('../../core/upload');
const { str, text, int, num, bool, httpError, sendCsv, toEnDigits } = require('../../core/utils');
const svc = require('./service');

const v = (name) => path.join(__dirname, 'views', name);
const METHODS = ['cash', 'card_to_card', 'pos', 'bank_transfer', 'online', 'cheque', 'other'];

/** محدود کردن فاکتورها به کلاس‌های در محدوده کاربر */
async function scoped(req, qb, col = 'i.class_id') {
  const ids = await scopeClassIds(req);
  if (ids !== null) qb.whereIn(col, ids.length ? ids : [-1]);
  // توجه: سازنده کوئری را برنمی‌گردانیم تا await آن را اجرا نکند
}

async function loadInvoice(req, id) {
  const inv = await db('invoices as i').join('users as u', 'u.id', 'i.user_id').leftJoin('classes as c', 'c.id', 'i.class_id')
    .select('i.*', 'u.first_name', 'u.last_name', 'u.mobile', 'u.national_code', 'u.father_name', 'c.title as class_title', 'c.code as class_code')
    .where('i.id', id).first();
  if (!inv) throw httpError(404, 'فاکتور یافت نشد.');
  const ids = await scopeClassIds(req);
  if (ids !== null && !ids.includes(Number(inv.class_id))) throw httpError(403);
  return inv;
}

function monthly(rows, dateKey, valueKey, months) {
  const map = {};
  rows.forEach((r) => { const k = jalali.jalaliMonthKey(r[dateKey]); if (k) map[k] = (map[k] || 0) + Number(valueKey ? r[valueKey] : 1); });
  return months.map((m) => map[m.key] || 0);
}

module.exports = (r) => {
  /* ------------------------------ داشبورد مالی ------------------------------ */
  r.get('/finance', requirePerm('finance.reports'), async (req, res) => {
    const months = jalali.lastJalaliMonths(12);
    const from = months[0].start;
    const payQ = db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('p.status', 'approved').where('p.paid_date', '>=', from).select('p.paid_date', 'p.amount', 'p.method');
    await scoped(req, payQ);
    const payments = await payQ;
    const invQ = db('invoices as i').whereNot('i.status', 'canceled').where('i.issue_date', '>=', from).select('i.issue_date', 'i.total');
    await scoped(req, invQ);
    const invoices = await invQ;
    const revenue = monthly(payments, 'paid_date', 'amount', months);
    const billed = monthly(invoices, 'issue_date', 'total', months);
    const methods = {};
    payments.forEach((p) => { methods[p.method] = (methods[p.method] || 0) + Number(p.amount); });

    const totQ = db('invoices as i').whereNot('i.status', 'canceled').sum({ total: 'i.total' }).sum({ paid: 'i.paid' }).sum({ discount: 'i.discount' }).first();
    await scoped(req, totQ);
    const tot = await totQ;
    const cur = jalali.currentJalaliMonthRange();
    const monthPayQ = db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('p.status', 'approved').whereBetween('p.paid_date', [cur.start, cur.end]).sum({ s: 'p.amount' }).first();
    await scoped(req, monthPayQ);
    const overdueQ = db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').whereNot('i.status', 'canceled')
      .whereIn('it.status', ['pending', 'partial', 'overdue']).where('it.due_date', '<', jalali.today()).select(db.raw('SUM(it.amount - it.paid_amount) as s'), db.raw('COUNT(*) as c')).first();
    await scoped(req, overdueQ);
    const upcomingQ = db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').join('users as u', 'u.id', 'i.user_id')
      .leftJoin('classes as c', 'c.id', 'i.class_id').whereNot('i.status', 'canceled').whereIn('it.status', ['pending', 'partial'])
      .whereBetween('it.due_date', [jalali.today(), jalali.addDays(jalali.today(), 14)])
      .select('it.*', 'u.first_name', 'u.last_name', 'c.title as class_title', 'i.id as invoice_id').orderBy('it.due_date').limit(10);
    await scoped(req, upcomingQ);
    const byClassQ = db('invoices as i').join('classes as c', 'c.id', 'i.class_id').whereNot('i.status', 'canceled')
      .groupBy('c.id', 'c.title').select('c.title').sum({ total: 'i.total' }).sum({ paid: 'i.paid' }).orderBy('total', 'desc').limit(8);
    await scoped(req, byClassQ);
    const pendingQ = db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('p.status', 'pending').count({ c: '*' }).first();
    await scoped(req, pendingQ);
    const overdue = await overdueQ;
    res.page(v('dashboard'), {
      title: 'داشبورد مالی',
      months, revenue, billed, methods,
      totals: { total: Number(tot.total || 0), paid: Number(tot.paid || 0), discount: Number(tot.discount || 0) },
      monthIncome: Number((await monthPayQ).s || 0), monthLabel: cur.label,
      overdue: { amount: Number(overdue.s || 0), count: Number(overdue.c || 0) },
      upcoming: await upcomingQ, byClass: await byClassQ, pendingCount: Number((await pendingQ).c),
      breadcrumbs: [{ label: 'داشبورد مالی' }],
    });
  });

  /* ------------------------------ فاکتورها ------------------------------ */
  const invoiceListQuery = async (req) => {
    const q = db('invoices as i').join('users as u', 'u.id', 'i.user_id').leftJoin('classes as c', 'c.id', 'i.class_id')
      .select('i.*', 'u.first_name', 'u.last_name', 'u.mobile', 'c.title as class_title').orderBy('i.id', 'desc');
    await scoped(req, q);
    if (req.query.status) q.where('i.status', str(req.query.status, 20));
    if (req.query.type) q.where('i.payment_type', str(req.query.type, 20));
    if (req.query.class) q.where('i.class_id', int(req.query.class));
    if (req.query.user) q.where('i.user_id', int(req.query.user));
    if (req.query.q) {
      const t = `%${toEnDigits(str(req.query.q, 100))}%`;
      q.where((w) => w.where('i.invoice_no', 'like', t).orWhere('u.first_name', 'like', t).orWhere('u.last_name', 'like', t).orWhere('u.mobile', 'like', t));
    }
    if (req.query.from) { const g = jalali.fromJalali(req.query.from); if (g) q.where('i.issue_date', '>=', g); }
    if (req.query.to) { const g = jalali.fromJalali(req.query.to); if (g) q.where('i.issue_date', '<=', g); }
    return { q };
  };

  r.get('/invoices', requirePerm('finance.view'), async (req, res) => {
    const { q } = await invoiceListQuery(req);
    const data = await paginate(q, req.query.page, settings.get('general.items_per_page', 20));
    const sums = await q.clone().clearSelect().clearOrder().sum({ total: 'i.total' }).sum({ paid: 'i.paid' }).first();
    const cq = db('classes').select('id', 'title').orderBy('id', 'desc');
    applyClassScope(cq, 'id', await scopeClassIds(req));
    res.page(v('invoices'), {
      title: 'فاکتورها', data, classes: await cq, sums: { total: Number(sums.total || 0), paid: Number(sums.paid || 0) },
      breadcrumbs: [{ label: 'فاکتورها' }],
    });
  });

  r.get('/invoices/export', requirePerm('finance.reports'), async (req, res) => {
    const rows = await (await invoiceListQuery(req)).q.limit(20000);
    sendCsv(res, `invoices-${jalali.toJalali(jalali.today(), '-')}.csv`, [
      { label: 'شماره فاکتور', key: 'invoice_no' }, { label: 'نام', value: (x) => `${x.first_name} ${x.last_name}` }, { label: 'موبایل', key: 'mobile' },
      { label: 'کلاس', key: 'class_title' }, { label: 'عنوان', key: 'title' }, { label: 'مبلغ', key: 'amount' }, { label: 'تخفیف', key: 'discount' },
      { label: 'قابل پرداخت', key: 'total' }, { label: 'پرداخت شده', key: 'paid' }, { label: 'مانده', value: (x) => Number(x.total) - Number(x.paid) },
      { label: 'نوع', value: (x) => (x.payment_type === 'installment' ? 'اقساطی' : 'نقدی') }, { label: 'وضعیت', key: 'status' },
      { label: 'تاریخ صدور', value: (x) => jalali.toJalali(x.issue_date) },
    ], rows);
  });

  r.get('/invoices/new', requirePerm('finance.invoices'), async (req, res) => {
    const cq = db('classes').whereNot('status', 'canceled').select('id', 'title', 'price').orderBy('id', 'desc');
    applyClassScope(cq, 'id', await scopeClassIds(req));
    let user = null;
    if (req.query.user) user = await db('users').where({ id: int(req.query.user) }).select('id', 'first_name', 'last_name', 'mobile').first();
    let enrollments = [];
    if (user) enrollments = await db('enrollments as e').join('classes as c', 'c.id', 'e.class_id').where('e.user_id', user.id).select('e.id', 'c.id as class_id', 'c.title', 'c.price');
    res.page(v('invoice-form'), {
      title: 'صدور فاکتور جدید', classes: await cq, student: user, enrollments, preClass: int(req.query.class) || null,
      breadcrumbs: [{ label: 'فاکتورها', href: '/panel/invoices' }, { label: 'فاکتور جدید' }],
    });
  });

  r.post('/invoices', requirePerm('finance.invoices'), async (req, res) => {
    const b = req.body;
    const userId = int(b.user_id);
    const classId = int(b.class_id) || null;
    if (!userId) return req.backWithErrors({ user_id: 'دانشجو را انتخاب کنید.' });
    if (classId) await assertClassAccess(req, classId);
    let enrollmentId = null;
    if (classId) {
      const e = await db('enrollments').where({ user_id: userId, class_id: classId }).first();
      if (e) enrollmentId = e.id;
      else if (bool(b.enroll)) enrollmentId = await require('../classes/service').enroll(classId, userId, { actorId: req.user.id });
    }
    const amount = Math.round(num(b.amount));
    if (amount <= 0) return req.backWithErrors({ amount: 'مبلغ فاکتور را وارد کنید.' });
    let schedule = null;
    if (b.payment_type === 'installment' && b.schedule) {
      const rows = Array.isArray(b.schedule) ? b.schedule : Object.values(b.schedule);
      schedule = rows.map((x) => ({ amount: Math.round(num(x.amount)), due_date: jalali.fromJalali(x.due_date) })).filter((x) => x.amount > 0);
      if (schedule.some((x) => !x.due_date)) return req.backWithErrors({ schedule: 'تاریخ سررسید یکی از اقساط معتبر نیست.' });
    }
    try {
      const id = await svc.createInvoice({
        userId, classId, enrollmentId, title: str(b.title, 191), amount, discount: Math.round(num(b.discount)),
        paymentType: b.payment_type, installments: int(b.installments_count, 2), downPayment: Math.round(num(b.down_payment)),
        schedule, notes: text(b.notes, 2000) || null, actorId: req.user.id, dueDate: jalali.fromJalali(b.due_date) || null,
        notify: bool(b.notify),
      });
      await audit(req, 'invoices.create', 'invoice', id, { user_id: userId, amount });
      req.flash('success', 'فاکتور با موفقیت صادر شد.');
      res.go(`/panel/invoices/${id}`);
    } catch (e) {
      return req.backWithErrors({ amount: e.message });
    }
  });

  r.get('/invoices/:id', requirePerm('finance.view'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    const installments = await db('installments').where({ invoice_id: inv.id }).orderBy('seq');
    const payments = await db('payments as p').leftJoin('users as r', 'r.id', 'p.reviewed_by').where('p.invoice_id', inv.id)
      .select('p.*', 'r.first_name as reviewer_first', 'r.last_name as reviewer_last').orderBy('p.id', 'desc');
    res.page(v('invoice'), {
      title: `فاکتور ${inv.invoice_no}`, inv, installments, payments, cards: svc.activeCards(),
      breadcrumbs: [{ label: 'فاکتورها', href: '/panel/invoices' }, { label: inv.invoice_no }],
    });
  });

  r.get('/invoices/:id/print', requirePerm('finance.view'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    const installments = await db('installments').where({ invoice_id: inv.id }).orderBy('seq');
    const payments = await db('payments').where({ invoice_id: inv.id, status: 'approved' }).orderBy('paid_date');
    res.render(v('invoice-print'), { title: `فاکتور ${inv.invoice_no}`, inv, installments, payments, cards: svc.activeCards() });
  });

  r.post('/invoices/:id/schedule', requirePerm('finance.invoices'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    const rows = req.body.rows ? (Array.isArray(req.body.rows) ? req.body.rows : Object.values(req.body.rows)) : [];
    const list = rows.map((x) => ({ id: int(x.id) || null, amount: Math.round(num(x.amount)), due_date: jalali.fromJalali(x.due_date) })).filter((x) => x.amount > 0);
    if (!list.length || list.some((x) => !x.due_date)) { req.flash('error', 'اطلاعات اقساط معتبر نیست.'); return res.go(`/panel/invoices/${inv.id}`); }
    const sum = list.reduce((a, b) => a + b.amount, 0);
    if (sum !== Number(inv.total)) { req.flash('error', `جمع اقساط (${sum.toLocaleString()}) باید برابر مبلغ قابل پرداخت (${Number(inv.total).toLocaleString()}) باشد.`); return res.go(`/panel/invoices/${inv.id}`); }
    list.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    await db.transaction(async (trx) => {
      await trx('payments').where({ invoice_id: inv.id }).update({ installment_id: null });
      await trx('installments').where({ invoice_id: inv.id }).del();
      for (let i = 0; i < list.length; i++) await trx('installments').insert({ invoice_id: inv.id, seq: i + 1, amount: list[i].amount, paid_amount: 0, due_date: list[i].due_date, status: 'pending' });
      await trx('invoices').where({ id: inv.id }).update({ payment_type: list.length > 1 ? 'installment' : 'cash', due_date: list[list.length - 1].due_date });
      await svc.recalc(inv.id, trx);
    });
    await audit(req, 'invoices.schedule', 'invoice', inv.id, { count: list.length });
    req.flash('success', 'جدول اقساط به‌روزرسانی شد.');
    res.go(`/panel/invoices/${inv.id}`);
  });

  r.post('/invoices/:id/discount', requirePerm('finance.invoices'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    const discount = Math.max(0, Math.min(Number(inv.amount), Math.round(num(req.body.discount))));
    const total = Number(inv.amount) - discount;
    if (total < Number(inv.paid)) { req.flash('error', 'مبلغ قابل پرداخت نمی‌تواند کمتر از مبلغ پرداخت‌شده باشد.'); return res.go(`/panel/invoices/${inv.id}`); }
    await db.transaction(async (trx) => {
      await trx('invoices').where({ id: inv.id }).update({ discount, total, updated_at: jalali.now() });
      // اصلاح آخرین اقساط پرداخت‌نشده
      let diff = total - Number(inv.total);
      const items = await trx('installments').where({ invoice_id: inv.id }).orderBy('seq', 'desc');
      for (const it of items) {
        if (diff === 0) break;
        const unpaid = Number(it.amount) - Number(it.paid_amount);
        const change = diff > 0 ? diff : -Math.min(unpaid, -diff);
        await trx('installments').where({ id: it.id }).update({ amount: Number(it.amount) + change });
        diff -= change;
      }
      await trx('installments').where({ invoice_id: inv.id }).where('amount', '<=', 0).del();
      await svc.recalc(inv.id, trx);
    });
    await audit(req, 'invoices.discount', 'invoice', inv.id, { discount });
    req.flash('success', 'تخفیف اعمال شد.');
    res.go(`/panel/invoices/${inv.id}`);
  });

  r.post('/invoices/:id/cancel', requirePerm('finance.delete'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    await db('invoices').where({ id: inv.id }).update({ status: 'canceled', notes: [inv.notes, `ابطال: ${str(req.body.reason, 200)}`].filter(Boolean).join('\n'), updated_at: jalali.now() });
    await audit(req, 'invoices.cancel', 'invoice', inv.id, { reason: req.body.reason });
    req.flash('success', 'فاکتور باطل شد.');
    res.go(`/panel/invoices/${inv.id}`);
  });

  r.post('/invoices/:id/delete', requirePerm('finance.delete'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    const p = await db('payments').where({ invoice_id: inv.id }).first();
    if (p) { req.flash('error', 'فاکتور دارای پرداخت است و قابل حذف نیست؛ می‌توانید آن را باطل کنید.'); return res.go(`/panel/invoices/${inv.id}`); }
    await db('invoices').where({ id: inv.id }).del();
    await audit(req, 'invoices.delete', 'invoice', inv.id, { invoice_no: inv.invoice_no });
    req.flash('success', 'فاکتور حذف شد.');
    res.go('/panel/invoices');
  });

  /* ------------------------------ پرداخت‌ها ------------------------------ */
  r.post('/invoices/:id/payments', requirePerm('finance.payments'), async (req, res) => {
    const inv = await loadInvoice(req, int(req.params.id));
    const b = req.body;
    const paidDate = jalali.fromJalali(b.paid_date) || jalali.today();
    try {
      const id = await svc.addPayment({
        invoiceId: inv.id, installmentId: int(b.installment_id) || null, amount: Math.round(num(b.amount)),
        method: METHODS.includes(b.method) ? b.method : 'cash', status: 'approved', trackingCode: str(b.tracking_code, 100) || null,
        payerCard: toEnDigits(str(b.payer_card, 30)) || null, destAccount: str(b.dest_account, 100) || null, paidDate,
        note: text(b.note, 1000) || null, actorId: req.user.id, notify: bool(b.notify),
      });
      await audit(req, 'payments.create', 'payment', id, { invoice_id: inv.id, amount: b.amount });
      req.flash('success', 'پرداخت ثبت شد.');
    } catch (e) { req.flash('error', e.message); }
    res.go(`/panel/invoices/${inv.id}`);
  });

  const paymentsQuery = async (req) => {
    const q = db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').join('users as u', 'u.id', 'p.user_id')
      .leftJoin('classes as c', 'c.id', 'i.class_id')
      .select('p.*', 'i.invoice_no', 'u.first_name', 'u.last_name', 'u.mobile', 'c.title as class_title').orderBy('p.id', 'desc');
    await scoped(req, q);
    if (req.query.status) q.where('p.status', str(req.query.status, 20));
    if (req.query.method) q.where('p.method', str(req.query.method, 30));
    if (req.query.class) q.where('i.class_id', int(req.query.class));
    if (req.query.from) { const g = jalali.fromJalali(req.query.from); if (g) q.where('p.paid_date', '>=', g); }
    if (req.query.to) { const g = jalali.fromJalali(req.query.to); if (g) q.where('p.paid_date', '<=', g); }
    if (req.query.q) {
      const t = `%${toEnDigits(str(req.query.q, 100))}%`;
      q.where((w) => w.where('i.invoice_no', 'like', t).orWhere('u.first_name', 'like', t).orWhere('u.last_name', 'like', t).orWhere('p.tracking_code', 'like', t).orWhere('u.mobile', 'like', t));
    }
    return { q };
  };

  r.get('/payments', requirePerm('finance.view'), async (req, res) => {
    const { q } = await paymentsQuery(req);
    const data = await paginate(q, req.query.page, settings.get('general.items_per_page', 20));
    const sum = await q.clone().clearSelect().clearOrder().where('p.status', 'approved').sum({ s: 'p.amount' }).first();
    const pq = db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('p.status', 'pending').count({ c: '*' }).first();
    await scoped(req, pq);
    const cq = db('classes').select('id', 'title').orderBy('id', 'desc');
    applyClassScope(cq, 'id', await scopeClassIds(req));
    res.page(v('payments'), {
      title: 'پرداخت‌ها', data, sum: Number(sum.s || 0), pendingCount: Number((await pq).c), classes: await cq, METHODS,
      breadcrumbs: [{ label: 'پرداخت‌ها' }],
    });
  });

  r.get('/payments/export', requirePerm('finance.reports'), async (req, res) => {
    const rows = await (await paymentsQuery(req)).q.limit(20000);
    const M = res.locals.PAYMENT_METHODS;
    sendCsv(res, `payments-${jalali.toJalali(jalali.today(), '-')}.csv`, [
      { label: 'شناسه', key: 'id' }, { label: 'فاکتور', key: 'invoice_no' }, { label: 'نام', value: (x) => `${x.first_name} ${x.last_name}` },
      { label: 'کلاس', key: 'class_title' }, { label: 'مبلغ', key: 'amount' }, { label: 'روش', value: (x) => M[x.method] || x.method },
      { label: 'وضعیت', key: 'status' }, { label: 'کد پیگیری', key: 'tracking_code' }, { label: 'تاریخ پرداخت', value: (x) => jalali.toJalali(x.paid_date) },
    ], rows);
  });

  const loadPayment = async (req, id) => {
    const p = await db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').select('p.*', 'i.class_id').where('p.id', id).first();
    if (!p) throw httpError(404, 'پرداخت یافت نشد.');
    const ids = await scopeClassIds(req);
    if (ids !== null && !ids.includes(Number(p.class_id))) throw httpError(403);
    return p;
  };

  r.post('/payments/:id/approve', requirePerm('finance.review'), async (req, res) => {
    const p = await loadPayment(req, int(req.params.id));
    await svc.reviewPayment(p.id, true, { actorId: req.user.id });
    await audit(req, 'payments.approve', 'payment', p.id, { amount: p.amount });
    req.flash('success', 'پرداخت تأیید شد.');
    res.back('/panel/payments?status=pending');
  });

  r.post('/payments/:id/reject', requirePerm('finance.review'), async (req, res) => {
    const p = await loadPayment(req, int(req.params.id));
    await svc.reviewPayment(p.id, false, { actorId: req.user.id, reason: str(req.body.reason, 255) || 'رسید نامعتبر' });
    await audit(req, 'payments.reject', 'payment', p.id, { reason: req.body.reason });
    req.flash('success', 'پرداخت رد شد.');
    res.back('/panel/payments?status=pending');
  });

  r.post('/payments/:id/delete', requirePerm('finance.delete'), async (req, res) => {
    const p = await loadPayment(req, int(req.params.id));
    await db.transaction(async (trx) => {
      await trx('payments').where({ id: p.id }).del();
      await svc.recalc(p.invoice_id, trx);
    });
    await audit(req, 'payments.delete', 'payment', p.id, { amount: p.amount, invoice_id: p.invoice_id });
    req.flash('success', 'پرداخت حذف شد.');
    res.back(`/panel/invoices/${p.invoice_id}`);
  });

  /** نمایش امن تصویر رسید (فقط برای کارشناس مالی یا صاحب رسید) */
  r.get('/payments/:id/receipt', async (req, res, next) => {
    const p = await db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').select('p.*', 'i.class_id').where('p.id', int(req.params.id)).first();
    if (!p || !p.receipt_path) return next(httpError(404));
    const owner = Number(p.user_id) === Number(req.user.id);
    if (!owner) {
      if (!can(req.user, 'finance.view')) return next(httpError(403));
      const ids = await scopeClassIds(req);
      if (ids !== null && !ids.includes(Number(p.class_id))) return next(httpError(403));
    }
    const full = filePath(p.receipt_path);
    if (!full || !fs.existsSync(full)) return next(httpError(404));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(full);
  });

  /* ------------------------------ اقساط ------------------------------ */
  r.get('/installments', requirePerm('finance.view'), async (req, res) => {
    const today = jalali.today();
    const filter = ['overdue', 'upcoming', 'paid', 'all'].includes(req.query.filter) ? req.query.filter : 'overdue';
    const q = db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').join('users as u', 'u.id', 'i.user_id')
      .leftJoin('classes as c', 'c.id', 'i.class_id').whereNot('i.status', 'canceled')
      .select('it.*', 'i.invoice_no', 'i.id as invoice_id', 'u.first_name', 'u.last_name', 'u.mobile', 'c.title as class_title', 'i.user_id');
    await scoped(req, q);
    if (filter === 'overdue') q.whereIn('it.status', ['pending', 'partial', 'overdue']).where('it.due_date', '<', today).orderBy('it.due_date');
    else if (filter === 'upcoming') q.whereIn('it.status', ['pending', 'partial']).where('it.due_date', '>=', today).orderBy('it.due_date');
    else if (filter === 'paid') q.where('it.status', 'paid').orderBy('it.paid_at', 'desc');
    else q.orderBy('it.due_date', 'desc');
    if (req.query.class) q.where('i.class_id', int(req.query.class));
    const data = await paginate(q, req.query.page, settings.get('general.items_per_page', 20));
    const sumQ = q.clone().clearSelect().clearOrder().select(db.raw('SUM(it.amount - it.paid_amount) as s')).first();
    const cq = db('classes').select('id', 'title').orderBy('id', 'desc');
    applyClassScope(cq, 'id', await scopeClassIds(req));
    res.page(v('installments'), {
      title: 'اقساط', data, filter, remaining: Number((await sumQ).s || 0), classes: await cq,
      breadcrumbs: [{ label: 'اقساط' }],
    });
  });

  r.post('/installments/:id/remind', requirePerm('finance.view'), async (req, res, next) => {
    const it = await db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').select('it.*', 'i.class_id').where('it.id', int(req.params.id)).first();
    if (!it) return next(httpError(404));
    const ids = await scopeClassIds(req);
    if (ids !== null && !ids.includes(Number(it.class_id))) return next(httpError(403));
    const today = jalali.today();
    const isOverdue = String(it.due_date).slice(0, 10) < today;
    await events.emitAsync(isOverdue ? 'installment.overdue' : 'installment.reminder', {
      installmentId: it.id, extra: isOverdue ? { days_late: jalali.diffDays(it.due_date, today) } : { days_left: jalali.diffDays(today, it.due_date) },
    });
    await db('installments').where({ id: it.id }).update({ reminded_at: jalali.now() });
    await audit(req, 'installments.remind', 'installment', it.id);
    req.flash('success', 'پیامک یادآوری ارسال شد.');
    res.back('/panel/installments');
  });
};
