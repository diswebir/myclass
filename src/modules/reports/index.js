/**
 * ماژول گزارش‌ها — مالی، حضور و غیاب، ظرفیت کلاس‌ها و خروجی قابل چاپ
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');
const { jalaliLong, toJalali, todayJalali } = require('../../core/helpers/jalali');

router.use(requireAuth, canMiddleware('reports.view'));

/** داشبورد گزارش‌ها */
router.get('/', async (req, res, next) => {
  try {
    // گزارش مالی ماهانه (۱۲ ماه اخیر)
    const yearAgo = new Date(Date.now() - 365 * 86400000);
    const p2 = (n) => String(n).padStart(2, '0');
    const yearAgoStr = `${yearAgo.getFullYear()}-${p2(yearAgo.getMonth() + 1)}-${p2(yearAgo.getDate())}`;
    const monthly = await db.query(
      `SELECT substr(COALESCE(paid_at, created_at), 1, 7) AS ym,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END),0) AS total,
        COUNT(*) AS cnt
       FROM payments
       WHERE COALESCE(paid_at, created_at) >= ?
       GROUP BY ym ORDER BY ym`,
      [yearAgoStr]
    );

    // آمار هر کلاس
    const classStats = await db.query(
      `SELECT c.id, c.title, c.capacity, c.price, c.status,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') AS students,
        (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id = c.id) AS sessions,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.class_id = c.id AND p.status = 'paid') AS income,
        (SELECT COUNT(*) FROM certificates ce WHERE ce.class_id = c.id AND ce.status = 'issued') AS certs
       FROM classes c ORDER BY c.created_at DESC LIMIT 30`
    );

    // مطالبات (اقساط معوق)
    const receivables = await db.query(
      `SELECT u.first_name, u.last_name, u.phone, ip.title AS plan_title,
        COUNT(i.id) AS unpaid_count, COALESCE(SUM(i.amount),0) AS unpaid_sum
       FROM installments i
       JOIN installment_plans ip ON ip.id = i.plan_id
       JOIN users u ON u.id = ip.student_id
       WHERE i.status IN ('unpaid','overdue')
       GROUP BY ip.id, u.id, u.first_name, u.last_name, u.phone, ip.title
       ORDER BY unpaid_sum DESC LIMIT 30`
    );

    // بهترین دانش‌آموزان بر اساس نمره
    const topStudents = await db.query(
      `SELECT u.first_name, u.last_name, AVG(cs.final_score) AS avg_score, COUNT(*) AS classes_count
       FROM class_students cs JOIN users u ON u.id = cs.student_id
       WHERE cs.final_score IS NOT NULL
       GROUP BY u.id ORDER BY avg_score DESC LIMIT 10`
    );

    res.render('reports/index', {
      title: 'گزارش‌ها',
      page: 'reports',
      monthly,
      classStats,
      receivables,
      topStudents,
    });
  } catch (e) {
    next(e);
  }
});

/** گزارش مالی */
router.get('/financial', async (req, res, next) => {
  try {
    const from = require('../../core/helpers/jalali').jalaliToDb(req.query.from) || '2000-01-01';
    const to = require('../../core/helpers/jalali').jalaliToDb(req.query.to) || '2100-01-01';

    const rows = await db.query(
      `SELECT p.*, u.first_name, u.last_name, c.title AS class_title
       FROM payments p
       LEFT JOIN users u ON u.id = p.student_id
       LEFT JOIN classes c ON c.id = p.class_id
       WHERE date(COALESCE(p.paid_at, p.created_at)) BETWEEN ? AND ?
       ORDER BY p.created_at DESC`,
      [from, to]
    );
    const totals = await db.one(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END),0) AS pending,
        COALESCE(SUM(CASE WHEN method = 'cash' AND status = 'paid' THEN amount ELSE 0 END),0) AS cash,
        COALESCE(SUM(CASE WHEN method = 'card_to_card' AND status = 'paid' THEN amount ELSE 0 END),0) AS card
       FROM payments WHERE date(COALESCE(paid_at, created_at)) BETWEEN ? AND ?`,
      [from, to]
    );

    res.render('reports/financial', {
      title: 'گزارش مالی',
      page: 'reports',
      rows,
      totals,
      filters: { from: req.query.from || '', to: req.query.to || '' },
    });
  } catch (e) {
    next(e);
  }
});

/** گزارش حضور و غیاب کلاس */
router.get('/attendance', async (req, res, next) => {
  try {
    const classId = parseInt(req.query.class_id || '0', 10);
    const classes = await db.query("SELECT id, title FROM classes WHERE status != 'cancelled' ORDER BY title");
    let rows = [];
    if (classId) {
      rows = await db.query(
        `SELECT u.id, u.first_name, u.last_name, sp.student_code,
          COUNT(a.id) AS total,
          SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
          SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
          SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
          SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused
         FROM class_students cs
         JOIN users u ON u.id = cs.student_id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         LEFT JOIN attendance a ON a.student_id = u.id
           AND a.session_id IN (SELECT id FROM class_sessions WHERE class_id = ?)
         WHERE cs.class_id = ?
         GROUP BY u.id, u.first_name, u.last_name, sp.student_code
         ORDER BY u.last_name`,
        [classId, classId]
      );
    }
    res.render('reports/attendance', {
      title: 'گزارش حضور و غیاب',
      page: 'reports',
      rows,
      classes,
      classId,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
