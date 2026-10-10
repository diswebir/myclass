# فرضیات پروژه (محافظه‌کارانه) — پاسخ سؤال‌های §۴

تاریخ: 2026-10-10 — چون پاسخی دریافت نشد، **فرض محافظه‌کارانه** سبت می‌شود (per spec §۴).

| # | سؤال | فرض محافظه‌کارانه | اثر طراحی |
|---|---|---|---|
| 1 | نسخه‌های Node.js هاست | Node 18 یا 20 در Node.js Selector | `engines: >=18`؛ target ES2021؛ خروجی CommonJS (`dist/`)؛ بدون API انحصاری Node 22 (جز node:sqlite که فقط در تست‌های sandbox استفاده می‌شود و با `await import` لود می‌شود) |
| 2 | دسترسی به Cron Jobs | cPanel Cron Jobs در دسترس است | صف پیامک با `dist/jobs/run.js` (روش ۱) + endpoint داخلی (روش ۲) — هر دو مستند در `docs/decisions/sms-cron.md`؛ اگر Cron نباشد، محدودیت مستند می‌شود |
| 3 | سقف RAM/پروسس/دیسک | نامشخص — فرض محافظه‌کارانه: منابع محدود (هاست اشتراکی) | صفحه‌بندی سمت سرور، پردازش مرحله‌ای (SMS, صدور گروهی)، بدون بارگذاری کل داده در حافظه، محدودیت حجم گزارش، log با چرخش |
| 4 | اینترنت از سمت سرور (IPPanel) | فرض: در دسترس است | Adapter IPPanel per مستندات رسمی؛ اگر در دسترس نباشد: ساختار Adapter + UI + Fake Provider ساخته می‌شود و بخش‌های API «تأییدنشده» می‌مانند (per spec §۳) |
| 5 | واحد پول / تقویم | **تومان** (کوچک‌ترین واحد = ۱ تومان، BIGINT) / تقویم **شمسی (جلالی)** پیش‌فرض | تبدیل ریال↔تومان per تنظیمات (CURRENCY_MINOR_PER_MAJOR)؛ نمایش شمسی در UI، ذخیره UTC/DATE در DB |

## فرضیات تکمیلی

- هاست cPanel با Phusion Passenger (Run Node.js App) — اپلیکیشن روی پورت داخلی گوش می‌دهد و Passenger proxy می‌کند.
- مسیر نصب خارج از `public_html` یا در آن — فایل‌های حساس (`.env`, storage, قفل نصب) **خارج از webroot**.
- DB از طریق MySQL Databases cPanel ساخته می‌شود (host=localhost، user/db با prefix هاست).
- HTTPS terminate در Apache — کوکی Secure با `COOKIE_SECURE=auto` (on اگر base URL https باشد).
-olus admin اولیه توسط installer ساخته می‌شود (username/password از فرم نصب) با `must_change_password=1`.
