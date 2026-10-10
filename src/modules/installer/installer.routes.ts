/** Routes — installer: /install (فرم)، /install/check، /install/run، /install/status */
import { Router } from 'express';
import type { Config } from '../../core/config/env';
import { InstallerService } from './installer.service';
import { isInstalledSync } from '../../core/http/middleware/installGate';
import { wantsHtml, type AppContext } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';

export function installerRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new InstallerService(ctx.config);

  const installed = () => isInstalledSync(ctx.config) && ctx.config.INSTALL_ALLOW_REINSTALL !== '1';

  router.get('/', (_req, res) => {
    if (installed()) {
      res.redirect('/');
      return;
    }
    res.render('install/index', { error: null, values: {} });
  });

  router.get('/status', (_req, res) => {
    res.json({ installed: service.isInstalled() });
  });

  router.post('/check', async (req, res, next) => {
    try {
      const input = normalizeInput(req.body);
      const checks = await service.runChecks(input);
      if (wantsHtml(req)) {
        res.render('install/check', { checks, values: publicValues(input) });
        return;
      }
      res.json({ checks, ok: checks.every((c) => c.ok) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/run', async (req, res, next) => {
    try {
      if (installed()) {
        res.redirect('/');
        return;
      }
      const input = normalizeInput(req.body);
      const { adminId } = await service.runInstall(input);
      service.writeEnvAndLock(input);
      if (wantsHtml(req)) {
        res.render('install/done', { adminId });
        return;
      }
      res.json({ ok: true, adminId });
    } catch (err) {
      if (wantsHtml(req)) {
        res.status(500).render('install/index', { error: (err as Error).message, values: req.body ?? {} });
        return;
      }
      next(err);
    }
  });

  return router;
}

function normalizeInput(body: Record<string, unknown>): {
  dbDriver: 'mysql' | 'sqlite';
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sqlitePath: string;
  appBaseUrl: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName: string;
} {
  const get = (k: string) => String(body?.[k] ?? '').trim();
  const dbDriver = get('dbDriver') || 'mysql';
  if (dbDriver !== 'mysql' && dbDriver !== 'sqlite') {
    throw AppError.badRequest('درایور پایگاه داده نامعتبر است. گزینه‌ها: mysql یا sqlite.');
  }
  return {
    dbDriver,
    dbHost: get('dbHost') || 'localhost',
    dbPort: Number(get('dbPort')) || 3306,
    dbName: get('dbName'),
    dbUser: get('dbUser'),
    dbPassword: String(body?.dbPassword ?? ''),
    sqlitePath: get('sqlitePath'),
    appBaseUrl: get('appBaseUrl') || 'http://localhost:3000',
    adminUsername: get('adminUsername'),
    adminPassword: String(body?.adminPassword ?? ''),
    adminFullName: get('adminFullName') || 'مدیر سیستم',
  };
}

function publicValues(input: { dbDriver: string; dbHost: string; dbPort: number; dbName: string; dbUser: string; sqlitePath: string; appBaseUrl: string; adminUsername: string; adminFullName: string }) {
  return {
    dbDriver: input.dbDriver,
    dbHost: input.dbHost,
    dbPort: input.dbPort,
    dbName: input.dbName,
    dbUser: input.dbUser,
    sqlitePath: input.sqlitePath,
    appBaseUrl: input.appBaseUrl,
    adminUsername: input.adminUsername,
    adminFullName: input.adminFullName,
  };
}
