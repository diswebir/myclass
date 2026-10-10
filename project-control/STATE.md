# STATE — current status, evidence and next steps

_Last updated: 2026-10-10. Branch `arena/a2a4ec6f-myclass`._

## Summary

Foundation phase is implemented and tested at the unit level. A release ZIP was built and verified to start from a clean extraction. The database layer now supports **SQLite (verified here: integration tests, live install and HTTP matrices)** and **MySQL/MariaDB (implemented, NOT verified: no server is reachable from the sandbox)**. The administrator chooses the engine on the installer page. Business modules (students, classes, sessions, enrolment, attendance, finance, certificates, SMS, files, backup UI) are **not started**. The honest per-requirement status is in `REQUIREMENTS.md`.

## Verification evidence (this session)

| Check | Command / method | Result |
|---|---|---|
| TypeScript strict type-check | `npm run check` | pass |
| Build | `npm run build` | pass |
| Unit tests | `npm test` (build + `node --test dist/tests/unit/*.test.js`) | **54 / 54 pass, 0 fail** (EVIDENCE.md §9) |
| DB integration tests (SQLite, no server) | `npm run test:integration` | **23 / 23 pass**: shared flow (install, RBAC, lockout, sessions, settings, audit, dashboard), SQLite behaviour (dates, LIKE escaping, constraints, rollback, durability), installer refusal for an unreachable MySQL. MySQL run requires `TEST_DB_*`: **not executed**. |
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
6. Release packaging: ZIP with runtime deps, `dist/`, per-engine migrations, `schema-mysql.sql` and `schema-sqlite.sql`, docs, `.env.example`. ✔
8. SQLite as an installable database option (round 3, EVIDENCE.md §8–10). ✔ on SQLite; MySQL unverified.
7. Remaining phases: see below.

## Known gaps and risks (must be addressed before any production claim)

- **MySQL path unverified.** The SQL that the MySQL driver runs was converted by hand for the SQLite support and has not run against a server. Run `TEST_DB_* npm run test:integration` and the live matrix with `DB_DRIVER=mysql` on a disposable database as the first next step.
- **SQLite limits:** one Node process per database file; the whole database lives in memory and is rewritten on every write (about 1.2 ms per write at 0.45 MB). Engine cannot be switched after install.
- Login throttling is keyed on username and IP, so it can be used to lock a known username for 15 minutes (deliberate trade-off; revisit with CAPTCHA or admin unlock).
- Installer token-failure counter is in memory (resets on restart).
- `login_attempts` and `audit_logs` have no retention policy.
- Health page runs `CREATE TABLE IF NOT EXISTS` through the migrator status check.
- Pagination lists have no sorting (UI-03).
- Browser-side behaviour (brand application, responsive layout) has not been tested in a browser.

## IPPanel Edge contracts (read from official docs, 2026-10-09; no code written yet)

Source: https://ippanelcom.github.io/Edge-Document/docs/ (overview), `/auth`, `/send`, `/send/pattern`, `/send/webservice`, `/report`.

- Base URL: `https://edge.ippanel.com/v1`
- Auth: every endpoint needs an `Authorization` header with the raw token or API key (no `Bearer` prefix per the docs' header tables). Tokens expire after 10 hours; API keys do not expire but some sensitive endpoints accept tokens only. API keys are created in the user panel (Developers → Access Keys).
  - Discrepancy to confirm with IPPanel before live use: the curl examples show `Authorization: API TOKEN`, while the header tables show `YOUR_TOKEN_HERE`.
- Pattern send: `POST {base}/api/send`, JSON body `{ sending_type: "pattern", from_number (E.164), code (pattern code), recipients: [one E.164 number], params: { <placeholder>: value }, phonebook?: {...} }`. Response `data.message_outbox_ids[]`, `meta.status`, `meta.message_code` ("200-1" success; "400-1" bad token; "400-2" validation error).
- Webservice (plain text) send: `POST {base}/api/send`, body `{ sending_type: "webservice", from_number, message, params: { recipients: [E.164...] }, send_time? }`; `send_time` is `YYYY-MM-DD HH:MM:SS` in UTC.
- Delivery status: the reports section lists "Outbox Report", "Outbox Report By ID", "Bulk Stats", and "Bulk Recipients". **Their exact paths and fields were not read yet**; read them before implementing delivery tracking.
- Live verification is not possible from this sandbox: `edge.ippanel.com` is not on the allowlist, and no credentials are present. Tests must use a dry-run provider. A real send requires explicit user configuration and approval.

## Blocked items

- **IPPanel live verification:** blocked by sandbox network allowlist and missing credentials (see above).
- **cPanel/Passenger:** no host available; install steps are untested on a real host.

## Next steps (in order)

1. Read the IPPanel report endpoints (outbox by ID, bulk recipients) and then implement the SMS adapter with a dry-run provider and the variable-mapping layer.
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
