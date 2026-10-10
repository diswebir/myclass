import path from 'node:path';
import express, { type Express } from 'express';
import type { AppServices } from './http/context';
import {
  authMiddleware, clientIpMiddleware, csrfMiddleware, installGate, securityHeaders,
} from './http/middleware';
import { errorHandler, notFoundHandler } from './http/error-handler';
import { authRoutes } from './routes/auth.routes';
import { installRoutes } from './routes/install.routes';
import { adminRoutes } from './routes/admin.routes';

/** Builds the Express application. All dependencies are injected, which keeps the app testable. */
export function createApp(s: AppServices, publicDir: string): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', s.cfg.trustProxy);
  app.use(securityHeaders());
  // Only the public/assets folder is exposed; everything else in the application root stays private.
  app.use(
    '/assets',
    express.static(path.join(publicDir, 'assets'), {
      index: false,
      dotfiles: 'deny',
      maxAge: s.cfg.isProduction ? '7d' : 0,
    }),
  );
  app.use(clientIpMiddleware(s.cfg.trustProxy));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(csrfMiddleware(s.cfg));

  app.get('/health', async (_req, res) => {
    try {
      await s.db.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use(installGate(s));
  app.use(authMiddleware(s));

  app.get('/', (_req, res) => {
    res.redirect(302, '/admin');
  });
  app.use(installRoutes(s));
  app.use(authRoutes(s));
  app.use(adminRoutes(s));

  app.use(notFoundHandler(s));
  app.use(errorHandler(s));
  return app;
}
