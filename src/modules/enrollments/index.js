/**
 * ماژول پیش‌ثبت‌نام — بررسی، تایید/رد و تبدیل به دانش‌آموز
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth, hashPassword, generatePassword } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const { jalaliLong, toJalali } = require('../../core/helpers/jalali');
const sms = require('../../core/sms/smsService');

router.use(requireAuth);

/** لیست درخواست‌ها */
router.get('/', canMiddleware('enrollments.view'), async (req, res, next) => {
  try {
    const { status, q, class_id } = req.query;
    let where = '1=1';
    const params = [];
    if (status) {
      where += ' AND e.status = ?';
      params.push(status);
    }
    if (class_id) {
      where += ' AND e.class_id = ?';
      params.push(parseInt(class_id, 10));
    }
    if (q) {
      where += ' AND (e.full_name LIKE ? OR e.phone LIKE ? OR e.national_code LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT e.*, c.title AS class_title, c.price AS class_price,
        u.first_name AS r_first, u.last_name AS r_last
       FROM enrollments e
       JOIN classes c ON c.id = e.class_id
       LEFT JOIN users u ON u.id = e.reviewed_by
       WHERE ${where}
       ORDER BY CASE e.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, e.created_at DESC`,
      params,
      page,
      20
    );

    const classes = await db.query("SELECT id, title FROM classes WHERE status != 'cancelled' ORDER BY title");
    const counts = await db.one(
      `SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM enrollments`
    );

    res.render('enrollments/list', {
      title: 'پیش‌ثبت‌نام‌ها',
      page: 'enrollments',
      ...result,
      classes,
      counts: counts || {},
      filters: { status: status || '', q: q || '', class_id: class_id || '' },
    });
  } catch (e) {
    next(e);
  }
});

/** جزئیات درخواست */
router.get('/:id', canMiddleware('enrollments.view'), async (req, res, next) => {
  try {
    const en = await db.one(
      `SELECT e.*, c.title AS class_title, c.price AS class_price, c.start_date, c.start_time,
        c.installments_count, c.id AS cid
       FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.id = ?`,
      [req.params.id]
    );
    if (!en) return res.status(404).render('errors/404', { title: 'درخواست یافت نشد' });

    // آیا قبلاً دانش‌آموز با این شماره وجود دارد؟
    const existingStudent = await db.one(
      "SELECT id, first_name, last_name, username FROM users WHERE user_type = 'student' AND (phone = ? OR (national_code != '' AND national_code = ?))",
      [en.phone, en.national_code || '']
    );

    res.render('enrollments/detail', {
      title: `پیش‌ثبت‌نام ${en.full_name}`,
      page: 'enrollments',
      en,
      existingStudent,
    });
  } catch (e) {
    next(e);
  }
});

/** تایید پیش‌ثبت‌نام → ساخت/لینک دانش‌آموز + افزودن به کلاس */
router.post('/:id/approve', canMiddleware('enrollments.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const en = await db.one(
      `SELECT e.*, c.title AS class_title, c.price AS class_price, c.installments_count,
        c.start_date, c.start_time, c.id AS cid
       FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.id = ?`,
      [id]
    );
    if (!en) return res.status(404).render('errors/404', { title: 'درخواست یافت نشد' });
    if (en.status !== 'pending') {
      flash(req, 'warning', 'این درخواست قبلاً بررسی شده است');
      return res.redirect(`/panel/enrollments/${id}`);
    }

    const b = req.body || {};
    let password = '';
    const result = await db.transaction(async (trx) => {
      // پیدا کردن یا ساخت دانش‌آموز
      let student = await trx.one(
        "SELECT * FROM users WHERE user_type = 'student' AND (phone = ? OR (national_code != '' AND national_code = ?))",
        [en.phone, en.national_code || '']
      );
      let isNew = false;
      if (!student) {
        const nameParts = String(en.full_name).trim().split(/\s+/);
        const firstName = nameParts[0] || en.full_name;
        const lastName = nameParts.slice(1).join(' ') || '—';
        let username = String(en.phone || '').replace(/^0/, '98');
        const uExists = await trx.one('SELECT id FROM users WHERE username = ?', [username]);
        if (uExists) username = `stu${Date.now().toString(36)}`;
        password = generatePassword(10);
        const studentRole = await trx.one('SELECT id FROM roles WHERE title = ?', ['دانش‌آموز']);
        const now = db.now();
        const userId = await trx.insert('users', {
          role_id: studentRole ? studentRole.id : null,
          user_type: 'student',
          first_name: firstName,
          last_name: lastName,
          username,
          phone: en.phone,
          email: en.email || '',
          national_code: en.national_code || '',
          password_hash: await hashPassword(password),
          is_active: 1,
          created_by: req.user.id,
          created_at: now,
          updated_at: now,
        });
        await trx.insert('student_profiles', {
          user_id: userId,
          student_code: `ST-${String(userId).padStart(5, '0')}`,
          gender: en.gender || '',
          education_level: en.education || '',
        });
        student = await trx.one('SELECT * FROM users WHERE id = ?', [userId]);
        isNew = true;
      }

      // افزودن به کلاس
      const dup = await trx.one('SELECT id FROM class_students WHERE class_id = ? AND student_id = ?', [en.class_id, student.id]);
      if (!dup) {
        await trx.insert('class_students', {
          class_id: en.class_id,
          student_id: student.id,
          status: 'active',
          enrolled_at: db.now(),
        });
      }

      await trx.update(
        'enrollments',
        {
          status: 'approved',
          student_id: student.id,
          reviewed_by: req.user.id,
          reviewed_at: db.now(),
          review_note: String(b.review_note || '').trim(),
        },
        'id = ?',
        [id]
      );

      return { student, isNew };
    });

    // پیامک تایید
    if (en.phone) {
      sms.sendEvent('enrollment_approved', en.phone, {
        full_name: en.full_name,
        class_name: en.class_title,
        class_date: jalaliLong(en.start_date),
        class_time: en.start_time ? String(en.start_time).slice(0, 5) : '',
        username: result.student.username,
        password: password || '(قبلی)',
      }).catch(() => {});
    }

    await audit.log(req, 'enrollment.approve', 'enrollment', id, `${en.full_name} → ${en.class_title}`);
    flash(
      req,
      'success',
      result.isNew
        ? `تایید شد. حساب دانش‌آموز ساخته شد — نام کاربری: ${result.student.username} — رمز: ${password}`
        : 'تایید شد. دانش‌آموز به کلاس اضافه شد'
    );
    res.redirect(`/panel/enrollments/${id}`);
  } catch (e) {
    next(e);
  }
});

/** رد درخواست */
router.post('/:id/reject', canMiddleware('enrollments.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const en = await db.one(
      'SELECT e.*, c.title AS class_title FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.id = ?',
      [id]
    );
    if (!en) return res.status(404).render('errors/404', { title: 'درخواست یافت نشد' });

    await db.update(
      'enrollments',
      {
        status: 'rejected',
        reviewed_by: req.user.id,
        reviewed_at: db.now(),
        review_note: String(req.body.review_note || '').trim(),
      },
      'id = ?',
      [id]
    );

    if (en.phone) {
      sms.sendEvent('enrollment_rejected', en.phone, {
        full_name: en.full_name,
        class_name: en.class_title,
      }).catch(() => {});
    }

    await audit.log(req, 'enrollment.reject', 'enrollment', id, en.full_name);
    flash(req, 'warning', 'درخواست رد شد');
    res.redirect(`/panel/enrollments/${id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
