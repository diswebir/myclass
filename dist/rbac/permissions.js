"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYSTEM_ROLES = exports.SUPER_ADMIN_ROLE = exports.ALL_PERMISSION_CODES = exports.PERMISSIONS = void 0;
exports.missingGrantablePermissions = missingGrantablePermissions;
exports.hasAllPermissions = hasAllPermissions;
exports.isKnownPermission = isKnownPermission;
exports.PERMISSIONS = [
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
];
exports.ALL_PERMISSION_CODES = exports.PERMISSIONS.map((p) => p.code);
exports.SUPER_ADMIN_ROLE = 'super_admin';
exports.SYSTEM_ROLES = [
    {
        slug: exports.SUPER_ADMIN_ROLE,
        nameFa: 'مدیر اصلی سامانه',
        description: 'دسترسی کامل به همه بخش‌ها. این نقش قابل حذف یا غیرفعال‌سازی نیست.',
        permissions: exports.ALL_PERMISSION_CODES,
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
function missingGrantablePermissions(actor, requested) {
    return requested.filter((code) => !actor.has(code));
}
function hasAllPermissions(actor, required) {
    return required.every((code) => actor.has(code));
}
function isKnownPermission(code) {
    return exports.ALL_PERMISSION_CODES.includes(code);
}
