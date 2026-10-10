# PROJECT_STATUS.md — پلتفرم مدیریت مؤسسه آموزشی (myclass)

> این فایل گزارش زنده پروژه است. منبع حقیقت: `project-control/MASTER_SPEC.md`.
> این فایل بعد از هر فاز/تسک مهم به‌روز می‌شود. تاریخ به‌روزرسانی: 2026-10-10 — **تحویل نهایی**.

## فاز جاری

**همه‌ی فازها (۰–۷) کامل شد ✅ — ۲۵۶ تست سبز — تحویل نهایی: ZIP + ۱۰ راهنمای فارسی + SQL dump مستقل**

## وضعیت پیشرفت

| مورد | وضعیت |
|---|---|
| `project-control/MASTER_SPEC.md` (متن کامل spec) | ✅ VERIFIED |
| `project-control/REQUIREMENTS.md` | ✅ VERIFIED — همه‌ی ۵۵+ نیازمندی (P0–P7 + X) VERIFIED |
| `project-control/STATE.md` | ✅ VERIFIED — Session 1–9 |
| `project-control/ZIP_MANIFEST.md` | ✅ VERIFIED — فهرست ZIP + sha256 + نتایج smoke |
| فاز ۰ — اسکلت پروژه (package, tsconfig, env, gitignore) + کنترل پروژه | ✅ VERIFIED |
| فاز ۱ — زیرساخت (config, db, migrations, auth, sessions, CSRF, helmet, rate-limit, RBAC, policy, audit, settings, users, health, UI) | ✅ VERIFIED (۱۲۷ تست) |
| فاز ۲ — اساتید، فراگیران، کلاس‌ها، جلسات، پیش‌ثبت‌نام، ثبت‌نام | ✅ VERIFIED (۱۲ تست) |
| فاز ۳ — attendance + پنل استاد + پنل فراگیر + IDOR | ✅ VERIFIED (۳۱ تست) |
| فاز ۴ — پرداخت‌ها، اقساط، رسید کارت‌به‌کارت، گزارش‌های مالی، PaymentGateway | ✅ VERIFIED (۱۶ تست) |
| فاز ۵ — قالب‌ها، صدور مدرک PDF (Vazirmatn+QR)، verify عمومی، لغو+audit، دسته‌ای | ✅ VERIFIED (۱۰ تست) |
| فاز ۶ — SmsProvider+Fake+IPPanel adapter (B2: wire تأییدنشده)، صف DB dedupe/rate/backoff، cron+endpoint داخلی، هوک‌ها | ✅ VERIFIED (۱۹ تست) |
| فاز ۷ — داشبورد KPI + ۷ نمودار، backup/restore + backup:cli، registry ماژول‌ها، ۱۰ راهنمای فارسی، dev guide، سناریوی پذیرش §۸، ZIP نهایی | ✅ VERIFIED (acceptance 23/23 + phase7 7/7 + notifications 6) |
| REQ-X-12 — اعلان‌های داخل برنامه (notifications) | ✅ VERIFIED (۶ تست integration) |
| Cross-cutting REQ-X-01..11 | ✅ VERIFIED (normalize, time/jalaali, soft delete, constraints, files, csvGuard, pagination, UI/RTL, security suite, secret scan, settings/brand) |
| تست کل | ✅ ۲۵۶ موفق / ۰ ناموفق (۲۱ فایل) — typecheck + build + smoke نصب از ZIP سبز |

## ماژول‌ها — وضعیت نهایی (per spec §۹)

| ماژول | وضعیت |
|---|---|
| installer, auth, sessions, users, rbac, settings, audit, health, registry | ✅ کامل‌و‌تست‌شده |
| teachers, students, courses, classes, prereg, enrollment, attendance | ✅ کامل‌و‌تست‌شده |
| files, finance, certificates, sms, backup, dashboard, panels, notifications | ✅ کامل‌و‌تست‌شده |
| SMS — IPPanel adapter (wire format) | ⚠️ کامل‌و‌تست‌نشده (با Fake) — B2: مستندات IPPanel در دسترس نبود |
| PaymentGateway — درگاه واقعی | ⚠️ کامل‌و‌تست‌نشده (interface + Fake) — درگاه واقعی خارج از scope fasi |
| هر ماژول دیگر | — پیاده‌نشده/ناقص: none — همه‌ی ماژول‌های spec کامل است |

## تحویل نهایی (per spec §۹)

- **ZIP قابل نصب cPanel:** `myclass-cpanel-0.1.0.zip` (sha256: `904fa0e1187132a9355f4e27881f0ae62443452e3add1802818653f8d48f27fd`)
  - محتوا: `dist/` (build کامل incl. `dist/migrations`), `src/ui/views/`, `public/` (فونت‌های Vazirmatn + vendor), `migrations/` (TS), `db/schema.sql`, `docs/`, `package.json`, `package-lock.json`, `.env.example` (تمیز), `README.md`, `project-control/ZIP_MANIFEST.md`
  - smoke نصب واقعی از ZIP: `npm ci` → `npm run migrate` (۶ migration) → `npm run backup:cli` → boot (`/install` 200، `/` 302، `/admin/health` auth-gated) — **سبز**
- **اسناد:** `docs/guides/01..10` (فارسی) + `docs/architecture.md` + `docs/erd.md` + `docs/decisions/*`
- **گزارش تست:** ۲۵۶/۲۵۶ موفق — `npm test`؛ typecheck ۰؛ build ۰
- **PR:** #3 (branch `arena/59243a56-myclass`)

## محیط sandbox

- Node.js v22.22.3 / npm 10.9.8
- MariaDB/MySQL: **سرور در sandbox موجود نیست** → تست‌های integration با SQLite (همان لایه Kysely)؛ تست MySQL روی هاست cPanel (B1)
- IPPanel: مستندات در دسترس نیست → adapter با Fake تست شد (B2)
- اسکن secret: ۰ hit — هیچ secret در کد/مخزن/لاگ (REQ-X-10)

## تصمیم‌های کلیدی

- PDF فارسی: `docs/decisions/pdf.md` (نتیجه spike)
- Cron برای صف پیامک: `docs/decisions/sms-cron.md`
- نصب بدون SSH: `docs/decisions/installer.md`
- استراتژی تست DB: `docs/decisions/testing.md`
