# Migrations

- Layout: one folder per engine, `migrations/mysql/` and `migrations/sqlite/`, with the same version numbers in both. The DDL differs by engine.
- Files: `NNN_name.sql` (three-digit, sequential). Never edit an applied file; add a new one. Add every new version to BOTH folders.
- Statements separated by a line containing exactly `-- @@`.
- The runner records a SHA-256 checksum; a modified applied file blocks further migrations.
- Run from the web installer/admin "سلامت سامانه" page (requires permission) or at install time.
- MySQL DDL auto-commits: keep each migration small and make failures recoverable (see docs/BACKUP_RESTORE_FA.md).
- SQLite: dates are UTC TEXT `YYYY-MM-DD HH:MM:SS.SSS`; `updated_at` is maintained by triggers (MySQL uses ON UPDATE). Use `-- @@` between statements in both engines.
