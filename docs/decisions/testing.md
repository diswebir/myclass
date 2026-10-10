# تصمیم: استراتژی تست پایگاه داده

تاریخ: 2026-10-10

## environments

| محیط | DB | driver | اجرا |
|---|---|---|---|
| Production (cPanel) | MariaDB/MySQL | `mysql2` (per spec §۲) | واقعی |
| Sandbox (CI/Arena) | SQLite (in-memory/file) | `node:sqlite` (built-in Node 22) | تست‌های unit + integration |
| Host (cPanel) — تست دستی | MariaDB/MySQL | `mysql2` | با `TEST_DB_DSN` می‌توان همان integration testها را gegen MySQL واقعی اجرا کرد |

## چرا SQLite در sandbox?

- sandbox هیچ سرور MySQL/MariaDB ندارد (apt مسدود، docker موجود نیست) — این یک محدودیت واقعی محیط است (ثبت در STATE.md — B1).
- لایه داده با **Kysely** (dialect-agnostic) نوشته می‌شود؛ repositoryها SQL قابل‌حمل می‌سازند (Kysely schema builder در migrationها).
- `node:sqlite` (ماژول داخلی Node 22) یک SQLite واقعی است — تست‌ها SQL واقعی اجرا می‌کنند، نه mock.

##arrantyavit تضمینی

- migrationها با Kysely schema builder (قابل حمل بین MySQL و SQLite) — همان فایل‌ها در هر دو DB اجرا می‌شوند.
- تست‌های integration gegen SQLite در sandbox **اجرا می‌شوند** و نتیجه گزارش می‌شود.
- تست gegen MySQL/MariaDB واقعی **روی هاست cPanel** قابل اجرا هستند (`TEST_DB_DSN=mysql://... npm run test:integration`) — در sandbox «اجرا‌نشده» ثبت می‌شود (نه «موفق»).
- هر claim «VERIFIED» در REQUIREMENTS.md فقط برای تست‌هایی است که واقعاً اجرا شده‌اند.

## تست‌ها

- `tests/unit/` — منطق کسب‌وکار (money, date/jalaali, normalize, csvGuard, shaper, rbac policy, sms mapping) — بدون DB.
- `tests/integration/` — با supertest + DB واقعی (SQLite در sandbox): install, auth, sessions, RBAC, settings, teachers, students, classes, enrollment, attendance, finance, certificates, sms queue, IDOR/authz, acceptance scenario.
- `tests/authz/` — negative authorization tests (IDOR) — زیرمجموعه integration.
- `tests/e2e-scenarios/` — سناریوی پذیرش §۸ به‌صورت خودکار.
- `tests/fixtures/shaping-cases.json` — fixtureهای شکل‌دهی فارسی (تولیدشده با HarfBuzz).

## دستورها

```
npm run test:unit         # تست‌های unit
npm run test:integration  # تست‌های integration (SQLite در sandbox)
npm test                  # همه
```
