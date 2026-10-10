/** Routes — مدیریت ماژول‌ها: فهرست + فعال/غیرفعال‌سازی با چک وابستگی. (REQ-P7-03) */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { sharedRegistry } from './registry';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { z } from 'zod';

const toggleSchema = z.object({ enabled: z.boolean() });

export function modulesRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = sharedRegistry(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('modules', 'modules', 'view'), async (req, res, next) => {
    try {
      const rows = await service.list();
      if (wantsHtml(req)) {
        res.render('modules/index', { rows });
        return;
      }
      res.json({ modules: rows });
    } catch (e) { next(e); }
  });

  router.post('/:slug/toggle', requirePermission('modules', 'modules', 'toggle'), async (req, res, next) => {
    try {
      const input = toggleSchema.parse(req.body);
      await service.setEnabled(getAuthUser(req), req.params.slug, input.enabled);
      if (wantsHtml(req)) {
        res.redirect('/admin/modules');
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}
