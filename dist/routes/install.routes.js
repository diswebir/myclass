"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installRoutes = installRoutes;
const express_1 = require("express");
const errors_1 = require("../lib/errors");
const render_1 = require("./render");
const pages_1 = require("../views/pages");
const pages_2 = require("../views/pages");
function installRoutes(s) {
    const r = (0, express_1.Router)();
    r.get('/install', async (req, res) => {
        if (s.install.isInstalled()) {
            return (0, render_1.renderPage)(s, req, res, { title: 'صفحه پیدا نشد', status: 404, body: (0, pages_2.errorBody)(404, 'صفحه پیدا نشد.') });
        }
        const checks = await s.install.checks();
        await (0, render_1.renderPage)(s, req, res, {
            title: 'نصب',
            body: (0, pages_1.installBody)({ csrf: req.csrfToken, checks, errors: {}, values: {}, canInstall: true }),
        });
    });
    r.post('/install', async (req, res) => {
        if (s.install.isInstalled()) {
            return (0, render_1.renderPage)(s, req, res, { title: 'صفحه پیدا نشد', status: 404, body: (0, pages_2.errorBody)(404, 'صفحه پیدا نشد.') });
        }
        const b = (0, render_1.bodyOf)(req);
        const values = { instituteName: b.instituteName ?? '', fullName: b.fullName ?? '', username: b.username ?? '', email: b.email ?? '' };
        try {
            await s.install.install({
                token: b.token ?? '',
                fullName: b.fullName ?? '',
                username: b.username ?? '',
                email: b.email,
                password: b.password ?? '',
                passwordConfirm: b.passwordConfirm ?? '',
                instituteName: b.instituteName ?? '',
            }, req.clientIp ?? null);
            res.redirect(303, '/login?msg=installed');
        }
        catch (err) {
            if (!(err instanceof errors_1.AppError) || err.status >= 500) {
                // Internal details are logged by the global error handler; the user sees a generic, Persian message.
                throw err;
            }
            const checks = await s.install.checks();
            await (0, render_1.renderPage)(s, req, res, {
                title: 'نصب',
                status: err.status,
                body: (0, pages_1.installBody)({ csrf: req.csrfToken, checks, errors: err.fieldErrors, values, formError: err.message, canInstall: true }),
            });
        }
    });
    return r;
}
