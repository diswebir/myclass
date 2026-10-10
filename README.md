# myclass — سامانه مدیریت آموزشگاه / مؤسسه

سامانه وب فارسی (RTL) برای مدیریت مؤسسه آموزشی، با Node.js + TypeScript + MySQL/MariaDB که روی هاست اشتراکی cPanel بدون SSH نصب می‌شود.

**وضعیت:** فاز پایه (نصب، کاربران، نقش‌ها و مجوزها، تنظیمات، سوابق، داشبورد پایه، پشتیبان‌گیری از پایگاه داده با راهنما). ماژول‌های دانشجو، کلاس، حضور و غیاب، مالی، گواهی و پیامک هنوز ساخته نشده‌اند. جزئیات دقیق در `project-control/REQUIREMENTS.md` و `project-control/STATE.md` آمده است.

## مستندات
- [نصب روی cPanel (فارسی)](docs/INSTALL_CPANEL_FA.md)
- [پشتیبان‌گیری، بازیابی و به‌روزرسانی](docs/BACKUP_RESTORE_FA.md)
- [کاربران، نقش‌ها و مجوزها](docs/ROLES_AND_PERMISSIONS_FA.md)
- [معماری و ساختار](docs/ARCHITECTURE_FA.md)
- [مشخصات کامل (MASTER_SPEC)](project-control/MASTER_SPEC.md)

## توسعه (بدون SSH روی هاست؛ این دستورات روی ماشین توسعه اجرا می‌شوند)

```bash
npm install
npm run check              # بررسی تایپ TypeScript
npm test                   # build + تست‌های واحد (54 تست)
npm run test:integration   # تست یکپارچه‌سازی؛ بدون TEST_DB_* روی SQLite موقت، با TEST_DB_NAME و TEST_DB_USER روی MySQL
npm start                  # اجرای محلی (نیاز به INSTALL_TOKEN؛ نمونه در .env.example)
./scripts/make-release.sh  # ساخت release/myclass-<version>.zip آماده آپلود روی هاست
```

> `npm run test:integration` با TEST_DB_* جداول را حذف و دوباره می‌سازد. فقط روی یک پایگاه داده **خالی و آزمایشی** اجرا کنید. بدون TEST_DB_* فایل موقت SQLite ساخته و پس از تست حذف می‌شود.

## اصول
- هیچ رمز، کلید API یا اطلاعات هاست در مخزن نیست؛ `.env` در `.gitignore` است.
- پیامک تست بدون پیکربندی صریح ارسال نمی‌شود (در بخش پیامک، هنوز ساخته نشده است).
- زمان‌ها در پایگاه داده UTC و در نمایش به وقت تهران و تقویم شمسی هستند.
- بدون ماژول بومی (native) و بدون Docker.
