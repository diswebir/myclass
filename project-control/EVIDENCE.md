# EVIDENCE — verification run (2026-10-10)

This file records every check executed in this run, with the exact command and its result. Anything not listed here was **not** verified.

## 1. Build and type-check
- `npm run check` (tsc strict, noUnusedLocals/Parameters, noImplicitReturns): pass.
- `npm run build`: pass; `dist/` regenerated.

## 2. Unit tests — `npm test` (40/40 pass)
Full list from `node --test --test-reporter=spec dist/tests/unit/*.test.js`:
```
✔ database connectivity and credential errors are classified as unavailable
✔ application and unrelated errors are not classified as database outages
✔ before installation every protected page redirects to the installer
✔ after installation the installer is not reachable (404)
✔ protected pages require login when no session cookie is present
✔ state-changing requests without a matching CSRF token are rejected (403)
✔ a valid double-submit CSRF token passes and failed logins show a generic message
✔ security headers are present and the framework signature is hidden
✔ public health endpoint reveals only status, never driver messages
✔ API routes without authentication return JSON 401, not HTML
✔ static assets are served from /assets only and unknown paths return 404
✔ known Nowruz dates convert correctly
✔ leap-year rules match the arithmetic calendar
✔ Esfand 30 exists only in leap years (boundary)
✔ round trip and Intl cross-check for 1925..2100 (sampled every 3 days)
✔ ISO date parsing rejects impossible dates and storage format is stable
✔ display formatting uses Persian digits and Jalali calendar
✔ Persian and Arabic digits convert to ASCII and back
✔ mobile numbers normalise to 09XXXXXXXXX
✔ invalid mobile numbers are rejected
✔ Persian keyboard letters are normalised
✔ money parses exact integers and rejects decimals or negatives
✔ money sums are exact (no floating-point drift)
✔ password hashing uses scrypt with salt and verifies correctly
✔ temporary passwords are random, long enough and unambiguous
✔ constant-time equality and hashing helpers
✔ CSV cells are protected against formula injection
✔ log sanitiser redacts secrets at any depth
✔ HTML escaping neutralises injected markup in templates
✔ cookie parser handles malformed values safely
✔ anti-escalation: missing permissions are reported
✔ system roles only reference known permissions and super admin holds all
✔ settings: values are typed, validated and defaulted
✔ settings: every default satisfies its own schema and keys are unique
✔ API keys are masked for display
✔ config: validates environment and applies defaults
✔ config: .env loader never overrides host-provided variables
✔ migrations: files are discovered in order with stable checksums and statements
✔ migrations: duplicate versions are rejected
✔ dates: UTC instants are shown in Tehran local time with Jalali calendar
ℹ tests 40
ℹ pass 40
ℹ fail 0
```
New in this run: `error-handler.test.ts` (2 tests) — classifies DB connectivity and credential errors as "unavailable" and leaves application errors alone.

## 3. Live HTTP matrix — `scripts/e2e-http.sh`
Two real `node app.js` processes, production mode, DB pointed at a closed port (no database reachable), one with `storage/install.lock` absent (pre-install) and one with it present (post-install).

### Pre-install (10/10 pass)
```
PASS  GET /install renders installer => 200
PASS  installer is RTL Persian => 1
PASS  GET /login redirects to installer => 302
PASS    ...to /install => /install
PASS  GET /admin redirects to installer => 302
PASS  POST /install without CSRF rejected => 403
PASS  GET /health (DB down) is 503 => 503
PASS  GET /assets/app.css => 200
PASS  static traversal not served => 404
PASS  unknown path before install -> installer => 302
SUMMARY mode=pre-install pass=10 fail=0
```
### Post-install (45/45 pass)
```
PASS  GET /install after install is 404 => 404
PASS  POST /install after install rejected => 403
PASS  GET /login renders => 200
PASS  login page is RTL Persian => 1
PASS  login sets csrf cookie => 1
PASS  POST /login without CSRF rejected => 403
PASS  POST /login with wrong CSRF rejected => 403
PASS  anon GET /admin => 302
PASS    -> /login => /login
PASS  anon GET /admin/users => 302
PASS    -> /login => /login
PASS  anon GET /admin/users/new => 302
PASS    -> /login => /login
PASS  anon GET /admin/users/1 => 302
PASS    -> /login => /login
PASS  anon GET /admin/roles => 302
PASS    -> /login => /login
PASS  anon GET /admin/roles/new => 302
PASS    -> /login => /login
PASS  anon GET /admin/roles/1 => 302
PASS    -> /login => /login
PASS  anon GET /admin/settings/institute => 302
PASS    -> /login => /login
PASS  anon GET /admin/audit => 302
PASS    -> /login => /login
PASS  anon GET /admin/system/health => 302
PASS    -> /login => /login
PASS  anon GET /account/password => 302
PASS    -> /login => /login
PASS  anon POST /admin/users without CSRF => 403
PASS  anon POST /admin/roles without CSRF => 403
PASS  anon POST /admin/settings/institute without CSRF => 403
PASS  anon POST /admin/system/migrate without CSRF => 403
PASS  anon POST /admin/users/1/status without CSRF => 403
PASS  anon POST /logout without CSRF => 403
PASS  anon POST /account/password without CSRF => 403
PASS  API without auth returns JSON 401 => 401
PASS  GET /health public minimal => 503
PASS  unknown path 404 after install => 404
PASS  CSP present and no unsafe-inline => 1
PASS  CSP forbids unsafe-inline => 0
PASS  X-Powered-By hidden => 0
PASS  X-Content-Type-Options nosniff => 1
PASS  failed login (DB down) leaks no driver or stack text => 0
PASS  failed login (DB down) -> 503 Persian page => 503
SUMMARY mode=post-install pass=45 fail=0
```

Behaviour notes:
- Before installation, unknown paths redirect to `/install` (302) instead of 404, so the pre-install route map is not revealed. Intended.
- After installation, a POST to `/install` without a CSRF token returns 403, because CSRF middleware runs before the installed check. This reveals nothing about install state. Intended.
- With the DB unreachable, a login POST returns **503** with a Persian message ("پایگاه داده در دسترس نیست…"). Before this run it returned a generic 500. The DB error is logged server-side with its code and no credentials or stack text reaches the browser.

## 4. Static SQL check
`node-sql-parser@5.4.0` (MySQL grammar) on `migrations/001_foundation.sql`: parsed 8/8 statements. Static only; not executed on a server.

## 5. Secrets scan
Grep of tracked source for key/token/password literals: only test fixtures (`install-token-for-tests…`, test passwords) and Persian validation messages. No real secrets.

## 6. Checks NOT performed (and why)
| Area | Reason | Status |
|---|---|---|
| DB integration suite (`npm run test:integration`) | No MySQL/MariaDB server obtainable (apt, pip, npm, cdn.mysql.com, archive.mariadb.org all blocked) | NOT RUN |
| Install, login, sessions, user/role CRUD, settings save, audit rows, dashboard counts, migration action | Need a DB | NOT RUN |
| Visual RTL layout, responsive breakpoints, collapsible sidebar, Jalali display in browser | No browser; Playwright's Chromium download host (cdn.playwright.dev) is blocked | NOT RUN |
| cPanel / Phusion Passenger startup | No host | NOT RUN |
| IPPanel SMS | Not implemented; network allowlist and credentials unavailable | NOT RUN |
| Business modules (students, classes, attendance, finance, certificates, files, charts, backup UI) | Not built yet | NOT STARTED |

## 7. Repository sync note
The local branch ref had been reset to the initial commit during the session. The remote branch `arena/a2a4ec6f-myclass` held the pushed work (`55cc069`). The working tree was compared file-by-file with that commit (identical), then the local branch was moved to `55cc069` with a mixed reset. No files were lost. `dist/` is tracked in git, so the rebuilt output is committed with this run.
