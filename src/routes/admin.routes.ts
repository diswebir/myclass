import { Migrator } from '../db/migrator';
import { Router, type Request, type Response } from 'express';
import type { AppServices } from '../http/context';
import { requireAuth, requirePermission } from '../http/middleware';
import { AppError, errors } from '../lib/errors';
import { parsePage, pageInfo } from '../http/pagination';
import { SETTING_GROUP_LABELS, SETTINGS, validateSettingValue, type SettingGroup } from '../settings/registry';
import { actorOf, bodyOf, parseId, renderPage } from './render';
import {
  auditBody, dashboardBody, healthBody, errorBody, roleFormBody, rolesListBody, settingsBody, tempPasswordBody, userFormBody, usersListBody,
} from '../views/pages';
import { hasAllPermissions } from '../rbac/permissions';

function fail(s: AppServices, req: Request, res: Response, err: unknown) {
  if (err instanceof AppError && err.status < 500) {
    return renderPage(s, req, res, { title: err.message, status: err.status, body: errorBody(err.status, err.message) });
  }
  throw err;
}

export function adminRoutes(s: AppServices): Router {
  const r = Router();
  const gate = [requireAuth()];

  // ---------- Dashboard ----------
  r.get('/admin', ...gate, async (req, res) => {
    const perms = req.auth!.permissions;
    if (!hasAllPermissions(perms, ['dashboard.view'])) {
      const first = [
        ['/admin/users', 'users.view'], ['/admin/roles', 'roles.view'], ['/admin/settings/institute', 'settings.view'],
        ['/admin/audit', 'audit.view'], ['/admin/system/health', 'system.health.view'],
      ].find(([, p]) => hasAllPermissions(perms, [p]));
      if (first) return res.redirect(302, first[0]);
      return renderPage(s, req, res, { title: 'دسترسی', body: errorBody(403, 'شما هنوز به هیچ بخشی دسترسی ندارید. با مدیر سامانه تماس بگیرید.'), status: 403 });
    }
    const stats = await s.dashboard.stats();
    const links = [
      { href: '/admin/users', label: 'مدیریت کاربران', allowed: hasAllPermissions(perms, ['users.view']) },
      { href: '/admin/roles', label: 'نقش‌ها و مجوزها', allowed: hasAllPermissions(perms, ['roles.view']) },
      { href: '/admin/settings/institute', label: 'اطلاعات مؤسسه', allowed: hasAllPermissions(perms, ['settings.view']) },
      { href: '/admin/audit', label: 'سوابق و رویدادها', allowed: hasAllPermissions(perms, ['audit.view']) },
      { href: '/admin/system/health', label: 'سلامت سامانه', allowed: hasAllPermissions(perms, ['system.health.view']) },
    ];
    await renderPage(s, req, res, {
      title: 'داشبورد',
      body: dashboardBody({ stats, name: req.auth!.user.full_name, links }),
      flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
    });
  });

  // ---------- Users ----------
  r.get('/admin/users', ...gate, requirePermission('users.view'), async (req, res) => {
    const page = parsePage(req.query as Record<string, unknown>, 20);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const roleIdRaw = typeof req.query.roleId === 'string' ? req.query.roleId : '';
    const roleId = parseId(roleIdRaw) ?? undefined;
    const [{ rows, total }, roles] = await Promise.all([
      s.users.list({ q, status, roleId, page: page.page, pageSize: page.pageSize }),
      s.roles.list(),
    ]);
    const perms = req.auth!.permissions;
    await renderPage(s, req, res, {
      title: 'کاربران',
      body: usersListBody({
        rows,
        pageInfo: pageInfo(page, total),
        filters: { q, status, roleId: roleIdRaw },
        roles,
        canCreate: hasAllPermissions(perms, ['users.create']),
        canUpdate: hasAllPermissions(perms, ['users.update']),
      }),
      activePath: '/admin/users',
    });
  });

  r.get('/admin/users/new', ...gate, requirePermission('users.create'), async (req, res) => {
    const roles = await s.roles.list();
    await renderPage(s, req, res, {
      title: 'کاربر جدید',
      activePath: '/admin/users',
      body: userFormBody({
        mode: 'create', roles, values: {}, errors: {}, csrf: req.csrfToken!,
        canUpdate: true, canStatus: false, canResetPassword: false, canRevoke: false, isSelf: false,
      }),
    });
  });

  r.post('/admin/users', ...gate, requirePermission('users.create'), async (req, res) => {
    const b = bodyOf(req);
    const roleId = parseId(b.roleId ?? '') ?? 0;
    const values = { username: b.username ?? '', fullName: b.fullName ?? '', phone: b.phone ?? '', email: b.email ?? '', roleId: b.roleId ?? '' };
    try {
      const id = await s.users.create(actorOf(req), {
        username: b.username,
        fullName: b.fullName ?? '',
        phone: b.phone,
        email: b.email,
        roleId,
        password: b.password,
      });
      res.redirect(303, `/admin/users/${id}?msg=user_created`);
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      if (err.status === 403) return fail(s, req, res, err);
      const roles = await s.roles.list();
      await renderPage(s, req, res, {
        title: 'کاربر جدید', status: err.status, activePath: '/admin/users',
        body: userFormBody({
          mode: 'create', roles, values, errors: err.fieldErrors, formError: err.message, csrf: req.csrfToken!,
          canUpdate: true, canStatus: false, canResetPassword: false, canRevoke: false, isSelf: false,
        }),
      });
    }
  });

  r.get('/admin/users/:id', ...gate, requirePermission('users.view'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('کاربر'));
    try {
      const user = await s.users.get(id);
      const roles = await s.roles.list();
      const perms = req.auth!.permissions;
      await renderPage(s, req, res, {
        title: user.full_name, activePath: '/admin/users',
        body: userFormBody({
          mode: 'edit', user, roles, values: {}, errors: {}, csrf: req.csrfToken!,
          canUpdate: hasAllPermissions(perms, ['users.update']),
          canStatus: hasAllPermissions(perms, ['users.status']),
          canResetPassword: hasAllPermissions(perms, ['users.reset_password']),
          canRevoke: hasAllPermissions(perms, ['users.sessions_revoke']),
          isSelf: user.id === req.auth!.user.id,
        }),
        flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
      });
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  r.post('/admin/users/:id', ...gate, requirePermission('users.update'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('کاربر'));
    const b = bodyOf(req);
    const roleId = parseId(b.roleId ?? '') ?? 0;
    try {
      await s.users.update(actorOf(req), id, { fullName: b.fullName ?? '', phone: b.phone, email: b.email, roleId });
      res.redirect(303, `/admin/users/${id}?msg=saved`);
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      if (err.status === 403) return fail(s, req, res, err);
      const user = await s.users.get(id);
      const roles = await s.roles.list();
      const perms = req.auth!.permissions;
      await renderPage(s, req, res, {
        title: user.full_name, status: err.status, activePath: '/admin/users',
        body: userFormBody({
          mode: 'edit', user, roles, values: { fullName: b.fullName ?? '', phone: b.phone ?? '', email: b.email ?? '' },
          errors: err.fieldErrors, formError: err.message, csrf: req.csrfToken!,
          canUpdate: hasAllPermissions(perms, ['users.update']), canStatus: hasAllPermissions(perms, ['users.status']),
          canResetPassword: hasAllPermissions(perms, ['users.reset_password']), canRevoke: hasAllPermissions(perms, ['users.sessions_revoke']),
          isSelf: user.id === req.auth!.user.id,
        }),
      });
    }
  });

  r.post('/admin/users/:id/status', ...gate, requirePermission('users.status'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('کاربر'));
    try {
      await s.users.setStatus(actorOf(req), id, bodyOf(req).active === '1');
      res.redirect(303, `/admin/users/${id}?msg=status_changed`);
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  r.post('/admin/users/:id/reset-password', ...gate, requirePermission('users.reset_password'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('کاربر'));
    try {
      const temp = await s.users.resetPassword(actorOf(req), id);
      const user = await s.users.get(id);
      await renderPage(s, req, res, {
        title: 'رمز موقت', noStore: true, activePath: '/admin/users',
        body: tempPasswordBody({ username: user.username, tempPassword: temp, backHref: `/admin/users/${id}` }),
      });
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  r.post('/admin/users/:id/revoke-sessions', ...gate, requirePermission('users.sessions_revoke'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('کاربر'));
    try {
      await s.users.revokeSessions(actorOf(req), id);
      res.redirect(303, `/admin/users/${id}?msg=sessions_revoked`);
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  // ---------- Roles ----------
  r.get('/admin/roles', ...gate, requirePermission('roles.view'), async (req, res) => {
    const roles = await s.roles.list();
    await renderPage(s, req, res, {
      title: 'نقش‌ها و دسترسی‌ها', activePath: '/admin/roles',
      body: rolesListBody({ roles, canManage: hasAllPermissions(req.auth!.permissions, ['roles.manage']) }),
      flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
    });
  });

  const roleFormValues = (b: Record<string, string>) => ({ slug: b.slug ?? '', nameFa: b.nameFa ?? '', description: b.description ?? '' });
  const selectedFrom = (req: Request): string[] => {
    const v = (req.body as Record<string, unknown>)?.permissions;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (typeof v === 'string') return [v];
    return [];
  };

  r.get('/admin/roles/new', ...gate, requirePermission('roles.manage'), async (req, res) => {
    await renderPage(s, req, res, {
      title: 'نقش جدید', activePath: '/admin/roles',
      body: roleFormBody({
        mode: 'create', values: { slug: '', nameFa: '', description: '' }, selected: new Set(), errors: {}, csrf: req.csrfToken!,
        canManage: true, grantable: new Set(req.auth!.permissions),
      }),
    });
  });

  r.post('/admin/roles', ...gate, requirePermission('roles.manage'), async (req, res) => {
    const b = bodyOf(req);
    const permissions = selectedFrom(req);
    try {
      const id = await s.roles.create(actorOf(req), { slug: b.slug, nameFa: b.nameFa ?? '', description: b.description, permissions });
      res.redirect(303, `/admin/roles/${id}?msg=role_created`);
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      if (err.status === 403) return fail(s, req, res, err);
      await renderPage(s, req, res, {
        title: 'نقش جدید', status: err.status, activePath: '/admin/roles',
        body: roleFormBody({
          mode: 'create', values: roleFormValues(b), selected: new Set(permissions), errors: err.fieldErrors, formError: err.message,
          csrf: req.csrfToken!, canManage: true, grantable: new Set(req.auth!.permissions),
        }),
      });
    }
  });

  r.get('/admin/roles/:id', ...gate, requirePermission('roles.view'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('نقش'));
    try {
      const role = await s.roles.get(id);
      const canManage = hasAllPermissions(req.auth!.permissions, ['roles.manage']);
      await renderPage(s, req, res, {
        title: role.name_fa, activePath: '/admin/roles',
        body: roleFormBody({
          mode: 'edit', role, values: { slug: role.slug, nameFa: role.name_fa, description: role.description ?? '' },
          selected: new Set(role.permissions), errors: {}, csrf: req.csrfToken!, canManage, grantable: new Set(req.auth!.permissions),
        }),
        flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
      });
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  r.post('/admin/roles/:id', ...gate, requirePermission('roles.manage'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('نقش'));
    const b = bodyOf(req);
    const permissions = selectedFrom(req);
    try {
      await s.roles.update(actorOf(req), id, { nameFa: b.nameFa ?? '', description: b.description, permissions });
      res.redirect(303, `/admin/roles/${id}?msg=role_saved`);
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      if (err.status === 403) return fail(s, req, res, err);
      const role = await s.roles.get(id);
      await renderPage(s, req, res, {
        title: role.name_fa, status: err.status, activePath: '/admin/roles',
        body: roleFormBody({
          mode: 'edit', role, values: { slug: role.slug, nameFa: b.nameFa ?? '', description: b.description ?? '' },
          selected: new Set(permissions), errors: err.fieldErrors, formError: err.message, csrf: req.csrfToken!,
          canManage: true, grantable: new Set(req.auth!.permissions),
        }),
      });
    }
  });

  r.post('/admin/roles/:id/active', ...gate, requirePermission('roles.manage'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('نقش'));
    try {
      await s.roles.setActive(actorOf(req), id, bodyOf(req).active === '1');
      res.redirect(303, `/admin/roles/${id}?msg=role_status`);
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  r.post('/admin/roles/:id/delete', ...gate, requirePermission('roles.manage'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return fail(s, req, res, errors.notFound('نقش'));
    try {
      await s.roles.remove(actorOf(req), id);
      res.redirect(303, '/admin/roles?msg=role_deleted');
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  // ---------- Settings ----------
  r.get('/admin/settings/:group', ...gate, requirePermission('settings.view'), async (req, res) => {
    const group = req.params.group as SettingGroup;
    if (!(group in SETTING_GROUP_LABELS)) return fail(s, req, res, errors.notFound('بخش تنظیمات'));
    const views = await s.settings.getGroup(group);
    const values: Record<string, string> = {};
    await renderPage(s, req, res, {
      title: SETTING_GROUP_LABELS[group], activePath: `/admin/settings/${group}`,
      body: settingsBody({
        group, views, csrf: req.csrfToken!, canUpdate: hasAllPermissions(req.auth!.permissions, ['settings.update']), errors: {}, values,
      }),
      flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
    });
  });

  r.post('/admin/settings/:group', ...gate, requirePermission('settings.update'), async (req, res) => {
    const group = req.params.group as SettingGroup;
    if (!(group in SETTING_GROUP_LABELS)) return fail(s, req, res, errors.notFound('بخش تنظیمات'));
    const b = bodyOf(req);
    const defs = SETTINGS.filter((d) => d.group === group);
    const errs: Record<string, string> = {};
    const toSave: { key: string; value: unknown }[] = [];
    for (const def of defs) {
      if (b[def.key] === undefined) continue;
      const check = validateSettingValue(def, b[def.key]);
      if (!check.ok) errs[def.key] = check.message;
      else toSave.push({ key: def.key, value: check.value });
    }
    if (Object.keys(errs).length) {
      const views = await s.settings.getGroup(group);
      return renderPage(s, req, res, {
        title: SETTING_GROUP_LABELS[group], status: 400, activePath: `/admin/settings/${group}`,
        body: settingsBody({ group, views, csrf: req.csrfToken!, canUpdate: true, errors: errs, values: b, formError: 'لطفاً خطاهای فرم را برطرف کنید.' }),
      });
    }
    for (const item of toSave) await s.settings.update(actorOf(req), item.key, item.value);
    res.redirect(303, `/admin/settings/${group}?msg=saved`);
  });

  // ---------- Audit ----------
  r.get('/admin/audit', ...gate, requirePermission('audit.view'), async (req, res) => {
    const page = parsePage(req.query as Record<string, unknown>, 50);
    const action = typeof req.query.action === 'string' ? req.query.action.slice(0, 120) : '';
    const { rows, total } = await s.audit.list({ action, page: page.page, pageSize: page.pageSize });
    await renderPage(s, req, res, {
      title: 'سوابق و رویدادها', activePath: '/admin/audit',
      body: auditBody({ rows, pageInfo: pageInfo(page, total), filters: { action } }),
    });
  });

  // ---------- System health ----------
  r.get('/admin/system/health', ...gate, requirePermission('system.health.view'), async (req, res) => {
    const report = await s.health.report();
    await renderPage(s, req, res, {
      title: 'سلامت سامانه',
      activePath: '/admin/system/health',
      body: healthBody(report, req.csrfToken!, hasAllPermissions(req.auth!.permissions, ['system.migrate'])),
      flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
    });
  });

  r.post('/admin/system/migrate', ...gate, requirePermission('system.migrate'), async (req, res) => {
    try {
      const result = await new Migrator(s.db, s.cfg.migrationsDir).migrate();
      await s.audit.record({
        action: 'system.migrated',
        actorUserId: req.auth!.user.id,
        entityType: 'system',
        ip: req.clientIp ?? null,
        details: { applied: result.applied },
      });
      res.redirect(303, '/admin/system/health?msg=migrated');
    } catch (err) {
      fail(s, req, res, err);
    }
  });

  r.get('/api/health', requirePermission('system.health.view'), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await s.health.report());
  });

  return r;
}
