"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModulesService = void 0;
class ModulesService {
    modules = new Map();
    constructor() {
        this.registerCoreModules();
    }
    registerCoreModules() {
        const list = [
            {
                id: 'auth',
                nameFa: 'احراز هویت و امنیت نشست‌ها',
                version: '1.0.0',
                descriptionFa: 'مدیریت ورود، خروج، نشست‌های فعال دیتابیس و توکن‌های CSRF',
                status: 'active',
                dependencies: [],
                permissions: [],
                routesPrefix: '/auth'
            },
            {
                id: 'rbac',
                nameFa: 'مدیریت نقش‌ها و دسترسی‌ها (RBAC)',
                version: '1.0.0',
                descriptionFa: 'سامانه کنترل دسترسی تفکیکی بر اساس ماژول و منبع',
                status: 'active',
                dependencies: ['auth'],
                permissions: ['roles.manage'],
                routesPrefix: '/admin/roles'
            },
            {
                id: 'users',
                nameFa: 'مدیریت کاربران سامانه',
                version: '1.0.0',
                descriptionFa: 'پرونده کاربران، تغییر رمز، فعال/غیرفعال‌سازی',
                status: 'active',
                dependencies: ['auth', 'rbac'],
                permissions: ['users.manage'],
                routesPrefix: '/admin/users'
            },
            {
                id: 'courses',
                nameFa: 'دوره‌ها، کلاس‌ها و زمان‌بندی',
                version: '1.0.0',
                descriptionFa: 'مدیریت دوره‌های آموزشی، ظرفیت، شهریه، جلسات و تشخیص تداخل',
                status: 'active',
                dependencies: ['auth'],
                permissions: ['courses.read', 'classes.read'],
                routesPrefix: '/admin/classes'
            },
            {
                id: 'teachers',
                nameFa: 'مدیریت اساتید و پنل استاد',
                version: '1.0.0',
                descriptionFa: 'پرونده پرسنلی اساتید، تخصیص چندگانه به کلاس و دسترسی ایزوله',
                status: 'active',
                dependencies: ['auth', 'courses'],
                permissions: ['teachers.read', 'teacher_portal.access'],
                routesPrefix: '/teacher'
            },
            {
                id: 'students',
                nameFa: 'مدیریت فراگیران و ورود گروهی CSV',
                version: '1.0.0',
                descriptionFa: 'پرونده تحصیلی، کد یکتا، ورود امن با فرمت CSV و پنل اختصاصی',
                status: 'active',
                dependencies: ['auth'],
                permissions: ['students.read', 'student_portal.access'],
                routesPrefix: '/student'
            },
            {
                id: 'preregistration',
                nameFa: 'پیش‌ثبت‌نام آنلاین و کد پیگیری',
                version: '1.0.0',
                descriptionFa: 'فرم‌های عمومی ثبت‌نام، پیگیری وضعیت و تبدیل کنترل‌شده به ثبت‌نام قطعی',
                status: 'active',
                dependencies: ['courses'],
                permissions: ['preregistration.read'],
                routesPrefix: '/preregister'
            },
            {
                id: 'attendance',
                nameFa: 'حضور و غیاب کلاسی هوشمند',
                version: '1.0.0',
                descriptionFa: 'ثبت جلسه‌محور، درصد حضور، هشدار غیبت مازاد و گزارش',
                status: 'active',
                dependencies: ['courses', 'teachers', 'students'],
                permissions: ['attendance.read', 'attendance.record'],
                routesPrefix: '/admin/attendance'
            },
            {
                id: 'finance',
                nameFa: 'امور مالی، اقساط و فیش‌های بانکی',
                version: '1.0.0',
                descriptionFa: 'تقسیط شهریه، تأیید فیش کارت‌به‌کارت، دفتر کل و گزارش بدهکاران',
                status: 'active',
                dependencies: ['students', 'courses'],
                permissions: ['finance.read', 'finance.review_receipts'],
                routesPrefix: '/admin/finance'
            },
            {
                id: 'certificates',
                nameFa: 'صدور و اعتبارسنجی مدارک با QR',
                version: '1.0.0',
                descriptionFa: 'کنترل خودکار شروط حضور و تسویه، کد یکتا، صفحه استعلام عمومی و ابطال',
                status: 'active',
                dependencies: ['courses', 'attendance', 'finance'],
                permissions: ['certificates.read', 'certificates.issue'],
                routesPrefix: '/admin/certificates'
            },
            {
                id: 'sms',
                nameFa: 'سامانه پیامک الگو محور IPPanel',
                version: '1.0.0',
                descriptionFa: 'آداپتور رسمی Edge API، نگاشت پویا متغیرها و صف پردازش پس‌زمینه',
                status: 'active',
                dependencies: ['settings'],
                permissions: ['sms.read', 'sms.templates'],
                routesPrefix: '/admin/sms'
            },
            {
                id: 'dashboard',
                nameFa: 'داشبورد مدیریتی و نمودارهای زنده',
                version: '1.0.0',
                descriptionFa: 'شاخص‌های کلیدی عملکرد بر اساس پرس‌وجوهای زنده پایگاه داده',
                status: 'active',
                dependencies: ['auth'],
                permissions: [],
                routesPrefix: '/admin'
            },
            {
                id: 'backup',
                nameFa: 'پشتیبان‌گیری و بازیابی پایگاه داده',
                version: '1.0.0',
                descriptionFa: 'تولید فایل SQL بدون نیاز به دستورات باینری سرور (مخصوص cPanel)',
                status: 'active',
                dependencies: ['auth'],
                permissions: ['backup.manage'],
                routesPrefix: '/admin/backup'
            }
        ];
        for (const m of list) {
            this.modules.set(m.id, m);
        }
    }
    getAllModules() {
        return Array.from(this.modules.values());
    }
    getModule(id) {
        return this.modules.get(id);
    }
}
exports.ModulesService = ModulesService;
