"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTING_GROUP_LABELS = exports.SETTINGS = void 0;
exports.findSetting = findSetting;
exports.validateSettingValue = validateSettingValue;
exports.maskSecret = maskSecret;
const zod_1 = require("zod");
const optionalText = (max) => zod_1.z.string().trim().max(max).default('');
const url = zod_1.z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\//i.test(v), {
    message: 'نشانی وب باید با http:// یا https:// شروع شود.',
});
const email = zod_1.z.string().trim().max(190).refine((v) => v === '' || zod_1.z.email().safeParse(v).success, {
    message: 'ایمیل نامعتبر است.',
});
const phone = zod_1.z.string().trim().max(32).refine((v) => v === '' || /^[0-9+\-() ]{6,32}$/.test(v), {
    message: 'شماره تلفن نامعتبر است.',
});
exports.SETTINGS = [
    { key: 'institute.name_official', group: 'institute', labelFa: 'نام رسمی مؤسسه', schema: zod_1.z.string().trim().min(2).max(190), defaultValue: 'مؤسسه آموزشی' },
    { key: 'institute.name_brand', group: 'institute', labelFa: 'نام تجاری', schema: optionalText(120), defaultValue: '' },
    { key: 'institute.slogan', group: 'institute', labelFa: 'شعار مؤسسه', schema: optionalText(190), defaultValue: '' },
    { key: 'institute.description', group: 'institute', labelFa: 'معرفی مؤسسه', schema: optionalText(2000), defaultValue: '', inputType: 'textarea', multiline: true },
    { key: 'institute.phone', group: 'institute', labelFa: 'شماره تماس', schema: phone, defaultValue: '', inputType: 'tel' },
    { key: 'institute.mobile', group: 'institute', labelFa: 'شماره همراه', schema: phone, defaultValue: '', inputType: 'tel' },
    { key: 'institute.email', group: 'institute', labelFa: 'ایمیل', schema: email, defaultValue: '', inputType: 'email' },
    { key: 'institute.address', group: 'institute', labelFa: 'نشانی', schema: optionalText(500), defaultValue: '', inputType: 'textarea', multiline: true },
    { key: 'institute.website', group: 'institute', labelFa: 'وب‌سایت', schema: url, defaultValue: '', inputType: 'url' },
    { key: 'institute.social_links', group: 'institute', labelFa: 'شبکه‌های اجتماعی (یک نشانی در هر خط)', schema: optionalText(1000), defaultValue: '', inputType: 'textarea', multiline: true },
    { key: 'institute.registration_number', group: 'institute', labelFa: 'شماره ثبت', schema: optionalText(64), defaultValue: '' },
    { key: 'institute.national_id', group: 'institute', labelFa: 'شناسه ملی', schema: optionalText(64), defaultValue: '' },
    { key: 'institute.manager_name', group: 'institute', labelFa: 'نام مدیر یا مسئول مؤسسه', schema: optionalText(190), defaultValue: '' },
    { key: 'institute.signatory_name', group: 'institute', labelFa: 'نام مسئول صدور مدارک', schema: optionalText(190), defaultValue: '' },
    { key: 'institute.letterhead_text', group: 'institute', labelFa: 'متن سربرگ اسناد', schema: optionalText(500), defaultValue: '', inputType: 'textarea', multiline: true },
    { key: 'appearance.primary_color', group: 'appearance', labelFa: 'رنگ اصلی هویت بصری', schema: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/, 'کد رنگ باید به شکل #RRGGBB باشد.'), defaultValue: '#1d4ed8', inputType: 'color' },
    { key: 'datetime.calendar', group: 'datetime', labelFa: 'نوع تقویم نمایشی', schema: zod_1.z.enum(['jalali', 'gregorian']), defaultValue: 'jalali', inputType: 'select', options: [{ value: 'jalali', labelFa: 'شمسی' }, { value: 'gregorian', labelFa: 'میلادی' }] },
    { key: 'security.password_min_length', group: 'security', labelFa: 'حداقل طول رمز عبور', schema: zod_1.z.number().int().min(8).max(128), defaultValue: 10, inputType: 'number' },
    { key: 'security.login_max_failures', group: 'security', labelFa: 'حداکثر تلاش ناموفق ورود در ۱۵ دقیقه', schema: zod_1.z.number().int().min(3).max(50), defaultValue: 5, inputType: 'number' },
];
exports.SETTING_GROUP_LABELS = {
    institute: 'اطلاعات مؤسسه',
    appearance: 'ظاهر و هویت بصری',
    datetime: 'تاریخ و زمان',
    security: 'امنیت',
};
function findSetting(key) {
    return exports.SETTINGS.find((s) => s.key === key);
}
/** Validates a raw (form) value against its definition. Returns the typed value or an error message. */
function validateSettingValue(def, raw) {
    const input = def.schema instanceof zod_1.z.ZodNumber && typeof raw === 'string' ? Number(raw.trim()) : raw;
    const result = def.schema.safeParse(input);
    if (!result.success) {
        return { ok: false, message: result.error.issues[0]?.message ?? 'مقدار نامعتبر است.' };
    }
    return { ok: true, value: result.data };
}
/** Masks a sensitive value for display (keeps the last 4 characters only). */
function maskSecret(value) {
    if (!value)
        return '';
    if (value.length <= 4)
        return '••••';
    return '••••••••' + value.slice(-4);
}
