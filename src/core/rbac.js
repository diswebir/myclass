/**
 * کنترل دسترسی مبتنی بر نقش (RBAC) + محدودسازی دامنه کاری (اساتید/دانش‌آموزان)
 */
const db = require('./db');

/** آیا کاربر جاری این دسترسی را دارد؟ */
function can(req, code) {
  if (!req.user) return false;
  if (req.user.user_type === 'admin' && req.userPerms && req.userPerms.has('roles.manage')) {
    return true; // مدیر کل سیستم
  }
  return req.userPerms ? req.userPerms.has(code) : false;
}

/** میدل‌ور دسترسی — در صورت نبود دسترسی، 403 */
function canMiddleware(code) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!can(req, code)) {
      return res.status(403).render('errors/403', {
        title: 'دسترسی غیرمجاز',
        message: 'شما به این بخش دسترسی ندارید.',
      });
    }
    next();
  };
}

/** میدل‌ور یکی از چند دسترسی */
function canAny(...codes) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (codes.some((c) => can(req, c))) return next();
    return res.status(403).render('errors/403', {
      title: 'دسترسی غیرمجاز',
      message: 'شما به این بخش دسترسی ندارید.',
    });
  };
}

/** آیا کاربر مدیر کامل است؟ */
function isSuper(req) {
  return req.user && req.user.user_type === 'admin' && can(req, 'roles.manage');
}

function isAdminType(req) {
  return req.user && ['admin', 'staff'].includes(req.user.user_type);
}

function isTeacher(req) {
  return req.user && req.user.user_type === 'teacher';
}

function isStudent(req) {
  return req.user && req.user.user_type === 'student';
}

/**
 * محدودسازی دامنه کلاس‌ها:
 * - استاد: فقط کلاس‌های خودش
 * - دانش‌آموز: فقط کلاس‌هایی که در آن‌ها ثبت‌نام کرده
 * - سایر: همه
 */
async function classScope(req) {
  if (isTeacher(req)) {
    return { where: 'c.teacher_id = ?', params: [req.user.id] };
  }
  if (isStudent(req)) {
    return {
      where: 'c.id IN (SELECT class_id FROM class_students WHERE student_id = ?)',
      params: [req.user.id],
    };
  }
  return { where: '1=1', params: [] };
}

/** آیا کاربر به این کلاس دسترسی دارد؟ */
async function canAccessClass(req, classId) {
  if (isAdminType(req)) return true;
  if (isTeacher(req)) {
    const row = await db.one('SELECT id FROM classes WHERE id = ? AND teacher_id = ?', [classId, req.user.id]);
    return !!row;
  }
  if (isStudent(req)) {
    const row = await db.one('SELECT id FROM class_students WHERE class_id = ? AND student_id = ?', [classId, req.user.id]);
    return !!row;
  }
  return false;
}

/** آیا کاربر به این دانش‌آموز دسترسی دارد؟ (استاد: از طریق کلاس مشترک) */
async function canAccessStudent(req, studentId) {
  if (isAdminType(req)) return true;
  if (isTeacher(req)) {
    const row = await db.one(
      `SELECT cs.id FROM class_students cs
       JOIN classes c ON c.id = cs.class_id
       WHERE cs.student_id = ? AND c.teacher_id = ?`,
      [studentId, req.user.id]
    );
    return !!row;
  }
  if (isStudent(req)) return req.user.id === studentId;
  return false;
}

module.exports = {
  can,
  canMiddleware,
  canAny,
  isSuper,
  isAdminType,
  isTeacher,
  isStudent,
  classScope,
  canAccessClass,
  canAccessStudent,
};
