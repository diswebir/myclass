/** Routes — پشتیبان‌گیری/بازیابی: فهرست نسخه‌ها + ساخت + بازیابی با چک سازگاری. (REQ-P7-02) */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { BackupService } from './backup.service';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { z } from 'zod';

const restoreSchema = z.object({ id: z.string().min(5).max(32) });

export function backupRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new BackupService(ctx.db, ctx.config);

  router.use(requireAuth);

  router.get('/', requirePermission('backup', 'backup', 'create'), async (req, res, next) => {
    try {
      const rows = await service.listBackups();
      if (wantsHtml(req)) {
        res.render('backup/index', { rows });
        return;
      }
      res.json({ backups: rows });
    } catch (e) { next(e); }
  });

  router.post('/create', requirePermission('backup', 'backup', 'create'), async (req, res, next) => {
    try {
      const result = await service.createBackup(getAuthUser(req));
      if (wantsHtml(req)) {
        res.redirect('/admin/backup');
        return;
      }
      res.status(201).json(result);
    } catch (e) { next(e); }
  });

  router.post('/restore', requirePermission('backup', 'backup', 'restore'), async (req, res, next) => {
    try {
      const input = restoreSchema.parse(req.body);
      const result = await service.restoreBackup(getAuthUser(req), input.id);
      if (wantsHtml(req)) {
        res.redirect('/admin/backup');
        return;
      }
      res.json(result);
    } catch (e) { next(e); }
  });

  return router;
}
