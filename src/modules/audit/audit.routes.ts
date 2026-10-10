/** Routes — audit log: فهرست + فیلتر (view). */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { AuditService } from './audit.service';
import { requireAuth, requirePermission } from '../../core/http/middleware/auth';

export function auditRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new AuditService(ctx.db);

  router.use(requireAuth, requirePermission('audit', 'audit', 'view'));

  router.get('/', async (req, res, next) => {
    try {
      const action = typeof req.query.action === 'string' ? req.query.action : undefined;
      const module = typeof req.query.module === 'string' ? req.query.module : undefined;
      const page = Math.max(1, Number(req.query.page ?? 1));
      const rows = await service.list({ action, module, limit: 50, offset: (page - 1) * 50 });
      if (req.headers.accept?.includes('text/html')) {
        res.render('audit/index', { rows, action: action ?? '', module: module ?? '', page });
        return;
      }
      res.json({ data: rows, page });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
