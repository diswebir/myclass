/**
 * ماژول مالی — پرداخت‌ها، اقساط، کارت به کارت و تایید رسید
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware, isStudent } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const { jalaliToDb, jalaliLong, toJalali, addDays, todayJalali } = require('../../core/helpers/jalali');
const { makeUploader, removeUpload } = require('../../core/uploader');
const settings = require('../../core/settings');
const sms = require('../../core/sms/smsService');

router.use(requireAuth);

/** لیست پرداخت‌ها */
router.get('/', canMiddleware('payments.view'), async (req, res, next) => {
  try {
    const { q, status, method, class_id } = req.query;
    let where = '1=1';
    const params = [];

    if (isStudent(req)) {
      where += ' AND p.student_id = ?';
      params.push(req.user.id);
    }
    if (q) {
      where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR p.tracking_code LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (method) {
      where += ' AND p.method = ?';
      params.push(method);
    }
    if (class_id) {
      where += ' AND p.class_id = ?';
      params.push(parseInt(class_id, 10));
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT p.*, u.first_name, u.last_name, u.phone, c.title AS class_title
       FROM payments p
       LEFT JOIN users u ON u.id = p.student_id
       LEFT JOIN classes c ON c.id = p.class_id
       WHERE ${where}
       ORDER BY p.created_at DESC`,
      params,
      page,
      20
    );

    const classes = await db.query("SELECT id, title FROM classes WHERE status != 'cancelled' ORDER BY title");
    const totals = await db.one(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END),0) AS pending
       FROM payments`
    );

    res.render('payments/list', {
      title: 'پرداخت‌ها',
      page: 'payments',
      ...result,
      classes,
      totals: totals || {},
      filters: { q: q || '', status: status || '', method: method || '', class_id: class_id || '' },
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ثبت پرداخت */
router.get('/create', canMiddleware('payments.manage'), async (req, res, next) => {
  try {
    const students = await db.query(
      "SELECT id, first_name, last_name, phone FROM users WHERE user_type = 'student' AND is_active = 1 ORDER BY last_name"
    );
    const classes = await db.query("SELECT id, title, price FROM classes WHERE status != 'cancelled' ORDER BY title");
    const cards = await settings.getJson('payment_cards', []);
    res.render('payments/form', {
      title: 'ثبت پرداخت',
      page: 'payments',
      students,
      classes,
      cards,
      payment: {},
      isEdit: false,
    });
  } catch (e) {
    next(e);
  }
});

/** ثبت پرداخت */
router.post('/', canMiddleware('payments.manage'), makeUploader('receipts', ['image', 'doc']).single('receipt_file'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = parseFloat(b.amount || '0');
    const studentId = parseInt(b.student_id, 10);
    if (!studentId || !amount || amount <= 0) {
      flash(req, 'danger', 'دانش‌آموز و مبلغ معتبر وارد کنید');
      return res.redirect('/panel/payments/create');
    }

    const now = db.now();
    const paymentId = await db.insert('payments', {
      student_id: studentId,
      class_id: b.class_id ? parseInt(b.class_id, 10) : null,
      plan_id: b.plan_id ? parseInt(b.plan_id, 10) : null,
      installment_id: b.installment_id ? parseInt(b.installment_id, 10) : null,
      amount,
      method: ['cash', 'card_to_card', 'online', 'other'].includes(b.method) ? b.method : 'cash',
      status: 'paid',
      receipt_file: req.file ? `receipts/${req.file.filename}` : '',
      tracking_code: String(b.tracking_code || '').trim(),
      bank_name: String(b.bank_name || '').trim(),
      card_number: String(b.card_number || '').trim(),
      paid_at: jalaliToDb(b.paid_date) ? jalaliToDb(b.paid_date) + ' ' + now.slice(11) : now,
      description: String(b.description || '').trim(),
      verified_by: req.user.id,
      verified_at: now,
      created_by: req.user.id,
      created_at: now,
    });

    // اگر مربوط به قسط بود، قسط را پرداخت‌شده کن
    if (b.installment_id) {
      await db.update(
        'installments',
        { status: 'paid', paid_at: now, payment_id: paymentId },
        'id = ?',
        [parseInt(b.installment_id, 10)]
      );
      await checkPlanCompletion(parseInt(b.plan_id || '0', 10));
    }

    // پیامک رسید
    const student = await db.one('SELECT * FROM users WHERE id = ?', [studentId]);
    const cls = b.class_id ? await db.one('SELECT title FROM classes WHERE id = ?', [b.class_id]) : null;
    if (student && student.phone) {
      sms.sendEvent('payment_received', student.phone, {
        full_name: `${student.first_name} ${student.last_name}`,
        amount: require('../../core/helpers/format').numberFa(amount),
        tracking_code: b.tracking_code || '—',
        class_name: cls ? cls.title : '',
      }).catch(() => {});
    }

    await audit.log(req, 'payment.create', 'payment', paymentId, `${amount} برای ${student ? student.first_name : ''}`);
    flash(req, 'success', 'پرداخت با موفقیت ثبت شد');
    res.redirect('/panel/payments');
  } catch (e) {
    next(e);
  }
});

async function checkPlanCompletion(planId) {
  if (!planId) return;
  const unpaid = await db.one(
    "SELECT COUNT(*) AS c FROM installments WHERE plan_id = ? AND status != 'paid'",
    [planId]
  );
  if (Number(unpaid.c) === 0) {
    await db.update('installment_plans', { status: 'completed' }, 'id = ?', [planId]);
  }
}

/** جزئیات پرداخت */
router.get('/:id', canMiddleware('payments.view'), async (req, res, next) => {
  try {
    const payment = await db.one(
      `SELECT p.*, u.first_name, u.last_name, u.phone, c.title AS class_title,
        v.first_name AS v_first, v.last_name AS v_last
       FROM payments p
       LEFT JOIN users u ON u.id = p.student_id
       LEFT JOIN classes c ON c.id = p.class_id
       LEFT JOIN users v ON v.id = p.verified_by
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!payment) return res.status(404).render('errors/404', { title: 'پرداخت یافت نشد' });
    if (isStudent(req) && payment.student_id !== req.user.id) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    }
    res.render('payments/detail', { title: 'جزئیات پرداخت', page: 'payments', payment });
  } catch (e) {
    next(e);
  }
});

/** تایید / رد پرداخت کارت به کارت */
router.post('/:id/verify', canMiddleware('payments.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const p = await db.one('SELECT * FROM payments WHERE id = ?', [id]);
    if (!p) return res.status(404).render('errors/404', { title: 'پرداخت یافت نشد' });

    const status = req.body.status === 'rejected' ? 'rejected' : 'paid';
    await db.update(
      'payments',
      { status, verified_by: req.user.id, verified_at: db.now() },
      'id = ?',
      [id]
    );

    if (status === 'paid' && p.installment_id) {
      await db.update('installments', { status: 'paid', paid_at: db.now(), payment_id: id }, 'id = ?', [p.installment_id]);
      await checkPlanCompletion(p.plan_id);
    }

    const student = await db.one('SELECT * FROM users WHERE id = ?', [p.student_id]);
    if (student && student.phone && status === 'paid') {
      sms.sendEvent('payment_received', student.phone, {
        full_name: `${student.first_name} ${student.last_name}`,
        amount: require('../../core/helpers/format').numberFa(p.amount),
        tracking_code: p.tracking_code || '—',
        class_name: '',
      }).catch(() => {});
    }

    await audit.log(req, 'payment.verify', 'payment', id, status);
    flash(req, status === 'paid' ? 'success' : 'warning', status === 'paid' ? 'پرداخت تایید شد' : 'پرداخت رد شد');
    res.redirect(`/panel/payments/${id}`);
  } catch (e) {
    next(e);
  }
});

// ── اقساط ──────────────────────────────────────────

/** لیست طرح‌های اقساط */
router.get('/installments/plans', canMiddleware('payments.view'), async (req, res, next) => {
  try {
    let where = '1=1';
    const params = [];
    if (isStudent(req)) {
      where += ' AND ip.student_id = ?';
      params.push(req.user.id);
    }
    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT ip.*, u.first_name, u.last_name, c.title AS class_title,
        (SELECT COUNT(*) FROM installments i WHERE i.plan_id = ip.id) AS total_inst,
        (SELECT COUNT(*) FROM installments i WHERE i.plan_id = ip.id AND i.status = 'paid') AS paid_inst,
        (SELECT COALESCE(SUM(i.amount),0) FROM installments i WHERE i.plan_id = ip.id AND i.status = 'paid') AS paid_amount
       FROM installment_plans ip
       JOIN users u ON u.id = ip.student_id
       LEFT JOIN classes c ON c.id = ip.class_id
       WHERE ${where}
       ORDER BY ip.created_at DESC`,
      params,
      page,
      15
    );
    res.render('payments/plans', { title: 'طرح‌های اقساط', page: 'payments', ...result });
  } catch (e) {
    next(e);
  }
});

/** ساخت طرح اقساط */
router.post('/installments/plans', canMiddleware('payments.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const studentId = parseInt(b.student_id, 10);
    const total = parseFloat(b.total_amount || '0');
    const count = parseInt(b.installments_count || '1', 10);
    const interval = parseInt(b.interval_days || (await settings.get('installment_interval_days', '30')), 10);
    const startDue = jalaliToDb(b.start_due_date) || db.today();

    if (!studentId || !total || count < 1) {
      flash(req, 'danger', 'اطلاعات طرح اقساط معتبر نیست');
      return res.redirect('/panel/payments/installments/plans');
    }

    const now = db.now();
    const planId = await db.insert('installment_plans', {
      student_id: studentId,
      class_id: b.class_id ? parseInt(b.class_id, 10) : null,
      title: String(b.title || '').trim() || `طرح اقساط ${jalaliLong(startDue)}`,
      total_amount: total,
      installments_count: count,
      start_due_date: startDue,
      status: 'active',
      created_by: req.user.id,
      created_at: now,
    });

    const per = Math.floor(total / count);
    let remaining = total;
    for (let i = 1; i <= count; i++) {
      const amount = i === count ? remaining : per;
      remaining -= amount;
      const due = addDays(new Date(startDue), (i - 1) * interval);
      const p = (n) => String(n).padStart(2, '0');
      const dueStr = `${due.getFullYear()}-${p(due.getMonth() + 1)}-${p(due.getDate())}`;
      await db.insert('installments', {
        plan_id: planId,
        installment_no: i,
        amount,
        due_date: dueStr,
        status: 'unpaid',
      });
    }

    await audit.log(req, 'payment.plan_create', 'plan', planId, `طرح ${count} قسطه`);
    flash(req, 'success', `طرح اقساط با ${count} قسط ساخته شد`);
    res.redirect('/panel/payments/installments/plans');
  } catch (e) {
    next(e);
  }
});

/** جزئیات طرح اقساط */
router.get('/installments/plans/:id', canMiddleware('payments.view'), async (req, res, next) => {
  try {
    const plan = await db.one(
      `SELECT ip.*, u.first_name, u.last_name, u.phone, c.title AS class_title
       FROM installment_plans ip
       JOIN users u ON u.id = ip.student_id
       LEFT JOIN classes c ON c.id = ip.class_id
       WHERE ip.id = ?`,
      [req.params.id]
    );
    if (!plan) return res.status(404).render('errors/404', { title: 'طرح یافت نشد' });
    if (isStudent(req) && plan.student_id !== req.user.id) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    }
    const installments = await db.query(
      'SELECT * FROM installments WHERE plan_id = ? ORDER BY installment_no',
      [plan.id]
    );
    res.render('payments/plan-detail', {
      title: plan.title,
      page: 'payments',
      plan,
      installments,
    });
  } catch (e) {
    next(e);
  }
});

/** ثبت پرداخت قسط */
router.post('/installments/:id/pay', canMiddleware('payments.manage'), async (req, res, next) => {
  try {
    const inst = await db.one('SELECT * FROM installments WHERE id = ?', [req.params.id]);
    if (!inst) return res.status(404).render('errors/404', { title: 'قسط یافت نشد' });
    const plan = await db.one('SELECT * FROM installment_plans WHERE id = ?', [inst.plan_id]);

    const now = db.now();
    const method = ['cash', 'card_to_card', 'online', 'other'].includes(req.body.method) ? req.body.method : 'cash';
    const paymentId = await db.insert('payments', {
      student_id: plan.student_id,
      class_id: plan.class_id,
      plan_id: plan.id,
      installment_id: inst.id,
      amount: inst.amount,
      method,
      status: 'paid',
      tracking_code: String(req.body.tracking_code || '').trim(),
      paid_at: now,
      description: `قسط شماره ${inst.installment_no} — ${plan.title}`,
      verified_by: req.user.id,
      verified_at: now,
      created_by: req.user.id,
      created_at: now,
    });

    await db.update('installments', { status: 'paid', paid_at: now, payment_id: paymentId }, 'id = ?', [inst.id]);
    await checkPlanCompletion(plan.id);

    const student = await db.one('SELECT * FROM users WHERE id = ?', [plan.student_id]);
    if (student && student.phone) {
      sms.sendEvent('payment_received', student.phone, {
        full_name: `${student.first_name} ${student.last_name}`,
        amount: require('../../core/helpers/format').numberFa(inst.amount),
        tracking_code: req.body.tracking_code || '—',
        class_name: plan.title,
      }).catch(() => {});
    }

    await audit.log(req, 'payment.installment_pay', 'installment', inst.id, '');
    flash(req, 'success', 'قسط پرداخت شد');
    res.redirect(`/panel/payments/installments/plans/${plan.id}`);
  } catch (e) {
    next(e);
  }
});

/** یادآوری پیامکی سررسید قسط‌ها */
router.post('/installments/remind', canMiddleware('payments.manage'), async (req, res, next) => {
  try {
    const days = parseInt(req.body.days || '3', 10);
    const future = addDays(new Date(), days);
    const p = (n) => String(n).padStart(2, '0');
    const futureStr = `${future.getFullYear()}-${p(future.getMonth() + 1)}-${p(future.getDate())}`;
    const rows = await db.query(
      `SELECT i.*, ip.title AS plan_title, ip.class_id, u.first_name, u.last_name, u.phone,
        c.title AS class_title
       FROM installments i
       JOIN installment_plans ip ON ip.id = i.plan_id
       JOIN users u ON u.id = ip.student_id
       LEFT JOIN classes c ON c.id = ip.class_id
       WHERE i.status = 'unpaid' AND i.due_date <= ? AND u.phone != ''`,
      [futureStr]
    );

    let sent = 0;
    for (const r of rows) {
      await sms.sendEvent('installment_due', r.phone, {
        full_name: `${r.first_name} ${r.last_name}`,
        amount: require('../../core/helpers/format').numberFa(r.amount),
        due_date: jalaliLong(r.due_date),
        class_name: r.class_title || r.plan_title,
      });
      sent++;
    }
    await audit.log(req, 'payment.remind', 'installment', '', `${sent} یادآوری`);
    flash(req, 'success', `${sent} پیامک یادآوری ارسال شد`);
    res.redirect('/panel/payments/installments/plans');
  } catch (e) {
    next(e);
  }
});

/** ثبت پرداخت دانش‌آموز (کارت به کارت با رسید) — از پنل دانش‌آموز */
router.post('/submit-receipt', isStudentGate(), makeUploader('receipts', ['image', 'doc']).single('receipt_file'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = parseFloat(b.amount || '0');
    if (!amount || !req.file) {
      flash(req, 'danger', 'مبلغ و تصویر رسید الزامی است');
      return res.redirect('/portal/payments');
    }
    await db.insert('payments', {
      student_id: req.user.id,
      class_id: b.class_id ? parseInt(b.class_id, 10) : null,
      amount,
      method: 'card_to_card',
      status: 'pending',
      receipt_file: `receipts/${req.file.filename}`,
      tracking_code: String(b.tracking_code || '').trim(),
      bank_name: String(b.bank_name || '').trim(),
      card_number: String(b.card_number || '').trim(),
      description: String(b.description || '').trim(),
      created_by: req.user.id,
      created_at: db.now(),
    });
    await audit.log(req, 'payment.receipt_submit', 'payment', '', `${amount}`);
    flash(req, 'success', 'رسید پرداخت ثبت شد و پس از تایید نهایی می‌شود');
    res.redirect('/portal/payments');
  } catch (e) {
    next(e);
  }
});

function isStudentGate() {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    next();
  };
}

module.exports = router;
