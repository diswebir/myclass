/** Routes — پنل فراگیر. */
import { Router } from 'express';
import multer from 'multer';
import type { AppContext } from '../../core/http/context';
import { StudentPanelService } from './student-panel.service';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

export function studentPanelRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new StudentPanelService(ctx.db, ctx.config);

  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const user = getAuthUser(req);
      const classes = await service.myClasses(user.id);
      const attendance = await service.myAttendance(user.id);
      if (wantsHtml(req)) {
        const finance = await service.myFinance(user.id);
        const certificates = await service.myCertificates(user.id);
        res.render('panel/student', {
          classes,
          attendance,
          finance,
          certificates,
          flashReceipt: req.query.receipt === 'ok',
        });
        return;
      }
      res.json({ data: { classes, attendance } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/profile', async (req, res, next) => {
    try {
      const profile = await service.getProfile(getAuthUser(req).id);
      if (wantsHtml(req)) {
        res.render('panel/student-profile', { profile });
        return;
      }
      res.json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

  router.put('/profile', async (req, res, next) => {
    try {
      await service.updateProfile(getAuthUser(req).id, req.body ?? {});
      if (wantsHtml(req)) {
        res.redirect('/panel/student/profile');
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/classes', async (req, res, next) => {
    try {
      res.json({ data: await service.myClasses(getAuthUser(req).id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/attendance', async (req, res, next) => {
    try {
      res.json({ data: await service.myAttendance(getAuthUser(req).id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/finance', async (req, res, next) => {
    try {
      res.json({ data: await service.myFinance(getAuthUser(req).id) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/receipts',
    requirePermission('files', 'files', 'upload'),
    upload.single('file'),
    async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) throw AppError.badRequest('فایل رسید را انتخاب کنید.');
      const enrollmentId = Number(req.body?.enrollmentId);
      const amount = String(req.body?.amount ?? '');
      const idempotencyKey = String(req.body?.idempotencyKey ?? '');
      if (!enrollmentId || !amount || !idempotencyKey) {
        throw AppError.badRequest('enrollmentId، amount و idempotencyKey را ارسال کنید.');
      }
      const result = await service.uploadReceipt(getAuthUser(req).id, {
        buffer: file.buffer,
        originalName: file.originalname,
        enrollmentId,
        amount,
        idempotencyKey,
      });
      if (wantsHtml(req)) {
        res.redirect('/panel/student?receipt=ok');
        return;
      }
      res.status(201).json({ ok: true, ...result });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/certificates', async (req, res, next) => {
    try {
      res.json({ data: await service.myCertificates(getAuthUser(req).id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
