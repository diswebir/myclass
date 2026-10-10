/** Context — تایپ‌های مشترک درخواست (AppContext، AuthUser) + augmentation Express. */
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import type { Config } from '../config/env';

export interface AppContext {
  db: Kysely<Database>;
  config: Config;
}

/** کاربر احراز هویت‌شده (per-request از DB لود می‌شود — اثر فوری تغییر نقش). */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: string[];
  /** کلید مجوزها: 'module.resource.action' */
  permissions: string[];
}

export interface SessionInfo {
  tokenHash: string;
  csrfToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: AppContext;
      user?: AuthUser;
      session?: SessionInfo;
    }
  }
}

/** آیا کاربر مجوز 'module.resource.action' را دارد (با wildcard: 'finance.*' و '*:*') */
export function hasPermission(user: AuthUser, module: string, resource: string, action: string): boolean {
  const needed = `${module}.${resource}.${action}`;
  for (const p of user.permissions) {
    if (p === needed) return true;
    if (p === '*:*') return true;
    if (p.endsWith('.*')) {
      const [pm, pr] = p.split('.');
      if (pm === module && (pr === '*' || pr === resource)) return true;
    }
  }
  return false;
}

/** آیا کلاینت HTML می‌خواهد؟ (Accept: text/html یا POST فرم؛ پیش‌فرض JSON برای API) */
export function wantsHtml(req: { headers: { accept?: string; 'content-type'?: string }; path: string }): boolean {
  const accept = req.headers.accept ?? '';
  const contentType = req.headers['content-type'] ?? '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return false;
  if (accept.includes('text/html')) return true;
  if (!accept && contentType.includes('application/x-www-form-urlencoded')) return true;
  return false;
}
