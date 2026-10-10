/**
 * ماژول اساتید — مدیریت اساتید و تخصیص کلاس‌ها
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth, hashPassword, generatePassword } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const { jalaliToDb } = require('../../core/helpers/jalali');

router.use(requireAuth);

/** لیست اساتید */
router.get('/', canMiddleware('teachers.view'), async (req, res, next) => {
  try {
    const { q } = req.query;
    let where = "u.user_type = 'teacher'";
    const params = [];
    if (q) {
      where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ? OR tp.expertise LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT u.*, tp.expertise, tp.bio,
        (SELECT COUNT(*) FROM classes c WHERE c.teacher_id = u.id AND c.status != 'cancelled') AS classes_count,
        (SELECT COUNT(*) FROM class_students cs JOIN classes c2 ON c2.id = cs.class_id WHERE c2.teacher_id = u.id) AS students_count
       FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
       WHERE ${where} ORDER BY u.created_at DESC`,
      params,
      page,
      20
    );
    res.render('teachers/list', {
      title: 'اساتید',
      page: 'teachers',
      ...result,
      q: q || '',
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ایجاد */
router.get('/create', canMiddleware('teachers.manage'), (req, res) => {
  res.render('teachers/form', {
    title: 'افزودن استاد',
    page: 'teachers',
    teacher: {},
    profile: {},
    isEdit: false,
    generatedPassword: generatePassword(10),
  });
});

/** ایجاد استاد */
router.post('/', canMiddleware('teachers.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const firstName = String(b.first_name || '').trim();
    const lastName = String(b.last_name || '').trim();
    if (!firstName || !lastName) {
      flash(req, 'danger', 'نام و نام خانوادگی الزامی است');
      return res.redirect('/panel/teachers/create');
    }
    const username = String(b.username || '').trim().toLowerCase();
    if (!username) {
      flash(req, 'danger', 'نام کاربری الزامی است');
      return res.redirect('/panel/teachers/create');
    }
    const exists = await db.one('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) {
      flash(req, 'danger', 'این نام کاربری قبلاً ثبت شده است');
      return res.redirect('/panel/teachers/create');
    }

    const password = String(b.password || '').trim() || generatePassword(10);
    const teacherRole = await db.one('SELECT id FROM roles WHERE title = ?', ['استاد']);
    const now = db.now();

    const userId = await db.insert('users', {
      role_id: teacherRole ? teacherRole.id : null,
      user_type: 'teacher',
      first_name: firstName,
      last_name: lastName,
      username,
      phone: String(b.phone || '').trim(),
      email: String(b.email || '').trim(),
      national_code: String(b.national_code || '').trim(),
      password_hash: await hashPassword(password),
      is_active: 1,
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });

    await db.insert('teacher_profiles', {
      user_id: userId,
      expertise: String(b.expertise || '').trim(),
      bio: String(b.bio || '').trim(),
      hire_date: jalaliToDb(b.hire_date) || null,
      hourly_rate: parseFloat(b.hourly_rate || '0') || 0,
      notes: String(b.notes || '').trim(),
    });

    await audit.log(req, 'teacher.create', 'user', userId, `${firstName} ${lastName}`);
    flash(req, 'success', `استاد ایجاد شد. نام کاربری: ${username} — رمز عبور: ${password}`);
    res.redirect(`/panel/teachers/${userId}`);
  } catch (e) {
    next(e);
  }
});

/** پرونده استاد */
router.get('/:id', canMiddleware('teachers.view'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const teacher = await db.one("SELECT * FROM users WHERE id = ? AND user_type = 'teacher'", [id]);
    if (!teacher) return res.status(404).render('errors/404', { title: 'استاد یافت نشد' });
    const profile = await db.one('SELECT * FROM teacher_profiles WHERE user_id = ?', [id]);

    const classes = await db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') AS students_count
       FROM classes c WHERE c.teacher_id = ? ORDER BY c.start_date DESC`,
      [id]
    );

    res.render('teachers/detail', {
      title: `${teacher.first_name} ${teacher.last_name}`,
      page: 'teachers',
      teacher,
      profile,
      classes,
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ویرایش */
router.get('/:id/edit', canMiddleware('teachers.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const teacher = await db.one("SELECT * FROM users WHERE id = ? AND user_type = 'teacher'", [id]);
    if (!teacher) return res.status(404).render('errors/404', { title: 'استاد یافت نشد' });
    const profile = await db.one('SELECT * FROM teacher_profiles WHERE user_id = ?', [id]);
    res.render('teachers/form', {
      title: 'ویرایش استاد',
      page: 'teachers',
      teacher,
      profile: profile || {},
      isEdit: true,
      generatedPassword: '',
    });
  } catch (e) {
    next(e);
  }
});

/** ویرایش */
router.post('/:id', canMiddleware('teachers.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const teacher = await db.one("SELECT * FROM users WHERE id = ? AND user_type = 'teacher'", [id]);
    if (!teacher) return res.status(404).render('errors/404', { title: 'استاد یافت نشد' });

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

    const profile = await db.one('SELECT id FROM teacher_profiles WHERE user_id = ?', [id]);
    const data = {
      expertise: String(b.expertise || '').trim(),
      bio: String(b.bio || '').trim(),
      hire_date: jalaliToDb(b.hire_date) || null,
      hourly_rate: parseFloat(b.hourly_rate || '0') || 0,
      notes: String(b.notes || '').trim(),
    };
    if (profile) await db.update('teacher_profiles', data, 'id = ?', [profile.id]);
    else await db.insert('teacher_profiles', { user_id: id, ...data });

    if (String(b.new_password || '').length >= 8) {
      await db.update('users', { password_hash: await hashPassword(b.new_password) }, 'id = ?', [id]);
    }

    await audit.log(req, 'teacher.update', 'user', id, '');
    flash(req, 'success', 'اطلاعات استاد به‌روزرسانی شد');
    res.redirect(`/panel/teachers/${id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
