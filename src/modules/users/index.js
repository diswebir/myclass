/**
 * ماژول کاربران — مدیریت حساب‌ها، نقش‌ها و وضعیت فعال
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth, hashPassword, generatePassword } = require('../../core/auth');
const { canMiddleware, isSuper } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');

router.use(requireAuth, canMiddleware('users.view'));

/** لیست کاربران */
router.get('/', async (req, res, next) => {
  try {
    const { q, user_type, role_id } = req.query;
    let where = '1=1';
    const params = [];
    if (q) {
      where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (user_type) {
      where += ' AND u.user_type = ?';
      params.push(user_type);
    }
    if (role_id) {
      where += ' AND u.role_id = ?';
      params.push(parseInt(role_id, 10));
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT u.*, r.title AS role_title,
        (SELECT COUNT(*) FROM audit_logs al WHERE al.user_id = u.id) AS actions
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE ${where} ORDER BY u.created_at DESC`,
      params,
      page,
      20
    );
    const roles = await db.query('SELECT id, title FROM roles ORDER BY title');

    res.render('users/list', {
      title: 'کاربران',
      page: 'users',
      ...result,
      roles,
      filters: { q: q || '', user_type: user_type || '', role_id: role_id || '' },
    });
  } catch (e) {
    next(e);
  }
});

/** فرم ایجاد کاربر */
router.get('/create', canMiddleware('users.manage'), async (req, res, next) => {
  try {
    const roles = await db.query('SELECT * FROM roles WHERE is_active = 1 ORDER BY title');
    res.render('users/form', {
      title: 'افزودن کاربر',
      page: 'users',
      user: {},
      roles,
      isEdit: false,
      generatedPassword: generatePassword(10),
    });
  } catch (e) {
    next(e);
  }
});

/** ایجاد کاربر */
router.post('/', canMiddleware('users.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const firstName = String(b.first_name || '').trim();
    const lastName = String(b.last_name || '').trim();
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '').trim() || generatePassword(10);

    if (!firstName || !lastName || !username) {
      flash(req, 'danger', 'نام، نام خانوادگی و نام کاربری الزامی است');
      return res.redirect('/panel/users/create');
    }
    const exists = await db.one('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) {
      flash(req, 'danger', 'نام کاربری تکراری است');
      return res.redirect('/panel/users/create');
    }

    const userType = ['admin', 'staff', 'teacher', 'student'].includes(b.user_type) ? b.user_type : 'staff';
    const now = db.now();
    const userId = await db.insert('users', {
      role_id: b.role_id ? parseInt(b.role_id, 10) : null,
      user_type: userType,
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

    if (userType === 'teacher') {
      await db.insert('teacher_profiles', { user_id: userId, expertise: String(b.expertise || '').trim() });
    } else if (userType === 'student') {
      await db.insert('student_profiles', {
        user_id: userId,
        student_code: `ST-${String(userId).padStart(5, '0')}`,
      });
    }

    await audit.log(req, 'user.create', 'user', userId, username);
    flash(req, 'success', `کاربر ساخته شد — نام کاربری: ${username} — رمز عبور: ${password}`);
    res.redirect('/panel/users');
  } catch (e) {
    next(e);
  }
});

/** فرم ویرایش */
router.get('/:id/edit', canMiddleware('users.manage'), async (req, res, next) => {
  try {
    const user = await db.one('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).render('errors/404', { title: 'کاربر یافت نشد' });
    const roles = await db.query('SELECT * FROM roles WHERE is_active = 1 ORDER BY title');
    res.render('users/form', {
      title: 'ویرایش کاربر',
      page: 'users',
      user,
      roles,
      isEdit: true,
      generatedPassword: '',
    });
  } catch (e) {
    next(e);
  }
});

/** ویرایش کاربر */
router.post('/:id', canMiddleware('users.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const user = await db.one('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).render('errors/404', { title: 'کاربر یافت نشد' });
    if (id === req.user.id && req.body.is_active === undefined) {
      // اجازه ویرایش خود
    }

    const b = req.body || {};
    const updates = {
      first_name: String(b.first_name || '').trim(),
      last_name: String(b.last_name || '').trim(),
      phone: String(b.phone || '').trim(),
      email: String(b.email || '').trim(),
      national_code: String(b.national_code || '').trim(),
      user_type: ['admin', 'staff', 'teacher', 'student'].includes(b.user_type) ? b.user_type : user.user_type,
      role_id: b.role_id ? parseInt(b.role_id, 10) : null,
      is_active: id === req.user.id ? user.is_active : b.is_active ? 1 : 0,
      updated_at: db.now(),
    };

    // جلوگیری از سلب دسترسی آخرین مدیر کل
    if (user.user_type === 'admin' && updates.user_type !== 'admin') {
      const adminCount = await db.one("SELECT COUNT(*) AS c FROM users WHERE user_type = 'admin' AND is_active = 1");
      if (Number(adminCount.c) <= 1) {
        flash(req, 'danger', 'حداقل یک کاربر مدیر باید فعال بماند');
        return res.redirect(`/panel/users/${id}/edit`);
      }
    }

    await db.update('users', updates, 'id = ?', [id]);

    if (String(b.new_password || '').length >= 8) {
      await db.update('users', { password_hash: await hashPassword(b.new_password) }, 'id = ?', [id]);
    }

    await audit.log(req, 'user.update', 'user', id, '');
    flash(req, 'success', 'کاربر به‌روزرسانی شد');
    res.redirect('/panel/users');
  } catch (e) {
    next(e);
  }
});

/** تنظیم مجدد رمز عبور */
router.post('/:id/reset-password', canMiddleware('users.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const password = generatePassword(10);
    await db.update(
      'users',
      { password_hash: await hashPassword(password), must_change_password: 1, updated_at: db.now() },
      'id = ?',
      [id]
    );
    await audit.log(req, 'user.reset_password', 'user', id, '');
    flash(req, 'success', `رمز عبور جدید: ${password}`);
    res.redirect('/panel/users');
  } catch (e) {
    next(e);
  }
});

module.exports = router;
