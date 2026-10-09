"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesService = void 0;
const errors_1 = require("../../lib/errors");
const persian_1 = require("../../lib/persian");
const permissions_1 = require("../../rbac/permissions");
const SLUG_RE = /^[a-z][a-z0-9_]{2,63}$/;
/**
 * Role management (custom roles, permission assignment, activation, deletion).
 * Rules: system roles cannot be deleted; super_admin permissions are fixed; an actor cannot grant
 * permissions they do not hold; roles with assigned users cannot be deleted.
 */
class RolesService {
    db;
    audit;
    constructor(db, audit) {
        this.db = db;
        this.audit = audit;
    }
    async list() {
        return this.db.query(`SELECT r.id, r.slug, r.name_fa, r.description, r.is_system, r.is_active,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
         FROM roles r ORDER BY r.is_system DESC, r.name_fa ASC`);
    }
    async get(id) {
        const [row] = await this.db.query(`SELECT r.id, r.slug, r.name_fa, r.description, r.is_system, r.is_active,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
         FROM roles r WHERE r.id = ?`, [id]);
        if (!row)
            throw errors_1.errors.notFound('نقش');
        const perms = await this.db.query(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`, [id]);
        return { ...row, permissions: perms.map((p) => p.code) };
    }
    validatePermissions(actor, codes) {
        const unknown = codes.filter((c) => !(0, permissions_1.isKnownPermission)(c));
        if (unknown.length)
            throw errors_1.errors.badRequest('مجوز نامعتبر انتخاب شده است.', { permissions: 'مجوز نامعتبر است.' });
        if ((0, permissions_1.missingGrantablePermissions)(actor.permissions, codes).length > 0)
            throw errors_1.errors.forbidden();
    }
    validateNameAndDescription(input) {
        const fe = {};
        const name = (0, persian_1.normalizeText)(input.nameFa ?? '');
        if (name.length < 2 || name.length > 120)
            fe.nameFa = 'نام نقش باید بین ۲ تا ۱۲۰ نویسه باشد.';
        if ((input.description ?? '').length > 500)
            fe.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
        return fe;
    }
    permissionIds(codes) {
        return [...new Set(codes)];
    }
    async create(actor, input) {
        const fe = this.validateNameAndDescription(input);
        const slug = (input.slug ?? '').trim().toLowerCase();
        if (!SLUG_RE.test(slug))
            fe.slug = 'شناسه نقش باید با حرف انگلیسی شروع شود و فقط حروف کوچک، عدد و زیرخط داشته باشد (۳ تا ۶۴ نویسه).';
        if (Object.keys(fe).length)
            throw errors_1.errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
        if (slug === permissions_1.SUPER_ADMIN_ROLE)
            throw errors_1.errors.conflict('این شناسه برای نقش سیستمی رزرو شده است.');
        const perms = this.permissionIds(input.permissions);
        this.validatePermissions(actor, perms);
        return this.db.transaction(async (tx) => {
            const [dup] = await tx.query('SELECT id FROM roles WHERE slug = ?', [slug]);
            if (dup)
                throw errors_1.errors.conflict('نقشی با این شناسه وجود دارد.');
            const res = await tx.execute('INSERT INTO roles (slug, name_fa, description, is_system, is_active) VALUES (?, ?, ?, 0, 1)', [slug, (0, persian_1.normalizeText)(input.nameFa), input.description?.trim() || null]);
            const roleId = Number(res.insertId);
            for (const code of perms) {
                await tx.execute('INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ?', [roleId, code]);
            }
            await this.audit.record({ action: 'role.created', actorUserId: actor.id, entityType: 'role', entityId: roleId, ip: actor.ip, details: { slug, permissions: perms } });
            return roleId;
        });
    }
    async update(actor, id, input) {
        const fe = this.validateNameAndDescription(input);
        if (Object.keys(fe).length)
            throw errors_1.errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
        const role = await this.get(id);
        const perms = this.permissionIds(input.permissions);
        if (role.slug === permissions_1.SUPER_ADMIN_ROLE) {
            // The super administrator always holds every permission; only the display name may change.
            if (perms.length !== permissions_1.PERMISSIONS.length)
                throw new errors_1.AppError(400, 'LOCKED_ROLE', 'مجوزهای مدیر اصلی قابل تغییر نیست.');
        }
        else {
            this.validatePermissions(actor, perms);
        }
        await this.db.transaction(async (tx) => {
            await tx.execute('UPDATE roles SET name_fa = ?, description = ? WHERE id = ?', [(0, persian_1.normalizeText)(input.nameFa), input.description?.trim() || null, id]);
            if (role.slug !== permissions_1.SUPER_ADMIN_ROLE) {
                await tx.execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
                for (const code of perms) {
                    await tx.execute('INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ?', [id, code]);
                }
            }
        });
        await this.audit.record({
            action: 'role.updated',
            actorUserId: actor.id,
            entityType: 'role',
            entityId: id,
            ip: actor.ip,
            details: { before: role.permissions, after: role.slug === permissions_1.SUPER_ADMIN_ROLE ? 'locked' : perms },
        });
    }
    async setActive(actor, id, active) {
        const role = await this.get(id);
        if (role.is_system)
            throw new errors_1.AppError(400, 'SYSTEM_ROLE', 'نقش‌های سیستمی قابل غیرفعال‌سازی نیستند.');
        await this.db.execute('UPDATE roles SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
        await this.audit.record({ action: active ? 'role.activated' : 'role.deactivated', actorUserId: actor.id, entityType: 'role', entityId: id, ip: actor.ip });
    }
    async remove(actor, id) {
        const role = await this.get(id);
        if (role.is_system)
            throw new errors_1.AppError(400, 'SYSTEM_ROLE', 'نقش‌های سیستمی قابل حذف نیستند.');
        if (role.user_count > 0)
            throw errors_1.errors.conflict('این نقش به کاربران اختصاص داده شده است. ابتدا نقش آن‌ها را تغییر دهید یا نقش را غیرفعال کنید.');
        await this.db.execute('DELETE FROM roles WHERE id = ?', [id]);
        await this.audit.record({ action: 'role.deleted', actorUserId: actor.id, entityType: 'role', entityId: id, ip: actor.ip, details: { slug: role.slug } });
    }
}
exports.RolesService = RolesService;
