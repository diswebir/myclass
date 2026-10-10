/** Routes — enrollment: سبت‌نام، تبدیل، لغو. */
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../core/http/context';
import { EnrollmentService } from './enrollment.service';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';

const enrollSchema = z.object({
  classId: z.coerce.number().int().positive(),
  studentId: z.coerce.number().int().positive(),
  feeAmount: z.string().regex(/^\d+$/).optional(),
  discountAmount: z.string().regex(/^\d+$/).optional(),
});

export function enrollmentRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new EnrollmentService(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('enrollment', 'enrollment', 'list'), async (req, res, next) => {
    try {
      const rows = await service.list({
        classId: typeof req.query.classId === 'string' ? Number(req.query.classId) : undefined,
        studentId: typeof req.query.studentId === 'string' ? Number(req.query.studentId) : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('enrollment', 'enrollment', 'create'), async (req, res, next) => {
    try {
      const input = enrollSchema.parse(req.body);
      const id = await service.enroll(getAuthUser(req), input);
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', requirePermission('enrollment', 'enrollment', 'cancel'), async (req, res, next) => {
    try {
      await service.cancel(getAuthUser(req), Number(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : undefined);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/balance', requirePermission('enrollment', 'enrollment', 'view_all'), async (req, res, next) => {
    try {
      const balance = await service.balance(Number(req.params.id));
      res.json({ data: balance });
    } catch (err) {
      next(err);
    }
  });

  // تبدیل پیش‌سبت‌نام
  router.post('/convert/:preregId', requirePermission('prereg', 'prereg', 'convert'), async (req, res, next) => {
    try {
      const result = await service.convertPrereg(getAuthUser(req), Number(req.params.preregId));
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
