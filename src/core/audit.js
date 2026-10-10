'use strict';
/** ثبت گزارش فعالیت‌ها (Audit Log) برای ردیابی تغییرات حساس */
const { db } = require('./db');
const jalali = require('./jalali');

const AUDIT_LABELS = {
  "attendance.save": "ثبت حضور و غیاب",
  "auth.login": "ورود به سامانه",
  "auth.logout": "خروج از سامانه",
  "certificates.issue": "صدور گواهی",
  "certificates.revoke": "ابطال گواهی",
  "certificates.template_save": "ذخیره قالب گواهی",
  "classes.create": "ایجاد کلاس",
  "classes.delete": "حذف کلاس",
  "classes.duplicate": "کپی کلاس",
  "classes.enroll": "ثبت‌نام در کلاس",
  "classes.grades": "ثبت نمرات",
  "classes.status": "تغییر وضعیت کلاس",
  "classes.update": "ویرایش کلاس",
  "enrollments.delete": "حذف ثبت‌نام",
  "enrollments.status": "تغییر وضعیت ثبت‌نام",
  "installments.remind": "یادآوری قسط",
  "invoices.cancel": "ابطال فاکتور",
  "invoices.create": "صدور فاکتور",
  "invoices.delete": "حذف فاکتور",
  "invoices.discount": "اعمال تخفیف",
  "invoices.schedule": "تغییر اقساط",
  "payments.approve": "تأیید پرداخت",
  "payments.create": "ثبت پرداخت",
  "payments.delete": "حذف پرداخت",
  "payments.reject": "رد پرداخت",
  "portal.receipt_submit": "ارسال رسید کارت به کارت",
  "prereg.approve": "تأیید پیش‌ثبت‌نام",
  "prereg.delete": "حذف پیش‌ثبت‌نام",
  "prereg.status": "تغییر وضعیت پیش‌ثبت‌نام",
  "profile.password_changed": "تغییر رمز عبور",
  "profile.sessions_cleared": "خروج از سایر دستگاه‌ها",
  "profile.update": "ویرایش پروفایل",
  "roles.create": "ایجاد نقش",
  "roles.delete": "حذف نقش",
  "roles.update": "ویرایش نقش",
  "sessions.create": "افزودن جلسه",
  "sessions.delete": "حذف جلسه",
  "sessions.generate": "تولید خودکار جلسات",
  "sessions.update": "ویرایش جلسه",
  "settings.cron_key_regenerated": "تغییر کلید Cron",
  "settings.modules": "تغییر ماژول‌ها",
  "settings.update": "ویرایش تنظیمات",
  "sms.bulk_send": "ارسال پیامک گروهی",
  "sms.pattern_update": "ویرایش پترن پیامک",
  "system.backup": "دریافت پشتیبان",
  "system.migrate": "به‌روزرسانی پایگاه داده",
  "system.restart": "راه‌اندازی مجدد",
  "system.sessions_cleared": "پایان نشست‌ها",
  "users.create": "ایجاد کاربر",
  "users.delete": "حذف کاربر",
  "users.export": "خروجی کاربران",
  "users.import": "ورود گروهی کاربران",
  "users.password_reset": "بازنشانی رمز کاربر",
  "users.unlock": "رفع قفل کاربر",
  "users.update": "ویرایش کاربر",
  "auth.failed": "ورود ناموفق"
  };

function auditLabel(a) { return AUDIT_LABELS[a] || a; }

async function audit(req, action, entity = null, entityId = null, details = null) {
  try {
    await db('audit_logs').insert({
      user_id: (req && req.user && req.user.id) || null,
      action: String(action).slice(0, 100),
      entity: entity ? String(entity).slice(0, 50) : null,
      entity_id: entityId ? Number(entityId) : null,
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 5000) : null,
      ip: req ? String(req.ip || '').slice(0, 45) : null,
      user_agent: req ? String(req.get('user-agent') || '').slice(0, 255) : null,
      created_at: jalali.now(),
    });
  } catch (e) {
    console.error('[audit] failed:', e.message);
  }
}

module.exports = { audit, auditLabel, AUDIT_LABELS };
