# STATE — current status, evidence and next steps

_Last updated: 2026-10-09. Branch `arena/a2a4ec6f-myclass`._

## Summary

Foundation phase is implemented and tested at the unit level. A release ZIP was built and verified to start from a clean extraction. **Database-backed behaviour is NOT verified**: no MySQL/MariaDB server is reachable from the sandbox. Business modules (students, classes, sessions, enrolment, attendance, finance, certificates, SMS, files, backup UI) are **not started**. The honest per-requirement status is in `REQUIREMENTS.md`.

## Verification evidence (this session)

| Check | Command / method | Result |
|---|---|---|
| TypeScript strict type-check | `npm run check` | pass |
| Build | `npm run build` | pass |
| Unit tests | `npm test` (build + `node --test dist/tests/unit/*.test.js`) | **38 / 38 pass, 0 fail** |
| DB integration tests | `npm run test:integration` | **skipped** (no `TEST_DB_*`; no DB available). Test is written: migrations, installer, RBAC escalation, last-super-admin lockout, role change and session revocation, settings, audit, dashboard counts. **Not executed.** |
| SQL syntax (static) | `node-sql-parser` MySQL grammar on `migrations/001_foundation.sql` | 8 / 8 statements parse (static only; not run on a server) |
| Live preview (no DB) | `node app.js` on port 3123 | `/install` 200 with RTL Persian checks; DB-failure message shows no host; `/login` and `/admin` → 302 `/install`; `/health` 503 `{"status":"error"}`; `/assets/app.css` 200 `text/css`; `/package.json` not served (302 to installer) |
| Release ZIP | `scripts/make-release.sh` | `release/myclass-0.1.0.zip` 3.4 MB; extracted to a clean folder and started; `/install` 200; `/assets/app.css` 200 |
| Secrets scan | grep for key/token/password literals in tracked files | only test fixtures and Persian validation text; no real secrets |
| Dependencies | `package.json` | pure JS only (express, helmet, mysql2, zod) |

## Phase log

1. Specification saved verbatim (`MASTER_SPEC.md`). ✔
2. Foundation: config, DB layer, migration runner, audit, RBAC (catalogue and anti-escalation), auth (scrypt, sessions, CSRF, login limits), settings registry, installer, health, dashboard (real SQL counts), HTTP layer (RTL Persian UI, CSP, helmet). ✔ (DB parts unverified)
3. Unit tests for Jalali, Persian digits and phones, money, security helpers, settings/config/migrations, and HTTP gate. ✔ 38/38
4. Admin actions: users, roles, settings, audit, health; migration action gated by `system.migrate` and audited. ✔ (not executed against DB)
5. Documentation (Persian): install on cPanel, backup/restore/update, roles, architecture; README. ✔
6. Release packaging: ZIP with runtime deps, `dist/`, migrations, schema.sql, docs, `.env.example`. ✔
7. Remaining phases: see below.

## Known gaps and risks (must be addressed before any production claim)

- **DB never executed.** The installer, migrations, RBAC writes, sessions, audit inserts and dashboard counts are all unexecuted SQL. Run `npm run test:integration` on a disposable MySQL/MariaDB as the first next step.
- Known install edge case: when users exist but no `install.lock` is present, the installer refuses to proceed and can leave a partial install stranded. Needs a recovery path plus a test.
- `users.service.create` maps duplicate-key errors by matching index names in the message; verify on real MySQL.
- Login rate-limit and session expiry are implemented but not exercised by tests.
- zod 4 `z.email()` and `z.number()` usage is not exercised against a runtime test beyond the config tests.
- Cosmetic cleanups pending: a no-op in `auth.routes.ts` login success path; a stray re-export and unused imports in `pages.ts`; duplicated Persian-digit mapping between `pagerHtml` and `pages.ts` (should use `lib/persian`).
- Installer failure counters are in memory (reset on restart); acceptable for install-only use, documented as a limitation.
- Pagination lists have no sorting (UI-03).

## Blocked items

- **IPPanel Edge SMS (§13):** the spec requires implementation strictly from `https://ippanelcom.github.io/Edge-Document/docs/`. The sandbox cannot reach `edge.ippanel.com` and the docs were **not yet fetched**, so no SMS code has been written. Next: fetch the docs (via the allowed web tools), record the auth/send/pattern/status contracts here, and implement an adapter with a dry-run provider for tests. Live verification needs IPPanel credentials and explicit user approval before any real send.
- **cPanel/Passenger:** no host available; install steps are untested on a real host.

## Next steps (in order)

1. Read the IPPanel Edge docs and record the contracts in this file (no guessing).
2. Attempt the DB integration test again only if a MySQL/MariaDB server becomes reachable; otherwise keep it `IMPLEMENTED_UNVERIFIED`.
3. Implement remaining domain modules in the spec's order: teachers, classes and sessions (with conflict detection), pre-registration and enrolment, students and CSV import, attendance, finance (exact integer rials, instalments, card-to-card review with no double approval), certificates with public QR verification, file storage with authorised serving, SMS adapter with masked key and dry-run tests, Chart.js dashboard charts, backup UI.
4. Add the test suites the spec requires for finance, certificates, SMS mapping, and object-level access control.
5. Fix the known gaps above.
6. Stop the temporary preview process once no longer needed.

## Files that define the current state

- `project-control/MASTER_SPEC.md` — spec (verbatim, unchanged)
- `project-control/REQUIREMENTS.md` — traceability matrix with honest statuses
- `docs/*.md` — Persian guides and architecture
- `release/myclass-0.1.0.zip` — host-uploadable build (git-ignored)
