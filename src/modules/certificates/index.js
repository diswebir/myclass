/**
 * ماژول مدارک — صدور، مدیریت و چاپ گواهی پایان دوره با QR استعلام
 */
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware, isStudent, classScope, isTeacher } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const settings = require('../../core/settings');
const { jalaliLong, todayJalali, toJalali } = require('../../core/helpers/jalali');
const sms = require('../../core/sms/smsService');

router.use(requireAuth);

function makeSerial() {
  return 'MC-' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

/** لیست مدارک */
router.get('/', canMiddleware('certificates.view'), async (req, res, next) => {
  try {
    const { q, class_id } = req.query;
    let where = '1=1';
    const params = [];
    if (isTeacher(req)) {
      where += ' AND c.teacher_id = ?';
      params.push(req.user.id);
    }
    if (isStudent(req)) {
      where += ' AND ce.student_id = ?';
      params.push(req.user.id);
    }
    if (class_id) {
      where += ' AND ce.class_id = ?';
      params.push(parseInt(class_id, 10));
    }
    if (q) {
      where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR ce.serial LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT ce.*, u.first_name, u.last_name, c.title AS class_title
       FROM certificates ce
       JOIN users u ON u.id = ce.student_id
       JOIN classes c ON c.id = ce.class_id
       WHERE ${where}
       ORDER BY ce.created_at DESC`,
      params,
      page,
      15
    );
    const classes = await db.query("SELECT id, title FROM classes WHERE status != 'cancelled' ORDER BY title");
    res.render('certificates/list', {
      title: 'مدارک و گواهی‌ها',
      page: 'certificates',
      ...result,
      classes,
      q: q || '',
      classId: class_id || '',
    });
  } catch (e) {
    next(e);
  }
});

/** فرم صدور مدرک */
router.get('/create', canMiddleware('certificates.manage'), async (req, res, next) => {
  try {
    const classes = await db.query(
      "SELECT id, title FROM classes WHERE status IN ('completed','in_progress') ORDER BY title"
    );
    res.render('certificates/form', {
      title: 'صدور مدرک جدید',
      page: 'certificates',
      classes,
      preClassId: req.query.class_id || '',
      preStudentId: req.query.student_id || '',
    });
  } catch (e) {
    next(e);
  }
});

/** دانش‌آموزان یک کلاس (JSON) */
router.get('/students-of-class/:id', canMiddleware('certificates.manage'), async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT u.id, u.first_name, u.last_name, cs.final_score
       FROM class_students cs JOIN users u ON u.id = cs.student_id
       WHERE cs.class_id = ? ORDER BY u.last_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/** صدور مدرک */
router.post('/', canMiddleware('certificates.manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const studentId = parseInt(b.student_id, 10);
    const classId = parseInt(b.class_id, 10);
    if (!studentId || !classId) {
      flash(req, 'danger', 'دانش‌آموز و کلاس را انتخاب کنید');
      return res.redirect('/panel/certificates/create');
    }

    const dup = await db.one('SELECT id FROM certificates WHERE student_id = ? AND class_id = ?', [studentId, classId]);
    if (dup) {
      flash(req, 'warning', 'برای این دانش‌آموز در این کلاس قبلاً مدرک صادر شده است');
      return res.redirect(`/panel/certificates/${dup.id}`);
    }

    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [classId]);
    const student = await db.one('SELECT * FROM users WHERE id = ?', [studentId]);
    if (!cls || !student) {
      flash(req, 'danger', 'کلاس یا دانش‌آموز یافت نشد');
      return res.redirect('/panel/certificates/create');
    }

    const certTitle = String(b.title || '').trim() || (await settings.get('cert_title', 'گواهی پایان دوره'));
    const score = parseFloat(b.final_score || '0') || null;
    const grade = String(b.grade_label || '').trim();

    const now = db.now();
    const certId = await db.insert('certificates', {
      serial: makeSerial(),
      student_id: studentId,
      class_id: classId,
      title: certTitle,
      description: String(b.description || '').trim(),
      final_score: score,
      grade_label: grade,
      issue_date: db.today(),
      status: 'issued',
      issued_by: req.user.id,
      created_at: now,
    });

    // به‌روزرسانی نمره نهایی در کلاس
    if (score !== null) {
      await db.update('class_students', { final_score: score, status: 'finished' }, 'class_id = ? AND student_id = ?', [classId, studentId]);
    }

    const cert = await db.one('SELECT * FROM certificates WHERE id = ?', [certId]);
    if (student.phone) {
      sms.sendEvent('certificate_ready', student.phone, {
        full_name: `${student.first_name} ${student.last_name}`,
        class_name: cls.title,
        serial: cert.serial,
      }).catch(() => {});
    }

    await audit.log(req, 'certificate.issue', 'certificate', certId, cert.serial);
    flash(req, 'success', `مدرک با شماره سریال ${cert.serial} صادر شد`);
    res.redirect(`/panel/certificates/${certId}`);
  } catch (e) {
    next(e);
  }
});

/** جزئیات مدرک */
router.get('/:id', canMiddleware('certificates.view'), async (req, res, next) => {
  try {
    const cert = await db.one(
      `SELECT ce.*, u.first_name, u.last_name, u.national_code, c.title AS class_title,
        c.start_date, c.end_date, sp.student_code, iu.first_name AS i_first, iu.last_name AS i_last
       FROM certificates ce
       JOIN users u ON u.id = ce.student_id
       JOIN classes c ON c.id = ce.class_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       LEFT JOIN users iu ON iu.id = ce.issued_by
       WHERE ce.id = ?`,
      [req.params.id]
    );
    if (!cert) return res.status(404).render('errors/404', { title: 'مدرک یافت نشد' });
    if (isStudent(req) && cert.student_id !== req.user.id) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    }

    res.render('certificates/detail', {
      title: `مدرک ${cert.serial}`,
      page: 'certificates',
      cert,
    });
  } catch (e) {
    next(e);
  }
});

/** چاپ مدرک (صفحه اختصاصی چاپ) */
router.get('/:id/print', canMiddleware('certificates.view'), async (req, res, next) => {
  try {
    const cert = await db.one(
      `SELECT ce.*, u.first_name, u.last_name, u.national_code, c.title AS class_title,
        c.start_date, c.end_date, sp.student_code
       FROM certificates ce
       JOIN users u ON u.id = ce.student_id
       JOIN classes c ON c.id = ce.class_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE ce.id = ?`,
      [req.params.id]
    );
    if (!cert) return res.status(404).render('errors/404', { title: 'مدرک یافت نشد' });
    if (isStudent(req) && cert.student_id !== req.user.id) {
      return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    }

    const appUrl = (await settings.get('institute_website', '')) || `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${appUrl}/verify/${cert.serial}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 160, margin: 1 });

    const certSettings = {
      title: cert.title || (await settings.get('cert_title')),
      subtitle: await settings.get('cert_subtitle'),
      footer: (await settings.get('cert_footer_text', '')).replace('{institute_name}', await settings.get('institute_name', '')),
      sign1_name: await settings.get('cert_sign1_name'),
      sign1_title: await settings.get('cert_sign1_title'),
      sign2_name: await settings.get('cert_sign2_name'),
      sign2_title: await settings.get('cert_sign2_title'),
      show_qr: (await settings.get('cert_show_qr', '1')) === '1',
      institute_name: await settings.get('institute_name'),
      institute_logo: await settings.get('institute_logo'),
    };

    res.render('certificates/print', {
      title: `چاپ مدرک ${cert.serial}`,
      cert,
      qrDataUrl,
      certSettings,
      layout: 'layouts/print',
    });
  } catch (e) {
    next(e);
  }
});

/** ابطال مدرک */
router.post('/:id/revoke', canMiddleware('certificates.manage'), async (req, res, next) => {
  try {
    await db.update('certificates', { status: 'revoked' }, 'id = ?', [req.params.id]);
    await audit.log(req, 'certificate.revoke', 'certificate', req.params.id, '');
    flash(req, 'warning', 'مدرک باطل شد');
    res.redirect(`/panel/certificates/${req.params.id}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
