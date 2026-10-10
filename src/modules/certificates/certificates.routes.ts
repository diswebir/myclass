/** Routes — certificates: فهرست/صدور/دسته‌ای/لغو/قالب‌ها + صفحه عمومی /verify/:token (REQ-P5-01..04). */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { CertificatesService } from './certificates.service';
import {
  createTemplateSchema,
  issueBatchSchema,
  issueSchema,
  revokeSchema,
  updateTemplateSchema,
} from './certificates.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { Policy } from '../../core/policy/policy';

export function certificatesRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new CertificatesService(ctx.db, ctx.config);
  const policy = new Policy(ctx.db);

  router.use(requireAuth);

  // ---------- فهرست مدارک ----------
  router.get('/', requirePermission('certificates', 'certificates', 'view_all'), async (req, res, next) => {
    try {
      const rows = await service.listCertificates({
        studentId: req.query.studentId ? Number(req.query.studentId) : undefined,
        classId: req.query.classId ? Number(req.query.classId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
      });
      if (wantsHtml(req)) {
        res.render('certificates/index', { rows, filters: req.query });
        return;
      }
      res.json({ certificates: rows });
    } catch (e) { next(e); }
  });

  // ---------- قالب‌ها ----------
  router.get('/templates', requirePermission('certificates', 'templates', 'manage'), async (req, res, next) => {
    try {
      const rows = await service.listTemplates();
      if (wantsHtml(req)) {
        res.render('certificates/templates', { rows });
        return;
      }
      res.json({ templates: rows });
    } catch (e) { next(e); }
  });

  router.post('/templates', requirePermission('certificates', 'templates', 'manage'), async (req, res, next) => {
    try {
      const input = createTemplateSchema.parse(req.body);
      const tpl = await service.createTemplate(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect('/certificates/templates');
        return;
      }
      res.status(201).json({ template: tpl });
    } catch (e) { next(e); }
  });

  router.post('/templates/:id', requirePermission('certificates', 'templates', 'manage'), async (req, res, next) => {
    try {
      const input = updateTemplateSchema.parse(req.body);
      const tpl = await service.updateTemplate(getAuthUser(req), Number(req.params.id), input);
      if (wantsHtml(req)) {
        res.redirect('/certificates/templates');
        return;
      }
      res.json({ template: tpl });
    } catch (e) { next(e); }
  });

  // ---------- صدور ----------
  router.post('/issue', requirePermission('certificates', 'certificates', 'issue'), async (req, res, next) => {
    try {
      const input = issueSchema.parse(req.body);
      await policy.assertClassAccess(getAuthUser(req), input.classId, { action: 'issue_certificate' });
      const cert = await service.issueCertificate(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.redirect(`/certificates?classId=${input.classId}`);
        return;
      }
      res.status(201).json({ certificate: cert });
    } catch (e) { next(e); }
  });

  router.post('/issue-batch', requirePermission('certificates', 'certificates', 'issue'), async (req, res, next) => {
    try {
      const input = issueBatchSchema.parse(req.body);
      await policy.assertClassAccess(getAuthUser(req), input.classId, { action: 'issue_certificate' });
      const result = await service.issueBatch(getAuthUser(req), input);
      if (wantsHtml(req)) {
        res.render('certificates/batch-result', { result, classId: input.classId, dryRun: Boolean(input.dryRun) });
        return;
      }
      res.json(result);
    } catch (e) { next(e); }
  });

  // ---------- لغو ----------
  router.post('/:id/revoke', requirePermission('certificates', 'certificates', 'revoke'), async (req, res, next) => {
    try {
      const input = revokeSchema.parse(req.body);
      const cert = await service.getById(Number(req.params.id));
      if (cert.class_id) {
        await policy.assertClassAccess(getAuthUser(req), Number(cert.class_id), { action: 'revoke_certificate' });
      }
      const updated = await service.revokeCertificate(getAuthUser(req), Number(req.params.id), input.reason);
      if (wantsHtml(req)) {
        res.redirect('/certificates');
        return;
      }
      res.json({ certificate: updated });
    } catch (e) { next(e); }
  });

  return router;
}

/** صفحه عمومی راستی‌آزمایی — بدون احراز هویت. */
export function certificateVerifyRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new CertificatesService(ctx.db, ctx.config);
  router.get('/verify/:token', async (req, res, next) => {
    try {
      const result = await service.verifyByToken(String(req.params.token));
      if (!result) {
        res.status(404).render('verify', { found: false, result: null });
        return;
      }
      res.render('verify', { found: true, result });
    } catch (e) { next(e); }
  });
  return router;
}
