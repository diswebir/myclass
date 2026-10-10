# ZIP_MANIFEST — فهرست ZIP نهایی cPanel

ZIP نهایی قابل نصب روی cPanel — بسته‌بندی per spec §9.

- **نام فایل:** `myclass-cpanel-0.1.0.zip` (ریشه‌ی مخزن)
- **نسخه:** 0.1.0 (از `package.json`)
- **تاریخ ساخت:** 2026-10-10
- **راهنمای نصب:** `docs/guides/01-install-cpanel.md`

## محتوای داخل ZIP

| مسیر | توضیح |
|---|---|
| `package.json` | وابستگی‌ها + scriptها (build/start/migrate/job:sms) |
| `package-lock.json` | قفل نسخه‌ها برای `npm ci` |
| `.env.example` | متغیرهای محیطی — تمیز، بدون secret |
| `README.md` | اشاره به راهنماها |
| `dist/` | build کامل (`tsc`) — شامل `dist/index.js` (startup file) و `dist/migrations/` |
| `src/ui/views/` | viewهای Nunjucks (مسیر prod در `src/core/http/server.ts`) |
| `public/` | static + فونت‌های Vazirmatn (self-host) + vendor (htmx/alpine/chart) |
| `migrations/` | سورس TS migrationها (برای rebuild/مرجع) |
| `db/schema.sql` | dump مستقل schema (MariaDB) — `npm run schema:dump` |
| `docs/` | ۱۰ راهنمای فارسی + architecture + ERD |
| `project-control/ZIP_MANIFEST.md` | همین فایل |

## مستثنیات (explicit exclude)

`node_modules/`, `.git/`, `tests/`, `scripts/`, `spike*`, `extra_ok.txt`, `storage/`, `.env`, `*.sqlite`, `coverage/`

## بررسی (verification)

- `npm run build` → 0 error
- `npm run typecheck` → 0 error
- `npm test` → 256/256 passed (21 فایل)
- `unzip -l` → 267 فایل — `dist/` (142), `src/ui/views/` (70), `public/` (20), `docs/` (20), `migrations/` (8), `db/schema.sql`, `package.json`, `package-lock.json`, `.env.example`, `README.md`, این فایل
- مستثنیات تأیید شدند: `node_modules`/`tests`/`scripts`/`extra_ok.txt`/`.git` داخل ZIP نیستند
- **Smoke Test (نصب واقعی از ZIP در سرور تمیز):**
  1. `unzip` + `cp .env.example .env` + تنظیم `DB_DRIVER=sqlite` → `npm ci --omit=dev` → OK
  2. `npm run migrate` → 6 migration اجرا شد (sqlite)
  3. `npm run backup:cli` → پشتیبان ساخته شد (`storage/backups/20261010-204745`)
  4. `node dist/index.js` → اجرا شد؛ `/install` → 200، `/` → 302 (ورود)، `/admin/health` → 302 (auth)
- `sha256sum myclass-cpanel-0.1.0.zip` → `904fa0e1187132a9355f4e27881f0ae62443452e3add1802818653f8d48f27fd`
- اندازه: 948898 بایت (~927 KB) — 267 فایل
- `zip -sf` / `unzip -t` → بدون خطا

> نکته: `npm start` = `node dist/index.js` است؛ ZIP شامل `dist/` است، پس نیازی به build روی سرور نیست (اگر `dist/` حذف شد، `npm run build` اجرا شود — راهنمای 09).
