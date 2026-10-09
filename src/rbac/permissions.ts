/**
 * Permission catalogue. Each module contributes permissions with the pattern `<module>.<operation>`.
 * New modules register their permissions here (or via a module manifest) so that they are synced to
 * the database on install/migration and can be assigned to roles from the admin UI.
 */
export interface PermissionDef {
  code: string;
  module: string;
  description: string;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  { code: 'dashboard.view', module: 'dashboard', description: 'مشاهده داشبورد مدیریتی' },
  { code: 'users.view', module: 'users', description: 'مشاهده کاربران' },
  { code: 'users.create', module: 'users', description: 'ایجاد کاربر' },
  { code: 'users.update', module: 'users', description: 'ویرایش اطلاعات کاربر' },
  { code: 'users.status', module: 'users', description: 'فعال/غیرفعال‌کردن حساب کاربر' },
  { code: 'users.reset_password', module: 'users', description: 'بازنشانی رمز عبور کاربر' },
  { code: 'users.sessions_revoke', module: 'users', description: 'خروج اجباری کاربر از نشست‌ها' },
  { code: 'roles.view', module: 'roles', description: 'مشاهده نقش‌ها و مجوزها' },
  { code: 'roles.manage', module: 'roles', description: 'ایجاد، ویرایش و حذف نقش‌ها' },
  { code: 'settings.view', module: 'settings', description: 'مشاهده تنظیمات' },
  { code: 'settings.update', module: 'settings', description: 'ویرایش تنظیمات' },
  { code: 'audit.view', module: 'audit', description: 'مشاهده سوابق حسابرسی و امنیتی' },
  { code: 'system.health.view', module: 'system', description: 'مشاهده وضعیت سلامت سامانه' },
  { code: 'system.migrate', module: 'system', description: 'اجرای migration پایگاه داده (به‌روزرسانی ساختار)' },
] as const;

export const ALL_PERMISSION_CODES: readonly string[] = PERMISSIONS.map((p) => p.code);

export const SUPER_ADMIN_ROLE = 'super_admin';

export interface SystemRoleDef {
  slug: string;
  nameFa: string;
  description: string;
  /** System roles cannot be deleted; super_admin additionally always has every permission. */
  permissions: readonly string[];
}

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    slug: SUPER_ADMIN_ROLE,
    nameFa: 'مدیر اصلی سامانه',
    description: 'دسترسی کامل به همه بخش‌ها. این نقش قابل حذف یا غیرفعال‌سازی نیست.',
    permissions: ALL_PERMISSION_CODES,
  },
  {
    slug: 'institute_admin',
    nameFa: 'مدیر اجرایی مؤسسه',
    description: 'مدیریت کاربران عادی و مشاهده تنظیمات و گزارش‌ها.',
    permissions: [
      'dashboard.view',
      'users.view',
      'users.create',
      'users.update',
      'users.status',
      'users.sessions_revoke',
      'settings.view',
      'audit.view',
    ],
  },
];

/**
 * Anti-escalation rule: an actor may grant a role only if they already hold every permission in it.
 * Returns the missing permission codes (empty array = allowed).
 */
export function missingGrantablePermissions(actor: ReadonlySet<string>, requested: readonly string[]): string[] {
  return requested.filter((code) => !actor.has(code));
}

export function hasAllPermissions(actor: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.every((code) => actor.has(code));
}

export function isKnownPermission(code: string): boolean {
  return ALL_PERMISSION_CODES.includes(code);
}
