"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const errors_1 = require("../../lib/errors");
const crypto_1 = require("../../lib/crypto");
const persian_1 = require("../../lib/persian");
const permissions_1 = require("../../rbac/permissions");
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
function validateProfile(input, requireUsername) {
    const fe = {};
    if (requireUsername) {
        const u = (input.username ?? '').trim().toLowerCase();
        if (!USERNAME_RE.test(u))
            fe.username = 'نام کاربری باید ۳ تا ۶۴ نویسه از حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.';
    }
    const name = (0, persian_1.normalizeText)(input.fullName ?? '');
    if (name.length < 2 || name.length > 190)
        fe.fullName = 'نام و نام خانوادگی باید بین ۲ تا ۱۹۰ نویسه باشد.';
    if (input.email && input.email.trim() !== '' && (!EMAIL_RE.test(input.email.trim()) || input.email.trim().length > 190)) {
        fe.email = 'ایمیل نامعتبر است.';
    }
    if (input.phone && input.phone.trim() !== '' && !(0, persian_1.normalizeIranMobile)(input.phone)) {
        fe.phone = 'شماره همراه باید یک شماره موبایل ایرانی معتبر باشد (مثال: ۰۹۱۲۱۲۳۴۵۶۷).';
    }
    if (!Number.isInteger(input.roleId) || input.roleId <= 0)
        fe.roleId = 'نقش را انتخاب کنید.';
    return fe;
}
/**
 * User administration. Every mutating method enforces:
 *  - anti-escalation: the actor must already hold every permission of the target role;
 *  - no self-lockout: an actor cannot disable themselves or change their own role;
 *  - the last active super administrator can never be disabled or demoted.
 */
class UsersService {
    db;
    audit;
    auth;
    rbac;
    passwordMinLength;
    constructor(db, audit, auth, rbac, passwordMinLength) {
        this.db = db;
        this.audit = audit;
        this.auth = auth;
        this.rbac = rbac;
        this.passwordMinLength = passwordMinLength;
    }
    async list(filter) {
        const where = [];
        const params = [];
        if (filter.q) {
            const like = `%${filter.q.trim().replace(/[%_\\]/g, '\\$&')}%`;
            where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)');
            params.push(like, like, like, like);
        }
        if (filter.status === 'active' || filter.status === 'disabled') {
            where.push('u.status = ?');
            params.push(filter.status);
        }
        if (filter.roleId) {
            where.push('u.role_id = ?');
            params.push(filter.roleId);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [count] = await this.db.query(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params);
        const rows = await this.db.query(`SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, r.slug AS role_slug, r.name_fa AS role_name,
              u.status, u.must_change_password, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id
         ${whereSql}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ? OFFSET ?`, [...params, filter.pageSize, (filter.page - 1) * filter.pageSize]);
        return { rows, total: Number(count?.n ?? 0) };
    }
    async get(id) {
        const [row] = await this.db.query(`SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, r.slug AS role_slug, r.name_fa AS role_name,
              u.status, u.must_change_password, u.last_login_at, u.created_at
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [id]);
        if (!row)
            throw errors_1.errors.notFound('کاربر');
        return row;
    }
    async rolePermissionCodes(roleId) {
        const [role] = await this.db.query('SELECT slug, is_active FROM roles WHERE id = ?', [roleId]);
        if (!role)
            throw errors_1.errors.badRequest('نقش انتخاب‌شده یافت نشد.', { roleId: 'نقش نامعتبر است.' });
        const codes = await this.db.query(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`, [roleId]);
        return { slug: role.slug, codes: codes.map((c) => c.code), active: role.is_active === 1 };
    }
    /** Anti-escalation guard: the actor may only manage/assign roles whose permissions they fully hold. */
    async assertCanGrantRole(actor, roleId) {
        const role = await this.rolePermissionCodes(roleId);
        if (!role.active)
            throw errors_1.errors.badRequest('نقش انتخاب‌شده غیرفعال است.', { roleId: 'نقش غیرفعال است.' });
        const missing = (0, permissions_1.missingGrantablePermissions)(actor.permissions, role.codes);
        if (missing.length > 0) {
            throw errors_1.errors.forbidden();
        }
        return { slug: role.slug };
    }
    async assertCanManageTarget(actor, targetUserId) {
        const target = await this.get(targetUserId);
        const role = await this.rolePermissionCodes(target.role_id);
        if ((0, permissions_1.missingGrantablePermissions)(actor.permissions, role.codes).length > 0)
            throw errors_1.errors.forbidden();
        return target;
    }
    async countActiveSuperAdmins() {
        const [row] = await this.db.query(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.slug = ? AND u.status = 'active'`, [permissions_1.SUPER_ADMIN_ROLE]);
        return Number(row?.n ?? 0);
    }
    async create(actor, input) {
        const fe = validateProfile(input, true);
        const minLen = await this.passwordMinLength();
        const password = input.password ?? '';
        if (password.length < minLen)
            fe.password = `رمز عبور باید حداقل ${minLen} نویسه باشد.`;
        if (Object.keys(fe).length)
            throw errors_1.errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
        await this.assertCanGrantRole(actor, input.roleId);
        const username = input.username.trim().toLowerCase();
        const phone = input.phone && input.phone.trim() ? (0, persian_1.normalizeIranMobile)(input.phone) : null;
        const email = input.email && input.email.trim() ? input.email.trim().toLowerCase() : null;
        const hash = await (0, crypto_1.hashPassword)(password);
        try {
            const res = await this.db.execute(`INSERT INTO users (username, email, phone, full_name, password_hash, role_id, must_change_password, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`, [username, email, phone, (0, persian_1.normalizeText)(input.fullName), hash, input.roleId, actor.id]);
            const id = Number(res.insertId);
            await this.audit.record({ action: 'user.created', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip, details: { username, roleId: input.roleId } });
            return id;
        }
        catch (err) {
            throw this.mapDuplicate(err);
        }
    }
    mapDuplicate(err) {
        const code = err.code;
        if (code === 'ER_DUP_ENTRY') {
            const msg = String(err.message ?? '');
            if (msg.includes('uq_users_username'))
                return errors_1.errors.conflict('این نام کاربری قبلاً ثبت شده است.');
            if (msg.includes('uq_users_phone'))
                return errors_1.errors.conflict('این شماره همراه قبلاً ثبت شده است.');
            if (msg.includes('uq_users_email'))
                return errors_1.errors.conflict('این ایمیل قبلاً ثبت شده است.');
            return errors_1.errors.conflict('اطلاعات تکراری است.');
        }
        return err instanceof Error ? err : new Error('unknown error');
    }
    async update(actor, id, input) {
        const fe = validateProfile(input, false);
        if (Object.keys(fe).length)
            throw errors_1.errors.badRequest('لطفاً خطاهای فرم را برطرف کنید.', fe);
        const target = await this.assertCanManageTarget(actor, id);
        if (target.role_id !== input.roleId) {
            if (id === actor.id)
                throw new errors_1.AppError(400, 'SELF_ROLE_CHANGE', 'امکان تغییر نقش خودتان وجود ندارد.');
            await this.assertCanGrantRole(actor, input.roleId);
            if (target.role_slug === permissions_1.SUPER_ADMIN_ROLE && (await this.countActiveSuperAdmins()) <= 1) {
                throw errors_1.errors.conflict('آخرین مدیر اصلی فعال را نمی‌توان تغییر نقش داد.');
            }
        }
        const phone = input.phone && input.phone.trim() ? (0, persian_1.normalizeIranMobile)(input.phone) : null;
        const email = input.email && input.email.trim() ? input.email.trim().toLowerCase() : null;
        try {
            await this.db.execute('UPDATE users SET full_name = ?, email = ?, phone = ?, role_id = ? WHERE id = ?', [(0, persian_1.normalizeText)(input.fullName), email, phone, input.roleId, id]);
        }
        catch (err) {
            throw this.mapDuplicate(err);
        }
        await this.audit.record({
            action: target.role_id !== input.roleId ? 'user.role_changed' : 'user.updated',
            actorUserId: actor.id,
            entityType: 'user',
            entityId: id,
            ip: actor.ip,
            details: { fromRole: target.role_slug, toRoleId: input.roleId },
        });
    }
    async setStatus(actor, id, active) {
        if (id === actor.id)
            throw new errors_1.AppError(400, 'SELF_DISABLE', 'امکان غیرفعال‌کردن حساب خودتان وجود ندارد.');
        const target = await this.assertCanManageTarget(actor, id);
        if (!active && target.role_slug === permissions_1.SUPER_ADMIN_ROLE && (await this.countActiveSuperAdmins()) <= 1) {
            throw errors_1.errors.conflict('آخرین مدیر اصلی فعال را نمی‌توان غیرفعال کرد.');
        }
        await this.db.execute("UPDATE users SET status = ? WHERE id = ?", [active ? 'active' : 'disabled', id]);
        if (!active)
            await this.auth.revokeUserSessions(id);
        await this.audit.record({ action: active ? 'user.activated' : 'user.disabled', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip });
    }
    /** Sets a generated temporary password. It is returned once to the administrator and must be changed at next login. */
    async resetPassword(actor, id) {
        await this.assertCanManageTarget(actor, id);
        const temp = (0, crypto_1.generateTemporaryPassword)(14);
        await this.auth.setPassword(id, temp, await this.passwordMinLength(), true);
        await this.auth.revokeUserSessions(id);
        await this.audit.record({ action: 'user.password_reset', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip });
        return temp;
    }
    async revokeSessions(actor, id) {
        await this.assertCanManageTarget(actor, id);
        const n = await this.auth.revokeUserSessions(id);
        await this.audit.record({ action: 'user.sessions_revoked', actorUserId: actor.id, entityType: 'user', entityId: id, ip: actor.ip, details: { count: n } });
        return n;
    }
    /** Used by the installer to create the first super administrator. */
    async createFirstSuperAdmin(input) {
        await this.rbac.syncCatalog();
        const [role] = await this.db.query('SELECT id FROM roles WHERE slug = ?', [permissions_1.SUPER_ADMIN_ROLE]);
        if (!role)
            throw new Error('نقش مدیر اصلی یافت نشد.');
        const hash = await (0, crypto_1.hashPassword)(input.password);
        const res = await this.db.execute(`INSERT INTO users (username, email, full_name, password_hash, role_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, 0)`, [input.username.toLowerCase(), input.email ? input.email.toLowerCase() : null, (0, persian_1.normalizeText)(input.fullName), hash, role.id]);
        return Number(res.insertId);
    }
}
exports.UsersService = UsersService;
