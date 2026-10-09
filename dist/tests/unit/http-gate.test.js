"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("../../app");
const errors_1 = require("../../lib/errors");
const env_1 = require("../../config/env");
/**
 * HTTP-level checks that do NOT need MySQL: installation gate, CSRF, security headers, public health,
 * error rendering. Services are stubs; the real database-backed behaviour is covered by integration tests.
 */
function stubServices(opts) {
    const cfg = (0, env_1.loadConfig)(node_path_1.default.resolve(__dirname, '..', '..', '..'), { NODE_ENV: 'development' });
    const settings = { get: async (key) => (key === 'appearance.primary_color' ? '#1d4ed8' : 'مؤسسه تست') };
    return {
        cfg,
        db: {
            ping: async () => {
                if (opts.pingOk === false)
                    throw new Error('connect ECONNREFUSED 10.0.0.1:3306 secret');
            },
        },
        install: { isInstalled: () => opts.installed, checks: async () => [] },
        settings,
        auth: {
            authenticate: async () => null,
            login: async () => {
                throw new errors_1.AppError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است.');
            },
        },
        rbac: { permissionsForUser: async () => new Set() },
    };
}
async function withServer(services, fn) {
    const publicDir = node_path_1.default.resolve(__dirname, '..', '..', '..', 'public');
    const app = (0, app_1.createApp)(services, publicDir);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
(0, node_test_1.default)('before installation every protected page redirects to the installer', async () => {
    await withServer(stubServices({ installed: false }), async (base) => {
        const res = await fetch(`${base}/login`, { redirect: 'manual' });
        strict_1.default.equal(res.status, 302);
        strict_1.default.equal(res.headers.get('location'), '/install');
        const admin = await fetch(`${base}/admin/users`, { redirect: 'manual' });
        strict_1.default.equal(admin.headers.get('location'), '/install');
    });
});
(0, node_test_1.default)('after installation the installer is not reachable (404)', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const res = await fetch(`${base}/install`, { redirect: 'manual' });
        strict_1.default.equal(res.status, 404);
        const text = await res.text();
        strict_1.default.match(text, /صفحه پیدا نشد/);
        strict_1.default.doesNotMatch(text, /token|INSTALL/i);
    });
});
(0, node_test_1.default)('protected pages require login when no session cookie is present', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const res = await fetch(`${base}/admin/users`, { redirect: 'manual' });
        strict_1.default.equal(res.status, 302);
        strict_1.default.equal(res.headers.get('location'), '/login');
    });
});
(0, node_test_1.default)('state-changing requests without a matching CSRF token are rejected (403)', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const res = await fetch(`${base}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'username=admin&password=whatever',
            redirect: 'manual',
        });
        strict_1.default.equal(res.status, 403);
        strict_1.default.match(await res.text(), /درخواست نامعتبر است/);
    });
});
(0, node_test_1.default)('a valid double-submit CSRF token passes and failed logins show a generic message', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const first = await fetch(`${base}/login`);
        const setCookie = first.headers.get('set-cookie') ?? '';
        const csrf = /csrf=([^;]+)/.exec(setCookie)?.[1];
        strict_1.default.ok(csrf && csrf.length >= 20, 'csrf cookie issued');
        strict_1.default.match(setCookie, /HttpOnly/);
        strict_1.default.match(setCookie, /SameSite=Lax/);
        const res = await fetch(`${base}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `csrf=${csrf}` },
            body: `_csrf=${csrf}&username=admin&password=wrong`,
            redirect: 'manual',
        });
        strict_1.default.equal(res.status, 401);
        const html = await res.text();
        strict_1.default.match(html, /نام کاربری یا رمز عبور نادرست است/);
        strict_1.default.doesNotMatch(html, /wrong/);
    });
});
(0, node_test_1.default)('security headers are present and the framework signature is hidden', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const res = await fetch(`${base}/login`);
        strict_1.default.equal(res.headers.get('x-powered-by'), null);
        const csp = res.headers.get('content-security-policy') ?? '';
        strict_1.default.match(csp, /default-src 'self'/);
        strict_1.default.match(csp, /frame-ancestors 'none'/);
        strict_1.default.match(csp, /script-src 'self'/);
        strict_1.default.doesNotMatch(csp, /unsafe-inline/);
        strict_1.default.equal(res.headers.get('x-content-type-options'), 'nosniff');
        strict_1.default.equal(res.headers.get('referrer-policy'), 'same-origin');
    });
});
(0, node_test_1.default)('public health endpoint reveals only status, never driver messages', async () => {
    await withServer(stubServices({ installed: true, pingOk: false }), async (base) => {
        const res = await fetch(`${base}/health`);
        strict_1.default.equal(res.status, 503);
        const body = await res.text();
        strict_1.default.deepEqual(JSON.parse(body), { status: 'error' });
        strict_1.default.doesNotMatch(body, /ECONNREFUSED|10\.0\.0\.1|secret/);
    });
});
(0, node_test_1.default)('API routes without authentication return JSON 401, not HTML', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const res = await fetch(`${base}/api/health`);
        strict_1.default.equal(res.status, 401);
        strict_1.default.match(res.headers.get('content-type') ?? '', /application\/json/);
        const json = (await res.json());
        strict_1.default.equal(json.error.code, 'UNAUTHORIZED');
    });
});
(0, node_test_1.default)('static assets are served from /assets only and unknown paths return 404', async () => {
    await withServer(stubServices({ installed: true }), async (base) => {
        const css = await fetch(`${base}/assets/app.css`);
        strict_1.default.equal(css.status, 200);
        strict_1.default.match(css.headers.get('content-type') ?? '', /text\/css/);
        const traversal = await fetch(`${base}/assets/..%2F..%2Fpackage.json`);
        strict_1.default.notEqual(traversal.status, 200);
        const missing = await fetch(`${base}/no-such-page`);
        strict_1.default.equal(missing.status, 404);
    });
});
