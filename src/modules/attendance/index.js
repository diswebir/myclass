/**
 * ماژول حضور و غیاب — ثبت سریع، ویرایش و گزارش
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware, classScope, canAccessClass, isTeacher } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const { jalaliToDb, toJalali, jalaliLong, todayJalali } = require('../../core/helpers/jalali');
const sms = require('../../core/sms/smsService');

router.use(requireAuth);

/** لیست جلسات برای ثبت حضور و غیاب */
router.get('/', canMiddleware('attendance.view'), async (req, res, next) => {
  try {
    const scope = await classScope(req);
    const { class_id, date, status } = req.query;
    let where = '1=1';
    const params = [];

    // محدودسازی بر اساس دامنه کاربر
    if (isTeacher(req)) {
      where += ' AND c.teacher_id = ?';
      params.push(req.user.id);
    }

    if (class_id) {
      where += ' AND s.class_id = ?';
      params.push(parseInt(class_id, 10));
    }
    const dateDb = jalaliToDb(date);
    if (dateDb) {
      where += ' AND s.session_date = ?';
      params.push(dateDb);
    }
    if (status) {
      where += ' AND s.status = ?';
      params.push(status);
    } else {
      where += " AND s.status != 'cancelled'";
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT s.*, c.title AS class_title, c.id AS class_id,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') AS students_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) AS recorded_count
       FROM class_sessions s JOIN classes c ON c.id = s.class_id
       WHERE ${where}
       ORDER BY s.session_date DESC, s.start_time DESC`,
      params,
      page,
      20
    );

    const classes = await db.query(
      `SELECT c.id, c.title FROM classes c WHERE ${isTeacher(req) ? 'c.teacher_id = ?' : "c.status != 'cancelled'"}
       ORDER BY c.title`,
      isTeacher(req) ? [req.user.id] : []
    );

    res.render('attendance/list', {
      title: 'حضور و غیاب',
      page: 'attendance',
      ...result,
      classes,
      filters: { class_id: class_id || '', date: date || todayJalali(), status: status || '' },
    });
  } catch (e) {
    next(e);
  }
});

/** صفحه ثبت حضور و غیاب یک جلسه */
router.get('/session/:id', canMiddleware('attendance.view'), async (req, res, next) => {
  try {
    const session = await db.one(
      `SELECT s.*, c.title AS class_title, c.id AS class_id, c.teacher_id
       FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!session) return res.status(404).render('errors/404', { title: 'جلسه یافت نشد' });
    if (!(await canAccessClass(req, session.class_id))) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: 'شما به این کلاس دسترسی ندارید.' });
    }

    const students = await db.query(
      `SELECT cs.student_id, u.first_name, u.last_name, u.phone, sp.student_code,
        a.status AS att_status, a.note, a.id AS att_id
       FROM class_students cs
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       LEFT JOIN attendance a ON a.session_id = ? AND a.student_id = cs.student_id
       WHERE cs.class_id = ? AND cs.status = 'active'
       ORDER BY u.last_name, u.first_name`,
      [session.id, session.class_id]
    );

    res.render('attendance/record', {
      title: `حضور و غیاب — ${session.class_title}`,
      page: 'attendance',
      session,
      students,
    });
  } catch (e) {
    next(e);
  }
});

/** ذخیره حضور و غیاب (فرم گروهی) */
router.post('/session/:id', canMiddleware('attendance.manage'), async (req, res, next) => {
  try {
    const session = await db.one(
      `SELECT s.*, c.title AS class_title FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!session) return res.status(404).render('errors/404', { title: 'جلسه یافت نشد' });
    if (!(await canAccessClass(req, session.class_id))) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    }

    const b = req.body || {};
    const statuses = b.status || {};
    const notes = b.note || {};
    const valid = ['present', 'absent', 'late', 'excused'];

    await db.transaction(async (trx) => {
      for (const [studentId, st] of Object.entries(statuses)) {
        const sid = parseInt(studentId, 10);
        if (!sid || !valid.includes(st)) continue;
        const note = String(notes[studentId] || '').trim().slice(0, 255);
        const existing = await trx.one(
          'SELECT id FROM attendance WHERE session_id = ? AND student_id = ?',
          [session.id, sid]
        );
        if (existing) {
          await trx.update(
            'attendance',
            { status: st, note, recorded_by: req.user.id, recorded_at: db.now() },
            'id = ?',
            [existing.id]
          );
        } else {
          await trx.insert('attendance', {
            session_id: session.id,
            student_id: sid,
            status: st,
            note,
            recorded_by: req.user.id,
            recorded_at: db.now(),
          });
        }
        // پیامک غیبت
        if (st === 'absent' && b.send_absence_sms === '1') {
          const stu = await trx.one('SELECT * FROM users WHERE id = ?', [sid]);
          if (stu && stu.phone) {
            sms.sendEvent('absence_notice', stu.phone, {
              full_name: `${stu.first_name} ${stu.last_name}`,
              class_name: session.class_title,
              class_date: jalaliLong(session.session_date),
            }).catch(() => {});
          }
        }
      }
      await trx.update('class_sessions', { status: 'held' }, 'id = ?', [session.id]);
    });

    await audit.log(req, 'attendance.record', 'session', session.id, session.class_title);
    flash(req, 'success', 'حضور و غیاب با موفقیت ثبت شد');
    res.redirect(`/panel/attendance/session/${session.id}`);
  } catch (e) {
    next(e);
  }
});

/** گزارش حضور و غیاب دانش‌آموز */
router.get('/student/:id', canMiddleware('attendance.view'), async (req, res, next) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const student = await db.one(
      "SELECT * FROM users WHERE id = ? AND user_type = 'student'",
      [studentId]
    );
    if (!student) return res.status(404).render('errors/404', { title: 'دانش‌آموز یافت نشد' });

    const rows = await db.query(
      `SELECT a.*, s.session_date, s.topic, c.title AS class_title, c.id AS class_id
       FROM attendance a
       JOIN class_sessions s ON s.id = a.session_id
       JOIN classes c ON c.id = s.class_id
       WHERE a.student_id = ?
       ORDER BY s.session_date DESC LIMIT 100`,
      [studentId]
    );

    const summary = await db.one(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused
       FROM attendance a WHERE a.student_id = ?`,
      [studentId]
    );

    res.render('attendance/student', {
      title: `کارنامه حضور — ${student.first_name} ${student.last_name}`,
      page: 'attendance',
      student,
      rows,
      summary,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
