/**
 * ماژول دانش‌آموزان — مدیریت پرونده، حساب کاربری و اطلاعات تکمیلی
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth, hashPassword, generatePassword } = require('../../core/auth');
const { canMiddleware, canAccessStudent, isTeacher, isStudent } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const { jalaliToDb, toJalali, jalaliLong } = require('../../core/helpers/jalali');
const { makeUploader } = require('../../core/uploader');
const sms = require('../../core/sms/smsService');

router.use(requireAuth);

/** لیست دانش‌آموزان */
router.get('/', canMiddleware('students.view'), async (req, res, next) => {
  try {
    const { q, gender, class_id } = req.query;
    let where = "u.user_type = 'student'";
    const params = [];

    if (isTeacher(req)) {
      where += ` AND u.id IN (SELECT cs.student_id FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE c.teacher_id = ?)`;
      params.push(req.user.id);
    }
    if (q) {
      where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ? OR u.national_code LIKE ? OR sp.student_code LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (gender) {
      where += ' AND sp.gender = ?';
      params.push(gender);
    }
    if (class_id) {
      where += ' AND u.id IN (SELECT student_id FROM class_students WHERE class_id = ?)';
      params.push(parseInt(class_id, 10));
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT u.*, sp.student_code, sp.gender, sp.education_level,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.student_id = u.id) AS classes_count,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.student_id = u.id AND p.status = 'paid') AS total_paid
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE ${where}
       ORDER BY u.created_at DESC`,
      params,
      page,
      20
    );

    const classes = await db.query("SELECT id, title FROM classes WHERE status != 'cancelled' ORDER BY title");

    res.render('students/list', {
      title: 'دانش‌آموزان',
      page: 'students',
      ...result,
      q: q || '',
      gender: gender || '',
      classId: class_id || '',
      classes,
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ایجاد دانش‌آموز */
router.get('/create', canMiddleware('students.manage'), (req, res) => {
  res.render('students/form', {
    title: 'افزودن دانش‌آموز',
    page: 'students',
    student: {},
    profile: {},
    isEdit: false,
    generatedPassword: generatePassword(10),
  });
});

/** ایجاد دانش‌آموز + حساب کاربری */
router.post('/', canMiddleware('students.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const firstName = String(b.first_name || '').trim();
    const lastName = String(b.last_name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!firstName || !lastName) {
      flash(req, 'danger', 'نام و نام خانوادگی الزامی است');
      return res.redirect('/panel/students/create');
    }

    const username = String(b.username || '').trim().toLowerCase() || (phone && /^0?9\d{9}$/.test(phone) ? phone.replace(/^0/, '98') : `stu${Date.now().toString(36)}`);
    const exists = await db.one('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) {
      flash(req, 'danger', 'این نام کاربری قبلاً ثبت شده است');
      return res.redirect('/panel/students/create');
    }

    const password = String(b.password || '').trim() || generatePassword(10);
    const studentRole = await db.one('SELECT id FROM roles WHERE title = ?', ['دانش‌آموز']);
    const now = db.now();
    const hash = await hashPassword(password);

    const userId = await db.insert('users', {
      role_id: studentRole ? studentRole.id : null,
      user_type: 'student',
      first_name: firstName,
      last_name: lastName,
      username,
      phone,
      email: String(b.email || '').trim(),
      national_code: String(b.national_code || '').trim(),
      password_hash: hash,
      is_active: 1,
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });

    await db.insert('student_profiles', {
      user_id: userId,
      student_code: String(b.student_code || '').trim() || `ST-${String(userId).padStart(5, '0')}`,
      birth_date: jalaliToDb(b.birth_date) || null,
      gender: b.gender === 'male' ? 'male' : b.gender === 'female' ? 'female' : '',
      education_level: String(b.education_level || '').trim(),
      school: String(b.school || '').trim(),
      address: String(b.address || '').trim(),
      guardian_name: String(b.guardian_name || '').trim(),
      guardian_phone: String(b.guardian_phone || '').trim(),
      notes: String(b.notes || '').trim(),
    });

    // پیامک خوش‌آمد با نام کاربری و رمز عبور
    if (phone) {
      sms.sendEvent('welcome_user', phone, {
        full_name: `${firstName} ${lastName}`,
        username,
        password,
      }).catch(() => {});
    }

    await audit.log(req, 'student.create', 'user', userId, `${firstName} ${lastName}`);
    flash(req, 'success', `دانش‌آموز ایجاد شد. نام کاربری: ${username} — رمز عبور: ${password}`);
    res.redirect(`/panel/students/${userId}`);
  } catch (e) {
    next(e);
  }
});

/** پرونده دانش‌آموز */
router.get('/:id', canMiddleware('students.view'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await canAccessStudent(req, id))) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: 'شما به این پرونده دسترسی ندارید.' });
    }
    const student = await db.one(
      `SELECT u.*, r.title AS role_title FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.user_type = 'student'`,
      [id]
    );
    if (!student) return res.status(404).render('errors/404', { title: 'دانش‌آموز یافت نشد' });

    const profile = await db.one('SELECT * FROM student_profiles WHERE user_id = ?', [id]);

    const classes = await db.query(
      `SELECT cs.*, c.title, c.code, c.start_date, c.end_date, c.status AS class_status,
        (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id = c.id) AS sessions_total,
        (SELECT COUNT(*) FROM attendance a JOIN class_sessions s2 ON s2.id = a.session_id
          WHERE s2.class_id = c.id AND a.student_id = ? AND a.status IN ('present','late')) AS sessions_present
       FROM class_students cs JOIN classes c ON c.id = cs.class_id
       WHERE cs.student_id = ? ORDER BY cs.enrolled_at DESC`,
      [id, id]
    );

    const payments = await db.query(
      `SELECT p.*, c.title AS class_title FROM payments p
       LEFT JOIN classes c ON c.id = p.class_id
       WHERE p.student_id = ? ORDER BY p.created_at DESC LIMIT 30`,
      [id]
    );

    const plans = await db.query(
      `SELECT ip.*, c.title AS class_title,
        (SELECT COUNT(*) FROM installments i WHERE i.plan_id = ip.id AND i.status = 'paid') AS paid_count
       FROM installment_plans ip LEFT JOIN classes c ON c.id = ip.class_id
       WHERE ip.student_id = ? ORDER BY ip.created_at DESC`,
      [id]
    );

    const certs = await db.query(
      `SELECT ce.*, c.title AS class_title FROM certificates ce
       JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = ? ORDER BY ce.created_at DESC`,
      [id]
    );

    const attSummary = await db.one(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
       FROM attendance a WHERE a.student_id = ?`,
      [id]
    );

    res.render('students/detail', {
      title: `${student.first_name} ${student.last_name}`,
      page: 'students',
      student,
      profile,
      classes,
      payments,
      plans,
      certs,
      attSummary,
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ویرایش */
router.get('/:id/edit', canMiddleware('students.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const student = await db.one("SELECT * FROM users WHERE id = ? AND user_type = 'student'", [id]);
    if (!student) return res.status(404).render('errors/404', { title: 'دانش‌آموز یافت نشد' });
    const profile = await db.one('SELECT * FROM student_profiles WHERE user_id = ?', [id]);
    res.render('students/form', {
      title: 'ویرایش دانش‌آموز',
      page: 'students',
      student,
      profile: profile || {},
      isEdit: true,
      generatedPassword: '',
    });
  } catch (e) {
    next(e);
  }
});

/** ویرایش */
router.post('/:id', canMiddleware('students.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const student = await db.one("SELECT * FROM users WHERE id = ? AND user_type = 'student'", [id]);
    if (!student) return res.status(404).render('errors/404', { title: 'دانش‌آموز یافت نشد' });

    const b = req.body || {};
    await db.update(
      'users',
      {
        first_name: String(b.first_name || '').trim(),
        last_name: String(b.last_name || '').trim(),
        phone: String(b.phone || '').trim(),
        email: String(b.email || '').trim(),
        national_code: String(b.national_code || '').trim(),
        is_active: b.is_active ? 1 : 0,
        updated_at: db.now(),
      },
      'id = ?',
      [id]
    );

    const profile = await db.one('SELECT id FROM student_profiles WHERE user_id = ?', [id]);
    const profileData = {
      student_code: String(b.student_code || '').trim(),
      birth_date: jalaliToDb(b.birth_date) || null,
      gender: b.gender === 'male' ? 'male' : b.gender === 'female' ? 'female' : '',
      education_level: String(b.education_level || '').trim(),
      school: String(b.school || '').trim(),
      address: String(b.address || '').trim(),
      guardian_name: String(b.guardian_name || '').trim(),
      guardian_phone: String(b.guardian_phone || '').trim(),
      notes: String(b.notes || '').trim(),
    };
    if (profile) {
      await db.update('student_profiles', profileData, 'id = ?', [profile.id]);
    } else {
      await db.insert('student_profiles', { user_id: id, ...profileData });
    }

    if (String(b.new_password || '').length >= 8) {
      await db.update('users', { password_hash: await hashPassword(b.new_password) }, 'id = ?', [id]);
    }

    await audit.log(req, 'student.update', 'user', id, '');
    flash(req, 'success', 'اطلاعات دانش‌آموز به‌روزرسانی شد');
    res.redirect(`/panel/students/${id}`);
  } catch (e) {
    next(e);
  }
});

/** غیرفعال‌سازی */
router.post('/:id/deactivate', canMiddleware('students.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.update('users', { is_active: 0, updated_at: db.now() }, 'id = ?', [id]);
    await audit.log(req, 'student.deactivate', 'user', id, '');
    flash(req, 'warning', 'حساب دانش‌آموز غیرفعال شد');
    res.redirect(`/panel/students/${id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
