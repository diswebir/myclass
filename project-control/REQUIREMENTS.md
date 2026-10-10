# REQUIREMENTS — traceability matrix

Source of truth: `MASTER_SPEC.md` (unchanged). Each row maps a spec requirement to an acceptance criterion and its **actual** status.

Status legend: `NOT_STARTED` · `IN_PROGRESS` · `IMPLEMENTED_UNVERIFIED` (code exists, required check not executed) · `VERIFIED` (check executed and passed; evidence given) · `BLOCKED` (external dependency) · `NOT_APPLICABLE`.

Verification environment limits (affect many rows): no MySQL/MariaDB server is reachable from the sandbox (apt, dev.mysql.com, cdn.mysql.com, archive.mariadb.org are blocked), so **every database-backed behaviour is `IMPLEMENTED_UNVERIFIED`**. No cPanel host, Phusion Passenger, or IPPanel API access is available either.

Evidence keys: `unit:<file>` = test file in `src/tests/unit` (54 tests, all pass via `npm test`; files: jalali, persian, security, settings-config, http-gate); `I` = the single DB integration test in `src/tests/integration/database.test.ts` with subtests for migrations, installer, RBAC/anti-escalation, last-super-admin lockout, role change and session revocation, settings, audit and dashboard counts (runs on a temporary SQLite file when no `TEST_DB_*` is set; on MySQL only when `TEST_DB_*` is set); `I-sqlite` = `sqlite-behaviour.test.ts`; `I-mysql-refused` = installer refusal test (no MySQL server needed); `P` = manual check in the running preview; `S` = static check.

## 1. Architecture and technology (spec §1)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| TECH-01 | Node.js + TypeScript backend | `tsc` strict build succeeds; app runs from `dist/` | VERIFIED | `npm run build` passes; `P` app served pages from `dist/` |
| TECH-02 | Express or cPanel-proven framework | App runs under Express 5; Passenger behaviour proven on a real host | IMPLEMENTED_UNVERIFIED | Express 5 runs locally; **Passenger/cPanel not tested** |
| TECH-03 | MySQL/MariaDB | Schema and queries run on MySQL/MariaDB | IMPLEMENTED_UNVERIFIED | `S`: all 8 CREATE statements parse with MySQL grammar (node-sql-parser); not executed |
| TECH-04 | RTL, responsive Persian UI | `dir="rtl"`, Persian strings, responsive CSS | IMPLEMENTED_UNVERIFIED | `P`: HTML has `lang="fa" dir="rtl"`; no visual/mobile test performed |
| TECH-05 | Chart.js charts | Charts bound to real DB data | NOT_STARTED | Dashboard has KPI cards only |
| TECH-06 | Safe DB access with transactions and migrations | Parameterised queries; transactions; migration runner | PARTIAL | Parameterised queries; transactions with nested joins; migration runner per engine. **SQLite: VERIFIED** (`I-sqlite`, live matrix). **MySQL: IMPLEMENTED_UNVERIFIED** (no server available) |
| TECH-07 | API design, input validation, standard errors | Consistent JSON error envelope; validation on all inputs | IN_PROGRESS | JSON envelope for `/api/*` (`unit:http-gate`); only `/api/health` exists; no versioned API yet |
| TECH-08 | Unit, integration, scenario tests | Tests run and results reported honestly | IN_PROGRESS | Unit: 38/38 pass. Integration: written, skipped (no DB) |
| TECH-09 | Avoid native modules / Docker / SSH tools | `package.json` contains only pure-JS runtime deps | VERIFIED | `S`: deps = express, helmet, mysql2, zod (all pure JS); no Docker files |
| ARCH-01 | Layered, modular architecture with clear boundaries | Routes → services → data layer; no business logic in views | IMPLEMENTED_UNVERIFIED | `docs/ARCHITECTURE_FA.md`; composition root `src/bootstrap.ts`. Module set still small |

## 2. Installation on cPanel without SSH (spec §2)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| CP-01 | Upload via File Manager | ZIP extracts to an app folder outside `public_html` with documented steps | IMPLEMENTED_UNVERIFIED | `docs/INSTALL_CPANEL_FA.md` §3; release ZIP not yet built (see CP-04) |
| CP-02 | Node.js app via cPanel GUI | `app.js` is the startup file and starts the app | IMPLEMENTED_UNVERIFIED | `app.js` → `dist/server.js#start`; `P`: `node app.js` served requests; Passenger not tested |
| CP-03 | Env vars and DB credentials via host UI | Config read from process env; `.env` optional and never overrides host values | VERIFIED | `unit:settings-config` tests; `P` run used env vars |
| CP-04 | Prebuilt production output, no build on host | `dist/` committed and runnable without `tsc` | VERIFIED (clean-extraction run) | `release/myclass-0.1.0.zip` extracted to a clean folder and started with `node app.js`; `/install` 200, `/assets/app.css` 200 |
| CP-05 | Dependency install without SSH; alternative provided | GUI "Run NPM Install" documented; ZIP with prod `node_modules` as fallback | IMPLEMENTED_UNVERIFIED | ZIP includes runtime `node_modules` (pure JS, `--ignore-scripts`); host GUI install not tested |
| CP-06 | DB tables/indexes/initial data via web or documented GUI method | Web installer runs migrations and creates admin | PARTIAL | Installer (web) runs migrations and creates admin with the chosen engine. **SQLite: VERIFIED** by a real HTTP install (EVIDENCE §8). **MySQL: IMPLEMENTED_UNVERIFIED** |
| CP-07 | Standalone SQL file for install/restore | `database/schema-mysql.sql` and `database/schema-sqlite.sql` generated from `migrations/<engine>/` | IMPLEMENTED_UNVERIFIED | Generated by `scripts/make-release.sh`; the SQLite schema is generated but not imported separately (the installer applies the same statements) |
| CP-08 | Create main admin account on first run | First super admin created by installer, guarded by INSTALL_TOKEN | IMPLEMENTED_UNVERIFIED | `I` (installer subtest) not executed; token check path `unit:http-gate` (gate) |
| CP-09 | Persian docs: install, update, backup, restore, troubleshoot | Four Persian guides exist and match behaviour | IMPLEMENTED_UNVERIFIED | `docs/INSTALL_CPANEL_FA.md`, `docs/BACKUP_RESTORE_FA.md`; not reviewed on a real host |
| CP-10 | Host compatibility check before install | Checks for Node version, storage writability, env, DB connection, token | VERIFIED | `P`: `/install` listed each check with correct result while DB was unreachable |
| CP-11 | Friendly install errors without sensitive details | Messages do not reveal DB host/driver text | VERIFIED | Live (EVIDENCE §3): install and login DB-failure pages show no host, code or stack text |
| CP-12 | Safe, traceable migrations for new versions | Checksums; refusal on edited applied files; lock; audit record | PARTIAL | `Migrator` per engine: checksums, lock (MySQL `GET_LOCK`; SQLite serialised), status. **SQLite: VERIFIED** (applied once, idempotent, modified-status). Refusal on edited files and the admin action are not executed |
| CP-13 | Block re-install and access to installer after setup | After install `/install` returns 404; lock file written | VERIFIED | `unit:http-gate` "after installation the installer is not reachable" (stubbed install state). Lock write: `I` (installer subtest, not executed) |
| CP-14 | Secrets in env or private storage, not public web path | Only `public/assets` is served statically; config from env | VERIFIED | `unit:http-gate`; live traversal probe returns 404/302, package.json not served (EVIDENCE §3) |
| CP-15 | Health tool: DB, Node version, modules, important errors | `/health` (public, minimal), `/api/health` and admin page (permissioned) | IMPLEMENTED_UNVERIFIED | `P`: `/health` returned `{"status":"error"}` with DB down; DB-up view not executed |
| CP-16 | Installer lets the administrator choose SQLite or MySQL (no SSH, no native module) | Driver radio on `/install`; choice saved to `storage/db-config.json` only after a successful connection; MySQL remains available | VERIFIED (SQLite); MySQL IMPLEMENTED_UNVERIFIED | `src/db/*`; live install over HTTP (EVIDENCE §8); `I-sqlite`; `I-mysql-refused` (503, nothing saved) |

## 3. Institute profile (spec §3)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| INST-01 | Official name, brand, slogan, description, phones, email, address, website, social links, registration IDs, manager, signatory, letterhead | Each field editable in settings with validation | IMPLEMENTED_UNVERIFIED | Registry entries in `src/settings/registry.ts`; `unit:settings-config` validates types |
| INST-02 | Logo, stamp, signature images | Upload, validate, store privately, use in documents | NOT_STARTED | Depends on file-management module (FILE-*) |
| INST-03 | Visual identity colours | Primary colour applied to layout | IMPLEMENTED_UNVERIFIED | `--brand` CSS variable from `appearance.primary_color`; `P` page source showed `--brand:#1d4ed8` |
| INST-04 | Settings used across the system (dashboard, SMS, certificates, receipts, reports) | Name and colour used in layout; others when modules exist | IN_PROGRESS | Name/colour used in layout and page titles; SMS/certificates/receipts not built |
| INST-05 | Changing institute data needs no code change | Edit via UI; stored in DB; reflected on next render | IMPLEMENTED_UNVERIFIED | `I` (settings subtest) (not executed); cache TTL 30s |

## 4. Users, roles and RBAC (spec §4)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| USR-01 | User types extensible (not fixed list) | Roles are data; custom roles can be created | IN_PROGRESS | Roles are DB rows; only 2 system roles seeded (super_admin, institute_admin) |
| RBAC-01 | Create role | Role saved with chosen permissions; audited | IMPLEMENTED_UNVERIFIED | `RolesService.create`; `I` (RBAC subtests) not executed |
| RBAC-02 | Edit role | Name/description/permissions editable; audited | IMPLEMENTED_UNVERIFIED | `RolesService.update` |
| RBAC-03 | Protect essential roles | System roles cannot be deleted/deactivated; super_admin permissions fixed | IMPLEMENTED_UNVERIFIED | `RolesService.remove/setActive/update`; `I` (RBAC subtests) not executed |
| RBAC-04 | Deactivate or delete unneeded roles | Delete only when unused; deactivate otherwise | IMPLEMENTED_UNVERIFIED | `RolesService.remove` refuses when users assigned |
| RBAC-05 | Choose permissions per role | Checkbox matrix grouped by module | IMPLEMENTED_UNVERIFIED | `roleFormBody`; `P` not rendered with data |
| RBAC-06 | Assign one role to each user | Role select on user form | IMPLEMENTED_UNVERIFIED | `userFormBody`, `UsersService.create/update` |
| RBAC-07 | View users per role | Role filter on users list | IMPLEMENTED_UNVERIFIED | `usersListBody` role filter; `UsersService.list` |
| RBAC-08 | Review permissions per role | Role detail shows permissions | IMPLEMENTED_UNVERIFIED | `GET /admin/roles/:id` |
| RBAC-09 | Prevent unintended admin-permission grants | Actor can only grant permissions they hold | VERIFIED (logic) / IMPLEMENTED_UNVERIFIED (end-to-end) | `unit:security` `missingGrantablePermissions`; `I` (RBAC subtests) not executed |
| RBAC-10 | Permissions by module, resource, operation; separate sensitive ops | Catalogue with `module.operation`; sensitive ops separate (e.g. `users.reset_password`, `system.migrate`) | IN_PROGRESS | 15 permissions; finance/class/attendance/certificate permissions not yet defined |
| RBAC-11 | Server-side enforcement on every request | `requirePermission` on each protected route | IMPLEMENTED_UNVERIFIED | Route guards in `admin.routes.ts`; unauthenticated redirect verified `unit:http-gate` |
| RBAC-12 | Role change effective immediately | Permissions loaded from DB per request | IMPLEMENTED_UNVERIFIED | `authMiddleware`; `I` (RBAC subtests) not executed checks role change |
| USR-02 | Enable/disable accounts | Disabling revokes sessions; self-disable blocked | IMPLEMENTED_UNVERIFIED | `UsersService.setStatus`; `I` (RBAC subtests) not executed |
| USR-03 | Change password, secure reset, force sessions out | Self-change; admin temp password (shown once, no-store); revoke sessions | IMPLEMENTED_UNVERIFIED | `AuthService.changeOwnPassword`, `UsersService.resetPassword`, `revokeSessions`; `I` (RBAC subtests) not executed |
| USR-04 | View user security history | Audit list filterable by action prefix; per-user view | IN_PROGRESS | Audit page filters by action prefix only; no per-user history view yet |
| USR-05 | Last super admin protected | Cannot disable or demote the last active super admin | IMPLEMENTED_UNVERIFIED | `UsersService`; `I` (RBAC subtests) not executed |

## 5. Class-level and data-level access control (spec §5)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| ACL-01 | Teacher sees only assigned classes | Object-level checks in service layer | NOT_STARTED | Classes module not built |
| ACL-02 | Student sees only own records | Owner checks on every student endpoint | NOT_STARTED | Student module not built |
| ACL-03 | Registrar cannot change security/finance settings | Permission split | IN_PROGRESS | Permission model exists; no registrar role seeded yet |
| ACL-04 | Finance cannot raise own admin rights | Anti-escalation on role assignment | IMPLEMENTED_UNVERIFIED | `UsersService.assertCanGrantRole`; `I` (RBAC subtests) not executed |
| ACL-05 | Object-level IDOR protection in all APIs | Every `:id` route checks ownership/permission | IN_PROGRESS | Admin `:id` routes check permission; ownership rules arrive with modules |
| ACL-06 | Export APIs obey same restrictions | Export permission + scope checks | NOT_STARTED | No export yet |
| ACL-07 | Tests for access control | Dedicated authorization tests | IN_PROGRESS | `I` (RBAC subtests) not executed covers users/roles escalation (not executed) |

## 6–12. Teachers, classes, registration, students, attendance, finance, certificates (spec §6–§12)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| TCH-01 | Teacher module (profile, code, expertise, status, notes with access control, assigned classes, schedule, attendance view, reports) | CRUD + views with permissions | NOT_STARTED | — |
| CLS-01 | Course/class management (all fields in §7; statuses draft/registering/full/running/finished/cancelled) | CRUD; status transitions; capacity; fees | NOT_STARTED | — |
| CLS-02 | Sessions with conflict detection; cancel/reschedule history | Overlap warnings; history kept | NOT_STARTED | — |
| REG-01 | Pre-registration forms configurable in admin | Field builder; validation; file type/size checks | NOT_STARTED | — |
| REG-02 | Review pre-registrations (approve/reject/ask correction, reason, tracking code, duplicate prevention) | Workflow with audit | NOT_STARTED | — |
| REG-03 | Conversion to final enrolment without duplicate users | Transactional conversion | NOT_STARTED | — |
| STU-01 | Student profiles, codes, enrolments, history, CSV import with validation, advanced search | CRUD + CSV import + search | NOT_STARTED | — |
| STU-02 | Transfer/enrol to new class keeping history | Enrolment history preserved | NOT_STARTED | — |
| ATT-01 | Session-based attendance (5 statuses; bulk; per-student change with reason; audit; no duplicates; reports; thresholds; alerts; CSV/PDF with access control) | Full workflow | NOT_STARTED | — |
| FIN-01 | Tuition per class; per-student finance; cash, lump sum, instalments, card-to-card, manual, configurable methods | Ledger with exact integer money | NOT_STARTED | Money helper `parseMoney/sumMoney` exists (`unit:persian`) |
| FIN-02 | Instalments: count, amount, due dates, partial/full payments, balance, overdue, reminders | Calculations tested | NOT_STARTED | — |
| FIN-03 | Card-to-card receipt upload; not auto-confirmed; review/approve/reject/resubmit; no double approval | Workflow + tests | NOT_STARTED | — |
| FIN-04 | Finance reports (receipts, debtors, income, instalments, class finance) | Report views + export | NOT_STARTED | — |
| FIN-05 | Finance permissions separate from academic data | Distinct permission set | IN_PROGRESS | Permission codes not yet defined for finance |
| CERT-01 | Certificate templates, issuance with unique code, QR to public verification page, cancellation with reason, regeneration keeping ID | Full certificate pipeline | NOT_STARTED | — |
| CERT-02 | Public verification page showing only necessary data | No private student data | NOT_STARTED | — |

## 13. IPPanel SMS (spec §13)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| SMS-01 | Implement strictly per official IPPanel Edge API docs (auth, send, pattern send, status) | Requests follow the documented contract | IN_PROGRESS | Docs read for auth, webservice, pattern send (see STATE “IPPanel Edge contracts”). Delivery-status endpoint paths not read yet. Live verification BLOCKED (no network allowlist, no credentials). No code written |
| SMS-02 | Independent adapter with defined interface | `SmsProvider` interface + IPPanel adapter | NOT_STARTED | — |
| SMS-03 | API key stored server-side only, masked | Sensitive setting masked | NOT_STARTED | Masking helper `maskSecret` exists (`unit:settings-config`) |
| SMS-04 | Patterns, variable mapping layer, required-variable validation before send | Mapping tests | NOT_STARTED | — |
| SMS-05 | Send queue, retry policy, duplicate prevention, rate limits, delivery status, reports | Queue design per shared-hosting limits | NOT_STARTED | — |
| SMS-06 | Tests never send real SMS by default | Dry-run adapter for tests | NOT_STARTED | — |

## 14. Settings (spec §14)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| SET-01 | Categorised central settings | Groups: institute, appearance, datetime, security (others pending) | IN_PROGRESS | 4 of 16 categories in `SETTINGS` / `SETTING_GROUP_LABELS` |
| SET-02 | Typed, validated, with defaults and access rules | Each setting has schema and default; unknown keys rejected | VERIFIED | `unit:settings-config` tests (types, defaults, invalid values); `I` (settings subtest) for persistence |
| SET-03 | Sensitive values masked; sensitive changes audited | Mask helper; audit with before/after (non-sensitive) | IMPLEMENTED_UNVERIFIED | `maskSecret` unit-tested; audit `I` (settings subtest) |
| SET-04 | Remaining categories (finance, certificates, SMS, notifications, files, backup, system…) | Each category has settings and UI | NOT_STARTED | — |

## 15. Dashboard and reports (spec §15)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| DASH-01 | Role-based dashboard content | Only permitted links/data shown | IMPLEMENTED_UNVERIFIED | Quick links filtered by permission; `/admin` redirects users without dashboard permission |
| DASH-02 | KPIs from real DB | Counts are SQL aggregates, no constants | IMPLEMENTED_UNVERIFIED | `DashboardService.stats`; `I` (dashboard subtest asserts `usersTotal`) |
| DASH-03 | Student/class/finance/attendance KPIs | Per spec §15 list | NOT_STARTED | Modules not built |
| DASH-04 | Charts with filters, drill-down, export | Chart.js bound to data | NOT_STARTED | — |

## 16. UI/UX (spec §16)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| UI-01 | Persian RTL layout, collapsible sidebar, header, search | Layout renders RTL with sidebar and topbar | IMPLEMENTED_UNVERIFIED | `P` markup verified; collapse behaviour not clicked-through |
| UI-02 | Responsive mobile/tablet/desktop | Media-query layout | IMPLEMENTED_UNVERIFIED | CSS breakpoints present; not tested on devices |
| UI-03 | Tables with filter, sort, pagination | Server-side pagination and filters | IN_PROGRESS | Pagination + filters on users and audit; **sorting not implemented** |
| UI-04 | Field-level errors, success/warning messages, empty states, confirmations for sensitive actions | Implemented in components | IMPLEMENTED_UNVERIFIED | `field()` error slot; flash messages; `data-confirm` JS |
| UI-05 | Jalali calendar display, Persian digits | Dates shown as Jalali in Tehran time | VERIFIED | `unit:jalali` (round-trip and Intl cross-check for 1925–2100, sampled every 3 days), `unit:settings-config` |
| UI-06 | Persian/Arabic digit and phone normalisation | Inputs normalised before storage | VERIFIED | `unit:persian` tests |
| UI-07 | Print-friendly documents | `@media print` rules | IMPLEMENTED_UNVERIFIED | CSS present; no documents yet |
| UI-08 | Accessibility basics (skip link, labels, focus, contrast) | Labels + skip link + focus ring | IMPLEMENTED_UNVERIFIED | Not audited with tools |
| UI-09 | Single design system / shared components | Shared CSS and component functions | IMPLEMENTED_UNVERIFIED | `views/ui.ts` components |

## 17. Security (spec §17)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| SEC-01 | Strong password hashing | scrypt with salt; parameters stored | VERIFIED | `unit:security` hash/verify tests |
| SEC-02 | Secure session management | Random tokens, hashed storage, expiry, revocation | IMPLEMENTED_UNVERIFIED | `AuthService`; `I` (not covered: session expiry is not tested) not executed |
| SEC-03 | Secure cookies under HTTPS | HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE` | VERIFIED (flags) | `unit:http-gate` checks HttpOnly and SameSite; Secure flag depends on config, not separately tested |
| SEC-04 | CSRF protection | State-changing requests require matching token | VERIFIED | `unit:http-gate`: rejected without token (403), accepted with matching double-submit token |
| SEC-05 | Server-side input validation | Validation in services with field errors | IMPLEMENTED_UNVERIFIED | Users, roles, settings, install validated; not exhaustively tested |
| SEC-06 | SQL-injection protection | Parameterised queries only | IMPLEMENTED_UNVERIFIED | `S`: all data passed as `?` params; LIKE wildcards escaped; not executed |
| SEC-07 | XSS protection | Escaping + CSP without `unsafe-inline` | VERIFIED | `unit:security` escape test; `unit:http-gate` CSP assertions |
| SEC-08 | Secure HTTP headers | helmet defaults + tuned CSP | VERIFIED | `unit:http-gate` header assertions |
| SEC-09 | Rate limiting for login and sensitive actions | Failed-login thresholds per account and IP | IMPLEMENTED_UNVERIFIED | `AuthService.login`; sensitive-action limits not yet added |
| SEC-10 | IDOR protection | Ownership/permission checks per record | IN_PROGRESS | Admin routes checked; object-level rules pending modules |
| SEC-11 | Secure password recovery | Self-service reset via SMS/email | NOT_STARTED | Admin-issued temporary password only (`USR-03`) |
| SEC-12 | No information leakage through errors | Generic messages; logs sanitised | VERIFIED | `unit:http-gate`, `unit:security`; live matrix (EVIDENCE §3): DB-down login returns 503 with no driver/stack text; 500 page generic |
| SEC-13 | No secrets in repository or public files | `.env` ignored; no credentials committed | VERIFIED | `.gitignore` excludes `.env`, `storage/`; `S` grep (see STATE) |
| SEC-14 | Upload validation (real type, size, no execution, private serving) | Upload pipeline | NOT_STARTED | File module not built |
| SEC-15 | Audit logging for sensitive events, no secrets | Audit events written; secrets stripped | IMPLEMENTED_UNVERIFIED | `AuditService` + `sanitizeForLog` (VERIFIED `unit:security`); DB writes `I-*` not executed |
| SEC-16 | MFA (modular, optional) | Pluggable MFA | NOT_STARTED | — |
| SEC-17 | Protected admin routes | Unauthenticated access redirected/denied | VERIFIED | `unit:http-gate`; live: all 11 protected GET routes → 302 `/login`, all POST routes without CSRF → 403 (EVIDENCE §3) |
| SEC-18 | Account status checked at authentication | Disabled accounts cannot authenticate or use sessions | IMPLEMENTED_UNVERIFIED | `AuthService.login/authenticate` check status; `I` (RBAC subtests) not executed |
| SEC-19 | Expired-session handling | Expired/revoked sessions rejected | IMPLEMENTED_UNVERIFIED | `AuthService.authenticate`; expiry not exercised by any test |

## 18. Database design (spec §18)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| DB-01 | Foundation entities (users, roles, permissions, role-permission, sessions, settings, audit, login attempts) | Tables with keys, FKs, unique and search indexes | PARTIAL | `migrations/{mysql,sqlite}/001_foundation.sql` (same tables, parity test). **SQLite: VERIFIED** (`I-sqlite`, behaviour tests). MySQL: IMPLEMENTED_UNVERIFIED |
| DB-02 | Full domain model (students, classes, sessions, enrolments, payments, certificates, SMS…) | ERD + migrations | NOT_STARTED | — |
| DB-03 | Referential integrity, no cascade deletion of important records | FKs with RESTRICT for business data; CASCADE only for link/session rows | IMPLEMENTED_UNVERIFIED | `users.role_id` RESTRICT; `sessions`/`role_permissions` CASCADE |
| DB-04 | Financial integrity (exact integers) | Money as BIGINT rials; helpers | VERIFIED (helpers) / NOT_STARTED (storage) | `unit:persian` |
| DB-05 | Date policy (UTC storage; display conversion only) | DB UTC; Tehran display | VERIFIED | `unit:settings-config` tests |
| DB-06 | Migration support and backup/restore | Versioned migrations; backup docs | PARTIAL | Versioned migrations per engine; SQLite backup/restore steps in `docs/BACKUP_RESTORE_FA.md` (file copy with app stopped). Restore was not executed |
| DB-07 | ERD and DB documentation | ERD document | IN_PROGRESS | Table summary in `docs/ARCHITECTURE_FA.md`; no diagram yet |

## 19. Files and documents (spec §19)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| FILE-01 | Upload/manage files (profile, documents, receipts, class files, templates, signature/stamp) | Private storage, validated uploads, access via server | NOT_STARTED | — |
| FILE-02 | Configurable storage path and cPanel-compatible storage | `STORAGE_DIR` configurable | IMPLEMENTED_UNVERIFIED | `loadConfig` `storageDir`; upload code absent |
| FILE-03 | File backups | Included in backup procedure | IN_PROGRESS | Manual backup instructions only |

## 20. Search, reports, export (spec §20)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| RPT-01 | Search and filters in admin lists | User search by name/username/phone/email; role/status filter | IMPLEMENTED_UNVERIFIED | `UsersService.list`; `I-*` not executed |
| RPT-02 | CSV/PDF export with access control and formula-injection protection | CSV writer neutralises formulas | VERIFIED (CSV writer) / NOT_STARTED (exports) | `unit:security` CSV tests; no export endpoints yet |
| RPT-03 | Export size limits and pagination | Caps on report sizes | NOT_STARTED | — |

## 21. Modules and extensibility (spec §21)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| MOD-01 | Module manifest (id, name, version, status, deps, settings, perms, routes, tables, UI) | Manifests registered | IN_PROGRESS | `src/modules/registry.ts` (id, name, version, deps, core). Enable/disable not implemented |
| MOD-02 | Module admin page | Status and health of modules | IN_PROGRESS | Module list shown on `/admin/system/health` |
| MOD-03 | Dependency-safe disable/remove | Checks before disable | NOT_STARTED | No optional modules yet |
| MOD-04 | Documented extension points | Developer guide | IMPLEMENTED_UNVERIFIED | `docs/ARCHITECTURE_FA.md` “افزودن ماژول جدید” |

## 22. Performance and stability (spec §22)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| PERF-01 | Server-side pagination | `LIMIT/OFFSET` with capped page size | IMPLEMENTED_UNVERIFIED | `parsePage` caps size at 100; users and audit lists |
| PERF-02 | Limited connection pool | `DB_CONNECTION_LIMIT` max 20 | VERIFIED | `unit:settings-config` range validation |
| PERF-03 | Limited request body size | 64 KB for form bodies | IMPLEMENTED_UNVERIFIED | `express.urlencoded({limit})` |
| PERF-04 | Settings cache with safe fallback | Short TTL; defaults when DB down | VERIFIED (fallback) | `P`: installer rendered with DB unreachable |
| PERF-05 | Batch/stepwise processing for SMS and certificates | Chunked jobs compatible with cPanel cron limits | NOT_STARTED | — |

## 23. Backup and restore (spec §23)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| BKP-01 | Admin backup section (DB dump, file backup, history, restore guide) | UI + history | NOT_STARTED | Manual procedure documented only |
| BKP-02 | Restore restricted and warned | Special permission + warning | NOT_STARTED | — |
| BKP-03 | Restore compatibility checks | Version/migration checks before restore | NOT_STARTED | — |

## 24–26. Admin, teacher and student panels (spec §24–§26)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| PANEL-01 | Admin menu with permitted sections | Menu filtered by permissions | IN_PROGRESS | Menu shows dashboard, users, roles, settings, audit, health only |
| PANEL-02 | Quick access to pending items | Dashboard shortcuts to pending work | NOT_STARTED | No pending workflows yet |
| PANEL-03 | Teacher panel | Assigned classes, attendance, notes, profile | NOT_STARTED | — |
| PANEL-04 | Student panel (mobile-first) | Own data only; receipts; certificates; password | NOT_STARTED | Only the password-change page exists (`/account/password`) |

## 27. Code quality and testing (spec §27)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| QA-01 | Strict TypeScript | `strict`, `noUnusedLocals`, etc. | VERIFIED | `tsconfig.json`; `npm run check` passes |
| QA-02 | Unit tests for core logic | Pass | VERIFIED | `npm test`: 38 pass, 0 fail |
| QA-03 | Integration tests (DB, RBAC, finance, certificates, SMS mapping, Jalali, install, migrations) | Executed against real DB | PARTIAL | `src/tests/integration/database.test.ts` (flow) and `sqlite-behaviour.test.ts` run on SQLite without any server; MySQL run requires `TEST_DB_*` (not executed) |
| QA-04 | Tests for access control, finance, certificates, SMS mapping | Dedicated test suites | NOT_STARTED (finance/certificates/SMS) / IN_PROGRESS (access control) | — |
| QA-05 | SMS tests isolated from real sending | No live calls in tests | NOT_STARTED | SMS not built |
| QA-06 | No mock data as real results | Dashboard and lists use DB | VERIFIED (code review) | `DashboardService` is pure SQL |

## 28. Deliverables (spec §28)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| DEL-01 | Backend source | In repository | VERIFIED | `src/` |
| DEL-02 | Frontend source | In repository | VERIFIED | `public/assets/` + `src/views/` |
| DEL-03 | Compiled, ready-to-run output | `dist/` | IMPLEMENTED_UNVERIFIED | Built; committed |
| DEL-04 | Module structure | Documented | IMPLEMENTED_UNVERIFIED | `docs/ARCHITECTURE_FA.md` |
| DEL-05 | DB files | DB files | IMPLEMENTED_UNVERIFIED | `migrations/mysql/001_foundation.sql`, `migrations/sqlite/001_foundation.sql` |
| DEL-06 | Versioned migrations | `NNN_*.sql` | VERIFIED (naming/ordering) | `unit:settings-config` |
| DEL-07 | Sample config without secrets | `.env.example` | IMPLEMENTED_UNVERIFIED | File written with empty secrets (see STATE) |
| DEL-08 | Installation process without SSH | Web installer | IMPLEMENTED_UNVERIFIED | See CP-* |
| DEL-09 | Persian install guide | docs | IMPLEMENTED_UNVERIFIED | `docs/INSTALL_CPANEL_FA.md` |
| DEL-10 | DB setup & connection guide | in install guide §۲ and §۴ | IMPLEMENTED_UNVERIFIED | — |
| DEL-11 | Node.js app setup guide | in install guide §۴ | IMPLEMENTED_UNVERIFIED | — |
| DEL-12 | IPPanel setup guide | — | NOT_STARTED | Depends on SMS-* |
| DEL-13 | Pattern & variable mapping guide | — | NOT_STARTED | Depends on SMS-* |
| DEL-14 | Users/roles/permissions guide | `docs/ROLES_AND_PERMISSIONS_FA.md` | IMPLEMENTED_UNVERIFIED | — |
| DEL-15 | Backup/restore guide | `docs/BACKUP_RESTORE_FA.md` | IMPLEMENTED_UNVERIFIED | — |
| DEL-16 | DB and module docs | `docs/ARCHITECTURE_FA.md` | IN_PROGRESS | Foundation tables only |
| DEL-17 | Extension guide | `docs/ARCHITECTURE_FA.md` §افزودن ماژول | IMPLEMENTED_UNVERIFIED | — |
| DEL-18 | Test results | `STATE.md` | VERIFIED (reporting) | See STATE.md |
| DEL-19 | Demo account with random password forced to change | Not created (no demo data shipped) | NOT_APPLICABLE | Spec says "only if needed"; the installer creates the real admin instead |
| DEL-20 | Host-uploadable ZIP | Release script | VERIFIED (build + clean extraction) | `scripts/make-release.sh` → `release/myclass-0.1.0.zip` (~3.4 MB, 1,792 files; no `dist/tests`, no `.env`) |

## 29–30. Execution rules and order (spec §29–§30)

| ID | Requirement | Acceptance criterion | Status | Evidence / notes |
|---|---|---|---|---|
| PROC-01 | Work in verifiable increments with a control-file trail | `REQUIREMENTS.md`, `STATE.md` updated | VERIFIED | This file and `STATE.md` |
| PROC-02 | Do not claim unverified results | Statuses reflect execution | VERIFIED | This matrix |
| PROC-03 | Phases 1–10 in order | Phase progress tracked in STATE | IN_PROGRESS | Phases 1–3 and parts of 4 and 9 done; see STATE |

## 31. Final acceptance scenarios (spec §31)

| # | Scenario | Status | Notes |
|---|---|---|---|
| 1 | Install from cPanel GUI without SSH | IMPLEMENTED_UNVERIFIED | Not executed on a host |
| 2 | Enter institute info | IMPLEMENTED_UNVERIFIED | Settings UI; DB persistence `I` (settings subtest) not executed |
| 3 | Create new role with permissions | IMPLEMENTED_UNVERIFIED | `I` (RBAC subtests) not executed not executed |
| 4 | Register a teacher and several students | NOT_STARTED | Modules missing |
| 5 | Create class with times, sessions, fees | NOT_STARTED | — |
| 6 | Assign teacher to class | NOT_STARTED | — |
| 7 | Open pre-registration form | NOT_STARTED | — |
| 8 | Convert pre-registration to enrolment | NOT_STARTED | — |
| 9 | Student logs in and sees only own data | NOT_STARTED | Login exists; student panel missing |
| 10 | Teacher sees only assigned classes | NOT_STARTED | — |
| 11 | Teacher records attendance | NOT_STARTED | — |
| 12 | Attendance appears in permitted reports | NOT_STARTED | — |
| 13 | Tuition and instalment plan for student | NOT_STARTED | — |
| 14 | Card-to-card receipt reviewed by finance | NOT_STARTED | — |
| 15 | Balance updated after approved payment | NOT_STARTED | — |
| 16 | Certificate issued and shown to student | NOT_STARTED | — |
| 17 | Certificate verified via public code page | NOT_STARTED | — |
| 18 | Configure IPPanel and a pattern | BLOCKED (live access); docs read | Contracts recorded in STATE; no code |
| 19 | Pattern variables extracted and mapped | NOT_STARTED | — |
| 20 | Real SMS send with tracked result | BLOCKED | Needs IPPanel access and approval to send |
| 21 | Dashboard from real DB | IMPLEMENTED_UNVERIFIED | 6 KPIs from SQL; `I` (dashboard subtest) not executed |
| 22 | Unauthorised user cannot access others' data by URL/API manipulation | IN_PROGRESS | Admin permission checks verified only by design; object-level tests pending modules |
| 23 | Database update via documented method without data loss | IMPLEMENTED_UNVERIFIED | Migrator + admin action; no real upgrade test yet |
