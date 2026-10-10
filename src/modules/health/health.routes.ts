/** Routes — سلامت: /healthz (عمومی، حداقل) + /admin/health (فقط مدیر). */
import { Router } from 'express';
import fs from 'node:fs';
import { wantsHtml, type AppContext } from '../../core/http/context';
import { requireAuth, requirePermission } from '../../core/http/middleware/auth';
import { pingDatabase, detectDialect } from '../../core/db/database';
import { listExecuted } from '../../core/db/migrate';
import { AuditService } from '../audit/audit.service';

export function healthRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/admin/health', requireAuth, requirePermission('health', 'health', 'view'), async (req, res, next) => {
    try {
      const dbOk = await pingDatabase(ctx.db);
      let migrations: string[] = [];
      try {
        migrations = [...(await listExecuted(ctx.db))].sort();
      } catch {
        migrations = [];
      }
      const audit = new AuditService(ctx.db);
      const recentErrors = await audit.countRecentErrors(60);
      let diskFree: number | null = null;
      try {
        const stat = fs.statfsSync(process.cwd());
        diskFree = Number(stat.bavail) * Number(stat.bsize);
      } catch {
        diskFree = null;
      }
      const info = {
        status: dbOk ? 'ok' : 'degraded',
        node: process.versions.node,
        uptimeSeconds: Math.round(process.uptime()),
        dialect: detectDialect(ctx.db),
        dbConnected: dbOk,
        migrationsApplied: migrations.length,
        migrations,
        recentErrors,
        diskFreeBytes: diskFree,
        memoryRssBytes: process.memoryUsage().rss,
      };
      if (wantsHtml(req)) {
        res.render('health', { info });
        return;
      }
      res.json(info);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
