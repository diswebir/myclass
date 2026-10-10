# راهنمای تنظیم اپلیکیشن Node.js در cPanel

این راهنمای تنظیم اپلیکیشن Node.js در cPanel است. قبل از شروع، `01-install-cpanel.md` را بررسی کنید.

## گام ۱ — ساخت اپلیکیشن

1. در cPanel وارد **Setup Node.js App** شوید.
2. روی دکمه‌ی **Create Application** را انتخاب کنید.
3. مقادیر را وارد کنید:
   - **Node.js version**: نسخه‌ی LTS (مثلاً ۲۰ یا ۲۲)
   - **Application mode**: `Production`
   - **Application root**: `/home/USER/myclass`
   - **Application URL**: دامنه یا زیر دامنه
   - **Application startup file**: `dist/index.js`
4. روی **Create** را انتخاب کنید.

## گام ۲ — نصب وابستگی‌ها

- روی دکمه‌ی **Run NPM Install** را انتخاب کنید (معادل `npm install`).
- اگر `dist/` موجود نیست، build را اجرا کنید: **Run NPM Run Script** ← `build` (یا `npm run build`).

> نکته: پروژه در ZIP نهایی `dist/` ساخته‌شده دارد؛ اگر `dist/` را حذف کرده‌اید، `npm run build` را اجرا کنید.

## گام ۳ — متغیرهای محیطی

بخش **Environment variables** را باز کنید و مقادیر را از `.env.example` تنظیم کنید:

| متغیر | مقدار | توضیح |
|---|---|---|
| `NODE_ENV` | `production` | محیط اجرا |
| `PORT` | `3000` | پورت توسط Passenger مدیریت می‌شود |
| `APP_BASE_URL` | `https://example.com` | آدرس کامل دامنه |
| `DB_DRIVER` | `mysql` یا `sqlite` | نوع پایگاه داده |
| `SESSION_SECRET` | رشته‌ی تصادفی ۳۲ کاراکتر | امضا نشست |
| `ENCRYPTION_KEY` | ۶۴ کاراکتر | رمزنگاری مقادیر حساس |

> هشدار: کلیدها و رمزها را هرگز در `public_html` یا مخزن گیت نگه دارید.

## گام ۴ — اجرا و راه‌اندازی

1. روی **Restart App** را انتخاب کنید.
2. اپلیکیشن باید وضعیت **Running** بدهد.
3. لاگ‌ها: **Log** (stdout/stderr) و cPanel **Error Log**.

## عیب‌یابی

- **اپلیکیشن خطا می‌کند**: در بیشتر حالتها `dist/index.js` موجود نیست ← `npm run build`.
- **خطا‌ی اتصال DB**: مقدار `DB_HOST` (`localhost`) و پایگاه داده را بررسی کنید.
- **خطا‌ی پورت**: در cPanel پورت توسط Passenger مدیریت می‌شود؛ تغییر `PORT` توصیه نمی‌شود.

برای موارد بیشتر، `09-troubleshooting.md` را باز کنید.
