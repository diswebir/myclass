/** Routes — dashboard: KPI + ۷ نمودار Chart.js (self-host) + API داده. (REQ-P7-01) */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { DashboardService, type RangeDays } from './dashboard.service';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';

const RANGES: RangeDays[] = [7, 30, 90];

export function dashboardRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new DashboardService(ctx.db);

  router.use(requireAuth);

  // صفحه داشبورد — محتوای per نقش (KPI در render سمت سرور)
  router.get('/', requirePermission('dashboard', 'dashboard', 'view'), async (req, res, next) => {
    try {
      const kpis = await service.kpis(getAuthUser(req));
      const range = RANGES.includes(Number(req.query.range) as RangeDays) ? (Number(req.query.range) as RangeDays) : 30;
      res.render('dashboard/index', { kpis, range, ranges: RANGES });
    } catch (e) { next(e); }
  });

  // API داده نمودارها — فقط دسترسی کامل (admin/مدیر)
  router.get('/api/charts', requirePermission('dashboard', 'dashboard', 'view'), async (req, res, next) => {
    try {
      const range = RANGES.includes(Number(req.query.range) as RangeDays) ? (Number(req.query.range) as RangeDays) : 30;
      const data = await service.charts(getAuthUser(req), range);
      if (!data) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'دسترسی به نمودارها کامل ندارید.' } });
        return;
      }
      res.json(data);
    } catch (e) { next(e); }
  });

  // API KPI (برای رفرش client-side)
  router.get('/api/kpis', requirePermission('dashboard', 'dashboard', 'view'), async (req, res, next) => {
    try {
      res.json({ kpis: await service.kpis(getAuthUser(req)) });
    } catch (e) { next(e); }
  });

  return router;
}
