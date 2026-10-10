/** Routes — پنل استاد. */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { TeacherPanelService } from './teacher-panel.service';
import { requireAuth, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { Policy } from '../../core/policy/policy';
import { AppError } from '../../core/errors/AppError';

export function teacherPanelRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new TeacherPanelService(ctx.db);
  const policy = new Policy(ctx.db);

  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const user = getAuthUser(req);
      const classes = await service.myClasses(user.id);
      const sessions = await service.mySessions(user.id, { upcomingOnly: true });
      if (wantsHtml(req)) {
        const reports = await service.myReports(user.id);
        res.render('panel/teacher', { classes, sessions, reports });
        return;
      }
      res.json({ data: { classes, sessions } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/classes', async (req, res, next) => {
    try {
      const classes = await service.myClasses(getAuthUser(req).id);
      res.json({ data: classes });
    } catch (err) {
      next(err);
    }
  });

  router.get('/classes/:id/students', async (req, res, next) => {
    try {
      const students = await service.classStudents(getAuthUser(req).id, Number(req.params.id));
      res.json({ data: students });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sessions', async (req, res, next) => {
    try {
      const sessions = await service.mySessions(getAuthUser(req).id);
      res.json({ data: sessions });
    } catch (err) {
      next(err);
    }
  });

  router.get('/reports', async (req, res, next) => {
    try {
      const reports = await service.myReports(getAuthUser(req).id);
      res.json({ data: reports });
    } catch (err) {
      next(err);
    }
  });

  /** صفحه سبت حضور جلسه — فقط استاد همان کلاس (یا license). */
  router.get('/mark/:sessionId', async (req, res, next) => {
    try {
      const user = getAuthUser(req);
      const sessionId = Number(req.params.sessionId);
      const session = await ctx.db
        .selectFrom('class_sessions')
        .select(['id', 'class_id', 'session_date', 'start_time', 'topic'])
        .where('id', '=', sessionId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!session) throw AppError.notFound('جلسه یافت نشد.');
      const classId = Number(session.class_id);
      await policy.assertClassAccess(user, classId, { action: 'mark' });
      const cls = await ctx.db
        .selectFrom('classes')
        .select(['id', 'code', 'title'])
        .where('id', '=', classId)
        .executeTakeFirstOrThrow();
      const roster = await service.attendance.classSessionRoster(classId, sessionId);
      if (wantsHtml(req)) {
        res.render('panel/mark', {
          session: { ...session, class_code: cls.code, class_title: cls.title },
          roster,
        });
        return;
      }
      res.json({ data: { session, roster } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/profile', async (req, res, next) => {
    try {
      const profile = await service.getProfile(getAuthUser(req).id);
      if (wantsHtml(req)) {
        res.render('panel/teacher-profile', { profile });
        return;
      }
      res.json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

  router.put('/profile', async (req, res, next) => {
    try {
      await service.updateProfile(getAuthUser(req).id, req.body ?? {});
      if (wantsHtml(req)) {
        res.redirect('/panel/teacher/profile');
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
