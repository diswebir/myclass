# PROJECT_STATUS.md — پلتفرم مدیریت مؤسسه آموزشی (myclass)

> این فایل گزارش زنده پروژه است. منبع حقیقت: `project-control/MASTER_SPEC.md`.
> این فایل بعد از هر فاز/تسک مهم به‌روز می‌شود. تاریخ به‌روزرسانی: 2026-10-10.

## فاز جاری

**فاز ۳ — حضور و غیاب + پنل استاد/فراگیر (تکمیل شد ✅ — ۱۷۰ تست) → فاز ۴ (مالی)**

## وضعیت پیشرفت

| مورد | وضعیت |
|---|---|
| `project-control/MASTER_SPEC.md` (متن کامل spec) | ✅ VERIFIED |
| `project-control/REQUIREMENTS.md` | ✅ VERIFIED |
| `project-control/STATE.md` | ✅ VERIFIED |
| بررسی اولیه پروژه (repo خالی — greenfield) | ✅ VERIFIED |
| اسکلت پروژه (package.json, tsconfig, .env.example) | ✅ VERIFIED |
| docs/ (architecture, ERD, assumptions, decisions) | ✅ VERIFIED |
| Spike PDF فارسی + `docs/decisions/pdf.md` | ✅ VERIFIED (۲۳/²³ تطابق با HarfBuzz + PDF نمونه) |
| نصب‌کننده (installer + gate + compat check + انتخاب درایور mysql/sqlite) | ✅ VERIFIED (نصب کامل e2e با sqlite + check graceful با mysql؛ مسیر MySQL روی هاست «اجرا‌نشده») |
| فاز ۱ — زیرساخت (config, db, migrations, auth, sessions, CSRF, helmet, rate-limit, RBAC, policy, audit, settings, users, health, UI) | ✅ VERIFIED (۱۲۷ تست) |
| فاز ۲ — اساتید، فراگیران، کلاس‌ها، جلسات، پیش‌سبت‌نام، سبت‌نام | ✅ VERIFIED (۱۲ تست)
| فاز ۳ — attendance + پنل استاد + پنل فراگیر + IDOR | ✅ VERIFIED (۳۱ تست) |
| فاز ۴ — پرداخت‌ها، اقساط، رسید کارت‌به‌کارت، گزارش‌های مالی، PaymentGateway | ✅ VERIFIED (۱۶ تست) |
| تست کل | ✅ ۱۹۱ موفق / ۰ ناموفق — typecheck + build + boot smoke سبز |

## محیط sandbox

- Node.js v22.22.3 / npm 10.9.8
- MariaDB/MySQL: **سرور در sandbox موجود نیست** (apt مسدود، docker موجود نیست) →
  تست‌های integration در sandbox با SQLite (از طریق Kysely dialect) اجرا می‌شوند؛
  همان تست‌ها با MySQL/MariaDB واقعی روی هاست cPanel قابل اجرا هستند
  (DSN تست از طریق متغیر محیطی مشخص می‌شود).
- دسترسی اینترنت: github.com, npmjs.org, pypi.org

## تصمیم‌های کلیدی

- PDF فارسی: `docs/decisions/pdf.md` (نتیجه spike)
- Cron برای صف پیامک: `docs/decisions/sms-cron.md`
- نصب بدون SSH: `docs/decisions/installer.md`
- استراتژی تست DB: `docs/decisions/testing.md`

## گام بعدی

1. فاز ۵ (مدارک): قالب‌ها، صدور مدرک PDF (pipeline spike) + QR، صفحه عمومی اعتبارسنجی، لغو + audit
2. فاز ۶ (پیامک): SmsProvider + Fake + IPPanel adapter، پترن/رویداد، صف DB + cron
3. فاز ۷: داشبورد KPI + Chart.js، backup/restore، ماژول‌ها، مستندات فارسی، سناریوی پذیرش §۸، ZIP نهایی
