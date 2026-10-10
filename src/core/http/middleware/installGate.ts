/** Install gate — اگر نصب نشده: فقط installer و healthz؛ اگر نصب شده: installer بسته است. */
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { AppContext } from '../context';

export const INSTALL_LOCK_FILENAME = '.installed';

export function installLockPath(config: AppContext['config']): string {
  return path.join(config.STORAGE_DIR, INSTALL_LOCK_FILENAME);
}

export function isInstalledSync(config: AppContext['config']): boolean {
  try {
    return fs.existsSync(installLockPath(config));
  } catch {
    return false;
  }
}

/** این middleware قبل از روترها نصب می‌شود. */
export function installGate(req: Request, res: Response, next: NextFunction): void {
  const { config } = req.ctx;
  const installed = isInstalledSync(config);
  const isInstallPath = req.path === '/install' || req.path.startsWith('/install/');
  const isPublicPath = req.path === '/healthz' || req.path.startsWith('/public/') || req.path.startsWith('/verify/') || req.path.startsWith('/prereg/public/');

  if (!installed && !isInstallPath && !isPublicPath) {
    // هنوز نصب نشده — فقط installer در دسترس است
    res.redirect('/install');
    return;
  }
  if (installed && isInstallPath && config.INSTALL_ALLOW_REINSTALL !== '1') {
    res.redirect('/');
    return;
  }
  next();
}
