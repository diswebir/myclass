"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const express_1 = require("express");
const middleware_1 = require("../http/middleware");
const errors_1 = require("../lib/errors");
const render_1 = require("./render");
const pages_1 = require("../views/pages");
function authRoutes(s) {
    const r = (0, express_1.Router)();
    r.get('/login', async (req, res) => {
        if (req.auth)
            return res.redirect(302, '/admin');
        const msg = typeof req.query.msg === 'string' ? req.query.msg : undefined;
        await (0, render_1.renderPage)(s, req, res, {
            title: 'ورود',
            body: (0, pages_1.loginBody)({ csrf: req.csrfToken, instituteName: await s.settings.get('institute.name_official'), notice: undefined }),
            flash: msg,
        });
    });
    r.post('/login', async (req, res) => {
        const b = (0, render_1.bodyOf)(req);
        const username = (b.username ?? '').slice(0, 190);
        const password = b.password ?? '';
        try {
            if (!username || !password)
                throw errors_1.errors.badRequest('نام کاربری و رمز عبور را وارد کنید.');
            const token = await s.auth.login({ username, password, ip: req.clientIp ?? null, userAgent: req.headers['user-agent'] ?? null });
            const maxAge = s.cfg.sessionTtlHours * 3600 * 1000;
            res.cookie(middleware_1.SESSION_COOKIE, token, (0, middleware_1.cookieOptions)(s.cfg, maxAge));
            res.redirect(303, '/admin');
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500)
                throw err;
            await (0, render_1.renderPage)(s, req, res, {
                title: 'ورود',
                status: err.status,
                body: (0, pages_1.loginBody)({ csrf: req.csrfToken, error: err.message, username, instituteName: await s.settings.get('institute.name_official') }),
            });
        }
    });
    r.post('/logout', (0, middleware_1.requireAuth)({ allowPasswordChange: true }), async (req, res) => {
        await s.auth.logout(req.auth.token, req.auth.user.id);
        res.clearCookie(middleware_1.SESSION_COOKIE, (0, middleware_1.cookieOptions)(s.cfg));
        res.redirect(303, '/login?msg=logged_out');
    });
    r.get('/account/password', (0, middleware_1.requireAuth)({ allowPasswordChange: true }), async (req, res) => {
        await (0, render_1.renderPage)(s, req, res, {
            title: 'تغییر رمز عبور',
            body: (0, pages_1.passwordBody)({
                csrf: req.csrfToken,
                mustChange: req.auth.user.must_change_password === 1,
                minLength: await s.settings.get('security.password_min_length'),
                fieldErrors: {},
            }),
            flash: typeof req.query.msg === 'string' ? req.query.msg : undefined,
        });
    });
    r.post('/account/password', (0, middleware_1.requireAuth)({ allowPasswordChange: true }), async (req, res) => {
        const b = (0, render_1.bodyOf)(req);
        const minLength = await s.settings.get('security.password_min_length');
        const fieldErrors = {};
        if (!b.currentPassword)
            fieldErrors.currentPassword = 'رمز عبور فعلی را وارد کنید.';
        if (!b.newPassword || b.newPassword.length < minLength)
            fieldErrors.newPassword = `رمز عبور جدید باید حداقل ${minLength} نویسه باشد.`;
        if (b.newPassword !== b.newPasswordConfirm)
            fieldErrors.newPasswordConfirm = 'تکرار رمز عبور با رمز جدید یکسان نیست.';
        if (Object.keys(fieldErrors).length) {
            return (0, render_1.renderPage)(s, req, res, {
                title: 'تغییر رمز عبور',
                status: 400,
                body: (0, pages_1.passwordBody)({ csrf: req.csrfToken, mustChange: req.auth.user.must_change_password === 1, minLength, fieldErrors, error: 'لطفاً خطاهای فرم را برطرف کنید.' }),
            });
        }
        try {
            await s.auth.changeOwnPassword({
                userId: req.auth.user.id,
                currentSessionId: req.auth.sessionId,
                currentPassword: b.currentPassword,
                newPassword: b.newPassword,
                minLength,
                ip: req.clientIp ?? null,
            });
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500)
                throw err;
            return (0, render_1.renderPage)(s, req, res, {
                title: 'تغییر رمز عبور',
                status: err.status,
                body: (0, pages_1.passwordBody)({ csrf: req.csrfToken, mustChange: req.auth.user.must_change_password === 1, minLength, fieldErrors: err.fieldErrors, error: err.message }),
            });
        }
        res.redirect(303, '/admin?msg=password_changed');
    });
    return r;
}
