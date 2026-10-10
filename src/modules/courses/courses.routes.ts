/** Routes — courses: API + UI. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { CoursesService } from './courses.service';
import { courseSchema } from './courses.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';

export function coursesRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new CoursesService(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('courses', 'courses', 'list'), async (req, res, next) => {
    try {
      const rows = await service.list({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
      });
      if (wantsHtml(req)) {
        res.render('courses/index', { courses: rows });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('courses', 'courses', 'create'), async (req, res, next) => {
    try {
      const input = courseSchema.parse(req.body);
      const id = await service.create(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect(`/courses/${id}`);
        return;
      }
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/new', requirePermission('courses', 'courses', 'create'), (_req, res) => {
    res.render('courses/form', { course: null });
  });

  router.get('/:id', requirePermission('courses', 'courses', 'list'), async (req, res, next) => {
    try {
      const course = await service.getById(Number(req.params.id));
      if (wantsHtml(req)) {
        res.render('courses/form', { course });
        return;
      }
      res.json({ data: course });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission('courses', 'courses', 'update'), async (req, res, next) => {
    try {
      const input = courseSchema.partial().parse(req.body);
      await service.update(getAuthUser(req), Number(req.params.id), input);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('courses', 'courses', 'delete'), async (req, res, next) => {
    try {
      await service.softDelete(getAuthUser(req), Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
