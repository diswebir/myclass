# STATE.md — کنترل وضعیت پروژه

> این فایل در پایان هر نشست کاری به‌روز می‌شود.
> آخرین به‌روزرسانی: 2026-10-10 — پایان فاز ۳ (attendance + پنل‌ها) — ۱۷۰ تست سبز

## تاریخچه نشست‌ها

### 2026-10-10 — Session 1 (شروع)

- `project-control/MASTER_SPEC.md` ذخیره شد (متن کامل spec، verbatim). VERIFIED
- `project-control/REQUIREMENTS.md` ایجاد شد: حدود ۵۵ نیازمندی با شناسه یکتا (REQ-P0/P1/P2/P3/P4/P5/P6/P7/X). VERIFIED
- `project-control/STATE.md` (همین فایل) ایجاد شد. VERIFIED
- `PROJECT_STATUS.md` در روت ایجاد شد. VERIFIED
- بررسی محیط: Node v22.22.3، npm 10.9.8، Debian 12، sudo موجود.
- **BLOCKER شناسایی شد:** سرور MariaDB/MySQL در sandbox موجود نیست (apt مسدود — فقط github/npm/pypi در دسترس). Docker موجود نیست.
  - راه‌حل: لایه داده با Kysely (dialect-agnostic)؛ prod = mysql2/MariaDB per spec؛ تست‌های sandbox = SQLite (better-sqlite3، فقط devDependency).
  - ثبت در `docs/decisions/testing.md`.
- اسکلت پروژه: `package.json` (فقط پکیج‌های JS خالص در prod)، `tsconfig.json`، `tsconfig.migrations.json`، `.env.example`، `.gitignore` ایجاد شد.

### 2026-10-10 — Session 2 (Spike PDF + docs + فاز ۱)

- Spike PDF: pdf-lib + Vazirmatn + shape.ts (جدول فرم‌ها با HarfBuzz تولید و ۲۳/۲۳ تطابق) + `docs/decisions/pdf.md`. PDF نمونه ساخته شد و ساختار آن تأیید شد (فونت embed، glyphهای کلیدی).
- docs: architecture.md, erd.md, assumptions.md, decisions/{installer,sms-cron,testing}.md.
- فاز ۱ (زیرساخت) کامل شد: config (Zod), db (Kysely + mysql2 prod + node:sqlite dev)، migrator + ۶ migration (۳۵ جدول)، auth (bcryptjs + قفل)، sessions (DB + CSRF synchronizer)، helmet + rate-limit (DB store)، RBAC (۶ نقش سیستمی + ~۷۰ مجوز)، Policy Layer، audit، settings (رمزنگاری secret)، installer (gate + compat check)، health، users، Design System RTL (Nunjucks + Vazirmatn + htmx/alpine self-host).
- تست‌ها: ۱۲۷ تست موفق (۷۸ unit + ۴۹ integration) — `npm test` + `npm run typecheck` + `npm run build` همگی سبز.
- Blocker B1 (عدم وجود MySQL در sandbox): با node:sqlite حل شد — تست‌های MySQL واقعی روی هاست cPanel «اجرا‌نشده» می‌مانند.
- REQ-P1-11 (Policy Layer) و REQ-P1-14 (installer MySQL flow) — IMPLEMENTED_UNVERIFIED (تست IDOR در فاز ۳؛ flow نصب کامل روی MySQL در sandbox ممکن نیست).

### 2026-10-10 — Session 3 (فاز ۲)

- ماژول‌های فاز ۲ کامل شدند: teachers (CRUD + کد + تخصص)، students (پرونده + CSV import با پیش‌نمایش/خطای هر سطر + export با محافظ formula)، courses، classes (فیلدهای کامل + ظرفیت + وضعیت + تخصیص چند استاد + جلسات با تشخیص تضاد زمانی استاد/مکان)، preregistration (فرم عمومی + honeypot + rate limit + کد پیگیری + ضدتکرار + review)، enrollment (ثبت‌نام + کنترل ظرفیت + تبدیل پیش‌ثبت‌نام + لغو).
- Policy Layer: assertClassAccess / assertStudentAccess / assertEnrollmentAccess / assertPaymentAccess / assertFileAccess / assertCertificateAccess — تست جداسازی داده کلاس‌ها (IDOR) پاس شد.
- تست‌ها: ۱۳۹ تست موفق — typecheck + build سبز.


### 2026-10-10 — Session 4 (فاز ۳ — attendance + پنل‌ها)

- ماژول‌های فاز ۳ کامل و mount شدند: attendance (ثبت/اصلاح با audit، یکتایی (جلسه،فراگیر)، unset=حذف، گزارش فراگیر/کلاس، هشدار حد غیبت)، files (آپلود امن + دانلود کنترل‌شده با Policy)، پنل استاد (کلاس‌های خود، ثبت حضور با فرم HTML، گزارش خود، پروفایل)، پنل فراگیر (پروفایل، کلاس‌ها، حضور، مالی، آپلود رسید کارت‌به‌کارت با idempotency، مدارک).
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

## وضعیت فعلی

- فاز: **۳ — حضور و غیاب + پنل استاد + پنل فراگیر — کامل شد ✅ (۱۷۰ تست) → شروع فاز ۴ (مالی)**
- آخرین نیازمندی VERIFIED: REQ-P3-04 (و REQ-P1-11)
- در حال انجام: فاز ۴ — REQ-P4-01.. (پرداخت‌ها، اقساط، دفتر کل، بررسی رسید، گزارش‌های مالی، PaymentGateway interface)
- تست‌ها: ۱۷۰ موفق / ۰ ناموفق — `npm test` + `npm run typecheck` + `npm run build` سبز؛ boot smoke (install + full mode) سبز.

## نتایج تست

| suite | نتیجه |
|---|---|
| unit | ۷۸ موفق |
| integration | ۹۲ موفق (install, auth, rbac, settings, migration, security, audit, phase2, phase3) |
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
