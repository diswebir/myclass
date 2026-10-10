/** Routes — classes: API + UI + تخصیص استاد + جلسات. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { ClassesService } from './classes.service';
import { classSchema, assignTeacherSchema, sessionSchema } from './classes.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';

export function classesRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new ClassesService(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('classes', 'classes', 'list'), async (req, res, next) => {
    try {
      const rows = await service.list({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      if (wantsHtml(req)) {
        res.render('classes/index', { classes: rows });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('classes', 'classes', 'create'), async (req, res, next) => {
    try {
      const input = classSchema.parse(req.body);
      const id = await service.create(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect(`/classes/${id}`);
        return;
      }
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/new', requirePermission('classes', 'classes', 'create'), (_req, res) => {
    res.render('classes/form', { cls: null });
  });

  router.get('/:id', requirePermission('classes', 'classes', 'list'), async (req, res, next) => {
    try {
      const cls = await service.getById(Number(req.params.id));
      const teachers = await service.listTeachers(Number(req.params.id));
      if (wantsHtml(req)) {
        res.render('classes/form', { cls, teachers });
        return;
      }
      res.json({ data: { ...cls, teachers } });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission('classes', 'classes', 'update'), async (req, res, next) => {
    try {
      const input = classSchema.partial().parse(req.body);
      await service.update(getAuthUser(req), Number(req.params.id), input);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/status', requirePermission('classes', 'classes', 'update'), async (req, res, next) => {
    try {
      const status = String(req.body?.status ?? '');
      await service.setStatus(getAuthUser(req), Number(req.params.id), status);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('classes', 'classes', 'delete'), async (req, res, next) => {
    try {
      await service.softDelete(getAuthUser(req), Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // تخصیص استاد
  router.get('/:id/teachers', requirePermission('classes', 'class_teachers', 'manage'), async (req, res, next) => {
    try {
      const teachers = await service.listTeachers(Number(req.params.id));
      res.json({ data: teachers });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/teachers', requirePermission('classes', 'class_teachers', 'manage'), async (req, res, next) => {
    try {
      const input = assignTeacherSchema.parse(req.body);
      await service.assignTeacher(getAuthUser(req), Number(req.params.id), input.teacherId);
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id/teachers/:teacherId', requirePermission('classes', 'class_teachers', 'manage'), async (req, res, next) => {
    try {
      await service.removeTeacher(getAuthUser(req), Number(req.params.id), Number(req.params.teacherId));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // جلسات
  router.get('/:id/sessions', requirePermission('sessions', 'sessions', 'list'), async (req, res, next) => {
    try {
      const rows = await service.listSessions(Number(req.params.id), {
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/sessions', requirePermission('sessions', 'sessions', 'create'), async (req, res, next) => {
    try {
      const input = sessionSchema.parse(req.body);
      const { id, conflicts } = await service.createSession(getAuthUser(req), Number(req.params.id), input);
      res.status(201).json({ ok: true, id, conflicts });
    } catch (err) {
      next(err);
    }
  });

  router.put('/sessions/:sessionId', requirePermission('sessions', 'sessions', 'update'), async (req, res, next) => {
    try {
      const input = sessionSchema.partial().parse(req.body);
      await service.updateSession(getAuthUser(req), Number(req.params.sessionId), input);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
