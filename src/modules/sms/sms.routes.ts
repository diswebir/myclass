/** Routes — sms: پترن‌ها، رویدادها، صف، ارسال آزمایشی + endpoint داخلی cron (REQ-P6-03/04). */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { SmsService } from './sms.service';
import { eventSchema, patternSchema, testSendSchema } from './sms.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';
import { safeEqual } from '../../core/security/tokens';

/** فرم HTML متغیرها را به‌صورت JSON string می‌فرستد — اینجا به array تبدیل می‌شود. */
function parseVariablesJson(body: Record<string, unknown>): void {
  const raw = body.variablesJson;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      body.variables = JSON.parse(raw);
    } catch {
      throw AppError.badRequest('متغیرها JSON معتبر نیست.');
    }
  }
  delete body.variablesJson;
}

export function smsRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new SmsService(ctx.db, ctx.config);

  router.use(requireAuth);

  // ---------- پترن‌ها ----------
  router.get('/patterns', requirePermission('sms', 'patterns', 'manage'), async (req, res, next) => {
    try {
      const rows = await service.listPatterns();
      if (wantsHtml(req)) {
        res.render('sms/patterns', { rows });
        return;
      }
      res.json({ patterns: rows });
    } catch (e) { next(e); }
  });

  router.post('/patterns', requirePermission('sms', 'patterns', 'manage'), async (req, res, next) => {
    try {
      parseVariablesJson(req.body);
      const input = patternSchema.parse(req.body);
      const id = await service.createPattern(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect('/sms/patterns');
        return;
      }
      res.status(201).json({ patternId: id });
    } catch (e) { next(e); }
  });

  router.post('/patterns/:id', requirePermission('sms', 'patterns', 'manage'), async (req, res, next) => {
    try {
      parseVariablesJson(req.body);
      const input = patternSchema.partial().parse(req.body);
      await service.updatePattern(getAuthUser(req), Number(req.params.id), input);
      if (wantsHtml(req)) {
        res.redirect('/sms/patterns');
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- رویدادها ----------
  router.get('/events', requirePermission('sms', 'events', 'manage'), async (req, res, next) => {
    try {
      const rows = await service.listEvents();
      const patterns = await service.listPatterns();
      if (wantsHtml(req)) {
        res.render('sms/events', { rows, patterns });
        return;
      }
      res.json({ events: rows });
    } catch (e) { next(e); }
  });

  router.post('/events', requirePermission('sms', 'events', 'manage'), async (req, res, next) => {
    try {
      const input = eventSchema.parse(req.body);
      const id = await service.createEvent(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect('/sms/events');
        return;
      }
      res.status(201).json({ eventId: id });
    } catch (e) { next(e); }
  });

  router.post('/events/:id', requirePermission('sms', 'events', 'manage'), async (req, res, next) => {
    try {
      // فرم HTML — enabled به‌صورت '0'/'1' می‌آید
      if (typeof req.body.enabled === 'string') req.body.enabled = req.body.enabled === '1';
      const input = eventSchema.partial().omit({ eventKey: true }).parse(req.body);
      await service.updateEvent(getAuthUser(req), Number(req.params.id), input);
      if (wantsHtml(req)) {
        res.redirect('/sms/events');
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- صف ----------
  router.get('/queue', requirePermission('sms', 'queue', 'view'), async (req, res, next) => {
    try {
      const rows = await service.listQueue({ status: req.query.status ? String(req.query.status) : undefined });
      const stats = await service.queueStats();
      if (wantsHtml(req)) {
        res.render('sms/queue', { rows, stats, filters: req.query });
        return;
      }
      res.json({ queue: rows, stats });
    } catch (e) { next(e); }
  });

  // ---------- ارسال آزمایشی ----------
  router.post('/test-send', requirePermission('sms', 'test_send', 'run'), async (req, res, next) => {
    try {
      const input = testSendSchema.parse(req.body);
      const result = await service.testSend(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.render('sms/test-result', { result, input });
        return;
      }
      res.json(result);
    } catch (e) { next(e); }
  });

  return router;
}

/**
 * Endpoint داخلی برای Cron گرافیکی cPanel — spec §3 روش ۲:
 * POST /internal/jobs/run با هدر Authorization: Bearer <SMS_CRON_TOKEN>
 * (بدون نشست؛ در EXEMPT_PATHS exempt شده. اگر توکن تنظیم نشده باشد → ۴۰۴.)
 */
export function internalJobsRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post('/internal/jobs/run', async (req, res, next) => {
    try {
      const token = ctx.config.SMS_CRON_TOKEN;
      if (!token) throw AppError.notFound('not found');
      const sent = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!sent || !safeEqual(sent, token)) throw AppError.unauthorized('invalid cron token');
      const service = new SmsService(ctx.db, ctx.config);
      const result = await service.processPending();
      res.json({ ok: true, sms: result });
    } catch (e) { next(e); }
  });
  return router;
}
