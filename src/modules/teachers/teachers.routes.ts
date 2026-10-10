/** Routes — teachers: API + UI. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { TeachersService } from './teachers.service';
import { teacherSchema } from './teachers.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';

export function teachersRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new TeachersService(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('teachers', 'teachers', 'list'), async (req, res, next) => {
    try {
      const rows = await service.list({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      if (wantsHtml(req)) {
        res.render('teachers/index', { teachers: rows });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('teachers', 'teachers', 'create'), async (req, res, next) => {
    try {
      const input = teacherSchema.parse(req.body);
      const id = await service.create(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect(`/teachers/${id}`);
        return;
      }
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/new', requirePermission('teachers', 'teachers', 'create'), (_req, res) => {
    res.render('teachers/form', { teacher: null });
  });

  router.get('/:id', requirePermission('teachers', 'teachers', 'list'), async (req, res, next) => {
    try {
      const teacher = await service.getById(Number(req.params.id));
      if (wantsHtml(req)) {
        res.render('teachers/form', { teacher });
        return;
      }
      res.json({ data: teacher });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission('teachers', 'teachers', 'update'), async (req, res, next) => {
    try {
      const input = teacherSchema.partial().parse(req.body);
      await service.update(getAuthUser(req), Number(req.params.id), input);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('teachers', 'teachers', 'delete'), async (req, res, next) => {
    try {
      await service.softDelete(getAuthUser(req), Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
