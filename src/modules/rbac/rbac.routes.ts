/** Routes — مدیریت نقش‌ها و مجوزها (spec §8 گام ۳: ساخت نقش جدید + تخصیص مجوز). */
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../core/http/context';
import { RbacService } from './rbac.service';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';

const roleSchema = z.object({
  name: z.string().min(1).max(191),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(z.string()).optional(),
});

export function rbacRoutes(ctx: AppContext): Router {
  const router = Router();
  const rbac = new RbacService(ctx.db);

  router.use(requireAuth);

  router.get('/roles', requirePermission('rbac', 'roles', 'list'), async (req, res, next) => {
    try {
      const roles = await rbac.listRoles();
      const permissions = await rbac.repo.listPermissions();
      if (wantsHtml(req)) {
        res.render('rbac/roles', { roles, permissions });
        return;
      }
      res.json({ roles, permissions });
    } catch (e) { next(e); }
  });

  router.post('/roles', requirePermission('rbac', 'roles', 'create'), async (req, res, next) => {
    try {
      const input = roleSchema.parse(req.body);
      const roleId = await rbac.createRole(getAuthUser(req), input.name, input.slug, input.description ?? null, input.permissions ?? []);
      if (wantsHtml(req)) {
        res.redirect('/rbac/roles');
        return;
      }
      res.status(201).json({ roleId });
    } catch (e) { next(e); }
  });

  router.post('/roles/:id', requirePermission('rbac', 'roles', 'update'), async (req, res, next) => {
    try {
      const input = roleSchema.partial().parse(req.body);
      const role = await rbac.repo.findRoleById(Number(req.params.id));
      if (!role) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'نقش یافت نشد.' } });
        return;
      }
      await rbac.updateRole(
        getAuthUser(req),
        Number(req.params.id),
        input.name ?? role.name,
        input.description ?? null,
        input.permissions,
      );
      if (wantsHtml(req)) {
        res.redirect('/rbac/roles');
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.post('/roles/:id/delete', requirePermission('rbac', 'roles', 'delete'), async (req, res, next) => {
    try {
      await rbac.deleteRole(getAuthUser(req), Number(req.params.id));
      if (wantsHtml(req)) {
        res.redirect('/rbac/roles');
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.get('/permissions', requirePermission('rbac', 'permissions', 'list'), async (req, res, next) => {
    try {
      res.json({ permissions: await rbac.repo.listPermissions() });
    } catch (e) { next(e); }
  });

  return router;
}
