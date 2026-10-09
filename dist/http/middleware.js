"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSRF_COOKIE = exports.SESSION_COOKIE = void 0;
exports.parseCookies = parseCookies;
exports.securityHeaders = securityHeaders;
exports.cookieOptions = cookieOptions;
exports.clientIpMiddleware = clientIpMiddleware;
exports.csrfMiddleware = csrfMiddleware;
exports.authMiddleware = authMiddleware;
exports.installGate = installGate;
exports.requireAuth = requireAuth;
exports.requirePermission = requirePermission;
exports.requestId = requestId;
exports.isAppError = isAppError;
const node_crypto_1 = __importDefault(require("node:crypto"));
const helmet_1 = __importDefault(require("helmet"));
const errors_1 = require("../lib/errors");
const crypto_1 = require("../lib/crypto");
const permissions_1 = require("../rbac/permissions");
exports.SESSION_COOKIE = 'sid';
exports.CSRF_COOKIE = 'csrf';
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0)
            continue;
        const key = part.slice(0, idx).trim();
        if (!key || out[key] !== undefined)
            continue;
        try {
            out[key] = decodeURIComponent(part.slice(idx + 1).trim());
        }
        catch {
            out[key] = '';
        }
    }
    return out;
}
function securityHeaders() {
    return (0, helmet_1.default)({
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
function cookieOptions(cfg, maxAgeMs) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.cookieSecure,
        path: '/',
        ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
    };
}
/** Resolves the client IP (trusting X-Forwarded-For only up to TRUST_PROXY hops). */
function clientIpMiddleware(trustProxy) {
    return (req, _res, next) => {
        if (trustProxy > 0) {
            const xff = req.headers['x-forwarded-for'];
            const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
            const picked = list.length >= trustProxy ? list[list.length - trustProxy] : undefined;
            req.clientIp = picked ?? req.socket.remoteAddress ?? null;
        }
        else {
            req.clientIp = req.socket.remoteAddress ?? null;
        }
        next();
    };
}
/**
 * Double-submit CSRF protection: a random `csrf` cookie is set once; every state-changing request must echo
 * the same value in the `_csrf` form field (or `x-csrf-token` header). Works before and after login.
 */
function csrfMiddleware(cfg) {
    return (req, res, next) => {
        const cookies = parseCookies(req.headers.cookie);
        let token = cookies[exports.CSRF_COOKIE];
        if (!token || token.length < 20 || token.length > 128) {
            token = (0, crypto_1.randomToken)(24);
            res.cookie(exports.CSRF_COOKIE, token, { ...cookieOptions(cfg), maxAge: 7 * 24 * 3600 * 1000 });
        }
        req.csrfToken = token;
        res.locals.csrfToken = token;
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
            return next();
        const body = (req.body ?? {});
        const sent = typeof body._csrf === 'string' ? body._csrf : req.headers['x-csrf-token'];
        if (typeof sent !== 'string' || !(0, crypto_1.safeEqual)(sent, token))
            return next(errors_1.errors.csrf());
        next();
    };
}
/** Loads the authenticated user + live permissions when a valid session cookie is present. */
function authMiddleware(services) {
    return async (req, _res, next) => {
        try {
            const token = parseCookies(req.headers.cookie)[exports.SESSION_COOKIE];
            if (!token)
                return next();
            const session = await services.auth.authenticate(token);
            if (!session)
                return next();
            const permissions = await services.rbac.permissionsForUser(session.user.id);
            req.auth = { user: session.user, permissions, sessionId: session.sessionId, token };
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
/** Blocks every page except the installer until the application has been installed. */
function installGate(services) {
    return (req, res, next) => {
        if (services.install.isInstalled())
            return next();
        if (req.path === '/install' || req.path === '/health' || req.path.startsWith('/assets/'))
            return next();
        res.redirect(302, '/install');
    };
}
function requireAuth(opts = {}) {
    return (req, res, next) => {
        if (!req.auth)
            return res.redirect(302, '/login');
        if (!opts.allowPasswordChange && req.auth.user.must_change_password) {
            return res.redirect(302, '/account/password?msg=must_change');
        }
        next();
    };
}
function requirePermission(...codes) {
    return (req, _res, next) => {
        if (!req.auth)
            return next(errors_1.errors.unauthorized());
        if (!(0, permissions_1.hasAllPermissions)(req.auth.permissions, codes))
            return next(errors_1.errors.forbidden());
        next();
    };
}
function requestId() {
    return node_crypto_1.default.randomBytes(6).toString('hex');
}
function isAppError(err) {
    return err instanceof errors_1.AppError;
}
