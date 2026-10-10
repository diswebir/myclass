/** Routes — users (CRUD + نقش + بازنشانی رمز). همه مسیرها نیازمند license هستند. */
import { Router } from 'express';
import { wantsHtml, type AppContext } from '../../core/http/context';
import { UsersService } from './users.service';
import { createUserSchema, updateUserSchema, resetPasswordSchema } from './users.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';

export function usersRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new UsersService(ctx.db, ctx.config);

  router.use(requireAuth);

  router.get('/', requirePermission('users', 'users', 'list'), async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const page = Math.max(1, Number(req.query.page ?? 1));
      const rows = await service.list({ q, limit: 50, offset: (page - 1) * 50 });
      if (wantsHtml(req)) {
        res.render('users/index', { users: rows, q: q ?? '', page });
        return;
      }
      res.json({ data: rows, page });
    } catch (err) {
      next(err);
    }
  });

  router.get('/new', requirePermission('users', 'users', 'create'), async (_req, res, next) => {
    try {
      const roles = await service.rbac.listRoles();
      res.render('users/form', { user: null, roles });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('users', 'users', 'create'), async (req, res, next) => {
    try {
      const input = createUserSchema.parse(req.body);
      const userId = await service.create(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect(`/users/${userId}`);
        return;
      }
      res.status(201).json({ ok: true, id: userId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission('users', 'users', 'list'), async (req, res, next) => {
    try {
      const user = await service.getById(Number(req.params.id));
      const roles = await service.rbac.listRoles();
      if (wantsHtml(req)) {
        res.render('users/form', { user, roles });
        return;
      }
      res.json({ data: user });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission('users', 'users', 'update'), async (req, res, next) => {
    try {
      const input = updateUserSchema.parse(req.body);
      await service.update(getAuthUser(req), Number(req.params.id), input);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/roles', requirePermission('users', 'users', 'assign_roles'), async (req, res, next) => {
    try {
      const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(Number) : [];
      await service.setRoles(getAuthUser(req), Number(req.params.id), roleIds);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reset-password', requirePermission('users', 'users', 'reset_password'), async (req, res, next) => {
    try {
      const input = resetPasswordSchema.parse(req.body);
      await service.resetPassword(getAuthUser(req), Number(req.params.id), input.newPassword);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('users', 'users', 'delete'), async (req, res, next) => {
    try {
      await service.softDelete(getAuthUser(req), Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
