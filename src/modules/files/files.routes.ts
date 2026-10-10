/** Routes — files: دانلود کنترل‌شده با بررسی مالکیت. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { FilesService } from './files.service';
import { requireAuth, getAuthUser } from '../../core/http/middleware/auth';
import { Policy } from '../../core/policy/policy';

export function filesRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new FilesService(ctx.db, ctx.config);
  const policy = new Policy(ctx.db);

  router.use(requireAuth);

  router.get('/:id', async (req, res, next) => {
    try {
      const actor = getAuthUser(req);
      await policy.assertFileAccess(actor, Number(req.params.id));
      const file = await service.getFileForDownload(Number(req.params.id));
      res.setHeader('Content-Type', file.mime);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(file.original_name)}"`,
      );
      res.send(file.buffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
