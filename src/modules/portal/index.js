/**
 * ماژول پنل کاربری — دانش‌آموز و استاد
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { isStudent, isTeacher, canAccessClass, canAccessStudent } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const { jalaliLong, toJalali, todayJalali } = require('../../core/helpers/jalali');
const settings = require('../../core/settings');
const QRCode = require('qrcode');

router.use(requireAuth);

/** داشبورد پنل کاربری */
router.get('/', async (req, res, next) => {
  try {
    const today = db.today();

    if (isTeacher(req)) {
      const classes = await db.query(
        `SELECT c.*,
          (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') AS students_count,
          (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id = c.id) AS sessions_count
         FROM classes c WHERE c.teacher_id = ? AND c.status != 'cancelled' ORDER BY c.start_date DESC`,
        [req.user.id]
      );
      const nextSessions = await db.query(
        `SELECT s.*, c.title AS class_title FROM class_sessions s
         JOIN classes c ON c.id = s.class_id
         WHERE c.teacher_id = ? AND s.session_date >= ? AND s.status = 'scheduled'
         ORDER BY s.session_date, s.start_time LIMIT 8`,
        [req.user.id, today]
      );
      return res.render('portal/teacher', {
        title: 'پنل استاد',
        page: 'portal',
        classes,
        nextSessions,
      });
    }

    // دانش‌آموز
    const classes = await db.query(
      `SELECT cs.*, c.title, c.code, c.start_date, c.end_date, c.start_time, c.end_time, c.status AS class_status,
        u.first_name AS t_first, u.last_name AS t_last,
        (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id = c.id) AS sessions_total,
        (SELECT COUNT(*) FROM attendance a JOIN class_sessions s2 ON s2.id = a.session_id
          WHERE s2.class_id = c.id AND a.student_id = ? AND a.status IN ('present','late')) AS sessions_present
       FROM class_students cs
       JOIN classes c ON c.id = cs.class_id
       LEFT JOIN users u ON u.id = c.teacher_id
       WHERE cs.student_id = ? ORDER BY cs.enrolled_at DESC`,
      [req.user.id, req.user.id]
    );

    const nextSessions = await db.query(
      `SELECT s.*, c.title AS class_title FROM class_sessions s
       JOIN classes c ON c.id = s.class_id
       WHERE s.class_id IN (SELECT class_id FROM class_students WHERE student_id = ?)
         AND s.session_date >= ? AND s.status = 'scheduled'
       ORDER BY s.session_date, s.start_time LIMIT 8`,
      [req.user.id, today]
    );

    const finance = await db.one(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END),0) AS pending
       FROM payments WHERE student_id = ?`,
      [req.user.id]
    );

    const unpaidInstallments = await db.query(
      `SELECT i.*, ip.title AS plan_title FROM installments i
       JOIN installment_plans ip ON ip.id = i.plan_id
       WHERE ip.student_id = ? AND i.status IN ('unpaid','overdue')
       ORDER BY i.due_date LIMIT 8`,
      [req.user.id]
    );

    const certs = await db.query(
      `SELECT ce.*, c.title AS class_title FROM certificates ce
       JOIN classes c ON c.id = ce.class_id
       WHERE ce.student_id = ? AND ce.status = 'issued' ORDER BY ce.created_at DESC`,
      [req.user.id]
    );

    res.render('portal/student', {
      title: 'پنل من',
      page: 'portal',
      classes,
      nextSessions,
      finance,
      unpaidInstallments,
      certs,
    });
  } catch (e) {
    next(e);
  }
});

/** جزئیات کلاس من */
router.get('/classes/:id', async (req, res, next) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!(await canAccessClass(req, classId))) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: 'شما به این کلاس دسترسی ندارید.' });
    }
    const cls = await db.one(
      `SELECT c.*, u.first_name AS t_first, u.last_name AS t_last
       FROM classes c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = ?`,
      [classId]
    );

    const sessions = await db.query(
      `SELECT s.*,
        a.status AS my_status
       FROM class_sessions s
       LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = ?
       WHERE s.class_id = ? ORDER BY s.session_date`,
      [req.user.id, classId]
    );

    let classmates = [];
    if (isTeacher(req)) {
      classmates = await db.query(
        `SELECT u.first_name, u.last_name, u.phone, sp.student_code, cs.final_score
         FROM class_students cs JOIN users u ON u.id = cs.student_id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE cs.class_id = ? ORDER BY u.last_name`,
        [classId]
      );
    }

    res.render('portal/class', {
      title: cls.title,
      page: 'portal',
      cls,
      sessions,
      classmates,
    });
  } catch (e) {
    next(e);
  }
});

/** مالی من */
router.get('/payments', async (req, res, next) => {
  try {
    const payments = await db.query(
      `SELECT p.*, c.title AS class_title FROM payments p
       LEFT JOIN classes c ON c.id = p.class_id
       WHERE p.student_id = ? ORDER BY p.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const plans = await db.query(
      `SELECT ip.*, c.title AS class_title,
        (SELECT COUNT(*) FROM installments i WHERE i.plan_id = ip.id AND i.status = 'paid') AS paid_count
       FROM installment_plans ip LEFT JOIN classes c ON c.id = ip.class_id
       WHERE ip.student_id = ? ORDER BY ip.created_at DESC`,
      [req.user.id]
    );
    const cards = await settings.getJson('payment_cards', []);
    res.render('portal/payments', {
      title: 'امور مالی من',
      page: 'portal',
      payments,
      plans,
      cards,
    });
  } catch (e) {
    next(e);
  }
});

/** جزئیات طرح اقساط من */
router.get('/installments/:id', async (req, res, next) => {
  try {
    const plan = await db.one(
      'SELECT * FROM installment_plans WHERE id = ? AND student_id = ?',
      [req.params.id, req.user.id]
    );
    if (!plan) return res.status(404).render('errors/404', { title: 'طرح یافت نشد' });
    const installments = await db.query(
      'SELECT * FROM installments WHERE plan_id = ? ORDER BY installment_no',
      [plan.id]
    );
    res.render('portal/installments', {
      title: plan.title,
      page: 'portal',
      plan,
      installments,
    });
  } catch (e) {
    next(e);
  }
});

/** مدارک من */
router.get('/certificates', async (req, res, next) => {
  try {
    const certs = await db.query(
      `SELECT ce.*, c.title AS class_title FROM certificates ce
       JOIN classes c ON c.id = ce.class_id
       WHERE ce.student_id = ? ORDER BY ce.created_at DESC`,
      [req.user.id]
    );
    res.render('portal/certificates', {
      title: 'مدارک من',
      page: 'portal',
      certs,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
