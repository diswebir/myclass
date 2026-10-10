# راهنمای ساخت پایگاه داده و اتصال

این راهنمای ساخت پایگاه داده و اتصال است.

## گام ۱

1. در cPanel وارد **MySQL Databases** شوید.
2. ساخت (**Create New Database**): مثلاً `user_myclass`
3. افزودن (**Add New User**): مثلاً `user_myclass` با رمز عبور قوی.
4. (**Add User To Database**) کاربر را به پایگاه داده متصل کنید و **ALL PRIVILEGES** کنید.

> نکته: آدرس `DB_HOST` در cPanel `localhost` است.

## گام ۲ — مقادیر اتصال

در `.env`:

```
DB_DRIVER=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=user_myclass
DB_USER=user_myclass
DB_PASSWORD=رمز قوی
```

> هشدار: رمز عبور پایگاه داده را هرگز در `public_html` یا مخزن git نگه دارید.

## گام ۳ — اجرا‌ی migrationهای

### روش — Installer (پیشنهادی)

نصب `/install` از صفحه‌ی: اجرا‌ی migrationهای و داده‌های اولیه را seed می‌کند.

### روش — CLI

```
npm run migrate
```

### روش — فایل SQL مستقل (`db/schema.sql`)

اگر به CLI دسترسی ندارید، فایل `db/schema.sql` (SQL MariaDB) را در **phpMyAdmin > Import** اجرا کنید؛ سپس installer یا `npm run migrate` داده‌های اولیه را تکمیل کنید.

> نکته‌ی: فایل `db/schema.sql` معادل migration است (ساختار جدول‌ها).

## گام ۴ — انتخاب sqlite

اگر `DB_DRIVER=sqlite` است، نیازی به ساخت سرور DB نیست:

```
DB_DRIVER=sqlite
DB_SQLITE_PATH=../storage/myclass.sqlite
```

- داده‌های اولیه در فایل sqlite ذخیره می‌شوند
- نصب از راه installer یا `npm run migrate` اجرا می‌کند.

## گام ۵

1. اپ را **Restart** کنید.
2. `/admin/health` را باز کنید — وضعیت **db** باید `ok` است.
3. از `/install` نصب را تکمیل کنید.

برای رفع خطا، `09-troubleshooting.md` را باز کنید.
