/** Routes — attendance: ثبت/اصلاح، فهرست جلسه، گزارش فراگیر/کلاس، هشدار غیبت. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { AttendanceService } from './attendance.service';
import { markSessionSchema } from './attendance.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { Policy } from '../../core/policy/policy';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../../core/errors/AppError';

export function attendanceRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new AttendanceService(ctx.db);
  const policy = new Policy(ctx.db);

  router.use(requireAuth);

  /** class_id یک جلسه (404 اگر جلسه موجود/حذف‌شده نباشد) */
  async function sessionClassId(sessionId: number): Promise<number> {
    const session = await ctx.db
      .selectFrom('class_sessions')
      .select('class_id')
      .where('id', '=', sessionId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!session) throw AppError.notFound('جلسه یافت نشد.');
    return Number(session.class_id);
  }

  router.post('/mark/:sessionId', requirePermission('attendance', 'attendance', 'mark'), async (req, res, next) => {
    try {
      const input = markSessionSchema.parse(req.body);
      const actor = getAuthUser(req);
      const sessionId = Number(req.params.sessionId);
      // مالکیت: استاد باید استاد کلاس جلسه باشد (یا license)
      const classId = await sessionClassId(sessionId);
      await policy.assertClassAccess(actor, classId, { action: 'mark' });
      const result = await service.markSession(actor, sessionId, input.entries);
      if (wantsHtml(req)) {
        res.redirect(`/panel/teacher/mark/${sessionId}`);
        return;
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.get('/session/:sessionId', requirePermission('attendance', 'attendance', 'view'), async (req, res, next) => {
    try {
      const actor = getAuthUser(req);
      const sessionId = Number(req.params.sessionId);
      const classId = await sessionClassId(sessionId);
      await policy.assertClassAccess(actor, classId, { action: 'view' });
      const rows = await service.listSession(sessionId);
      if (wantsHtml(req)) {
        res.render('attendance/session', { rows, sessionId, classId });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/roster/:classId/:sessionId', requirePermission('attendance', 'attendance', 'view'), async (req, res, next) => {
    try {
      const actor = getAuthUser(req);
      const classId = Number(req.params.classId);
      await policy.assertClassAccess(actor, classId, { action: 'view' });
      const rows = await service.classSessionRoster(classId, Number(req.params.sessionId));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/report/student/:studentId', async (req, res, next) => {
    try {
      const actor = getAuthUser(req);
      await policy.assertStudentAccess(actor, Number(req.params.studentId));
      const report = await service.studentReport(Number(req.params.studentId));
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  router.get('/report/class/:classId', requirePermission('attendance', 'attendance', 'report'), async (req, res, next) => {
    try {
      const actor = getAuthUser(req);
      const classId = Number(req.params.classId);
      await policy.assertClassAccess(actor, classId, { action: 'report' });
      const report = await service.classReport(classId);
      if (wantsHtml(req)) {
        res.render('attendance/class-report', { report });
        return;
      }
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  /** هشدار حد غیبت — فقط license (view_all): داده‌های همه فراگیران را نشان می‌دهد. */
  router.get('/warnings', requirePermission('attendance', 'attendance', 'view_all'), async (_req, res, next) => {
    try {
      const settings = new SettingsService(ctx.db, ctx.config);
      const maxAbsence = await settings.get<number>('attendance.max_absence_warn');
      const warnings = await service.absenceWarnings(maxAbsence);
      res.json({ data: warnings });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
