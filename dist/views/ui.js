"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLASH_MESSAGES = void 0;
exports.navItems = navItems;
exports.layout = layout;
exports.alertBox = alertBox;
exports.pageHeader = pageHeader;
exports.badge = badge;
exports.field = field;
exports.checkbox = checkbox;
exports.emptyState = emptyState;
exports.pagerHtml = pagerHtml;
const html_1 = require("../http/html");
const permissions_1 = require("../rbac/permissions");
exports.FLASH_MESSAGES = {
    installed: { type: 'success', text: 'نصب با موفقیت انجام شد. اکنون با حساب مدیر اصلی وارد شوید.' },
    logged_out: { type: 'info', text: 'از سامانه خارج شدید.' },
    must_change: { type: 'warning', text: 'برای ادامه، ابتدا رمز عبور موقت خود را تغییر دهید.' },
    password_changed: { type: 'success', text: 'رمز عبور با موفقیت تغییر کرد.' },
    saved: { type: 'success', text: 'تغییرات با موفقیت ذخیره شد.' },
    user_created: { type: 'success', text: 'کاربر جدید با موفقیت ایجاد شد.' },
    status_changed: { type: 'success', text: 'وضعیت حساب کاربر به‌روزرسانی شد.' },
    sessions_revoked: { type: 'success', text: 'نشست‌های فعال کاربر بسته شد.' },
    role_created: { type: 'success', text: 'نقش جدید ایجاد شد.' },
    role_saved: { type: 'success', text: 'نقش با موفقیت ذخیره شد.' },
    role_deleted: { type: 'success', text: 'نقش حذف شد.' },
    role_status: { type: 'success', text: 'وضعیت نقش به‌روزرسانی شد.' },
    migrated: { type: 'success', text: 'migration ها با موفقیت اجرا شدند (یا قبلاً اجرا شده بودند).' },
};
function navItems() {
    return [
        { href: '/admin', label: 'داشبورد', permission: 'dashboard.view', icon: '◧' },
        { href: '/admin/users', label: 'کاربران', permission: 'users.view', icon: '◉' },
        { href: '/admin/roles', label: 'نقش‌ها و دسترسی‌ها', permission: 'roles.view', icon: '◈' },
        { href: '/admin/settings/institute', label: 'تنظیمات', permission: 'settings.view', icon: '⚙' },
        { href: '/admin/audit', label: 'سوابق و رویدادها', permission: 'audit.view', icon: '≡' },
        { href: '/admin/system/health', label: 'سلامت سامانه', permission: 'system.health.view', icon: '♥' },
    ];
}
function flashBanner(o) {
    if (o.flashError)
        return (0, html_1.html) `<div class="alert alert-error" role="alert">${o.flashError}</div>`;
    const f = o.flash ? exports.FLASH_MESSAGES[o.flash] : undefined;
    if (!f)
        return (0, html_1.raw)('');
    return (0, html_1.html) `<div class="alert alert-${f.type}" role="status">${f.text}</div>`;
}
function layout(o) {
    const auth = o.auth;
    const perms = auth?.permissions ?? new Set();
    const nav = auth
        ? navItems()
            .filter((n) => (0, permissions_1.hasAllPermissions)(perms, [n.permission]))
            .map((n) => {
            const active = o.activePath && (o.activePath === n.href || (n.href !== '/admin' && o.activePath.startsWith(n.href)));
            return (0, html_1.html) `<a class="nav-link${active ? ' is-active' : ''}" href="${n.href}" ${active ? (0, html_1.raw)('aria-current="page"') : (0, html_1.raw)('')}><span class="nav-icon" aria-hidden="true">${n.icon}</span><span class="nav-label">${n.label}</span></a>`;
        })
        : [];
    const sidebar = auth
        ? (0, html_1.html) `<aside class="sidebar" id="sidebar" aria-label="منوی اصلی">
        <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">${o.instituteName}</span></div>
        <nav class="nav">${(0, html_1.joinRaw)(nav)}</nav>
      </aside>`
        : (0, html_1.raw)('');
    const topbar = auth
        ? (0, html_1.html) `<header class="topbar">
        <button type="button" class="icon-btn" data-toggle-sidebar aria-controls="sidebar" aria-label="باز/بسته کردن منو">☰</button>
        <h1 class="topbar-title">${o.title}</h1>
        <div class="topbar-user">
          <span class="user-chip" title="کاربر وارد شده">${auth.user.full_name}</span>
          <a class="btn btn-ghost btn-sm" href="/account/password">تغییر رمز</a>
          <form method="post" action="/logout" class="inline-form">
            <input type="hidden" name="_csrf" value="${o.csrf}">
            <button type="submit" class="btn btn-ghost btn-sm">خروج</button>
          </form>
        </div>
      </header>`
        : (0, html_1.raw)('');
    const page = (0, html_1.html) `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${o.title} · ${o.instituteName}</title>
<link rel="stylesheet" href="/assets/app.css">
<style>:root{--brand:${o.primaryColor};}</style>
</head>
<body class="${auth ? 'is-app' : 'is-guest'}">
<a class="skip-link" href="#main">رفتن به محتوای اصلی</a>
${sidebar}
<div class="shell">
${topbar}
<main id="main" class="content" tabindex="-1">
${flashBanner(o)}
${o.body}
</main>
<footer class="footer">${o.instituteName} · سامانه مدیریت آموزش</footer>
</div>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
    return page.html;
}
function alertBox(type, text) {
    return (0, html_1.html) `<div class="alert alert-${type}" role="${type === 'error' ? 'alert' : 'status'}">${text}</div>`;
}
function pageHeader(title, description, actions = (0, html_1.raw)('')) {
    return (0, html_1.html) `<div class="page-header"><div><h2>${title}</h2>${description ? (0, html_1.html) `<p class="muted">${description}</p>` : (0, html_1.raw)('')}</div><div class="page-actions">${actions}</div></div>`;
}
function badge(text, tone = 'muted') {
    return (0, html_1.html) `<span class="badge badge-${tone}">${text}</span>`;
}
function field(o) {
    const id = `f-${o.name}`;
    const cls = `field${o.full ? ' field-full' : ''}${o.error ? ' has-error' : ''}`;
    const common = `id="${id}" name="${(0, html_1.esc)(o.name)}"${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''}${o.dir ? ` dir="${o.dir}"` : ''}`;
    let control;
    if (o.options) {
        const opts = o.options.map((op) => (0, html_1.html) `<option value="${op.value}" ${String(o.value ?? '') === op.value ? (0, html_1.raw)('selected') : (0, html_1.raw)('')}>${op.label}</option>`);
        control = (0, html_1.raw)(`<select ${common}>${(0, html_1.joinRaw)(opts).html}</select>`);
    }
    else if (o.rows) {
        control = (0, html_1.html) `<textarea ${(0, html_1.raw)(common)} rows="${o.rows}">${o.value ?? ''}</textarea>`;
    }
    else {
        control = (0, html_1.html) `<input ${(0, html_1.raw)(common)} type="${o.type ?? 'text'}" value="${o.type === 'password' ? '' : o.value ?? ''}" ${o.autocomplete ? (0, html_1.raw)(`autocomplete="${(0, html_1.esc)(o.autocomplete)}"`) : (0, html_1.raw)('')}>`;
    }
    return (0, html_1.html) `<div class="${cls}">
    <label for="${id}">${o.label}${o.required ? (0, html_1.html) `<span class="req" aria-hidden="true"> *</span>` : (0, html_1.raw)('')}</label>
    ${control}
    ${o.help ? (0, html_1.html) `<small class="help">${o.help}</small>` : (0, html_1.raw)('')}
    ${o.error ? (0, html_1.html) `<small class="error" id="${id}-err">${o.error}</small>` : (0, html_1.raw)('')}
  </div>`;
}
function checkbox(name, value, label, checked) {
    return (0, html_1.html) `<label class="check"><input type="checkbox" name="${name}" value="${value}" ${checked ? (0, html_1.raw)('checked') : (0, html_1.raw)('')}><span>${label}</span></label>`;
}
function emptyState(text, hint) {
    return (0, html_1.html) `<div class="empty"><p class="empty-title">${text}</p><p class="muted">${hint}</p></div>`;
}
function pagerHtml(basePath, query, page, totalPages) {
    if (totalPages <= 1)
        return (0, html_1.raw)('');
    const link = (p, label, disabled = false) => {
        if (disabled)
            return (0, html_1.html) `<span class="pager-item is-disabled">${label}</span>`;
        const qs = new URLSearchParams({ ...query, page: String(p) }).toString();
        return (0, html_1.html) `<a class="pager-item" href="${basePath}?${qs}">${label}</a>`;
    };
    return (0, html_1.html) `<nav class="pager" aria-label="صفحه‌بندی">
    ${link(page - 1, 'قبلی', page <= 1)}
    <span class="pager-info">صفحه ${String(page).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])} از ${String(totalPages).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])}</span>
    ${link(page + 1, 'بعدی', page >= totalPages)}
  </nav>`;
}
