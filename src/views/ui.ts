import type { AuthContext } from '../http/context';
import { esc, html, raw, Raw, joinRaw } from '../http/html';
import { hasAllPermissions } from '../rbac/permissions';

export const FLASH_MESSAGES: Record<string, { type: 'success' | 'warning' | 'error' | 'info'; text: string }> = {
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

export interface LayoutOptions {
  title: string;
  instituteName: string;
  primaryColor: string;
  auth?: AuthContext | undefined;
  flash?: string | undefined;
  flashError?: string | undefined;
  body: Raw;
  activePath?: string;
  csrf: string;
}

export function navItems(): { href: string; label: string; permission: string; icon: string }[] {
  return [
    { href: '/admin', label: 'داشبورد', permission: 'dashboard.view', icon: '◧' },
    { href: '/admin/users', label: 'کاربران', permission: 'users.view', icon: '◉' },
    { href: '/admin/roles', label: 'نقش‌ها و دسترسی‌ها', permission: 'roles.view', icon: '◈' },
    { href: '/admin/settings/institute', label: 'تنظیمات', permission: 'settings.view', icon: '⚙' },
    { href: '/admin/audit', label: 'سوابق و رویدادها', permission: 'audit.view', icon: '≡' },
    { href: '/admin/system/health', label: 'سلامت سامانه', permission: 'system.health.view', icon: '♥' },
  ];
}

function flashBanner(o: LayoutOptions): Raw {
  if (o.flashError) return html`<div class="alert alert-error" role="alert">${o.flashError}</div>`;
  const f = o.flash ? FLASH_MESSAGES[o.flash] : undefined;
  if (!f) return raw('');
  return html`<div class="alert alert-${f.type}" role="status">${f.text}</div>`;
}

export function layout(o: LayoutOptions): string {
  const auth = o.auth;
  const perms = auth?.permissions ?? new Set<string>();
  const nav = auth
    ? navItems()
        .filter((n) => hasAllPermissions(perms, [n.permission]))
        .map((n) => {
          const active = o.activePath && (o.activePath === n.href || (n.href !== '/admin' && o.activePath.startsWith(n.href)));
          return html`<a class="nav-link${active ? ' is-active' : ''}" href="${n.href}" ${active ? raw('aria-current="page"') : raw('')}><span class="nav-icon" aria-hidden="true">${n.icon}</span><span class="nav-label">${n.label}</span></a>`;
        })
    : [];
  const sidebar = auth
    ? html`<aside class="sidebar" id="sidebar" aria-label="منوی اصلی">
        <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">${o.instituteName}</span></div>
        <nav class="nav">${joinRaw(nav as Raw[])}</nav>
      </aside>`
    : raw('');
  const topbar = auth
    ? html`<header class="topbar">
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
    : raw('');
  const page = html`<!doctype html>
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

export function alertBox(type: 'error' | 'success' | 'warning' | 'info', text: string): Raw {
  return html`<div class="alert alert-${type}" role="${type === 'error' ? 'alert' : 'status'}">${text}</div>`;
}

export function pageHeader(title: string, description: string | null, actions: Raw = raw('')): Raw {
  return html`<div class="page-header"><div><h2>${title}</h2>${description ? html`<p class="muted">${description}</p>` : raw('')}</div><div class="page-actions">${actions}</div></div>`;
}

export function badge(text: string, tone: 'ok' | 'warn' | 'bad' | 'muted' = 'muted'): Raw {
  return html`<span class="badge badge-${tone}">${text}</span>`;
}

export interface FieldOptions {
  name: string;
  label: string;
  type?: string;
  value?: unknown;
  error?: string | undefined;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
  rows?: number;
  autocomplete?: string;
  dir?: 'ltr' | 'rtl';
  full?: boolean;
  disabled?: boolean;
}

export function field(o: FieldOptions): Raw {
  const id = `f-${o.name}`;
  const cls = `field${o.full ? ' field-full' : ''}${o.error ? ' has-error' : ''}`;
  const common = `id="${id}" name="${esc(o.name)}"${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''}${o.dir ? ` dir="${o.dir}"` : ''}`;
  let control: Raw;
  if (o.options) {
    const opts = o.options.map((op) => html`<option value="${op.value}" ${String(o.value ?? '') === op.value ? raw('selected') : raw('')}>${op.label}</option>`);
    control = raw(`<select ${common}>${joinRaw(opts as Raw[]).html}</select>`);
  } else if (o.rows) {
    control = html`<textarea ${raw(common)} rows="${o.rows}">${o.value ?? ''}</textarea>`;
  } else {
    control = html`<input ${raw(common)} type="${o.type ?? 'text'}" value="${o.type === 'password' ? '' : o.value ?? ''}" ${o.autocomplete ? raw(`autocomplete="${esc(o.autocomplete)}"`) : raw('')}>`;
  }
  return html`<div class="${cls}">
    <label for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true"> *</span>` : raw('')}</label>
    ${control}
    ${o.help ? html`<small class="help">${o.help}</small>` : raw('')}
    ${o.error ? html`<small class="error" id="${id}-err">${o.error}</small>` : raw('')}
  </div>`;
}

export function checkbox(name: string, value: string, label: string, checked: boolean): Raw {
  return html`<label class="check"><input type="checkbox" name="${name}" value="${value}" ${checked ? raw('checked') : raw('')}><span>${label}</span></label>`;
}

export function emptyState(text: string, hint: string): Raw {
  return html`<div class="empty"><p class="empty-title">${text}</p><p class="muted">${hint}</p></div>`;
}

export function pagerHtml(basePath: string, query: Record<string, string>, page: number, totalPages: number): Raw {
  if (totalPages <= 1) return raw('');
  const link = (p: number, label: string, disabled = false) => {
    if (disabled) return html`<span class="pager-item is-disabled">${label}</span>`;
    const qs = new URLSearchParams({ ...query, page: String(p) }).toString();
    return html`<a class="pager-item" href="${basePath}?${qs}">${label}</a>`;
  };
  return html`<nav class="pager" aria-label="صفحه‌بندی">
    ${link(page - 1, 'قبلی', page <= 1)}
    <span class="pager-info">صفحه ${String(page).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])} از ${String(totalPages).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])}</span>
    ${link(page + 1, 'بعدی', page >= totalPages)}
  </nav>`;
}
