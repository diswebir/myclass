/** Routes — students: API + UI + CSV import/export. */
import { Router } from 'express';
import multer from 'multer';
import type { AppContext } from '../../core/http/context';
import { StudentsService } from './students.service';
import { studentSchema } from './students.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

export function studentsRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new StudentsService(ctx.db);

  router.use(requireAuth);

  router.get('/', requirePermission('students', 'students', 'list'), async (req, res, next) => {
    try {
      const rows = await service.list({
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      if (wantsHtml(req)) {
        res.render('students/index', { students: rows });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/export.csv', requirePermission('students', 'students', 'export'), async (_req, res, next) => {
    try {
      const csv = await service.exportCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  router.post('/import/preview', requirePermission('students', 'students', 'import'), upload.single('file'), async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) throw AppError.badRequest('فایل CSV را انتخاب کنید.');
      const text = file.buffer.toString('utf-8');
      const parsed = service.parseCsv(text);
      if (wantsHtml(req)) {
        res.render('students/import-preview', { parsed });
        return;
      }
      res.json(parsed);
    } catch (err) {
      next(err);
    }
  });

  router.post('/import/commit', requirePermission('students', 'students', 'import'), async (req, res, next) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
      if (!rows) throw AppError.badRequest('ردیف‌های CSV را ارسال کنید.');
      const result = await service.importCommit(getAuthUser(req), { rows });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('students', 'students', 'create'), async (req, res, next) => {
    try {
      const input = studentSchema.parse(req.body);
      const id = await service.create(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect(`/students/${id}`);
        return;
      }
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/new', requirePermission('students', 'students', 'create'), (_req, res) => {
    res.render('students/form', { student: null });
  });

  router.get('/:id', requirePermission('students', 'students', 'list'), async (req, res, next) => {
    try {
      const student = await service.getById(Number(req.params.id));
      if (wantsHtml(req)) {
        res.render('students/form', { student });
        return;
      }
      res.json({ data: student });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission('students', 'students', 'update'), async (req, res, next) => {
    try {
      const input = studentSchema.partial().parse(req.body);
      await service.update(getAuthUser(req), Number(req.params.id), input);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('students', 'students', 'delete'), async (req, res, next) => {
    try {
      await service.softDelete(getAuthUser(req), Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
