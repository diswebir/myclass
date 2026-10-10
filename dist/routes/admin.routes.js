"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRoutes = adminRoutes;
const migrator_1 = require("../db/migrator");
const express_1 = require("express");
const middleware_1 = require("../http/middleware");
const errors_1 = require("../lib/errors");
const pagination_1 = require("../http/pagination");
const registry_1 = require("../settings/registry");
const render_1 = require("./render");
const pages_1 = require("../views/pages");
const permissions_1 = require("../rbac/permissions");
function fail(s, req, res, err) {
    if (err instanceof errors_1.AppError && err.status < 500) {
        return (0, render_1.renderPage)(s, req, res, { title: err.message, status: err.status, body: (0, pages_1.errorBody)(err.status, err.message) });
    }
    throw err;
}
function adminRoutes(s) {
    const r = (0, express_1.Router)();
    const gate = [(0, middleware_1.requireAuth)()];
    // ---------- Dashboard ----------
    r.get('/admin', ...gate, async (req, res) => {
        const perms = req.auth.permissions;
        if (!(0, permissions_1.hasAllPermissions)(perms, ['dashboard.view'])) {
            const first = [
                ['/admin/users', 'users.view'], ['/admin/roles', 'roles.view'], ['/admin/settings/institute', 'settings.view'],
                ['/admin/audit', 'audit.view'], ['/admin/system/health', 'system.health.view'],
            ].find(([, p]) => (0, permissions_1.hasAllPermissions)(perms, [p]));
            if (first)
                return res.redirect(302, first[0]);
            return (0, render_1.renderPage)(s, req, res, { title: 'دسترسی', body: (0, pages_1.errorBody)(403, 'شما هنوز به هیچ بخشی دسترسی ندارید. با مدیر سامانه تماس بگیرید.'), status: 403 });
        }
        const stats = await s.dashboard.stats();
        const links = [
            { href: '/admin/users', label: 'مدیریت کاربران', allowed: (0, permissions_1.hasAllPermissions)(perms, ['users.view']) },
            { href: '/admin/roles', label: 'نقش‌ها و مجوزها', allowed: (0, permissions_1.hasAllPermissions)(perms, ['roles.view']) },
            { href: '/admin/settings/institute', label: 'اطلاعات مؤسسه', allowed: (0, permissions_1.hasAllPermissions)(perms, ['settings.view']) },
            { href: '/admin/audit', label: 'سوابق و رویدادها', allowed: (0, permissions_1.hasAllPermissions)(perms, ['audit.view']) },
            { href: '/admin/system/health', label: 'سلامت سامانه', allowed: (0, permissions_1.hasAllPermissions)(perms, ['system.health.view']) },
        ];
        await (0, render_1.renderPage)(s, req, res, {
            title: 'داشبورد',
            body: (0, pages_1.dashboardBody)({ stats, name: req.auth.user.full_name, links }),
            flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
        });
    });
    // ---------- Users ----------
    r.get('/admin/users', ...gate, (0, middleware_1.requirePermission)('users.view'), async (req, res) => {
        const page = (0, pagination_1.parsePage)(req.query, 20);
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
        const status = typeof req.query.status === 'string' ? req.query.status : '';
        const roleIdRaw = typeof req.query.roleId === 'string' ? req.query.roleId : '';
        const roleId = (0, render_1.parseId)(roleIdRaw) ?? undefined;
        const [{ rows, total }, roles] = await Promise.all([
            s.users.list({ q, status, roleId, page: page.page, pageSize: page.pageSize }),
            s.roles.list(),
        ]);
        const perms = req.auth.permissions;
        await (0, render_1.renderPage)(s, req, res, {
            title: 'کاربران',
            body: (0, pages_1.usersListBody)({
                rows,
                pageInfo: (0, pagination_1.pageInfo)(page, total),
                filters: { q, status, roleId: roleIdRaw },
                roles,
                canCreate: (0, permissions_1.hasAllPermissions)(perms, ['users.create']),
                canUpdate: (0, permissions_1.hasAllPermissions)(perms, ['users.update']),
            }),
            activePath: '/admin/users',
        });
    });
    r.get('/admin/users/new', ...gate, (0, middleware_1.requirePermission)('users.create'), async (req, res) => {
        const roles = await s.roles.list();
        await (0, render_1.renderPage)(s, req, res, {
            title: 'کاربر جدید',
            activePath: '/admin/users',
            body: (0, pages_1.userFormBody)({
                mode: 'create', roles, values: {}, errors: {}, csrf: req.csrfToken,
                canUpdate: true, canStatus: false, canResetPassword: false, canRevoke: false, isSelf: false,
            }),
        });
    });
    r.post('/admin/users', ...gate, (0, middleware_1.requirePermission)('users.create'), async (req, res) => {
        const b = (0, render_1.bodyOf)(req);
        const roleId = (0, render_1.parseId)(b.roleId ?? '') ?? 0;
        const values = { username: b.username ?? '', fullName: b.fullName ?? '', phone: b.phone ?? '', email: b.email ?? '', roleId: b.roleId ?? '' };
        try {
            const id = await s.users.create((0, render_1.actorOf)(req), {
                username: b.username,
                fullName: b.fullName ?? '',
                phone: b.phone,
                email: b.email,
                roleId,
                password: b.password,
            });
            res.redirect(303, `/admin/users/${id}?msg=user_created`);
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500)
                throw err;
            if (err.status === 403)
                return fail(s, req, res, err);
            const roles = await s.roles.list();
            await (0, render_1.renderPage)(s, req, res, {
                title: 'کاربر جدید', status: err.status, activePath: '/admin/users',
                body: (0, pages_1.userFormBody)({
                    mode: 'create', roles, values, errors: err.fieldErrors, formError: err.message, csrf: req.csrfToken,
                    canUpdate: true, canStatus: false, canResetPassword: false, canRevoke: false, isSelf: false,
                }),
            });
        }
    });
    r.get('/admin/users/:id', ...gate, (0, middleware_1.requirePermission)('users.view'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('کاربر'));
        try {
            const user = await s.users.get(id);
            const roles = await s.roles.list();
            const perms = req.auth.permissions;
            await (0, render_1.renderPage)(s, req, res, {
                title: user.full_name, activePath: '/admin/users',
                body: (0, pages_1.userFormBody)({
                    mode: 'edit', user, roles, values: {}, errors: {}, csrf: req.csrfToken,
                    canUpdate: (0, permissions_1.hasAllPermissions)(perms, ['users.update']),
                    canStatus: (0, permissions_1.hasAllPermissions)(perms, ['users.status']),
                    canResetPassword: (0, permissions_1.hasAllPermissions)(perms, ['users.reset_password']),
                    canRevoke: (0, permissions_1.hasAllPermissions)(perms, ['users.sessions_revoke']),
                    isSelf: user.id === req.auth.user.id,
                }),
                flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
            });
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    r.post('/admin/users/:id', ...gate, (0, middleware_1.requirePermission)('users.update'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('کاربر'));
        const b = (0, render_1.bodyOf)(req);
        const roleId = (0, render_1.parseId)(b.roleId ?? '') ?? 0;
        try {
            await s.users.update((0, render_1.actorOf)(req), id, { fullName: b.fullName ?? '', phone: b.phone, email: b.email, roleId });
            res.redirect(303, `/admin/users/${id}?msg=saved`);
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500)
                throw err;
            if (err.status === 403)
                return fail(s, req, res, err);
            const user = await s.users.get(id);
            const roles = await s.roles.list();
            const perms = req.auth.permissions;
            await (0, render_1.renderPage)(s, req, res, {
                title: user.full_name, status: err.status, activePath: '/admin/users',
                body: (0, pages_1.userFormBody)({
                    mode: 'edit', user, roles, values: { fullName: b.fullName ?? '', phone: b.phone ?? '', email: b.email ?? '' },
                    errors: err.fieldErrors, formError: err.message, csrf: req.csrfToken,
                    canUpdate: (0, permissions_1.hasAllPermissions)(perms, ['users.update']), canStatus: (0, permissions_1.hasAllPermissions)(perms, ['users.status']),
                    canResetPassword: (0, permissions_1.hasAllPermissions)(perms, ['users.reset_password']), canRevoke: (0, permissions_1.hasAllPermissions)(perms, ['users.sessions_revoke']),
                    isSelf: user.id === req.auth.user.id,
                }),
            });
        }
    });
    r.post('/admin/users/:id/status', ...gate, (0, middleware_1.requirePermission)('users.status'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('کاربر'));
        try {
            await s.users.setStatus((0, render_1.actorOf)(req), id, (0, render_1.bodyOf)(req).active === '1');
            res.redirect(303, `/admin/users/${id}?msg=status_changed`);
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    r.post('/admin/users/:id/reset-password', ...gate, (0, middleware_1.requirePermission)('users.reset_password'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('کاربر'));
        try {
            const temp = await s.users.resetPassword((0, render_1.actorOf)(req), id);
            const user = await s.users.get(id);
            await (0, render_1.renderPage)(s, req, res, {
                title: 'رمز موقت', noStore: true, activePath: '/admin/users',
                body: (0, pages_1.tempPasswordBody)({ username: user.username, tempPassword: temp, backHref: `/admin/users/${id}` }),
            });
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    r.post('/admin/users/:id/revoke-sessions', ...gate, (0, middleware_1.requirePermission)('users.sessions_revoke'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('کاربر'));
        try {
            await s.users.revokeSessions((0, render_1.actorOf)(req), id);
            res.redirect(303, `/admin/users/${id}?msg=sessions_revoked`);
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    // ---------- Roles ----------
    r.get('/admin/roles', ...gate, (0, middleware_1.requirePermission)('roles.view'), async (req, res) => {
        const roles = await s.roles.list();
        await (0, render_1.renderPage)(s, req, res, {
            title: 'نقش‌ها و دسترسی‌ها', activePath: '/admin/roles',
            body: (0, pages_1.rolesListBody)({ roles, canManage: (0, permissions_1.hasAllPermissions)(req.auth.permissions, ['roles.manage']) }),
            flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
        });
    });
    const roleFormValues = (b) => ({ slug: b.slug ?? '', nameFa: b.nameFa ?? '', description: b.description ?? '' });
    const selectedFrom = (req) => {
        const v = req.body?.permissions;
        if (Array.isArray(v))
            return v.filter((x) => typeof x === 'string');
        if (typeof v === 'string')
            return [v];
        return [];
    };
    r.get('/admin/roles/new', ...gate, (0, middleware_1.requirePermission)('roles.manage'), async (req, res) => {
        await (0, render_1.renderPage)(s, req, res, {
            title: 'نقش جدید', activePath: '/admin/roles',
            body: (0, pages_1.roleFormBody)({
                mode: 'create', values: { slug: '', nameFa: '', description: '' }, selected: new Set(), errors: {}, csrf: req.csrfToken,
                canManage: true, grantable: new Set(req.auth.permissions),
            }),
        });
    });
    r.post('/admin/roles', ...gate, (0, middleware_1.requirePermission)('roles.manage'), async (req, res) => {
        const b = (0, render_1.bodyOf)(req);
        const permissions = selectedFrom(req);
        try {
            const id = await s.roles.create((0, render_1.actorOf)(req), { slug: b.slug, nameFa: b.nameFa ?? '', description: b.description, permissions });
            res.redirect(303, `/admin/roles/${id}?msg=role_created`);
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500)
                throw err;
            if (err.status === 403)
                return fail(s, req, res, err);
            await (0, render_1.renderPage)(s, req, res, {
                title: 'نقش جدید', status: err.status, activePath: '/admin/roles',
                body: (0, pages_1.roleFormBody)({
                    mode: 'create', values: roleFormValues(b), selected: new Set(permissions), errors: err.fieldErrors, formError: err.message,
                    csrf: req.csrfToken, canManage: true, grantable: new Set(req.auth.permissions),
                }),
            });
        }
    });
    r.get('/admin/roles/:id', ...gate, (0, middleware_1.requirePermission)('roles.view'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('نقش'));
        try {
            const role = await s.roles.get(id);
            const canManage = (0, permissions_1.hasAllPermissions)(req.auth.permissions, ['roles.manage']);
            await (0, render_1.renderPage)(s, req, res, {
                title: role.name_fa, activePath: '/admin/roles',
                body: (0, pages_1.roleFormBody)({
                    mode: 'edit', role, values: { slug: role.slug, nameFa: role.name_fa, description: role.description ?? '' },
                    selected: new Set(role.permissions), errors: {}, csrf: req.csrfToken, canManage, grantable: new Set(req.auth.permissions),
                }),
                flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
            });
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    r.post('/admin/roles/:id', ...gate, (0, middleware_1.requirePermission)('roles.manage'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('نقش'));
        const b = (0, render_1.bodyOf)(req);
        const permissions = selectedFrom(req);
        try {
            await s.roles.update((0, render_1.actorOf)(req), id, { nameFa: b.nameFa ?? '', description: b.description, permissions });
            res.redirect(303, `/admin/roles/${id}?msg=role_saved`);
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500)
                throw err;
            if (err.status === 403)
                return fail(s, req, res, err);
            const role = await s.roles.get(id);
            await (0, render_1.renderPage)(s, req, res, {
                title: role.name_fa, status: err.status, activePath: '/admin/roles',
                body: (0, pages_1.roleFormBody)({
                    mode: 'edit', role, values: { slug: role.slug, nameFa: b.nameFa ?? '', description: b.description ?? '' },
                    selected: new Set(permissions), errors: err.fieldErrors, formError: err.message, csrf: req.csrfToken,
                    canManage: true, grantable: new Set(req.auth.permissions),
                }),
            });
        }
    });
    r.post('/admin/roles/:id/active', ...gate, (0, middleware_1.requirePermission)('roles.manage'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('نقش'));
        try {
            await s.roles.setActive((0, render_1.actorOf)(req), id, (0, render_1.bodyOf)(req).active === '1');
            res.redirect(303, `/admin/roles/${id}?msg=role_status`);
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    r.post('/admin/roles/:id/delete', ...gate, (0, middleware_1.requirePermission)('roles.manage'), async (req, res) => {
        const id = (0, render_1.parseId)(req.params.id);
        if (!id)
            return fail(s, req, res, errors_1.errors.notFound('نقش'));
        try {
            await s.roles.remove((0, render_1.actorOf)(req), id);
            res.redirect(303, '/admin/roles?msg=role_deleted');
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    // ---------- Settings ----------
    r.get('/admin/settings/:group', ...gate, (0, middleware_1.requirePermission)('settings.view'), async (req, res) => {
        const group = req.params.group;
        if (!(group in registry_1.SETTING_GROUP_LABELS))
            return fail(s, req, res, errors_1.errors.notFound('بخش تنظیمات'));
        const views = await s.settings.getGroup(group);
        const values = {};
        await (0, render_1.renderPage)(s, req, res, {
            title: registry_1.SETTING_GROUP_LABELS[group], activePath: `/admin/settings/${group}`,
            body: (0, pages_1.settingsBody)({
                group, views, csrf: req.csrfToken, canUpdate: (0, permissions_1.hasAllPermissions)(req.auth.permissions, ['settings.update']), errors: {}, values,
            }),
            flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
        });
    });
    r.post('/admin/settings/:group', ...gate, (0, middleware_1.requirePermission)('settings.update'), async (req, res) => {
        const group = req.params.group;
        if (!(group in registry_1.SETTING_GROUP_LABELS))
            return fail(s, req, res, errors_1.errors.notFound('بخش تنظیمات'));
        const b = (0, render_1.bodyOf)(req);
        const defs = registry_1.SETTINGS.filter((d) => d.group === group);
        const errs = {};
        const toSave = [];
        for (const def of defs) {
            if (b[def.key] === undefined)
                continue;
            const check = (0, registry_1.validateSettingValue)(def, b[def.key]);
            if (!check.ok)
                errs[def.key] = check.message;
            else
                toSave.push({ key: def.key, value: check.value });
        }
        if (Object.keys(errs).length) {
            const views = await s.settings.getGroup(group);
            return (0, render_1.renderPage)(s, req, res, {
                title: registry_1.SETTING_GROUP_LABELS[group], status: 400, activePath: `/admin/settings/${group}`,
                body: (0, pages_1.settingsBody)({ group, views, csrf: req.csrfToken, canUpdate: true, errors: errs, values: b, formError: 'لطفاً خطاهای فرم را برطرف کنید.' }),
            });
        }
        for (const item of toSave)
            await s.settings.update((0, render_1.actorOf)(req), item.key, item.value);
        res.redirect(303, `/admin/settings/${group}?msg=saved`);
    });
    // ---------- Audit ----------
    r.get('/admin/audit', ...gate, (0, middleware_1.requirePermission)('audit.view'), async (req, res) => {
        const page = (0, pagination_1.parsePage)(req.query, 50);
        const action = typeof req.query.action === 'string' ? req.query.action.slice(0, 120) : '';
        const { rows, total } = await s.audit.list({ action, page: page.page, pageSize: page.pageSize });
        await (0, render_1.renderPage)(s, req, res, {
            title: 'سوابق و رویدادها', activePath: '/admin/audit',
            body: (0, pages_1.auditBody)({ rows, pageInfo: (0, pagination_1.pageInfo)(page, total), filters: { action } }),
        });
    });
    // ---------- System health ----------
    r.get('/admin/system/health', ...gate, (0, middleware_1.requirePermission)('system.health.view'), async (req, res) => {
        const report = await s.health.report();
        await (0, render_1.renderPage)(s, req, res, {
            title: 'سلامت سامانه',
            activePath: '/admin/system/health',
            body: (0, pages_1.healthBody)(report, req.csrfToken, (0, permissions_1.hasAllPermissions)(req.auth.permissions, ['system.migrate'])),
            flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
        });
    });
    r.post('/admin/system/migrate', ...gate, (0, middleware_1.requirePermission)('system.migrate'), async (req, res) => {
        try {
            const result = await new migrator_1.Migrator(s.db, s.cfg.migrationsDir).migrate();
            await s.audit.record({
                action: 'system.migrated',
                actorUserId: req.auth.user.id,
                entityType: 'system',
                ip: req.clientIp ?? null,
                details: { applied: result.applied },
            });
            res.redirect(303, '/admin/system/health?msg=migrated');
        }
        catch (err) {
            fail(s, req, res, err);
        }
    });
    r.get('/api/health', (0, middleware_1.requirePermission)('system.health.view'), async (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await s.health.report());
    });
    return r;
}
