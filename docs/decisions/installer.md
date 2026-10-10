# تصمیم: نصب‌کننده وب (cPanel بدون SSH)

تاریخ: 2026-10-10

## جریان نصب (web installer)

```
GET  /install          → فرم نصب (DB + admin) — فقط وقتی «نصب نشده»
POST /install/check    → بررسی سازگاری (compat check) — نمایش نتایج
POST /install/run      → migration → seed (roles/permissions) → admin → قفل نصب
GET  /install/status   → وضعیت نصب
```

## بررسی سازگاری (compat check)

- نسخه Node (>= 18)
- نوشتن‌پذیری مسیرها: `STORAGE_DIR`، `UPLOAD_DIR`، روت پروژه (برای `.env` و قفل)
- اتصال DB (host/port/name/user/pass) — ping واقعی
- متغیرهای محیطی ضروری: `SESSION_SECRET`، `ENCRYPTION_KEY`
- محدودیت اندازه آپلود (MAX_UPLOAD_MB)

نتیجه: لیست ✅/❌ — خطاها فارسی و **بدون افشای مسیر/جزئیات سرور**.

## قفل نصب

- فایل قفل **خارج از مسیر عمومی** (پیش‌فرض `../storage/.installed` — خارج از webroot)
- پرچم در DB: `system_state['installed'] = '1'` + زمان نصب
- Middleware: اگر نصب شده → `/install/*` غیرفعال (redirect/403). اگر نشده → فقط `/install/*` و `/healthz` در دسترس.
- نصب مجدد ناخواسته ممنوع؛ باز کردن مجدد فقط با `INSTALL_ALLOW_REINSTALL=1` در env (مستند در راهنمای عیب‌یابی).

## مسیر جایگزین: SQL مستقل

- `database/schema.sql` — dump SQL کامل (برای نصب با phpMyAdmin یا import در cPanel) — همان migrationها به SQL.
- `database/seed.sql` — داده اولیه (roles/permissions/permission catalog).
- installer وب در صورت موجود بودن env (`DB_*`) مستقیم متصل می‌شود؛ در غیر این صورت از فرم می‌گیرد و `.env` می‌سازد (خارج از webroot).

## خطاها

- همه خطاها فارسی، کاربرپسند، بدون مسیر فایل/نام هاست/versione DB.
- خطاهای داخلی در `audit_log`/`error log` با جزئیات (سمت سرور) ثبت می‌شوند.

## decisões de design

- installer módulos de código: `src/modules/installer/` (routes, service, checks, views).
- تست: `tests/integration/install.test.ts` — سناریوی نصب کامل با supertest.
