/**
 * کاتالوگ مجوزها و نقش‌های سیستمی (per spec §۶-پ و A8).
 * کلید مجوز: 'module.resource.action' — wildcard: 'module.*' و '*:*'
 */

export interface PermissionDef {
  module: string;
  resource: string;
  action: string;
  description: string;
}

export interface RoleDef {
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** لیست مجوزها — wildcard پشتیبانی می‌شود ('finance.*'، '*:*') */
  permissions: string[];
}

export const PERMISSIONS: PermissionDef[] = [
  // users
  { module: 'users', resource: 'users', action: 'list', description: 'فهرست کاربران' },
  { module: 'users', resource: 'users', action: 'create', description: 'ایجاد کاربر' },
  { module: 'users', resource: 'users', action: 'update', description: 'ویرایش کاربر' },
  { module: 'users', resource: 'users', action: 'delete', description: 'غیرفعال‌سازی کاربر' },
  { module: 'users', resource: 'users', action: 'assign_roles', description: 'تخصیص نقش' },
  { module: 'users', resource: 'users', action: 'reset_password', description: 'بازنشانی رمز' },
  // rbac
  { module: 'rbac', resource: 'roles', action: 'list', description: 'مشاهده نقش‌ها' },
  { module: 'rbac', resource: 'roles', action: 'create', description: 'ایجاد نقش' },
  { module: 'rbac', resource: 'roles', action: 'update', description: 'ویرایش نقش' },
  { module: 'rbac', resource: 'roles', action: 'delete', description: 'حذف نقش' },
  { module: 'rbac', resource: 'permissions', action: 'list', description: 'مشاهده مجوزها' },
  // settings
  { module: 'settings', resource: 'settings', action: 'view', description: 'مشاهده تنظیمات' },
  { module: 'settings', resource: 'settings', action: 'update', description: 'ویرایش تنظیمات' },
  { module: 'settings', resource: 'institute', action: 'update', description: 'ویرایش اطلاعات مؤسسه' },
  // audit
  { module: 'audit', resource: 'audit', action: 'view', description: 'مشاهده لاگ ممیزی' },
  // files
  { module: 'files', resource: 'files', action: 'upload', description: 'آپلود فایل' },
  { module: 'files', resource: 'files', action: 'download_all', description: 'دانلود همه فایل‌ها' },
  { module: 'files', resource: 'files', action: 'delete', description: 'حذف فایل' },
  // teachers
  { module: 'teachers', resource: 'teachers', action: 'list', description: 'فهرست اساتید' },
  { module: 'teachers', resource: 'teachers', action: 'create', description: 'ایجاد استاد' },
  { module: 'teachers', resource: 'teachers', action: 'update', description: 'ویرایش استاد' },
  { module: 'teachers', resource: 'teachers', action: 'delete', description: 'حذف استاد' },
  // students
  { module: 'students', resource: 'students', action: 'list', description: 'فهرست فراگیران' },
  { module: 'students', resource: 'students', action: 'view_all', description: 'مشاهده همه فراگیران' },
  { module: 'students', resource: 'students', action: 'create', description: 'ایجاد فراگیر' },
  { module: 'students', resource: 'students', action: 'update', description: 'ویرایش فراگیر' },
  { module: 'students', resource: 'students', action: 'delete', description: 'حذف فراگیر' },
  { module: 'students', resource: 'students', action: 'import', description: 'ورود گروهی CSV' },
  { module: 'students', resource: 'students', action: 'export', description: 'خروجی CSV' },
  // courses / classes / sessions
  { module: 'courses', resource: 'courses', action: 'list', description: 'فهرست دوره‌ها' },
  { module: 'courses', resource: 'courses', action: 'create', description: 'ایجاد دوره' },
  { module: 'courses', resource: 'courses', action: 'update', description: 'ویرایش دوره' },
  { module: 'courses', resource: 'courses', action: 'delete', description: 'حذف دوره' },
  { module: 'classes', resource: 'classes', action: 'list', description: 'فهرست کلاس‌ها' },
  { module: 'classes', resource: 'classes', action: 'manage_all', description: 'مدیریت همه کلاس‌ها' },
  { module: 'classes', resource: 'classes', action: 'create', description: 'ایجاد کلاس' },
  { module: 'classes', resource: 'classes', action: 'update', description: 'ویرایش کلاس' },
  { module: 'classes', resource: 'classes', action: 'delete', description: 'حذف کلاس' },
  { module: 'classes', resource: 'class_teachers', action: 'manage', description: 'مدیریت اساتید کلاس' },
  { module: 'sessions', resource: 'sessions', action: 'list', description: 'فهرست جلسات' },
  { module: 'sessions', resource: 'sessions', action: 'create', description: 'ایجاد جلسه' },
  { module: 'sessions', resource: 'sessions', action: 'update', description: 'ویرایش جلسه' },
  { module: 'sessions', resource: 'sessions', action: 'delete', description: 'حذف جلسه' },
  // preregistration
  { module: 'prereg', resource: 'prereg', action: 'list', description: 'فهرست پیش‌ثبت‌نام‌ها' },
  { module: 'prereg', resource: 'prereg', action: 'review', description: 'بررسی پیش‌ثبت‌نام' },
  { module: 'prereg', resource: 'prereg', action: 'update', description: 'ویرایش پیش‌ثبت‌نام' },
  { module: 'prereg', resource: 'prereg', action: 'convert', description: 'تبدیل به ثبت‌نام' },
  // enrollment
  { module: 'enrollment', resource: 'enrollment', action: 'list', description: 'فهرست ثبت‌نام‌ها' },
  { module: 'enrollment', resource: 'enrollment', action: 'view_all', description: 'مشاهده همه ثبت‌نام‌ها' },
  { module: 'enrollment', resource: 'enrollment', action: 'create', description: 'ثبت‌نام' },
  { module: 'enrollment', resource: 'enrollment', action: 'update', description: 'ویرایش ثبت‌نام' },
  { module: 'enrollment', resource: 'enrollment', action: 'cancel', description: 'لغو ثبت‌نام' },
  // attendance
  { module: 'attendance', resource: 'attendance', action: 'view', description: 'مشاهده حضور' },
  { module: 'attendance', resource: 'attendance', action: 'view_all', description: 'مشاهده همه حضورها' },
  { module: 'attendance', resource: 'attendance', action: 'mark', description: 'ثبت حضور' },
  { module: 'attendance', resource: 'attendance', action: 'correct', description: 'اصلاح حضور' },
  { module: 'attendance', resource: 'attendance', action: 'report', description: 'گزارش حضور' },
  // finance
  { module: 'finance', resource: 'finance', action: 'view_all', description: 'مشاهده همه مالی' },
  { module: 'finance', resource: 'payments', action: 'view_all', description: 'مشاهده همه پرداخت‌ها' },
  { module: 'finance', resource: 'payments', action: 'create', description: 'ثبت پرداخت' },
  { module: 'finance', resource: 'payments', action: 'approve', description: 'تأیید پرداخت' },
  { module: 'finance', resource: 'payments', action: 'reject', description: 'رد پرداخت' },
  { module: 'finance', resource: 'payments', action: 'reverse', description: 'برگشت پرداخت' },
  { module: 'finance', resource: 'installments', action: 'manage', description: 'مدیریت اقساط' },
  { module: 'finance', resource: 'receipts', action: 'review', description: 'بررسی رسید کارت‌به‌کارت' },
  { module: 'finance', resource: 'reports', action: 'view', description: 'گزارش‌های مالی' },
  // certificates
  { module: 'certificates', resource: 'templates', action: 'manage', description: 'مدیریت قالب‌های مدرک' },
  { module: 'certificates', resource: 'certificates', action: 'issue', description: 'صدور مدرک' },
  { module: 'certificates', resource: 'certificates', action: 'view_all', description: 'مشاهده همه مدارک' },
  { module: 'certificates', resource: 'certificates', action: 'revoke', description: 'لغو مدرک' },
  // sms
  { module: 'sms', resource: 'patterns', action: 'manage', description: 'مدیریت پترن‌های پیامک' },
  { module: 'sms', resource: 'events', action: 'manage', description: 'مدیریت رویدادهای پیامک' },
  { module: 'sms', resource: 'queue', action: 'view', description: 'مشاهده صف پیامک' },
  { module: 'sms', resource: 'test_send', action: 'run', description: 'ارسال آزمایشی' },
  // reports / dashboard
  { module: 'reports', resource: 'reports', action: 'view', description: 'گزارش‌ها' },
  { module: 'reports', resource: 'reports', action: 'export', description: 'خروجی گزارش' },
  { module: 'dashboard', resource: 'dashboard', action: 'view', description: 'داشبورد' },
  // backup / modules / health
  { module: 'backup', resource: 'backup', action: 'create', description: 'پشتیبان‌گیری' },
  { module: 'backup', resource: 'backup', action: 'restore', description: 'بازیابی' },
  { module: 'modules', resource: 'modules', action: 'view', description: 'مشاهده ماژول‌ها' },
  { module: 'modules', resource: 'modules', action: 'toggle', description: 'فعال/غیرفعال‌سازی ماژول' },
  { module: 'health', resource: 'health', action: 'view', description: 'صفحه سلامت' },
  // notifications
  { module: 'notifications', resource: 'notifications', action: 'view', description: 'اعلان‌ها' },
  { module: 'notifications', resource: 'notifications', action: 'mark_read', description: 'علامت خوانده‌شدن' },
  // self-service (all authenticated)
  { module: 'self', resource: 'profile', action: 'view', description: 'مشاهده پروفایل' },
  { module: 'self', resource: 'profile', action: 'update', description: 'ویرایش پروفایل' },
  { module: 'self', resource: 'password', action: 'change', description: 'تغییر رمز' },
];

export const SYSTEM_ROLES: RoleDef[] = [
  {
    slug: 'super_admin',
    name: 'مدیرکل',
    description: 'دسترسی کامل سیستم',
    isSystem: true,
    permissions: ['*:*'],
  },
  {
    slug: 'admin',
    name: 'مدیر',
    description: 'مدیریت کاربران، نقش‌ها، تنظیمات و ماژول‌ها',
    isSystem: true,
    permissions: [
      'users.*', 'rbac.*', 'settings.*', 'audit.view', 'files.*',
      'teachers.*', 'students.*', 'courses.*', 'classes.*', 'sessions.*',
      'prereg.*', 'enrollment.*', 'attendance.*', 'finance.*',
      'certificates.*', 'sms.*', 'reports.*', 'dashboard.view',
      'modules.*', 'health.view', 'notifications.*', 'self.*',
    ],
  },
  {
    slug: 'finance',
    name: 'مسئول مالی',
    description: 'امور مالی، پرداخت‌ها، رسیدها و گزارش‌های مالی',
    isSystem: true,
    permissions: [
      'students.list', 'students.view_all', 'classes.list', 'attendance.view_all',
      'attendance.report', 'finance.*', 'reports.*', 'dashboard.view',
      'notifications.*', 'self.*',
    ],
  },
  {
    slug: 'academic',
    name: 'مسئول آموزش',
    description: 'اساتید، فراگیران، دوره‌ها، کلاس‌ها، جلسات، پیش‌ثبت‌نام، ثبت‌نام، حضور، مدارک',
    isSystem: true,
    permissions: [
      'teachers.*', 'students.*', 'courses.*', 'classes.*', 'sessions.*',
      'prereg.*', 'enrollment.*', 'attendance.*', 'certificates.*',
      'reports.view', 'reports.export', 'dashboard.view', 'notifications.*', 'self.*',
    ],
  },
  {
    slug: 'teacher',
    name: 'استاد',
    description: 'کلاس‌های خود، جلسات، ثبت و اصلاح حضور، مشاهده فراگیران کلاس‌های خود (از پنل استاد — نه فهرست کامل فراگیران)',
    isSystem: true,
    permissions: [
      'classes.list', 'sessions.list', 'sessions.update',
      'attendance.view', 'attendance.mark', 'attendance.correct', 'attendance.report',
      'dashboard.view', 'notifications.*', 'self.*',
    ],
  },
  {
    slug: 'student',
    name: 'فراگیر',
    description: 'پروفایل، کلاس‌ها، حضور، امور مالی خود، رسید، مدارک خود',
    isSystem: true,
    permissions: ['self.*', 'dashboard.view', 'notifications.*', 'files.upload'],
  },
];

/** تمام کلیدهای مجوز (unique) */
export function permissionKey(p: PermissionDef): string {
  return `${p.module}.${p.resource}.${p.action}`;
}
