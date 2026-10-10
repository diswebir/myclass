/** Entry point — dist/index.js (Startup File در cPanel). */
import { loadConfig, loadDotEnv, isSecureCookies } from './core/config/env';
import { createDatabase, pingDatabase } from './core/db/database';
import { createApp } from './core/http/server';
import { logger } from './core/logger/logger';
import { isInstalledSync } from './core/http/middleware/installGate';
import { installerRoutes } from './modules/installer/installer.routes';
import { healthRoutes } from './modules/health/health.routes';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  logger.info('myclass در حال راه‌اندازی...', { node: process.versions.node, env: config.NODE_ENV });

  const installed = isInstalledSync(config);

  // تلاش برای اتصال DB (اگر تنظیم شده باشد)
  let dbOk = false;
  try {
    const db = createDatabase(config);
    dbOk = await pingDatabase(db);
    if (dbOk) {
      const app = createApp({ db, config });
      const port = config.PORT;
      app.listen(port, '0.0.0.0', () => {
        logger.info(`سرور روی پورت ${port} گوش می‌دهد. نصب‌شده: ${installed}`);
      });
      return;
    }
    await db.destroy();
  } catch (err) {
    logger.warn('اتصال اولیه به پایگاه داده برقرار نشد:', (err as Error).message);
  }

  if (!dbOk) {
    // حالت نصب — فقط installer + healthz
    logger.info('حالت نصب: فقط installer در دسترس است.');
    const app = express();
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());
    app.use(
      '/public',
      express.static(path.join(__dirname, '..', '..', 'public'), { index: false }),
    );
    const ctx = { db: null as never, config };
    app.use((req, _res, next) => {
      req.ctx = ctx;
      next();
    });
    app.use('/install', installerRoutes(ctx));
    app.use('/', healthRoutes(ctx));
    app.get('/', (_req, res) => res.redirect('/install'));
    app.use((req, res) => {
      res.status(404).send('Not Found');
    });
    const port = config.PORT;
    app.listen(port, '0.0.0.0', () => {
      logger.info(`سرور (حالت نصب) روی پورت ${port} گوش می‌دهد.`);
    });
  }
}

main().catch((err) => {
  logger.error('خطای راه‌اندازی:', err);
  process.exit(1);
});

export { isSecureCookies };
