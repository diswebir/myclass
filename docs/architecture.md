# معماری سیستم — myclass

تاریخ: 2026-10-10 — این سند با کد واقعی (`src/`) همگام نگه داشته می‌شود.

## ۱. obiettivi diseño

- نصب روی هاست اشتراکی cPanel **بدون SSH** (ZIP + Setup Node.js App + installer وب).
- امنیت و صحت داده در اولویت (server-side authorization برای هر درخواست).
- ماژولار: هر ماژول با manifest، routes، controller نازک، service، repository، schemas (Zod)، tests.
- pakket JS خالص در production (بدون native addon؛ WASM landscape جز برای ابزار build).

## ۲. پشته فناوری (per spec §۲)

| لایه | technologie |
|---|---|
| Runtime | Node.js >= 18 (LTS), TypeScript → CommonJS (`dist/`) |
| Web | Express.js (سازگار با Phusion Passenger) |
| DB | MariaDB/MySQL + `mysql2` (prod) — Kysely (query builder تایپ‌شده) |
| Validation | Zod (API + فرم‌ها) |
| Password | bcryptjs (JS خالص) |
| Session | کوکی HttpOnly/Secure/SameSite + جدول `user_sessions` در DB |
| CSRF | synchronizer token داخلی (token در نشست DB) |
| Security headers | helmet |
| Rate limit | express-rate-limit + store در DB (جدول `rate_limits`) |
| UI | SSR Nunjucks + htmx + Alpine.js — RTL فارسی، self-host |
| Charts | Chart.js (self-host، بدون CDN) |
| Persian calendar | jalaali-js |
| QR | qrcode (JS) |
| Upload | multer + file-type (تشخیص نوع واقعی) |
| PDF | pdf-lib + `src/core/text/shape.ts` (per `docs/decisions/pdf.md`) |
| Test | Vitest + supertest |

## ۳. ساختار پوشه‌ها (per spec §۷)

```
/src
  /core        config, db (Kysely + migrate), errors, logger, http (server, middleware), security, policy, text (shaper)
  /modules     auth, users, rbac, settings, audit, files,
               teachers, students, courses (classes/sessions),
               enrollment, preregistration, attendance,
               finance, certificates, sms, reports, dashboard,
               backup, modules-registry, installer, health
  /ui          views (Nunjucks), partials, components, assets-src
  /jobs        run.ts (Cron: صف پیامک + کارهای دوره‌ای)
/migrations    نسخه‌بندی‌شده (Kysely schema builder — قابل حمل بین MySQL/SQLite)
/tests         unit, integration, authz, e2e-scenarios, fixtures
/docs          ERD، تصمیم‌ها، راهنماهای فارسی
/dist          خروجی build (tsc) —Startup file: dist/index.js
/public        فقط دارایی‌های عمومی (css/js/fonts/vendor)
/project-control  MASTER_SPEC.md, REQUIREMENTS.md, STATE.md
```

## ۴. چرخه درخواست (request lifecycle)

```
helmet → cookie-parser → body parser (محدودیت اندازه) → install-gate
→ session (ns load از DB) → CSRF (state-changing) → rate limit (DB store)
→ requireAuth → RBAC (permission) → Policy Layer (مالکیت/عضویت)
→ route → controller (نازک) → service (منطق کسب‌وکار) → repository (Kysely) → DB
→ audit log (برای عملیات حساس) → پاسخ (Nunjucks SSR یا JSON)
→ error handler (فارسی، بدون افشای جزئیات سرور)
```

## ۵. مدل داده (خلاصه)

ERD کامل در `docs/erd.md`. نکات کلیدی:
- مبالغ: `BIGINT` (کوچک‌ترین واحد پول — پیش‌فرض تومان).
- تاریخ/زمان: `DATETIME` به‌صورت UTC + `DATE` خالص برای جلسات؛ تبدیل شمسی فقط در لایه نمایش/ورودی.
- Soft delete (`deleted_at`) برای رکوردهای آموزشی/مالی.
-exfalso Constraints: کدOg کلاس/دوره/فراگیر/استاد، کد پیگیری، کد مدرک، یک attendance per (جلسه، فراگیر)، یک enrollment per (کلاس، فراگیر)، idempotency key برای پرداخت/پیامک.

## ۶. استقرار روی cPanel (خلاصه)

1. ZIP (کد + `node_modules` + `dist` + `public` + `migrations` + `src/ui/views`) در File Manager آپلود و Extract.
2. MySQL Databases: ساخت DB + user + Grant.
3. Setup Node.js App: نسخه Node (18/20)، Application root، Startup File: `dist/index.js`، متغیرهای محیطی (یا `.env`).
4. مرور `/install` → compat check → migrate → ساخت admin → قفل نصب.
5. Cron (اختیاری): `node /path/dist/jobs/run.js` (یا فراخوانی endpoint داخلی با توکن).

جزئیات: `docs/guides/` (فاز ۷).

## ۷. logging و errors

- Logger با levels (error/warn/info) — بدون سبت secret (password، API key، token).
- `AppError` با کد وضعیت + پیام فارسی کاربرپسند؛ error handler جزئیات داخلی را فقط در log سبت می‌کند (نه در پاسخ).
- audit log برای عملیات حساس (per spec §۶-پ).

## ۸.ellido decisiones videre

- `docs/decisions/pdf.md` — PDF فارسی
- `docs/decisions/installer.md` — نصب و قفل
- `docs/decisions/sms-cron.md` — صف پیامک و Cron
- `docs/decisions/testing.md` — استراتژی تست DB
- `docs/assumptions.md` — فرضیات
