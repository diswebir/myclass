/** Routes — مالی: پرداخت‌ها، اقساط، رسید کارت‌به‌کارت، گزارش‌ها (REQ-P4-02..04). */
import { Router } from 'express';
import type { AppContext } from '../../core/http/context';
import { FinanceService } from './finance.service';
import { createPaymentSchema, reviewReceiptSchema, scheduleSchema } from './finance.schemas';
import { requireAuth, requirePermission, getAuthUser } from '../../core/http/middleware/auth';
import { wantsHtml } from '../../core/http/context';
import { Policy } from '../../core/policy/policy';

export function financeRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new FinanceService(ctx.db);
  const policy = new Policy(ctx.db);

  router.use(requireAuth);

  // ---------- پرداخت‌ها ----------
  router.get('/payments', requirePermission('finance', 'payments', 'view_all'), async (req, res, next) => {
    try {
      const rows = await service.listPayments({
        studentId: req.query.studentId ? Number(req.query.studentId) : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
      });
      if (wantsHtml(req)) {
        res.render('finance/payments', { rows, filters: req.query });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/payments', requirePermission('finance', 'payments', 'create'), async (req, res, next) => {
    try {
      const input = createPaymentSchema.parse(req.body);
      const actor = getAuthUser(req);
      const result = await service.createPayment(actor, input);
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/payments/:id/approve', requirePermission('finance', 'payments', 'approve'), async (req, res, next) => {
    try {
      await service.approvePayment(getAuthUser(req), Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/payments/:id/reject', requirePermission('finance', 'payments', 'reject'), async (req, res, next) => {
    try {
      await service.rejectPayment(getAuthUser(req), Number(req.params.id), String(req.body?.note ?? ''));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/payments/:id/reverse', requirePermission('finance', 'payments', 'reverse'), async (req, res, next) => {
    try {
      await service.reversePayment(getAuthUser(req), Number(req.params.id), String(req.body?.reason ?? ''));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /** دفتر کل یک فراگیر — با بررسی مالکیت. */
  router.get('/ledger/:studentId', requirePermission('finance', 'finance', 'view_all'), async (req, res, next) => {
    try {
      const rows = await service.ledgerForStudent(Number(req.params.studentId));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  // ---------- اقساط ----------
  router.get('/installments', requirePermission('finance', 'installments', 'manage'), async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const rows = await service.installmentsReport({ status });
      if (wantsHtml(req)) {
        res.render('finance/installments', { rows, filters: req.query });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/installments/:enrollmentId', requirePermission('finance', 'installments', 'manage'), async (req, res, next) => {
    try {
      const rows = await service.listInstallments(Number(req.params.enrollmentId));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/installments/schedule', requirePermission('finance', 'installments', 'manage'), async (req, res, next) => {
    try {
      const input = scheduleSchema.parse(req.body);
      const result = await service.createSchedule(getAuthUser(req), input);
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  // ---------- رسید کارت‌به‌کارت ----------
  router.get('/receipts', requirePermission('finance', 'receipts', 'review'), async (req, res, next) => {
    try {
      const rows = await service.listReceipts({
        status: typeof req.query.status === 'string' ? req.query.status : 'pending',
      });
      if (wantsHtml(req)) {
        res.render('finance/receipts', { rows, filters: req.query });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/receipts/:id/review', requirePermission('finance', 'receipts', 'review'), async (req, res, next) => {
    try {
      const input = reviewReceiptSchema.parse(req.body);
      const result = await service.reviewReceipt(getAuthUser(req), Number(req.params.id), input.action, input.note);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  // ---------- گزارش‌ها ----------
  router.get('/reports', requirePermission('finance', 'reports', 'view'), async (req, res, next) => {
    try {
      const actor = getAuthUser(req);
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const [revenue, debtors] = await Promise.all([
        service.revenueReport({ from, to }),
        service.debtorsReport(),
      ]);
      if (wantsHtml(req)) {
        res.render('finance/reports', { revenue, debtors, filters: req.query });
        return;
      }
      res.json({ data: { revenue, debtors } });
    } catch (err) {
      next(err);
    }
  });

  /** گزارش مالی یک کلاس — با بررسی مالکیت کلاس. */
  router.get('/reports/class/:classId', requirePermission('finance', 'reports', 'view'), async (req, res, next) => {
    try {
      const classId = Number(req.params.classId);
      await policy.assertClassAccess(getAuthUser(req), classId, { action: 'view' });
      const rows = await service.classFinance(classId);
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
