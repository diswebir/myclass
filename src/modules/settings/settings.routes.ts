/** Routes — settings: فهرست/ویرایش (API + UI ساده). */
import { Router } from 'express';
import { wantsHtml, type AppContext } from '../../core/http/context';
import { SettingsService } from './settings.service';
import { SETTING_DEFS, SETTING_BY_KEY } from './settings.defaults';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';

export function settingsRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new SettingsService(ctx.db, ctx.config);

  router.use(requireAuth);

  router.get('/', requirePermission('settings', 'settings', 'view'), async (req, res, next) => {
    try {
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const settings = await service.listForUi(category);
      const categories = [...new Set(SETTING_DEFS.map((d) => d.category))];
      if (wantsHtml(req)) {
        res.render('settings/index', { settings, categories, category: category ?? '' });
        return;
      }
      res.json({ data: settings });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:key', requirePermission('settings', 'settings', 'update'), async (req, res, next) => {
    try {
      const key = req.params.key;
      const def = SETTING_BY_KEY.get(key);
      if (!def) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'تنظیم یافت نشد.' } });
        return;
      }
      let value: unknown = req.body?.value;
      // تبدیل رشته به نوع مناسب
      if (typeof value === 'string') {
        if (def.schema._def.typeName === 'ZodNumber') value = Number(value);
        else if (def.schema._def.typeName === 'ZodBoolean') value = value === 'true' || (value as unknown) === true;
        else if (value === '' && def.defaultValue === null) value = null;
      }
      await service.set(getAuthUser(req), key, value);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
