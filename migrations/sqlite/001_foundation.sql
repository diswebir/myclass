-- Foundation schema (SQLite): settings, RBAC, users, sessions, audit log, login attempts.
-- Mirrors migrations/mysql/001_foundation.sql. Dates are UTC TEXT 'YYYY-MM-DD HH:MM:SS.SSS'.
-- Statements are separated by `-- @@` lines. Keep each statement idempotent-friendly.
CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT NOT NULL PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_by INTEGER NULL
);
-- @@
CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at AFTER UPDATE ON settings FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE setting_key = NEW.setting_key;
END;
-- @@
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name_fa TEXT NOT NULL,
  description TEXT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
-- @@
CREATE TRIGGER IF NOT EXISTS trg_roles_updated_at AFTER UPDATE ON roles FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE roles SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;
-- @@
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description_fa TEXT NOT NULL
);
-- @@
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions (module);
-- @@
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
);
-- @@
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions (permission_id);
-- @@
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NULL UNIQUE,
  phone TEXT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT NULL,
  password_changed_at TEXT NULL,
  created_by INTEGER NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT
);
-- @@
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at AFTER UPDATE ON users FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;
-- @@
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role_id);
-- @@
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
-- @@
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
-- @@
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
-- @@
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
-- @@
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  actor_user_id INTEGER NULL,
  action TEXT NOT NULL,
  entity_type TEXT NULL,
  entity_id TEXT NULL,
  ip_address TEXT NULL,
  details_json TEXT NULL
);
-- @@
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_logs (occurred_at);
-- @@
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (actor_user_id);
-- @@
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action);
-- @@
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id);
-- @@
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
-- @@
CREATE INDEX IF NOT EXISTS idx_login_identifier ON login_attempts (identifier_hash, attempted_at);
-- @@
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts (ip_hash, attempted_at);
