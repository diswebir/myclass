/**
 * ماژول داشبورد — آمار، نمودارها و خلاصه عملیات روزانه
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware, classScope, isTeacher, isStudent } = require('../../core/rbac');
const { todayJalali, jalaliToDb, toJalali, jalaliLong } = require('../../core/helpers/jalali');

router.use(requireAuth);

/** داشبورد اصلی */
router.get('/', canMiddleware('dashboard.view'), async (req, res, next) => {
  try {
    const today = db.today();
    const monthStart = today.slice(0, 8) + '01';

    // آمار پایه
    const stats = {};
    const count = async (sql, params = []) => {
      const r = await db.one(sql, params);
      return Number(Object.values(r || {})[0] || 0);
    };

    if (isStudent(req)) {
      return res.redirect('/portal');
    }

    stats.students = isTeacher(req)
      ? await count(
          `SELECT COUNT(*) AS c FROM users WHERE user_type = 'student' AND is_active = 1
           AND id IN (SELECT cs.student_id FROM class_students cs JOIN classes c2 ON c2.id = cs.class_id WHERE c2.teacher_id = ?)`,
          [req.user.id]
        )
      : await count("SELECT COUNT(*) AS c FROM users WHERE user_type = 'student' AND is_active = 1");
    stats.classes = isTeacher(req)
      ? await count("SELECT COUNT(*) AS c FROM classes WHERE status IN ('open','in_progress') AND teacher_id = ?", [req.user.id])
      : await count("SELECT COUNT(*) AS c FROM classes WHERE status IN ('open','in_progress')");
    stats.sessionsToday = isTeacher(req)
      ? await count(
          'SELECT COUNT(*) AS c FROM class_sessions WHERE session_date = ? AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)',
          [today, req.user.id]
        )
      : await count('SELECT COUNT(*) AS c FROM class_sessions WHERE session_date = ?', [today]);
    stats.pendingEnrollments = isTeacher(req)
      ? await count(
          "SELECT COUNT(*) AS c FROM enrollments WHERE status = 'pending' AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)",
          [req.user.id]
        )
      : await count("SELECT COUNT(*) AS c FROM enrollments WHERE status = 'pending'");
    stats.monthIncome = isTeacher(req)
      ? 0
      : await count(
          "SELECT COALESCE(SUM(amount),0) AS c FROM payments WHERE status = 'paid' AND paid_at >= ?",
          [monthStart]
        );
    stats.unpaidInstallments = isTeacher(req)
      ? 0
      : await count("SELECT COUNT(*) AS c FROM installments WHERE status IN ('unpaid','overdue')");
    stats.certificates = isTeacher(req)
      ? await count(
          "SELECT COUNT(*) AS c FROM certificates WHERE status = 'issued' AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)",
          [req.user.id]
        )
      : await count("SELECT COUNT(*) AS c FROM certificates WHERE status = 'issued'");
    stats.activeTeachers = isTeacher(req)
      ? 1
      : await count("SELECT COUNT(*) AS c FROM users WHERE user_type = 'teacher' AND is_active = 1");

    // نرخ حضور ۳۰ روز اخیر
    const att = await db.one(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late
       FROM attendance a JOIN class_sessions s ON s.id = a.session_id
       WHERE s.session_date >= ?`,
      [db.today(new Date(Date.now() - 30 * 86400000))]
    );
    stats.attendanceRate =
      att && att.total > 0 ? Math.round(((Number(att.present) + Number(att.late)) / Number(att.total)) * 100) : 0;

    // جلسات امروز
    const todaySessions = await db.query(
      `SELECT s.*, c.title AS class_title, c.id AS class_id,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) AS recorded
       FROM class_sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.session_date = ?${isTeacher(req) ? ' AND c.teacher_id = ?' : ''}
       ORDER BY s.start_time`,
      isTeacher(req) ? [today, req.user.id] : [today]
    );

    // آخرین پیش‌ثبت‌نام‌ها
    const recentEnrollments = await db.query(
      `SELECT e.*, c.title AS class_title FROM enrollments e
       JOIN classes c ON c.id = e.class_id
       ${isTeacher(req) ? 'WHERE c.teacher_id = ?' : ''}
       ORDER BY e.created_at DESC LIMIT 6`,
      isTeacher(req) ? [req.user.id] : []
    );

    // نمودارها: درآمد ۶ ماه اخیر میلادی
    const incomeRows = isTeacher(req)
      ? []
      : await db.query(
          `SELECT substr(COALESCE(paid_at, created_at), 1, 7) AS ym, COALESCE(SUM(amount),0) AS total
       FROM payments WHERE status = 'paid'
       GROUP BY ym ORDER BY ym DESC LIMIT 6`
        );
    incomeRows.reverse();

    // دانش‌آموزان هر کلاس فعال
    const classFill = await db.query(
      `SELECT c.title, c.capacity,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') AS cnt
       FROM classes c WHERE c.status IN ('open','in_progress')${isTeacher(req) ? ' AND c.teacher_id = ?' : ''}
       ORDER BY cnt DESC LIMIT 8`,
      isTeacher(req) ? [req.user.id] : []
    );

    // وضعیت حضور و غیاب کلاس‌ها
    const attByClass = await db.query(
      `SELECT c.title,
        COUNT(a.id) AS total,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late
       FROM classes c
       LEFT JOIN class_sessions s ON s.class_id = c.id
       LEFT JOIN attendance a ON a.session_id = s.id
       WHERE c.status IN ('open','in_progress')${isTeacher(req) ? ' AND c.teacher_id = ?' : ''}
       GROUP BY c.id, c.title ORDER BY total DESC LIMIT 8`,
      isTeacher(req) ? [req.user.id] : []
    );

    // توزیع وضعیت پیش‌ثبت‌نام‌ها
    const enrollDist = isTeacher(req)
      ? []
      : await db.query('SELECT status, COUNT(*) AS c FROM enrollments GROUP BY status');

    res.render('dashboard/index', {
      title: 'داشبورد',
      page: 'dashboard',
      stats,
      todaySessions,
      recentEnrollments,
      charts: {
        income: incomeRows.map((r) => ({ label: toJalali(r.ym + '-01').slice(0, 7), value: Number(r.total) })),
        classFill: classFill.map((r) => ({ label: r.title, value: Number(r.cnt), max: Number(r.capacity) })),
        attByClass,
        enrollDist,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
