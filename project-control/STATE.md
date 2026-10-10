# STATE.md — کنترل وضعیت پروژه

> این فایل در پایان هر نشست کاری به‌روز می‌شود.
> آخرین به‌روزرسانی: 2026-10-10 — پایان فاز ۶ (پیامک/IPPanel) — ۲۲۰ تست سبز

## تاریخچه نشست‌ها

### 2026-10-10 — Session 1 (شروع)

- `project-control/MASTER_SPEC.md` ذخیره شد (متن کامل spec، verbatim). VERIFIED
- `project-control/REQUIREMENTS.md` ایجاد شد: حدود ۵۵ نیازمندی با شناسه یکتا (REQ-P0/P1/P2/P3/P4/P5/P6/P7/X). VERIFIED
- `project-control/STATE.md` (همین فایل) ایجاد شد. VERIFIED
- `PROJECT_STATUS.md` در روت ایجاد شد. VERIFIED
- بررسی محیط: Node v22.22.3، npm 10.9.8، Debian 12، sudo موجود.
- **BLOCKER شناسایی شد:** سرور MariaDB/MySQL در sandbox موجود نیست (apt مسدود — فقط github/npm/pypi در دسترس). Docker موجود نیست.
  - راه‌حل: لایه داده با Kysely (dialect-agnostic)؛ prod = mysql2/MariaDB per spec؛ تست‌های sandbox = SQLite (better-sqlite3، فقط devDependency).
  - سبت در `docs/decisions/testing.md`.
- اسکلت پروژه: `package.json` (فقط پکیج‌های JS خالص در prod)، `tsconfig.json`، `tsconfig.migrations.json`، `.env.example`، `.gitignore` ایجاد شد.

### 2026-10-10 — Session 2 (Spike PDF + docs + فاز ۱)

- Spike PDF: pdf-lib + Vazirmatn + shape.ts (جدول فرم‌ها با HarfBuzz تولید و ۲۳/۲۳ تطابق) + `docs/decisions/pdf.md`. PDF نمونه ساخته شد و ساختار آن تأیید شد (فونت embed، glyphهای کلیدی).
- docs: architecture.md, erd.md, assumptions.md, decisions/{installer,sms-cron,testing}.md.
- فاز ۱ (زیرساخت) کامل شد: config (Zod), db (Kysely + mysql2 prod + node:sqlite dev)، migrator + ۶ migration (۳۵ جدول)، auth (bcryptjs + قفل)، sessions (DB + CSRF synchronizer)، helmet + rate-limit (DB store)، RBAC (۶ نقش سیستمی + ~۷۰ مجوز)، Policy Layer، audit، settings (رمزنگاری secret)، installer (gate + compat check)، health، users، Design System RTL (Nunjucks + Vazirmatn + htmx/alpine self-host).
- تست‌ها: ۱۲۷ تست موفق (۷۸ unit + ۴۹ integration) — `npm test` + `npm run typecheck` + `npm run build` همگی سبز.
- Blocker B1 (عدم وجود MySQL در sandbox): با node:sqlite حل شد — تست‌های MySQL واقعی روی هاست cPanel «اجرا‌نشده» می‌مانند.
- REQ-P1-11 (Policy Layer) و REQ-P1-14 (installer MySQL flow) — IMPLEMENTED_UNVERIFIED (تست IDOR در فاز ۳؛ flow نصب کامل روی MySQL در sandbox ممکن نیست).

### 2026-10-10 — Session 3 (فاز ۲)

- ماژول‌های فاز ۲ کامل شدند: teachers (CRUD + کد + تخصص)، students (پرونده + CSV import با پیش‌نمایش/خطای هر سطر + export با محافظ formula)، courses، classes (فیلدهای کامل + ظرفیت + وضعیت + تخصیص چند استاد + جلسات با تشخیص تضاد زمانی استاد/مکان)، preregistration (فرم عمومی + honeypot + rate limit + کد پیگیری + ضدتکرار + review)، enrollment (سبت‌نام + کنترل ظرفیت + تبدیل پیش‌سبت‌نام + لغو).
- Policy Layer: assertClassAccess / assertStudentAccess / assertEnrollmentAccess / assertPaymentAccess / assertFileAccess / assertCertificateAccess — تست جداسازی داده کلاس‌ها (IDOR) پاس شد.
- تست‌ها: ۱۳۹ تست موفق — typecheck + build سبز.


### 2026-10-10 — Session 4 (فاز ۳ — attendance + پنل‌ها)

- ماژول‌های فاز ۳ کامل و mount شدند: attendance (سبت/اصلاح با audit، یکتایی (جلسه،فراگیر)، unset=حذف، گزارش فراگیر/کلاس، هشدار حد غیبت)، files (آپلود امن + دانلود کنترل‌شده با Policy)، پنل استاد (کلاس‌های خود، سبت حضور با فرم HTML، گزارش خود، پروفایل)، پنل فراگیر (پروفایل، کلاس‌ها، حضور، مالی، آپلود رسید کارت‌به‌کارت با idempotency، مدارک).
- Viewهای جدید: panel/{teacher,teacher-profile,student,student-profile,mark}.njk + attendance/{session,class-report}.njk؛ لینک پنل‌ها در layout + داشبورد.
- **باگ‌های مهم پیدا و رفع شد:**
  1. کلیدهای ۲بخشی مجوز در نقش‌های سیستمی (مثل `attendance.view`) silently resolve نمی‌شدند → shorthand `module.action` به `resolvePermissionIds` اضافه شد + تست regression.
  2. نقش فراگیر `finance.payments.view_all` داشت که license bypass در `assertPaymentAccess` بود (IDOR) → حذف شد.
  3. `assertClassAccess` برای استاد کلاس نیاز به مجوز `classes.classes.mark` (ناموجود) داشت → ترتیب بازنویسی شد (مالک → در غیر این صورت license).
  4. `GET /students` با `selectAll()` — استاد به همه‌ی فیلدهای فراگیران دسترسی داشت (نقض A9) → `students.list` از نقش استاد حذف شد (پنل استاد مسیر خودش را دارد).
  5. **mysql2/promise pool با Kysely ناسازگار بود** — Kysely `getConnection(callback)` صدا می‌زند ولی promise pool callback را ignore می‌کند → در prod هر query hang می‌کرد و rejection هندل‌نشده پروسس را crash می‌کرد. هر دو سایت (database.ts + installer) به callback pool از `mysql2` + `pool.on('error')` منتقل شدند.
  6. Rate limiter با DB store در حالت نصب (جدول موجود نیست) باعث 500 روی خود /install می‌شد → FallbackStore با MemoryStore fallback.
  7. `viewsDir` در dist به `dist/ui/views` اشاره می‌کرد (وجود نداشت) → resolution چند کاندیدایی (src/ui/views در prod).
  8. `import(file://...)` در migrate.ts در build CJS به `require('file://...')` تبدیل می‌شد → plain path.
  9. redirectهای `/login` → `/auth/login` (server.ts, auth.routes logout, requireAuth, install/done.njk).
  10. MulterError → 400 (به‌جای 500)، متد override `_method` برای فرم‌های HTML، `migrate-cli.ts` ساخته شد (اسکریپت `npm run migrate` کار نمی‌کرد).
- تست‌ها: `tests/integration/phase3.test.ts` — ۳۱ تست (attendance، پنل استاد، پنل فراگیر، IDOR منفی، تفکیک مجوز نقش‌ها). **مجموع: ۱۷۰ تست سبز** (۷۸ unit + ۹۲ integration)، typecheck + build سبز.
- Smoke test واقعی: حالت نصب (virgin DB): /install 200، /healthz 200، POST /install/run با MySQL down → 500 graceful (بدون crash). حالت کامل (sqlite): migrate-cli (۶ مایگریشن)، seed، login/logout، dashboard، /classes، /attendance/warnings، پنل‌ها — همه سبز. redirectهای /login رفع شد.
- REQ-P3-01..04 → VERIFIED؛ REQ-P1-11 (Policy/IDOR) → VERIFIED. REQ-P1-14 (installer MySQL flow) هنوز IMPLEMENTED_UNVERIFIED (MySQL واقعی در sandbox نیست) — ولی باگ pool که آن را «ناممکن» کرده بود رفع شد.


### 2026-10-10 — Session 5 (درخواست کاربر: انتخاب درایور mysql/sqlite در installer)

- installer حالا از انتخاب بین **MariaDB/MySQL** و **SQLite** پشتیبانی می‌کند (`dbDriver` در فرم نصب، check و run).
  - sqlite: مسیر فایل (پیش‌فرض `<STORAGE_DIR>/myclass.sqlite`) → `DB_DRIVER=sqlite` + `DB_SQLITE_PATH` در `.env`
  - mysql: همان flow قبلی + `DB_DRIVER=mysql` + host/port/name/user/pass
- `runChecks` و `writeEnvAndLock` driver-aware شدند؛ view فرم نصب select درایور + فیلدهای شرطی (Alpine).
- `.env.example` و `docs/decisions/installer.md` به‌روز شدند.
- تست‌های جدید در `install.test.ts`: درایور نامعتبر → 400؛ check با sqlite (ok) و mysql down (fail بدون crash)؛ **نصب کامل e2e با sqlite** (migrate → seed → admin → قفل → `.env` → لاگین واقعی روی DB نصب‌شده)؛ پس از نصب /install بسته می‌شود.
- REQ-P1-14 → VERIFIED (مسیر sqlite کاملاً تست شد؛ مسیر mysql روی سرور واقعی هنوز اجرا‌نشده — sandbox MySQL ندارد).
- تست‌ها: **۱۷۵ موفق** — typecheck + build سبز.


### 2026-10-10 — Session 6 (فاز ۴ — مالی)

- ماژول finance کامل شد: پرداخت‌ها (create/approve/reject/reverse + idempotency + ledger append-only + تراکنش)، اقساط (schedule + تخصیص خودکار پرداخت به قدیمی‌ترین قسط)، رسید کارت‌به‌کارت (review approve/reject → پرداخت خودکار + ledger)، گزارش‌ها (درآمد per روش، بدهکاران، مالی کلاس)، PaymentGateway interface + FakeGateway.
- Viewها: finance/{payments,receipts,installments,reports}.njk + لینک «مالی» در nav.
- ۱۶ تست جدید (phase4.test.ts) —امات concretos: ledger credit/reversal، idempotency 409، تخصیص قسط، تأیید رسید → پرداخت + موجودی، گزارش‌ها، 403 استاد/فراگیر.
- **رفع خطای سیستماتیک نویسه‌ای «ثبت» (ث→س) در ۴۱ فایل / ۱۹۷ رخداد** — علت: pipeline تایپ. ابزار `fa_check.py` (واژه‌سنج فارسی مبتنی بر corpus) ساخته شد
- REQ-P4-01..06 → VERIFIED. تست‌ها: **۱۹۱ موفق**. typecheck + build سبز.


### 2026-10-10 — Session 7 (فاز ۵ — مدارک)

- ماژول certificates: قالب‌ها (CRUD + design/conditions JSON)، صدور مدرک با شرط حضور/تسویه مالی (طبق تنظیمات یا قالب)، کد یکتا MC-<سال جلالی>-<۵رقم>، PDF با pdf-lib + Vazirmatn + QR (pipeline spike) + ذخیره در files، صدور دسته‌ای (dryRun + واقعی)، لغو با دلیل + audit + بازتولید PDF با واترمارک (کد ثابت)، صفحه عمومی /verify/:token (حداقل اطلاعات + نمایش لغو).
- ۱۰ تست جدید (phase5.test.ts): صدور+PDF+فونت+QR، verify عمومی/نامعتبر، حضور ناکافی، تسویه‌نشده→پرداخت→صدور، تکراری ۴۰۹، لغو+دوباره ۴۰۹، دسته‌ای+dryRun، پنل فراگیر، CRUD قالب+شرط ۱۰۰٪، RBAC ۴۰۳.
- REQ-P5-01..04 → VERIFIED. تست‌ها: **۲۰۱ موفق**. typecheck + build سبز.


### 2026-10-10 — Session 8 (فاز ۶ — پیامک/IPPanel)

- SmsProvider interface + FakeSmsProvider (outbox داخل حافظه، failNext برای تست backoff) + IPanelSmsProvider adapter (wire format «تأییدنشده» — blocker B2 — ippanel.com خارج از allowlist — در یک فایل ایزوله، per spec §3).
- Gate REQ-P6-05: مگر SMS_LIVE_TESTS=1، provider همیشه Fake است (هیچ تماس شبکه‌ای در تست/کران).
- کلید API: تنظیمات sms.ip_panel_api_key (isSecret — رمزنگاری‌شده با ENCRYPTION_KEY، ماسک در UI) + fallback به env؛ هرگز در لاگ.
- صف DB: enqueue با dedupe (event+entity+recipient)، delay_minutes، شرط (gte/lte/eq)، نگاشت متغیر + پیش‌فرض + الزامی، rate limit (پیش‌فرض ۳۰/دقیقه)، backoff exponential (base*2^n، سقف ۶۰ دقیقه)، retry_max → failed.
- پردازش: cron dist/jobs/run.js (smoke تست شد) + endpoint داخلی POST /internal/jobs/run با Bearer SMS_CRON_TOKEN (CSRF-exempt).
- پترن/رویداد: CRUD + seedDefaults (۴ پترن + ۴ رویداد) — installer و test helper هر دو seed می‌کنند.
- هوک‌های دامنه (best-effort): enrollment_created، payment_approved (create+approve)، certificate_issued.
- ارسال آزمایشی مدیر (sms.test_send.run) + viewهای صف/پترن/رویداد + nav «پیامک‌ها».
- ۱۹ تست جدید (phase6.test.ts). REQ-P6-01..05 → VERIFIED (P6-01 با caveat B2). تست‌ها: **۲۲۰ موفق**. typecheck + build + cron smoke سبز.

## وضعیت فعلی

- فاز: **۶ — پیامک/IPPanel — کامل شد ✅ (۲۲۰ تست) → شروع فاز ۷ (داشبورد/backup/ZIP نهایی)**
- آخرین نیازمندی VERIFIED: REQ-P6-05 (P6-01 با caveat B2 — wire format IPPanel تأییدنشده)
- در حال انجام: فاز ۷ — REQ-P7-01.. (داشبورد KPI + ۷ نمودار، backup/restore، ماژول‌ها، ۹ راهنمای فارسی، سناریوی پذیرش §۸، ZIP نهایی)
- تست‌ها: ۲۲۰ موفق / ۰ ناموفق — `npm test` + `npm run typecheck` + `npm run build` سبز؛ boot smoke (install + full mode) سبز.

## نتایج تست

| suite | نتیجه |
|---|---|
| unit | ۷۸ موفق |
| integration | ۱۴۲ موفق (install incl. sqlite e2e, auth, rbac, settings, migration, security, audit, phase2, phase3, phase4, phase5, phase6) |
| typecheck / build | سبز |
| boot smoke (install mode, virgin DB) | سبز — /install 200، /healthz 200، installer failure graceful |
| boot smoke (full mode, sqlite) | سبز — migrate-cli + login/logout + dashboard + panels + attendance |

## Blockerها

| # | Blocker | تأثیر | راه‌حل/وضعیت |
|---|---|---|---|
| B1 | عدم وجود سرور MySQL/MariaDB در sandbox | تست‌های integration با MySQL واقعی در sandbox اجرا نمی‌شوند | تست با SQLite (همان لایه repository/Kysely)؛ تست MySQL روی هاست cPanel. مستند در docs/decisions/testing.md |
| B2 | عدم دسترسی به مستندات IPPanel (edge.ippanel.com خارج از allowlist) | پیاده‌سازی Adapter IPPanel «تأییدنشده» می‌ماند | ساختار Adapter + UI + Fake Provider ساخته می‌شود؛ بخش‌های وابسته به API بعد از دسترسی به مستندات |
| B3 | cron در sandbox | تست واقعی cron اجرا‌نشده | اسکریپت `dist/jobs/run.js` + تست مستقیم آن |

## Next task (دقیق)

1. فاز ۴ (مالی): ماژول finance — پرداخت‌ها (create/approve/reject/reverse + idempotency + ledger)، اقساط (installments)، بررسی رسید کارت‌به‌کارت (card_receipts review → approve/reject با پرداخت خودکار)، گزارش‌های مالی، PaymentGateway interface (interface + Fake؛ درگاه واقعی فاز ۴/۷).
2. mount روترهای مالی + viewها + تست‌های integration (phase4.test.ts).
3. سپس فاز ۵ (مدارک/PDF/QR)، فاز ۶ (SMS/IPPanel)، فاز ۷ (داشبورد/backup/اسناد/ZIP نهایی).
