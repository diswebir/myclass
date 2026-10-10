/** Routes — preregistration: عمومی (public) + review. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { PreregService } from './prereg.service';
import { preregFormSchema, preregSubmitSchema, preregReviewSchema } from './prereg.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';
import { rateLimit } from 'express-rate-limit';

export function preregRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new PreregService(ctx.db);

  // rate limit برای فرم عمومی
  const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    keyGenerator: (req) => `prereg:${req.ip}`,
  });

  // ---------- عمومی ----------
  router.get('/public/:classCode', publicLimiter, async (req, res, next) => {
    try {
      const { class: cls, form } = await service.getFormByClassCode(req.params.classCode);
      res.render('prereg/public-form', { cls, form });
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/:classCode', publicLimiter, async (req, res, next) => {
    try {
      // honeypot — اگر پر شده باشد → ربات
      if (req.body?.website) throw AppError.badRequest('درخواست نامعتبر است.');
      const input = preregSubmitSchema.parse(req.body);
      const { id, trackingCode } = await service.submitPublic(
        // classId از code
        (await service.getFormByClassCode(req.params.classCode)).class.id,
        input,
        req.ip ?? null,
      );
      if (wantsHtml(req)) {
        res.render('prereg/public-done', { trackingCode, cls: (await service.getFormByClassCode(req.params.classCode)).class });
        return;
      }
      res.status(201).json({ ok: true, id, trackingCode });
    } catch (err) {
      next(err);
    }
  });

  router.get('/tracking/:code', async (req, res, next) => {
    try {
      const row = await service.getByTrackingCode(req.params.code);
      if (wantsHtml(req)) {
        res.render('prereg/tracking', { row });
        return;
      }
      // پاسخ عمومی — فقط وضعیت و اطلاعات حداقلی
      res.json({
        data: {
          trackingCode: row.tracking_code,
          applicantName: row.applicant_name,
          status: row.status,
          reviewNote: row.review_note,
          createdAt: row.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- review (نیازمند ورود) ----------
  router.use(requireAuth);

  router.get('/', requirePermission('prereg', 'prereg', 'list'), async (req, res, next) => {
    try {
      const rows = await service.list({
        classId: typeof req.query.classId === 'string' ? Number(req.query.classId) : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      if (wantsHtml(req)) {
        res.render('prereg/index', { rows });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/forms/:classId', requirePermission('prereg', 'prereg', 'update'), async (req, res, next) => {
    try {
      const input = preregFormSchema.parse(req.body);
      await service.upsertForm(getAuthUser(req), Number(req.params.classId), input.fields);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/review', requirePermission('prereg', 'prereg', 'review'), async (req, res, next) => {
    try {
      const input = preregReviewSchema.parse(req.body);
      await service.review(getAuthUser(req), Number(req.params.id), input.status, input.reviewNote || null);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
