/** Middleware احراز هویت — لود نشست از DB + لود کاربر/نقش/مجوز (per-request — اثر فوری تغییر نقش). */
import type { NextFunction, Request, Response } from 'express';
import type { AppContext, AuthUser } from '../context';
import { AppError } from '../../errors/AppError';
import { hasPermission, wantsHtml } from '../context';
import { SessionService } from '../../../modules/sessions/session.service';
import { RbacService } from '../../../modules/rbac/rbac.service';

export const SESSION_COOKIE = 'mc_session';

export function sessionCookieOptions(ctx: AppContext) {
  const secure = ctx.config.COOKIE_SECURE === 'true' || (ctx.config.COOKIE_SECURE === 'auto' && ctx.config.APP_BASE_URL.startsWith('https://'));
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ctx.config.SESSION_TTL_HOURS * 3600 * 1000,
  };
}

/** لود نشست + کاربر — روی هر درخواست. */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const { ctx } = req;
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const sessions = new SessionService(ctx.db, ctx.config);
    const session = await sessions.resolve(token);
    if (!session) return next();
    req.session = { tokenHash: session.token_hash, csrfToken: session.csrf_token };
    const userRow = await ctx.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', Number(session.user_id))
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!userRow || userRow.is_active !== 1) {
      await sessions.revokeByHash(session.token_hash);
      return next();
    }
    const rbac = new RbacService(ctx.db);
    const roles = await rbac.getUserRoleSlugs(Number(userRow.id));
    const permissions = await rbac.getUserPermissions(Number(userRow.id));
    req.user = {
      id: Number(userRow.id),
      username: userRow.username,
      fullName: userRow.full_name,
      isActive: userRow.is_active === 1,
      mustChangePassword: userRow.must_change_password === 1,
      roles,
      permissions,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    if (wantsHtml(req)) {
      res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    throw AppError.unauthorized();
  }
  next();
}

export function requirePermission(module: string, resource: string, action: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw AppError.unauthorized();
    if (!hasPermission(req.user, module, resource, action)) {
      throw AppError.forbidden();
    }
    next();
  };
}

export function getAuthUser(req: Request): AuthUser {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}
