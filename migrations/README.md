# Migrations

- Files: `NNN_name.sql` (three-digit, sequential). Never edit an applied file; add a new one.
- Statements separated by a line containing exactly `-- @@`.
- The runner records a SHA-256 checksum; a modified applied file blocks further migrations.
- Run from the web installer/admin "سلامت سامانه" page (requires permission) or at install time.
- MySQL DDL auto-commits: keep each migration small and make failures recoverable (see docs/BACKUP_RESTORE_FA.md).
