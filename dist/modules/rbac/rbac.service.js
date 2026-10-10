"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacService = exports.SYSTEM_PERMISSIONS_CATALOG = void 0;
const errors_1 = require("../../core/errors");
exports.SYSTEM_PERMISSIONS_CATALOG = [
    {
        module: 'courses',
        moduleTitleFa: 'دوره‌ها و کلاس‌ها',
        permissions: [
            { key: 'courses.read', titleFa: 'مشاهده دوره‌ها و کلاس‌ها' },
            { key: 'courses.write', titleFa: 'ایجاد و ویرایش دوره‌ها' },
            { key: 'courses.delete', titleFa: 'حذف دوره' },
            { key: 'classes.read', titleFa: 'مشاهده جزئیات کلاس‌ها' },
            { key: 'classes.write', titleFa: 'ایجاد و ویرایش کلاس' },
            { key: 'classes.delete', titleFa: 'حذف کلاس' },
        ]
    },
    {
        module: 'teachers',
        moduleTitleFa: 'مدیریت اساتید',
        permissions: [
            { key: 'teachers.read', titleFa: 'مشاهده پرونده اساتید' },
            { key: 'teachers.write', titleFa: 'ایجاد و ویرایش مشخصات استاد' },
            { key: 'teachers.assign', titleFa: 'تخصیص استاد به کلاس' },
            { key: 'teachers.delete', titleFa: 'حذف یا غیرفعال‌سازی استاد' },
        ]
    },
    {
        module: 'students',
        moduleTitleFa: 'مدیریت فراگیران',
        permissions: [
            { key: 'students.read', titleFa: 'مشاهده پرونده فراگیران' },
            { key: 'students.write', titleFa: 'ایجاد و ویرایش فراگیر' },
            { key: 'students.import', titleFa: 'ورود گروهی فراگیران با CSV' },
            { key: 'students.export', titleFa: 'خروجی اکسل/CSV فراگیران' },
            { key: 'students.delete', titleFa: 'حذف یا بایگانی فراگیر' },
        ]
    },
    {
        module: 'preregistration',
        moduleTitleFa: 'پیش‌ثبت‌نام و ثبت‌نام',
        permissions: [
            { key: 'preregistration.read', titleFa: 'مشاهده درخواست‌های پیش‌ثبت‌نام' },
            { key: 'preregistration.review', titleFa: 'تأیید، رد یا درخواست اصلاح' },
            { key: 'enrollment.read', titleFa: 'مشاهده ثبت‌نام‌های قطعی' },
            { key: 'enrollment.create', titleFa: 'ثبت‌نام قطعی دانشجو در کلاس' },
            { key: 'enrollment.cancel', titleFa: 'انصراف یا لغو ثبت‌نام' },
        ]
    },
    {
        module: 'attendance',
        moduleTitleFa: 'حضور و غیاب',
        permissions: [
            { key: 'attendance.read', titleFa: 'مشاهده گزارش حضور و غیاب' },
            { key: 'attendance.record', titleFa: 'ثبت و ویرایش حضور و غیاب' },
            { key: 'attendance.export', titleFa: 'خروجی گزارش حضور و غیاب' },
        ]
    },
    {
        module: 'finance',
        moduleTitleFa: 'امور مالی و اقساط',
        permissions: [
            { key: 'finance.read', titleFa: 'مشاهده سوابق و وضعیت مالی' },
            { key: 'finance.installments', titleFa: 'مدیریت و زمان‌بندی اقساط' },
            { key: 'finance.review_receipts', titleFa: 'بررسی و تأیید فیش کارت‌به‌کارت' },
            { key: 'finance.record_payment', titleFa: 'ثبت پرداخت نقدی یا دستی' },
            { key: 'reports.finance', titleFa: 'مشاهده گزارش‌های درآمد و بدهکاران' },
        ]
    },
    {
        module: 'certificates',
        moduleTitleFa: 'مدارک و گواهینامه‌ها',
        permissions: [
            { key: 'certificates.read', titleFa: 'مشاهده مدارک صادرشده' },
            { key: 'certificates.issue', titleFa: 'صدور تکی و گروهی مدرک' },
            { key: 'certificates.revoke', titleFa: 'ابطال مدرک با ذکر دلیل' },
            { key: 'certificates.templates', titleFa: 'مدیریت قالب‌های مدرک' },
        ]
    },
    {
        module: 'sms',
        moduleTitleFa: 'سامانه پیامک',
        permissions: [
            { key: 'sms.read', titleFa: 'مشاهده صف و تاریخچه پیامک‌ها' },
            { key: 'sms.templates', titleFa: 'مدیریت الگوها و نگاشت متغیرها' },
            { key: 'sms.send_test', titleFa: 'ارسال پیامک تستی' },
            { key: 'sms.settings', titleFa: 'تنظیمات اتصال IPPanel' },
        ]
    },
    {
        module: 'settings',
        moduleTitleFa: 'تنظیمات و امنیت',
        permissions: [
            { key: 'settings.manage', titleFa: 'ویرایش تنظیمات عمومی مؤسسه' },
            { key: 'users.manage', titleFa: 'مدیریت کاربران و کلمات عبور' },
            { key: 'roles.manage', titleFa: 'مدیریت نقش‌ها و دسترسی‌ها' },
            { key: 'audit.read', titleFa: 'مشاهده لاگ وقایع امنیتی' },
            { key: 'backup.manage', titleFa: 'تهیه و بازیابی نسخه پشتیبان' },
        ]
    }
];
class RbacService {
    db;
    constructor(db) {
        this.db = db;
    }
    async getAllRoles() {
        const roles = await this.db.selectFrom('roles').selectAll().orderBy('id', 'asc').execute();
        // Add user count per role
        const rolesWithCounts = await Promise.all(roles.map(async (r) => {
            const userCountRes = await this.db
                .selectFrom('users')
                .where('role_id', '=', r.id)
                .where('deleted_at', 'is', null)
                .select(this.db.fn.count('id').as('count'))
                .executeTakeFirst();
            let permissions = [];
            try {
                permissions = JSON.parse(r.permissions_json);
            }
            catch {
                permissions = [];
            }
            return {
                ...r,
                permissions,
                userCount: Number(userCountRes?.count || 0)
            };
        }));
        return rolesWithCounts;
    }
    async getRoleById(roleId) {
        const role = await this.db.selectFrom('roles').where('id', '=', roleId).selectAll().executeTakeFirst();
        if (!role)
            throw new errors_1.NotFoundError('نقش مورد نظر یافت نشد.');
        let permissions = [];
        try {
            permissions = JSON.parse(role.permissions_json);
        }
        catch {
            permissions = [];
        }
        return {
            ...role,
            permissions
        };
    }
    async createRole(data) {
        if (!data.name || !data.titleFa) {
            throw new errors_1.ValidationError('نام شناسه انگلیسی و عنوان فارسی نقش الزامی است.');
        }
        const cleanName = data.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const existing = await this.db.selectFrom('roles').where('name', '=', cleanName).select('id').executeTakeFirst();
        if (existing) {
            throw new errors_1.ConflictError('نقشی با این شناسه انگلیسی قبلاً تعریف شده است.');
        }
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const result = await this.db.insertInto('roles').values({
            name: cleanName,
            title_fa: data.titleFa.trim(),
            is_system: 0,
            permissions_json: JSON.stringify(data.permissions || []),
            created_at: now,
            updated_at: now
        }).execute();
        return result;
    }
    async updateRole(roleId, data) {
        const role = await this.getRoleById(roleId);
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const updates = {
            updated_at: now
        };
        if (data.titleFa) {
            updates.title_fa = data.titleFa.trim();
        }
        if (data.permissions) {
            // If super_admin, keep '*'
            if (role.name === 'super_admin') {
                updates.permissions_json = JSON.stringify(['*']);
            }
            else {
                updates.permissions_json = JSON.stringify(data.permissions);
            }
        }
        await this.db.updateTable('roles').set(updates).where('id', '=', roleId).execute();
    }
    async deleteRole(roleId) {
        const role = await this.getRoleById(roleId);
        if (role.is_system) {
            throw new errors_1.ValidationError('نقش‌های سیستمی پیش‌فرض قابل حذف نیستند.');
        }
        const usersWithRole = await this.db
            .selectFrom('users')
            .where('role_id', '=', roleId)
            .where('deleted_at', 'is', null)
            .select('id')
            .execute();
        if (usersWithRole.length > 0) {
            throw new errors_1.ValidationError(`امکان حذف این نقش وجود ندارد زیرا ${usersWithRole.length} کاربر به آن اختصاص دارند.`);
        }
        await this.db.deleteFrom('roles').where('id', '=', roleId).execute();
    }
}
exports.RbacService = RbacService;
