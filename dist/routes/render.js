"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPage = renderPage;
exports.parseId = parseId;
exports.actorOf = actorOf;
exports.bodyOf = bodyOf;
const ui_1 = require("../views/ui");
/** Renders a full HTML page with institute branding loaded from settings (never hard-coded). */
async function renderPage(services, req, res, spec) {
    const [instituteName, primaryColor] = await Promise.all([
        services.settings.get('institute.name_official'),
        services.settings.get('appearance.primary_color'),
    ]);
    if (spec.noStore)
        res.setHeader('Cache-Control', 'no-store');
    res
        .status(spec.status ?? 200)
        .type('html')
        .send((0, ui_1.layout)({
        title: spec.title,
        instituteName,
        primaryColor,
        auth: req.auth,
        flash: spec.flash,
        flashError: spec.flashError,
        body: spec.body,
        activePath: spec.activePath ?? req.path,
        csrf: req.csrfToken ?? '',
    }));
}
function parseId(raw) {
    if (typeof raw !== 'string' || !/^[1-9]\d{0,17}$/.test(raw))
        return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
}
function actorOf(req) {
    if (!req.auth)
        throw new Error('actorOf called without authentication');
    return { id: req.auth.user.id, permissions: req.auth.permissions, ip: req.clientIp ?? null };
}
function bodyOf(req) {
    const out = {};
    const src = (req.body ?? {});
    for (const [k, v] of Object.entries(src)) {
        if (typeof v === 'string')
            out[k] = v;
    }
    return out;
}
