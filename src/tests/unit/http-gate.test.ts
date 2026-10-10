import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../app';
import type { AppServices } from '../../http/context';
import { AppError } from '../../lib/errors';
import { loadConfig } from '../../config/env';

/**
 * HTTP-level checks that do NOT need MySQL: installation gate, CSRF, security headers, public health,
 * error rendering. Services are stubs; the real database-backed behaviour is covered by integration tests.
 */
function stubServices(opts: { installed: boolean; pingOk?: boolean }): AppServices {
  const cfg = loadConfig(path.resolve(__dirname, '..', '..', '..'), { NODE_ENV: 'development' } as NodeJS.ProcessEnv);
  const settings = { get: async (key: string) => (key === 'appearance.primary_color' ? '#1d4ed8' : 'مؤسسه تست') };
  return {
    cfg,
    db: {
      ping: async () => {
        if (opts.pingOk === false) throw new Error('connect ECONNREFUSED 10.0.0.1:3306 secret');
      },
    },
    install: { isInstalled: () => opts.installed, checks: async () => [] },
    settings,
    auth: {
      authenticate: async () => null,
      login: async () => {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است.');
      },
    },
    rbac: { permissionsForUser: async () => new Set<string>() },
  } as unknown as AppServices;
}

async function withServer(services: AppServices, fn: (base: string) => Promise<void>) {
  const publicDir = path.resolve(__dirname, '..', '..', '..', 'public');
  const app = createApp(services, publicDir);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('before installation every protected page redirects to the installer', async () => {
  await withServer(stubServices({ installed: false }), async (base) => {
    const res = await fetch(`${base}/login`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/install');
    const admin = await fetch(`${base}/admin/users`, { redirect: 'manual' });
    assert.equal(admin.headers.get('location'), '/install');
  });
});

test('after installation the installer is not reachable (404)', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const res = await fetch(`${base}/install`, { redirect: 'manual' });
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.match(text, /صفحه پیدا نشد/);
    assert.doesNotMatch(text, /token|INSTALL/i);
  });
});

test('protected pages require login when no session cookie is present', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const res = await fetch(`${base}/admin/users`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});

test('state-changing requests without a matching CSRF token are rejected (403)', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=admin&password=whatever',
      redirect: 'manual',
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /درخواست نامعتبر است/);
  });
});

test('a valid double-submit CSRF token passes and failed logins show a generic message', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const first = await fetch(`${base}/login`);
    const setCookie = first.headers.get('set-cookie') ?? '';
    const csrf = /csrf=([^;]+)/.exec(setCookie)?.[1];
    assert.ok(csrf && csrf.length >= 20, 'csrf cookie issued');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `csrf=${csrf}` },
      body: `_csrf=${csrf}&username=admin&password=wrong`,
      redirect: 'manual',
    });
    assert.equal(res.status, 401);
    const html = await res.text();
    assert.match(html, /نام کاربری یا رمز عبور نادرست است/);
    assert.doesNotMatch(html, /wrong/);
  });
});

test('security headers are present and the framework signature is hidden', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const res = await fetch(`${base}/login`);
    assert.equal(res.headers.get('x-powered-by'), null);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
  });
});

test('public health endpoint reveals only status, never driver messages', async () => {
  await withServer(stubServices({ installed: true, pingOk: false }), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.deepEqual(JSON.parse(body), { status: 'error' });
    assert.doesNotMatch(body, /ECONNREFUSED|10\.0\.0\.1|secret/);
  });
});

test('API routes without authentication return JSON 401, not HTML', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const json = (await res.json()) as { error: { code: string } };
    assert.equal(json.error.code, 'UNAUTHORIZED');
  });
});

test('static assets are served from /assets only and unknown paths return 404', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const css = await fetch(`${base}/assets/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    const traversal = await fetch(`${base}/assets/..%2F..%2Fpackage.json`);
    assert.notEqual(traversal.status, 200);
    const missing = await fetch(`${base}/no-such-page`);
    assert.equal(missing.status, 404);
  });
});

test('CSP regression: rendered pages contain no inline style or script (brand colour is applied by app.js)', async () => {
  await withServer(stubServices({ installed: true }), async (base) => {
    const res = await fetch(`${base}/login`);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /style-src 'self'/);
    assert.doesNotMatch(csp, /style-src[^;]*unsafe-inline/);
    const html = await res.text();
    assert.doesNotMatch(html, /<style[\s>]/i, 'inline <style> elements are blocked by the CSP');
    assert.doesNotMatch(html, /\sstyle="/i, 'inline style attributes are blocked by the CSP');
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'inline script is blocked by the CSP');
    assert.match(html, /<html lang="fa" dir="rtl" data-brand="#1d4ed8">/);
  });
});
