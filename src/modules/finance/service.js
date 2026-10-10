'use strict';
/**
 * سرویس مالی: صدور فاکتور، تولید اقساط، ثبت پرداخت و تخصیص به اقساط
 * همه عملیات مالی داخل تراکنش پایگاه داده انجام می‌شوند تا یکپارچگی داده حفظ شود.
 */
const { db, insertId } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { httpError } = require('../../core/utils');

async function nextInvoiceNo(trx) {
  const prefix = settings.get('finance.invoice_prefix', 'INV-');
  const jy = jalali.toJalaliParts(jalali.today()).jy;
  const like = `${prefix}${jy}-%`;
  const last = await (trx || db)('invoices').where('invoice_no', 'like', like).orderBy('id', 'desc').first();
  let n = 1;
  if (last) n = (parseInt(String(last.invoice_no).split('-').pop(), 10) || 0) + 1;
  let no = `${prefix}${jy}-${String(n).padStart(5, '0')}`;
  while (await (trx || db)('invoices').where('invoice_no', no).first()) { n++; no = `${prefix}${jy}-${String(n).padStart(5, '0')}`; }
  return no;
}

/** تولید جدول اقساط */
function buildSchedule({ total, count, downPayment = 0, firstDue, intervalMonths = 1, intervalDays = 0 }) {
  const roundTo = Math.max(1, Number(settings.get('finance.round_to', 1000)));
  const rows = [];
  const today = jalali.today();
  count = Math.max(1, Math.min(48, Number(count) || 1));
  downPayment = Math.max(0, Math.min(total, Math.round(downPayment)));
  if (downPayment > 0 && count > 1) {
    rows.push({ amount: downPayment, due_date: today });
    count -= 1;
  }
  const remaining = total - (rows[0] ? rows[0].amount : 0);
  const each = Math.floor(remaining / count / roundTo) * roundTo || Math.floor(remaining / count);
  let due = firstDue || (rows.length ? (intervalDays ? jalali.addDays(today, intervalDays) : jalali.addJalaliMonths(today, intervalMonths)) : today);
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? remaining - each * (count - 1) : each;
    rows.push({ amount, due_date: due });
    due = intervalDays ? jalali.addDays(due, intervalDays) : jalali.addJalaliMonths(due, intervalMonths);
  }
  return rows.map((r, i) => Object.assign(r, { seq: i + 1 }));
}

/**
 * صدور فاکتور
 * @param {object} p { userId, classId, enrollmentId, title, amount, discount, paymentType: cash|installment, installments, downPayment, firstDue, schedule, notes, actorId }
 */
async function createInvoice(p) {
  const amount = Math.max(0, Math.round(Number(p.amount) || 0));
  const discount = Math.max(0, Math.min(amount, Math.round(Number(p.discount) || 0)));
  const total = amount - discount;
  if (total < 0) throw httpError(422, 'مبلغ فاکتور نامعتبر است.');
  const type = p.paymentType === 'installment' ? 'installment' : 'cash';
  let schedule;
  if (Array.isArray(p.schedule) && p.schedule.length) {
    schedule = p.schedule.map((s, i) => ({ seq: i + 1, amount: Math.round(Number(s.amount) || 0), due_date: s.due_date || jalali.today() }));
    const sum = schedule.reduce((a, b) => a + b.amount, 0);
    if (sum !== total) throw httpError(422, `جمع مبالغ اقساط (${sum.toLocaleString()}) با مبلغ قابل پرداخت (${total.toLocaleString()}) برابر نیست.`);
  } else if (type === 'installment') {
    const count = Math.min(Number(settings.get('finance.max_installments', 6)) || 6, Math.max(2, Number(p.installments) || 2));
    schedule = buildSchedule({
      total, count, downPayment: p.downPayment, firstDue: p.firstDue,
      intervalMonths: Number(settings.get('finance.installment_interval', 1)) || 1,
    });
  } else {
    schedule = [{ seq: 1, amount: total, due_date: p.dueDate || jalali.today() }];
  }

  const now = jalali.now();
  let title = p.title;
  if (!title && p.classId) {
    const cls = await db('classes').where({ id: p.classId }).first();
    title = cls ? `شهریه کلاس ${cls.title}` : 'شهریه';
  }
  const id = await db.transaction(async (trx) => {
    const invoiceNo = await nextInvoiceNo(trx);
    const iid = await insertId('invoices', {
      invoice_no: invoiceNo, user_id: p.userId, class_id: p.classId || null, enrollment_id: p.enrollmentId || null,
      title: String(title || 'فاکتور').slice(0, 191), amount, discount, total, paid: 0, payment_type: type,
      status: total === 0 ? 'paid' : 'unpaid', issue_date: jalali.today(), due_date: schedule[schedule.length - 1].due_date,
      notes: p.notes || null, created_by: p.actorId || null, created_at: now, updated_at: now,
    }, trx);
    for (const s of schedule) {
      await trx('installments').insert({ invoice_id: iid, seq: s.seq, amount: s.amount, paid_amount: 0, due_date: s.due_date, status: s.amount === 0 ? 'paid' : 'pending' });
    }
    return iid;
  });
  if (p.notify !== false) events.emit('invoice.created', { invoiceId: id });
  return id;
}

/** محاسبه مجدد مبلغ پرداختی و وضعیت فاکتور و اقساط (تخصیص به ترتیب سررسید) */
async function recalc(invoiceId, trx) {
  const q = trx || db;
  const inv = await q('invoices').where({ id: invoiceId }).first();
  if (!inv) return;
  const paidRow = await q('payments').where({ invoice_id: invoiceId, status: 'approved' }).sum({ s: 'amount' }).first();
  const paid = Number((paidRow && paidRow.s) || 0);
  let pool = paid;
  const today = jalali.today();
  const items = await q('installments').where({ invoice_id: invoiceId }).orderBy('seq');
  for (const it of items) {
    const amt = Number(it.amount);
    const take = Math.min(amt, pool);
    pool -= take;
    let status = 'pending';
    if (take >= amt) status = 'paid';
    else if (String(it.due_date).slice(0, 10) < today) status = 'overdue';
    else if (take > 0) status = 'partial';
    const upd = { paid_amount: take, status };
    if (status === 'paid' && !it.paid_at) upd.paid_at = jalali.now();
    if (status !== 'paid') upd.paid_at = null;
    await q('installments').where({ id: it.id }).update(upd);
  }
  let status = inv.status === 'canceled' ? 'canceled' : (paid >= Number(inv.total) ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
  if (Number(inv.total) === 0 && status !== 'canceled') status = 'paid';
  await q('invoices').where({ id: invoiceId }).update({ paid, status, updated_at: jalali.now() });
  return { paid, status };
}

/** ثبت پرداخت */
async function addPayment(p) {
  const inv = await db('invoices').where({ id: p.invoiceId }).first();
  if (!inv) throw httpError(404, 'فاکتور یافت نشد.');
  if (inv.status === 'canceled') throw httpError(422, 'فاکتور باطل شده است.');
  const amount = Math.round(Number(p.amount) || 0);
  if (amount <= 0) throw httpError(422, 'مبلغ پرداخت باید بیشتر از صفر باشد.');
  const now = jalali.now();
  const status = p.status || 'approved';
  const id = await db.transaction(async (trx) => {
    const pid = await insertId('payments', {
      invoice_id: inv.id, installment_id: p.installmentId || null, user_id: inv.user_id, amount, method: p.method || 'cash', status,
      tracking_code: p.trackingCode || null, payer_card: p.payerCard || null, payer_name: p.payerName || null, dest_account: p.destAccount || null,
      paid_date: p.paidDate || jalali.today(), receipt_path: p.receiptPath || null, note: p.note || null,
      created_by: p.actorId || null, reviewed_by: status === 'approved' ? p.actorId || null : null, reviewed_at: status === 'approved' ? now : null,
      created_at: now, updated_at: now,
    }, trx);
    if (status === 'approved') await recalc(inv.id, trx);
    return pid;
  });
  if (status === 'approved' && p.notify !== false) events.emit('payment.approved', { paymentId: id });
  if (status === 'pending') events.emit('payment.submitted', { paymentId: id });
  return id;
}

async function reviewPayment(paymentId, approve, { actorId, reason } = {}) {
  const pay = await db('payments').where({ id: paymentId }).first();
  if (!pay) throw httpError(404, 'پرداخت یافت نشد.');
  if (pay.status !== 'pending') throw httpError(422, 'این پرداخت قبلاً بررسی شده است.');
  const now = jalali.now();
  await db.transaction(async (trx) => {
    await trx('payments').where({ id: paymentId }).update({
      status: approve ? 'approved' : 'rejected', reviewed_by: actorId, reviewed_at: now, reject_reason: approve ? null : (reason || null), updated_at: now,
    });
    await recalc(pay.invoice_id, trx);
  });
  events.emit(approve ? 'payment.approved' : 'payment.rejected', { paymentId, reason });
}

/** بارگذاری اطلاعات کامل پرداخت برای پیامک و نمایش */
async function paymentContext(paymentId) {
  const payment = await db('payments').where({ id: paymentId }).first();
  if (!payment) return null;
  const invoice = await db('invoices').where({ id: payment.invoice_id }).first();
  const user = await db('users').where({ id: payment.user_id }).first();
  const cls = invoice.class_id ? await db('classes').where({ id: invoice.class_id }).first() : null;
  return { payment, invoice, user, cls };
}

function activeCards() {
  const cards = settings.get('finance.cards', []) || [];
  return cards.filter((c) => c && c.card_number && c.active !== false);
}

module.exports = { createInvoice, buildSchedule, recalc, addPayment, reviewPayment, paymentContext, nextInvoiceNo, activeCards };
