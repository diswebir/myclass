/**
 * ماژول صفحات عمومی — صفحه اصلی، جزئیات کلاس، پیش‌ثبت‌نام، استعلام مدرک
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const settings = require('../../core/settings');
const { publicFormLimiter } = require('../../core/security');
const { flash } = require('../../core/viewHelpers');
const { jalaliToDb, jalaliLong, toPersianDigits, todayJalali } = require('../../core/helpers/jalali');
const sms = require('../../core/sms/smsService');
const audit = require('../../core/audit');

/** صفحه اصلی — معرفی موسسه + کلاس‌های ثبت‌نام باز */
router.get('/', async (req, res, next) => {
  try {
    if (req.user && !req.query.public) return res.redirect('/panel');
    const openClasses = await db.query(
      `SELECT c.*, u.first_name AS t_first, u.last_name AS t_last,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id) AS students_count
       FROM classes c LEFT JOIN users u ON u.id = c.teacher_id
       WHERE c.status IN ('open','in_progress')
       ORDER BY c.start_date DESC LIMIT 12`
    );
    res.render('public/home', {
      title: await settings.get('institute_name', 'موسسه آموزشی'),
      openClasses,
      layout: 'layouts/public',
    });
  } catch (e) {
    next(e);
  }
});

/** جزئیات کلاس + فرم پیش‌ثبت‌نام */
router.get('/classes/:id', async (req, res, next) => {
  try {
    const cls = await db.one(
      `SELECT c.*, u.first_name AS t_first, u.last_name AS t_last, u.phone AS t_phone
       FROM classes c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!cls || cls.status === 'cancelled') {
      return res.status(404).render('errors/404', { title: 'کلاس یافت نشد', layout: 'layouts/auth' });
    }
    const sessions = await db.query(
      'SELECT session_date, start_time, end_time, topic FROM class_sessions WHERE class_id = ? ORDER BY session_date LIMIT 30',
      [cls.id]
    );
    res.render('public/class-detail', {
      title: cls.title,
      cls,
      sessions,
      sent: req.query.sent === '1',
      layout: 'layouts/public',
    });
  } catch (e) {
    next(e);
  }
});

/** ثبت پیش‌ثبت‌نام */
router.post('/classes/:id/preregister', publicFormLimiter, async (req, res, next) => {
  try {
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [req.params.id]);
    if (!cls || !['open', 'draft'].includes(cls.status)) {
      flash(req, 'danger', 'ثبت‌نام این کلاس در حال حاضر امکان‌پذیر نیست');
      return res.redirect('/');
    }
    const regOpen = await settings.get('registration_open', '1');
    if (regOpen !== '1') {
      flash(req, 'danger', 'پیش‌ثبت‌نام در حال حاضر غیرفعال است');
      return res.redirect(`/classes/${cls.id}`);
    }

    const { full_name, phone, national_code, email, gender, education, message } = req.body || {};
    const name = String(full_name || '').trim();
    const mobile = String(phone || '').trim();
    if (!name || !mobile) {
      flash(req, 'danger', 'نام و شماره موبایل الزامی است');
      return res.redirect(`/classes/${cls.id}`);
    }
    if (!/^0?9\d{9}$/.test(mobile.replace(/[^\d]/g, ''))) {
      flash(req, 'danger', 'شماره موبایل معتبر نیست');
      return res.redirect(`/classes/${cls.id}`);
    }

    // جلوگیری از ثبت تکراری
    const dup = await db.one(
      "SELECT id FROM enrollments WHERE class_id = ? AND phone = ? AND status = 'pending'",
      [cls.id, mobile]
    );
    if (dup) {
      flash(req, 'warning', 'درخواست شما قبلاً ثبت شده و در انتظار بررسی است');
      return res.redirect(`/classes/${cls.id}`);
    }

    await db.insert('enrollments', {
      class_id: cls.id,
      full_name: name,
      phone: mobile,
      national_code: String(national_code || '').trim(),
      email: String(email || '').trim(),
      gender: gender === 'male' ? 'male' : gender === 'female' ? 'female' : '',
      education: String(education || '').trim(),
      message: String(message || '').trim(),
      status: 'pending',
      source: 'web',
      created_at: db.now(),
    });

    // پیامک به متقاضی
    sms.sendEvent('enrollment_received', mobile, {
      full_name: name,
      class_name: cls.title,
    }).catch(() => {});

    await audit.log(req, 'enrollment.create', 'enrollment', cls.id, `پیش‌ثبت‌نام ${name} برای ${cls.title}`);
    return res.redirect(`/classes/${cls.id}?sent=1#prereg`);
  } catch (e) {
    next(e);
  }
});

/** استعلام مدرک با شماره سریال */
router.get(['/verify', '/verify/:serial'], async (req, res, next) => {
  try {
    const serial = String(req.params.serial || req.query.serial || '').trim();
    const cert = serial ? await db.one(
      `SELECT ce.*, u.first_name, u.last_name, c.title AS class_title
       FROM certificates ce
       JOIN users u ON u.id = ce.student_id
       JOIN classes c ON c.id = ce.class_id
       WHERE ce.serial = ?`,
      [serial]
    ) : null;
    res.render('public/verify-cert', {
      title: 'استعلام مدرک',
      cert,
      serial,
      layout: 'layouts/public',
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
