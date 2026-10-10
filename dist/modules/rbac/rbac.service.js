"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacService = void 0;
const permissions_1 = require("../../rbac/permissions");
/**
 * Permission loading. Permissions are read from the database on every authenticated request so that
 * a role change or permission change takes effect immediately (no stale session claims).
 */
class RbacService {
    db;
    constructor(db) {
        this.db = db;
    }
    async permissionsForUser(userId) {
        const rows = await this.db.query(`SELECT p.code
         FROM users u
         JOIN roles r ON r.id = u.role_id AND r.is_active = 1
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.id = ? AND u.status = 'active'`, [userId]);
        return new Set(rows.map((r) => r.code));
    }
    /**
     * Idempotently synchronises the permission catalogue and the system roles.
     * - Permissions are upserted from code.
     * - System roles are created if missing; their permission links are only ADDED (never removed) so
     *   admin customisations survive upgrades. super_admin always receives every permission.
     */
    async syncCatalog() {
        const d = this.db.dialect;
        for (const p of permissions_1.PERMISSIONS) {
            await this.db.execute(`INSERT INTO permissions (code, module, description_fa) VALUES (?, ?, ?)
         ${d.upsert(['code'], [d.incoming('module'), d.incoming('description_fa')])}`, [p.code, p.module, p.description]);
        }
        for (const role of permissions_1.SYSTEM_ROLES) {
            await this.db.execute(`INSERT INTO roles (slug, name_fa, description, is_system, is_active) VALUES (?, ?, ?, 1, 1)
         ${d.upsert(['slug'], ['is_system = 1'])}`, [role.slug, role.nameFa, role.description]);
            const [roleRow] = await this.db.query('SELECT id FROM roles WHERE slug = ?', [role.slug]);
            const perms = role.slug === permissions_1.SUPER_ADMIN_ROLE ? permissions_1.PERMISSIONS.map((p) => p.code) : role.permissions;
            for (const code of perms) {
                await this.db.execute(`${d.insertIgnore} INTO role_permissions (role_id, permission_id)
           SELECT ?, id FROM permissions WHERE code = ?`, [roleRow.id, code]);
            }
        }
    }
}
exports.RbacService = RbacService;
