import type { Request, Response } from 'express';
import { layout } from '../views/ui';
import type { Raw } from '../http/html';
import type { AppServices } from '../http/context';

export interface PageSpec {
  title: string;
  body: Raw;
  status?: number;
  activePath?: string;
  flash?: string;
  flashError?: string;
  /** Sensitive pages (e.g. one-time passwords) must not be cached. */
  noStore?: boolean;
}

/** Renders a full HTML page with institute branding loaded from settings (never hard-coded). */
export async function renderPage(services: AppServices, req: Request, res: Response, spec: PageSpec): Promise<void> {
  const [instituteName, primaryColor] = await Promise.all([
    services.settings.get<string>('institute.name_official'),
    services.settings.get<string>('appearance.primary_color'),
  ]);
  if (spec.noStore) res.setHeader('Cache-Control', 'no-store');
  res
    .status(spec.status ?? 200)
    .type('html')
    .send(
      layout({
        title: spec.title,
        instituteName,
        primaryColor,
        auth: req.auth,
        flash: spec.flash,
        flashError: spec.flashError,
        body: spec.body,
        activePath: spec.activePath ?? req.path,
        csrf: req.csrfToken ?? '',
      }),
    );
}

export function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,17}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function actorOf(req: Request) {
  if (!req.auth) throw new Error('actorOf called without authentication');
  return { id: req.auth.user.id, permissions: req.auth.permissions, ip: req.clientIp ?? null };
}

export function bodyOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const src = (req.body ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
