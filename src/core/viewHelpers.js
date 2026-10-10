/**
 * کمک‌کننده‌های نما (View Locals) — در دسترس تمام قالب‌ها
 */
const fmt = require('./helpers/format');
const j = require('./helpers/jalali');
const settings = require('./settings');
const rbac = require('./rbac');
const { icon } = require('./icons');

/** پیام‌های لحظه‌ای (Flash) */
function flash(req, type, text) {
  req.session.flash = { type, text };
}

function popFlash(req) {
  const f = req.session.flash;
  if (f) delete req.session.flash;
  return f;
}

/** منوی کناری بر اساس دسترسی‌ها و ماژول‌های فعال */
function buildNav(req, enabledModules) {
  const items = [
    { code: 'dashboard', title: 'داشبورد', href: '/panel', icon: 'grid', perm: 'dashboard.view' },
    { code: 'classes', title: 'کلاس‌ها', href: '/panel/classes', icon: 'book', perm: 'classes.view' },
    { code: 'attendance', title: 'حضور و غیاب', href: '/panel/attendance', icon: 'check-square', perm: 'attendance.view' },
    { code: 'students', title: 'دانش‌آموزان', href: '/panel/students', icon: 'users', perm: 'students.view' },
    { code: 'teachers', title: 'اساتید', href: '/panel/teachers', icon: 'user-check', perm: 'teachers.view' },
    { code: 'enrollments', title: 'پیش‌ثبت‌نام‌ها', href: '/panel/enrollments', icon: 'clipboard', perm: 'enrollments.view', badgeKey: 'pendingEnrollments' },
    { code: 'payments', title: 'مالی و پرداخت‌ها', href: '/panel/payments', icon: 'wallet', perm: 'payments.view' },
    { code: 'certificates', title: 'مدارک و گواهی‌ها', href: '/panel/certificates', icon: 'award', perm: 'certificates.view' },
    { code: 'sms', title: 'پنل پیامک', href: '/panel/sms', icon: 'message', perm: 'sms.view' },
    { code: 'reports', title: 'گزارش‌ها', href: '/panel/reports', icon: 'bar-chart', perm: 'reports.view' },
    { code: 'users', title: 'کاربران', href: '/panel/users', icon: 'user', perm: 'users.view' },
    { code: 'roles', title: 'سطوح دسترسی', href: '/panel/roles', icon: 'shield', perm: 'roles.view' },
    { code: 'settings', title: 'تنظیمات', href: '/panel/settings', icon: 'settings', perm: 'settings.view' },
    { code: 'modules', title: 'ماژول‌های سیستم', href: '/panel/modules', icon: 'package', perm: 'modules.manage' },
    { code: 'audit', title: 'گزارش رویدادها', href: '/panel/audit', icon: 'activity', perm: 'audit.view' },
  ];
  return items.filter((it) => {
    if (!rbac.can(req, it.perm)) return false;
    if (it.code !== 'dashboard' && !enabledModules.has(it.code)) return false;
    return true;
  });
}

async function viewLocals(req, res, next) {
  res.locals.fmt = fmt;
  res.locals.j = j;
  res.locals.icon = icon;
  res.locals.req = req;
  res.locals.currentPath = req.path;
  res.locals.basePath = require('./config').basePath || '';
  res.locals.query = req.query || {};

  // تنظیمات پایه برای هدر و برندینگ
  try {
    const s = await settings.all();
    res.locals.S = s;
    res.locals.instituteName = s.institute_name || 'موسسه آموزشی';
    res.locals.panelTitle = s.panel_title || 'سامانه مدیریت کلاس‌ها';
    res.locals.currencyLabel = s.currency_label || 'تومان';
    res.locals.themeAccent = s.theme_accent || '#4f46e5';
  } catch {
    res.locals.S = {};
    res.locals.instituteName = 'موسسه آموزشی';
    res.locals.panelTitle = 'سامانه مدیریت کلاس‌ها';
    res.locals.currencyLabel = 'تومان';
    res.locals.themeAccent = '#4f46e5';
  }

  // ماژول‌های فعال
  let enabled = new Set();
  try {
    const rows = await require('./db').query('SELECT code FROM system_modules WHERE is_enabled = 1');
    enabled = new Set(rows.map((r) => r.code));
  } catch {}
  res.locals.enabledModules = enabled;

  // دسترسی‌ها
  res.locals.can = (code) => rbac.can(req, code);
  res.locals.isTeacher = rbac.isTeacher(req);
  res.locals.isStudent = rbac.isStudent(req);
  res.locals.isAdminType = rbac.isAdminType(req);

  // فلش
  res.locals.flash = popFlash(req);

  // منو
  res.locals.navItems = req.user ? buildNav(req, enabled) : [];

  next();
}

module.exports = { viewLocals, flash, popFlash, buildNav };
