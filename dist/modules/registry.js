"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULES = void 0;
exports.MODULES = [
    { id: 'core.install', nameFa: 'نصب و راه‌اندازی', version: '0.1.0', dependencies: [], core: true },
    { id: 'core.auth', nameFa: 'احراز هویت و نشست‌ها', version: '0.1.0', dependencies: [], core: true },
    { id: 'core.rbac', nameFa: 'نقش‌ها و مجوزها (RBAC)', version: '0.1.0', dependencies: ['core.auth'], core: true },
    { id: 'core.users', nameFa: 'مدیریت کاربران', version: '0.1.0', dependencies: ['core.rbac'], core: true },
    { id: 'core.settings', nameFa: 'تنظیمات مؤسسه و سامانه', version: '0.1.0', dependencies: ['core.rbac'], core: true },
    { id: 'core.audit', nameFa: 'ثبت رویدادها و حسابرسی', version: '0.1.0', dependencies: ['core.rbac'], core: true },
    { id: 'core.dashboard', nameFa: 'داشبورد', version: '0.1.0', dependencies: ['core.rbac'], core: true },
];
