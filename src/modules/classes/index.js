/**
 * ماژول کلاس‌ها — تعریف کلاس، جلسات، ظرفیت، استاد و اعضای کلاس
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware, classScope, canAccessClass, isTeacher, isStudent } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const { jalaliToDb, toJalali, jalaliLong, weekdaysList, addDays, weekdayIndex, toPersianDigits } = require('../../core/helpers/jalali');
const { makeUploader, removeUpload } = require('../../core/uploader');
const sms = require('../../core/sms/smsService');

router.use(requireAuth);

/** لیست کلاس‌ها */
router.get('/', canMiddleware('classes.view'), async (req, res, next) => {
  try {
    const scope = await classScope(req);
    const { q, status, teacher } = req.query;
    let where = scope.where;
    const params = [...scope.params];

    if (q) {
      where += ' AND (c.title LIKE ? OR c.code LIKE ? OR c.category LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      where += ' AND c.status = ?';
      params.push(status);
    }
    if (teacher && !isTeacher(req)) {
      where += ' AND c.teacher_id = ?';
      params.push(teacher);
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT c.*, u.first_name AS t_first, u.last_name AS t_last,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') AS students_count
       FROM classes c LEFT JOIN users u ON u.id = c.teacher_id
       WHERE ${where}
       ORDER BY c.created_at DESC`,
      params,
      page,
      12
    );

    const teachers = await db.query(
      "SELECT id, first_name, last_name FROM users WHERE user_type = 'teacher' ORDER BY last_name"
    );

    res.render('classes/list', {
      title: 'کلاس‌ها',
      page: 'classes',
      ...result,
      q: q || '',
      status: status || '',
      teacherId: teacher || '',
      teachers,
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ایجاد */
router.get('/create', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const teachers = await db.query(
      "SELECT id, first_name, last_name FROM users WHERE user_type = 'teacher' AND is_active = 1 ORDER BY last_name"
    );
    res.render('classes/form', {
      title: 'ایجاد کلاس جدید',
      page: 'classes',
      cls: {
        days_of_week: '',
        capacity: 20,
        installments_count: parseInt((await require('../../core/settings').get('installment_default_count', '3')) || '3', 10),
        status: 'open',
        certificate_enabled: 1,
        passing_score: 10,
      },
      teachers,
      weekdays: weekdaysList(),
      isEdit: false,
    });
  } catch (e) {
    next(e);
  }
});

/** ایجاد کلاس */
router.post('/', canMiddleware('classes.manage'), makeUploader('classes', ['image']).single('image_file'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) {
      flash(req, 'danger', 'عنوان کلاس الزامی است');
      return res.redirect('/panel/classes/create');
    }
    const code = String(b.code || '').trim() || `CL-${Date.now().toString(36).toUpperCase()}`;
    const exists = await db.one('SELECT id FROM classes WHERE code = ?', [code]);
    if (exists) {
      flash(req, 'danger', 'کد کلاس تکراری است');
      return res.redirect('/panel/classes/create');
    }

    const days = Array.isArray(b.days_of_week) ? b.days_of_week.join(',') : String(b.days_of_week || '');
    const now = db.now();
    const id = await db.insert('classes', {
      code,
      title,
      description: String(b.description || '').trim(),
      category: String(b.category || '').trim(),
      level: String(b.level || '').trim(),
      teacher_id: b.teacher_id ? parseInt(b.teacher_id, 10) : null,
      capacity: parseInt(b.capacity || '20', 10),
      price: parseFloat(b.price || '0') || 0,
      installments_count: parseInt(b.installments_count || '1', 10),
      start_date: jalaliToDb(b.start_date) || null,
      end_date: jalaliToDb(b.end_date) || null,
      start_time: normalizeTime(b.start_time),
      end_time: normalizeTime(b.end_time),
      days_of_week: days,
      location: String(b.location || '').trim(),
      image_file: req.file ? `classes/${req.file.filename}` : '',
      passing_score: parseFloat(b.passing_score || '10') || 10,
      certificate_enabled: b.certificate_enabled ? 1 : 0,
      status: b.status || 'open',
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });

    await audit.log(req, 'class.create', 'class', id, title);
    flash(req, 'success', 'کلاس با موفقیت ایجاد شد');
    res.redirect(`/panel/classes/${id}`);
  } catch (e) {
    next(e);
  }
});

function normalizeTime(t) {
  if (!t) return null;
  const s = require('../../core/helpers/jalali').toEnglishDigits(String(t));
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}:00`;
}

/** جزئیات کلاس */
router.get('/:id', canMiddleware('classes.view'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessClass(req, id))) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: 'شما به این کلاس دسترسی ندارید.' });
    }
    const cls = await db.one(
      `SELECT c.*, u.first_name AS t_first, u.last_name AS t_last, u.phone AS t_phone
       FROM classes c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = ?`,
      [id]
    );
    if (!cls) return res.status(404).render('errors/404', { title: 'کلاس یافت نشد' });

    const sessions = await db.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status IN ('present','late')) AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) AS recorded_count
       FROM class_sessions s WHERE s.class_id = ? ORDER BY s.session_date, s.start_time`,
      [id]
    );

    const students = await db.query(
      `SELECT cs.*, u.first_name, u.last_name, u.phone, u.username, sp.student_code
       FROM class_students cs
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE cs.class_id = ?
       ORDER BY u.last_name, u.first_name`,
      [id]
    );

    const teachers = await db.query(
      "SELECT id, first_name, last_name FROM users WHERE user_type = 'teacher' AND is_active = 1 ORDER BY last_name"
    );

    const enrollments = await db.query(
      "SELECT * FROM enrollments WHERE class_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 10",
      [id]
    );

    // آمار مالی کلاس
    const finance = await db.one(
      `SELECT
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END),0) AS paid,
        COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END),0) AS pending
       FROM payments p WHERE p.class_id = ?`,
      [id]
    );

    res.render('classes/detail', {
      title: cls.title,
      page: 'classes',
      cls,
      sessions,
      students,
      teachers,
      enrollments,
      finance,
      weekdays: weekdaysList(),
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ویرایش */
router.get('/:id/edit', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [req.params.id]);
    if (!cls) return res.status(404).render('errors/404', { title: 'کلاس یافت نشد' });
    const teachers = await db.query(
      "SELECT id, first_name, last_name FROM users WHERE user_type = 'teacher' AND is_active = 1 ORDER BY last_name"
    );
    res.render('classes/form', {
      title: 'ویرایش کلاس',
      page: 'classes',
      cls,
      teachers,
      weekdays: weekdaysList(),
      isEdit: true,
    });
  } catch (e) {
    next(e);
  }
});

/** ویرایش کلاس */
router.post('/:id', canMiddleware('classes.manage'), makeUploader('classes', ['image']).single('image_file'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [id]);
    if (!cls) return res.status(404).render('errors/404', { title: 'کلاس یافت نشد' });

    const b = req.body || {};
    const days = Array.isArray(b.days_of_week) ? b.days_of_week.join(',') : String(b.days_of_week || '');
    const updates = {
      title: String(b.title || cls.title).trim(),
      description: String(b.description || '').trim(),
      category: String(b.category || '').trim(),
      level: String(b.level || '').trim(),
      teacher_id: b.teacher_id ? parseInt(b.teacher_id, 10) : null,
      capacity: parseInt(b.capacity || cls.capacity, 10),
      price: parseFloat(b.price || '0') || 0,
      installments_count: parseInt(b.installments_count || '1', 10),
      start_date: jalaliToDb(b.start_date) || cls.start_date,
      end_date: jalaliToDb(b.end_date) || cls.end_date,
      start_time: normalizeTime(b.start_time) || cls.start_time,
      end_time: normalizeTime(b.end_time) || cls.end_time,
      days_of_week: days,
      location: String(b.location || '').trim(),
      passing_score: parseFloat(b.passing_score || '10') || 10,
      certificate_enabled: b.certificate_enabled ? 1 : 0,
      status: b.status || cls.status,
      updated_at: db.now(),
    };
    if (req.file) {
      if (cls.image_file) removeUpload(cls.image_file);
      updates.image_file = `classes/${req.file.filename}`;
    }

    await db.update('classes', updates, 'id = ?', [id]);
    await audit.log(req, 'class.update', 'class', id, updates.title);
    flash(req, 'success', 'تغییرات کلاس ذخیره شد');
    res.redirect(`/panel/classes/${id}`);
  } catch (e) {
    next(e);
  }
});

/** حذف / لغو کلاس */
router.post('/:id/delete', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [id]);
    if (!cls) return res.status(404).render('errors/404', { title: 'کلاس یافت نشد' });

    const hasStudents = await db.one('SELECT COUNT(*) AS c FROM class_students WHERE class_id = ?', [id]);
    if (Number(hasStudents.c) > 0) {
      await db.update('classes', { status: 'cancelled', updated_at: db.now() }, 'id = ?', [id]);
      flash(req, 'warning', 'کلاس دارای دانش‌آموز است و به جای حذف، «لغو شد» علامت خورد');
    } else {
      await db.exec('DELETE FROM classes WHERE id = ?', [id]);
      flash(req, 'success', 'کلاس حذف شد');
    }
    await audit.log(req, 'class.delete', 'class', id, cls.title);
    res.redirect('/panel/classes');
  } catch (e) {
    next(e);
  }
});

/** تولید خودکار جلسات از روی برنامه هفتگی */
router.post('/:id/sessions/generate', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [id]);
    if (!cls) return res.status(404).render('errors/404', { title: 'کلاس یافت نشد' });
    if (!cls.start_date || !cls.end_date) {
      flash(req, 'danger', 'ابتدا تاریخ شروع و پایان کلاس را مشخص کنید');
      return res.redirect(`/panel/classes/${id}`);
    }

    const days = String(cls.days_of_week || '')
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter((x) => !isNaN(x) && x >= 0 && x <= 6);

    if (days.length === 0) {
      flash(req, 'danger', 'روزهای برگزاری کلاس تعیین نشده است');
      return res.redirect(`/panel/classes/${id}`);
    }

    // جلوگیری از تکراری: جلسات موجود
    const existing = await db.query('SELECT session_date FROM class_sessions WHERE class_id = ?', [id]);
    const existSet = new Set(existing.map((r) => String(r.session_date).slice(0, 10)));

    const start = new Date(String(cls.start_date).slice(0, 10));
    const end = new Date(String(cls.end_date).slice(0, 10));
    if (isNaN(start) || isNaN(end) || end < start) {
      flash(req, 'danger', 'بازه تاریخ کلاس معتبر نیست');
      return res.redirect(`/panel/classes/${id}`);
    }

    let created = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const wd = weekdayIndex(d);
      if (!days.includes(wd)) continue;
      const p = (n) => String(n).padStart(2, '0');
      const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      if (existSet.has(dateStr)) continue;
      await db.insert('class_sessions', {
        class_id: id,
        session_date: dateStr,
        start_time: cls.start_time,
        end_time: cls.end_time,
        topic: '',
        status: 'scheduled',
        created_at: db.now(),
      });
      created++;
    }

    await audit.log(req, 'class.sessions_generate', 'class', id, `تولید ${created} جلسه`);
    flash(req, 'success', `${toPersianDigits(created)} جلسه جدید ایجاد شد`);
    res.redirect(`/panel/classes/${id}`);
  } catch (e) {
    next(e);
  }
});

/** افزودن جلسه دستی */
router.post('/:id/sessions', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const date = jalaliToDb(req.body.session_date);
    if (!date) {
      flash(req, 'danger', 'تاریخ جلسه معتبر نیست');
      return res.redirect(`/panel/classes/${id}`);
    }
    await db.insert('class_sessions', {
      class_id: id,
      session_date: date,
      start_time: normalizeTime(req.body.start_time),
      end_time: normalizeTime(req.body.end_time),
      topic: String(req.body.topic || '').trim(),
      status: 'scheduled',
      created_at: db.now(),
    });
    flash(req, 'success', 'جلسه اضافه شد');
    res.redirect(`/panel/classes/${id}`);
  } catch (e) {
    next(e);
  }
});

/** حذف جلسه */
router.post('/sessions/:sid/delete', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const sid = parseInt(req.params.sid, 10);
    const s = await db.one('SELECT * FROM class_sessions WHERE id = ?', [sid]);
    if (!s) return res.status(404).render('errors/404', { title: 'جلسه یافت نشد' });
    await db.exec('DELETE FROM class_sessions WHERE id = ?', [sid]);
    await audit.log(req, 'class.session_delete', 'session', sid, '');
    flash(req, 'success', 'جلسه حذف شد');
    res.redirect(`/panel/classes/${s.class_id}`);
  } catch (e) {
    next(e);
  }
});

/** افزودن دانش‌آموز به کلاس */
router.post('/:id/students', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const studentId = parseInt(req.body.student_id, 10);
    if (!studentId) {
      flash(req, 'danger', 'دانش‌آموز را انتخاب کنید');
      return res.redirect(`/panel/classes/${id}`);
    }
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [id]);
    const student = await db.one("SELECT * FROM users WHERE id = ? AND user_type = 'student'", [studentId]);
    if (!cls || !student) {
      flash(req, 'danger', 'کلاس یا دانش‌آموز یافت نشد');
      return res.redirect(`/panel/classes/${id}`);
    }
    const dup = await db.one('SELECT id FROM class_students WHERE class_id = ? AND student_id = ?', [id, studentId]);
    if (dup) {
      flash(req, 'warning', 'این دانش‌آموز قبلاً در کلاس حضور دارد');
      return res.redirect(`/panel/classes/${id}`);
    }
    const active = await db.one(
      "SELECT COUNT(*) AS c FROM class_students WHERE class_id = ? AND status = 'active'",
      [id]
    );
    if (cls.capacity > 0 && Number(active.c) >= cls.capacity) {
      flash(req, 'danger', 'ظرفیت کلاس تکمیل است');
      return res.redirect(`/panel/classes/${id}`);
    }

    await db.insert('class_students', {
      class_id: id,
      student_id: studentId,
      status: 'active',
      enrolled_at: db.now(),
    });
    await audit.log(req, 'class.student_add', 'class', id, `دانش‌آموز ${student.first_name} ${student.last_name}`);
    flash(req, 'success', 'دانش‌آموز به کلاس اضافه شد');
    res.redirect(`/panel/classes/${id}`);
  } catch (e) {
    next(e);
  }
});

/** حذف دانش‌آموز از کلاس */
router.post('/:id/students/:sid/remove', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sid = parseInt(req.params.sid, 10);
    await db.exec('DELETE FROM class_students WHERE class_id = ? AND student_id = ?', [id, sid]);
    await audit.log(req, 'class.student_remove', 'class', id, `دانش‌آموز ${sid}`);
    flash(req, 'success', 'دانش‌آموز از کلاس حذف شد');
    res.redirect(`/panel/classes/${id}`);
  } catch (e) {
    next(e);
  }
});

/** لیست دانش‌آموزان قابل افزودن (JSON برای جستجو) */
router.get('/:id/available-students', canMiddleware('classes.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const q = String(req.query.q || '').trim();
    let sql = `SELECT u.id, u.first_name, u.last_name, u.phone, sp.student_code
      FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.user_type = 'student' AND u.is_active = 1
        AND u.id NOT IN (SELECT student_id FROM class_students WHERE class_id = ?)`;
    const params = [id];
    if (q) {
      sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ? OR u.national_code LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY u.last_name LIMIT 20';
    const rows = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
