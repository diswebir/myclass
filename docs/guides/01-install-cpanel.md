# راهنمای نصب روی cPanel

myclass یک پلتفرم مدیریت مؤسسه آموزشی است.

> نسخه‌ی ZIP `myclass-cpanel-<version>.zip` — فهرست محتوا: `project-control/ZIP_MANIFEST.md`

## نیازمندی‌ها

- هاست اشتراکی cPanel
- MariaDB (MySQL) — یا SQLite برای نصب ساده/تست
- یک دامنه یا زیر دامنه

## گام ۱ بارگذاری ZIP

1. از cPanel وارد **File Manager** شوید.
2. فایل `myclass-cpanel-<version>.zip` را در پوشه‌ی **home** بارگذاری کنید (خارج از `public_html`).
3. گزینه‌ی **Extract** را انتخاب کنید — پوشه‌ی `myclass/` ساخته می‌شود.

> نکته‌ی امنیتی: کد منبع و `.env` هرگز داخل `public_html` نباشد.

## گام ۲ نصب وابستگی‌ها

1. وارد **Setup Node.js App** شوید.
2. **Application root**: `/home/USER/myclass`
3. **Application startup file**: `dist/index.js`
4. گزینه‌ی **Run NPM Install** را انتخاب کنید (یا `npm install --omit=dev`).
5. اگر `dist/` نبود: `npm run build` اجرا کنید (ZIP نهایی شامل `dist/` است).

## گام ۳ متغیرهای محیطی (.env)

در **Setup Node.js App > Environment variables** مقادیر را از `.env.example` تنظیم کنید:

- `NODE_ENV=production`، `APP_BASE_URL` (آدرس واقعی دامنه)، `DB_*`، `SESSION_SECRET`، `ENCRYPTION_KEY` (`openssl rand -hex 32`)

## گام ۴ پایگاه داده

اگر `DB_DRIVER=mysql` است در **MySQL Databases** پایگاه داده و کاربر را ایجاد کنید و مقادیر را وارد کنید — برای جزئیات `03-database-setup.md`.

اگر `DB_DRIVER=sqlite` است نیازی به ساخت DB نیست.

مسیر `DB_SQLITE_PATH` داخل `STORAGE_DIR` نگه دارید.

## گام ۵ اجرا و راه‌اندازی

1. اپ را **Restart** کنید.
2. آدرس دامنه را باز کنید — صفحه‌ی نصب نمایش داده می‌شود.
3. فرم نصب را پر کنید و نصب را فعال کنید. این کار به‌صورت خودکار اجرا می‌شود
   - migrationهای پایگاه داده را اجرا می‌کند (معادل مستقل `db/schema.sql` نیز در ZIP موجود است),
   - داده‌های اولیه را seed می‌کند (نقش‌ها، مجوزها، تنظیمات و کاربر مدیر),
   - فایل `.env` و قفل نصب را می‌سازد.
4. با حساب مدیر وارد شوید. در ورود اول، سیستم از شما تغییر رمز عبور می‌خواهد.

## گام ۶ بررسی نصب

- `/` ← داشبورد
- `/admin/health` ← سلامت سیستم
- `/verify/<token>` ← صفحه عمومی

## در صورت خطا

برای رفع خطا `09-troubleshooting.md` باز کنید:

- خطا‌ی اتصال DB (`DB_HOST` = `localhost`),
- خطا‌ی: `ENCRYPTION_KEY` — طول ۶۴ hex,
- خطا‌ی راه‌اندازی — لاگ `storage/logs/` و **Error Log** cPanel.
- خطای `Cannot find module ... dist/index.js` — یعنی `dist/` ساخته نشده است؛ ابتدا `npm run build` را اجرا کنید (راهنمای 09).
- روی Windows — دستور `PORT=3040 npm start` کار نمی‌کند؛ در CMD: `set PORT=3040 && npm start`، در PowerShell: `$env:PORT=3040; npm start`.
