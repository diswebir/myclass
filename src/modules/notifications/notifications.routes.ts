/** Routes — in-app notifications: list, unread counter, mark read. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { wantsHtml } from '../../core/http/context';
import { NotificationsService } from './notifications.service';
import { requireAuth, requirePermission } from '../../core/http/middleware/auth';

export function notificationsRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new NotificationsService(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('notifications', 'notifications', 'view'), async (req, res, next) => {
    try {
      const unreadOnly = req.query.unread === '1';
      const rows = await service.list(req.user!.id, { unreadOnly });
      if (wantsHtml(req)) {
        res.render('notifications/index', { rows, unreadOnly });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  // Unread counter — feeds the bell badge in layout.
  router.get('/unread-count', requirePermission('notifications', 'notifications', 'view'), async (req, res, next) => {
    try {
      res.json({ data: { count: await service.unreadCount(req.user!.id) } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/read', requirePermission('notifications', 'notifications', 'mark_read'), async (req, res, next) => {
    try {
      await service.markRead(Number(req.params.id), req.user!.id);
      if (wantsHtml(req)) {
        res.redirect('/notifications');
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/read-all', requirePermission('notifications', 'notifications', 'mark_read'), async (req, res, next) => {
    try {
      const updated = await service.markAllRead(req.user!.id);
      if (wantsHtml(req)) {
        res.redirect('/notifications');
        return;
      }
      res.json({ ok: true, updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
