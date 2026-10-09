import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { errors, AppError } from '../lib/errors';
import { safeEqual, randomToken } from '../lib/crypto';
import { hasAllPermissions } from '../rbac/permissions';
import type { AppServices } from './context';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key || out[key] !== undefined) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = '';
    }
  }
  return out;
}

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  });
}

export function cookieOptions(cfg: AppServices['cfg'], maxAgeMs?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cfg.cookieSecure,
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
}

/** Resolves the client IP (trusting X-Forwarded-For only up to TRUST_PROXY hops). */
export function clientIpMiddleware(trustProxy: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (trustProxy > 0) {
      const xff = req.headers['x-forwarded-for'];
      const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const picked = list.length >= trustProxy ? list[list.length - trustProxy] : undefined;
      req.clientIp = picked ?? req.socket.remoteAddress ?? null;
    } else {
      req.clientIp = req.socket.remoteAddress ?? null;
    }
    next();
  };
}

/**
 * Double-submit CSRF protection: a random `csrf` cookie is set once; every state-changing request must echo
 * the same value in the `_csrf` form field (or `x-csrf-token` header). Works before and after login.
 */
export function csrfMiddleware(cfg: AppServices['cfg']) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies[CSRF_COOKIE];
    if (!token || token.length < 20 || token.length > 128) {
      token = randomToken(24);
      res.cookie(CSRF_COOKIE, token, { ...cookieOptions(cfg), maxAge: 7 * 24 * 3600 * 1000 });
    }
    req.csrfToken = token;
    res.locals.csrfToken = token;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sent = typeof body._csrf === 'string' ? body._csrf : req.headers['x-csrf-token'];
    if (typeof sent !== 'string' || !safeEqual(sent, token)) return next(errors.csrf());
    next();
  };
}

/** Loads the authenticated user + live permissions when a valid session cookie is present. */
export function authMiddleware(services: AppServices) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (!token) return next();
      const session = await services.auth.authenticate(token);
      if (!session) return next();
      const permissions = await services.rbac.permissionsForUser(session.user.id);
      req.auth = { user: session.user, permissions, sessionId: session.sessionId, token };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Blocks every page except the installer until the application has been installed. */
export function installGate(services: AppServices) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (services.install.isInstalled()) return next();
    if (req.path === '/install' || req.path === '/health' || req.path.startsWith('/assets/')) return next();
    res.redirect(302, '/install');
  };
}

export function requireAuth(opts: { allowPasswordChange?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.redirect(302, '/login');
    if (!opts.allowPasswordChange && req.auth.user.must_change_password) {
      return res.redirect(302, '/account/password?msg=must_change');
    }
    next();
  };
}

export function requirePermission(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(errors.unauthorized());
    if (!hasAllPermissions(req.auth.permissions, codes)) return next(errors.forbidden());
    next();
  };
}

export function requestId(): string {
  return crypto.randomBytes(6).toString('hex');
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
