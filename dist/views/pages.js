"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateOnly = exports.errors = exports.checkbox = exports.esc = void 0;
exports.loginBody = loginBody;
exports.installBody = installBody;
exports.dashboardBody = dashboardBody;
exports.usersListBody = usersListBody;
exports.userFormBody = userFormBody;
exports.tempPasswordBody = tempPasswordBody;
exports.rolesListBody = rolesListBody;
exports.roleFormBody = roleFormBody;
exports.settingsBody = settingsBody;
exports.auditBody = auditBody;
exports.healthBody = healthBody;
exports.passwordBody = passwordBody;
exports.errorBody = errorBody;
const errors_1 = require("../lib/errors");
Object.defineProperty(exports, "errors", { enumerable: true, get: function () { return errors_1.errors; } });
const html_1 = require("../http/html");
Object.defineProperty(exports, "esc", { enumerable: true, get: function () { return html_1.esc; } });
const format_1 = require("../http/format");
Object.defineProperty(exports, "formatDateOnly", { enumerable: true, get: function () { return format_1.formatDateOnly; } });
const permissions_1 = require("../rbac/permissions");
const registry_1 = require("../settings/registry");
const ui_1 = require("./ui");
Object.defineProperty(exports, "checkbox", { enumerable: true, get: function () { return ui_1.checkbox; } });
function loginBody(o) {
    return (0, html_1.html) `<section class="auth-card">
    <div class="auth-brand"><span class="brand-mark" aria-hidden="true"></span><h1>${o.instituteName}</h1><p class="muted">ورود به سامانه مدیریت آموزش</p></div>
    ${o.notice ? (0, ui_1.alertBox)('info', o.notice) : (0, html_1.raw)('')}
    ${o.error ? (0, ui_1.alertBox)('error', o.error) : (0, html_1.raw)('')}
    <form method="post" action="/login" class="form-stack" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${(0, ui_1.field)({ name: 'username', label: 'نام کاربری', value: o.username ?? '', required: true, dir: 'ltr', autocomplete: 'username', full: true })}
      ${(0, ui_1.field)({ name: 'password', label: 'رمز عبور', type: 'password', required: true, dir: 'ltr', autocomplete: 'current-password', full: true })}
      <button type="submit" class="btn btn-primary btn-block">ورود</button>
    </form>
  </section>`;
}
function installBody(o) {
    const selectedDriver = o.values.driver === 'mysql' ? 'mysql' : 'sqlite';
    const driverOption = (value, label, hint) => (0, html_1.html) `<label class="radio-option"><input type="radio" name="driver" value="${value}"${selectedDriver === value ? (0, html_1.raw)(' checked') : (0, html_1.raw)('')}> <span><strong>${label}</strong><span class="muted"> — ${hint}</span></span></label>`;
    const driverField = (0, html_1.html) `<fieldset class="field-full driver-choice"><legend>نوع پایگاه داده</legend>
        ${driverOption('sqlite', 'SQLite (پیشنهادی برای میزبانی ساده)', 'بدون نیاز به سرور پایگاه داده؛ فایل در پوشه storage ذخیره می‌شود.')}
        ${driverOption('mysql', 'MySQL / MariaDB', 'نیازمند پایگاه داده MySQL و تنظیم DB_NAME، DB_USER، DB_PASSWORD در cPanel.')}
        ${o.errors.driver ? (0, html_1.html) `<small class="error">${o.errors.driver}</small>` : (0, html_1.raw)('')}
      </fieldset>`;
    const rows = o.checks.map((c) => (0, html_1.html) `<li class="check-row check-${c.level}"><span class="check-dot" aria-hidden="true"></span><div><strong>${c.labelFa}</strong><div class="muted">${c.messageFa}</div></div></li>`);
    const blocked = o.checks.some((c) => c.level === 'error');
    return (0, html_1.html) `<section class="install">
    ${(0, ui_1.pageHeader)('نصب و راه‌اندازی', 'این صفحه فقط تا پیش از نصب موفق فعال است. پس از نصب به‌صورت خودکار بسته می‌شود.')}
    <div class="card">
      <h3>۱. بررسی سازگاری محیط</h3>
      <ul class="check-list">${(0, html_1.joinRaw)(rows)}</ul>
      ${blocked ? (0, ui_1.alertBox)('error', 'برخی بررسی‌ها ناموفق بودند. تا برطرف‌شدن موارد خطا، فرم نصب فعال نمی‌شود.') : (0, ui_1.alertBox)('success', 'محیط برای نصب آماده است.')}
    </div>
    ${o.canInstall && !blocked
        ? (0, html_1.html) `<div class="card">
      <h3>۲. ایجاد پایگاه داده و حساب مدیر اصلی</h3>
      <p class="muted">جداول پایگاه داده ساخته می‌شوند و مدیر اصلی تعریف می‌شود. توکن نصب همان مقداری است که در متغیر INSTALL_TOKEN تنظیم کرده‌اید.</p>
      ${o.formError ? (0, ui_1.alertBox)('error', o.formError) : (0, html_1.raw)('')}
      <form method="post" action="/install" class="form-grid" novalidate>
        <input type="hidden" name="_csrf" value="${o.csrf}">
        ${driverField}
        ${(0, ui_1.field)({ name: 'token', label: 'توکن نصب', type: 'password', required: true, dir: 'ltr', error: o.errors.token, full: true, autocomplete: 'off' })}
        ${(0, ui_1.field)({ name: 'instituteName', label: 'نام رسمی مؤسسه', value: o.values.instituteName ?? '', required: true, error: o.errors.instituteName })}
        ${(0, ui_1.field)({ name: 'fullName', label: 'نام و نام خانوادگی مدیر', value: o.values.fullName ?? '', required: true, error: o.errors.fullName })}
        ${(0, ui_1.field)({ name: 'username', label: 'نام کاربری مدیر', value: o.values.username ?? '', required: true, dir: 'ltr', error: o.errors.username, help: 'حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط' })}
        ${(0, ui_1.field)({ name: 'email', label: 'ایمیل مدیر (اختیاری)', type: 'email', value: o.values.email ?? '', dir: 'ltr', error: o.errors.email })}
        ${(0, ui_1.field)({ name: 'password', label: 'رمز عبور مدیر', type: 'password', required: true, dir: 'ltr', error: o.errors.password, help: 'حداقل ۱۰ نویسه', autocomplete: 'new-password' })}
        ${(0, ui_1.field)({ name: 'passwordConfirm', label: 'تکرار رمز عبور', type: 'password', required: true, dir: 'ltr', error: o.errors.passwordConfirm, autocomplete: 'new-password' })}
        <div class="form-actions field-full"><button type="submit" class="btn btn-primary">نصب سامانه</button></div>
      </form>
    </div>`
        : (0, html_1.raw)('')}
  </section>`;
}
function dashboardBody(o) {
    const cards = [
        ['کاربران ثبت‌شده', o.stats.usersTotal],
        ['کاربران فعال', o.stats.usersActive],
        ['نقش‌های فعال', o.stats.rolesActive],
        ['نشست‌های فعال', o.stats.activeSessions],
        ['رویدادهای ۲۴ ساعت گذشته', o.stats.auditLast24h],
        ['ورود ناموفق ۲۴ ساعت گذشته', o.stats.failedLoginsLast24h],
    ];
    return (0, html_1.html) `<section class="dashboard">
    <p class="greeting">خوش آمدید، ${o.name}.</p>
    <div class="kpi-grid">${(0, html_1.joinRaw)(cards.map(([label, value]) => (0, html_1.html) `<div class="kpi"><span class="kpi-label">${label}</span><strong class="kpi-value">${(0, format_1.num)(value)}</strong></div>`))}</div>
    <div class="card">
      <h3>دسترسی سریع</h3>
      <div class="quick-links">${(0, html_1.joinRaw)(o.links.filter((l) => l.allowed).map((l) => (0, html_1.html) `<a class="quick-link" href="${l.href}">${l.label}</a>`))}</div>
    </div>
  </section>`;
}
function usersListBody(o) {
    const body = o.rows.length
        ? (0, html_1.html) `<div class="table-wrap"><table class="table"><thead><tr>
        <th>نام</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th><th>عملیات</th></tr></thead><tbody>
        ${(0, html_1.joinRaw)(o.rows.map((u) => (0, html_1.html) `<tr>
          <td>${u.full_name}</td>
          <td dir="ltr" class="ltr-cell">${u.username}</td>
          <td>${u.role_name}</td>
          <td>${u.status === 'active' ? (0, ui_1.badge)('فعال', 'ok') : (0, ui_1.badge)('غیرفعال', 'bad')}${u.must_change_password ? (0, ui_1.badge)('تغییر رمز', 'warn') : (0, html_1.raw)('')}</td>
          <td>${(0, format_1.formatDateTime)(u.last_login_at)}</td>
          <td>${o.canUpdate ? (0, html_1.html) `<a class="btn btn-ghost btn-sm" href="/admin/users/${u.id}">مشاهده / ویرایش</a>` : (0, html_1.raw)('')}</td>
        </tr>`))}
        </tbody></table></div>
        ${(0, ui_1.pagerHtml)('/admin/users', { q: o.filters.q, status: o.filters.status, roleId: o.filters.roleId }, o.pageInfo.page, o.pageInfo.totalPages)}`
        : (0, ui_1.emptyState)('کاربری با این مشخصات یافت نشد.', 'فیلترها را تغییر دهید یا با دکمه «کاربر جدید» اولین کاربر را ثبت کنید.');
    return (0, html_1.html) `<section>
    ${(0, ui_1.pageHeader)('کاربران', `${(0, format_1.num)(o.pageInfo.total)} کاربر`, o.canCreate ? (0, html_1.html) `<a class="btn btn-primary" href="/admin/users/new">کاربر جدید</a>` : (0, html_1.raw)(''))}
    <form method="get" action="/admin/users" class="toolbar">
      <input type="search" name="q" value="${o.filters.q}" placeholder="جست‌وجو با نام، نام کاربری، موبایل یا ایمیل" aria-label="جست‌وجو">
      <select name="status" aria-label="وضعیت">
        <option value="">همه وضعیت‌ها</option>
        <option value="active" ${o.filters.status === 'active' ? (0, html_1.raw)('selected') : (0, html_1.raw)('')}>فعال</option>
        <option value="disabled" ${o.filters.status === 'disabled' ? (0, html_1.raw)('selected') : (0, html_1.raw)('')}>غیرفعال</option>
      </select>
      <select name="roleId" aria-label="نقش">
        <option value="">همه نقش‌ها</option>
        ${(0, html_1.joinRaw)(o.roles.map((r) => (0, html_1.html) `<option value="${r.id}" ${o.filters.roleId === String(r.id) ? (0, html_1.raw)('selected') : (0, html_1.raw)('')}>${r.name_fa}</option>`))}
      </select>
      <button class="btn btn-ghost" type="submit">اعمال فیلتر</button>
    </form>
    ${body}
  </section>`;
}
function userFormBody(o) {
    const u = o.user;
    const roleOptions = o.roles.filter((r) => r.is_active || (u && r.id === u.role_id)).map((r) => ({ value: String(r.id), label: r.name_fa + (r.is_active ? '' : ' (غیرفعال)') }));
    const action = o.mode === 'create' ? '/admin/users' : `/admin/users/${u.id}`;
    const disabled = o.mode === 'edit' && !o.canUpdate;
    const form = (0, html_1.html) `<form method="post" action="${action}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${o.csrf}">
    ${o.formError ? (0, ui_1.alertBox)('error', o.formError) : (0, html_1.raw)('')}
    ${o.mode === 'create'
        ? (0, ui_1.field)({ name: 'username', label: 'نام کاربری', value: o.values.username ?? '', required: true, dir: 'ltr', error: o.errors.username, help: 'حروف انگلیسی کوچک، عدد، نقطه، خط تیره یا زیرخط' })
        : (0, ui_1.field)({ name: 'username', label: 'نام کاربری', value: u.username, dir: 'ltr', disabled: true, help: 'نام کاربری پس از ثبت قابل تغییر نیست.' })}
    ${(0, ui_1.field)({ name: 'fullName', label: 'نام و نام خانوادگی', value: o.values.fullName ?? u?.full_name ?? '', required: true, error: o.errors.fullName, disabled })}
    ${(0, ui_1.field)({ name: 'phone', label: 'شماره همراه', value: o.values.phone ?? u?.phone ?? '', dir: 'ltr', error: o.errors.phone, help: 'مثال: ۰۹۱۲۱۲۳۴۵۶۷', disabled })}
    ${(0, ui_1.field)({ name: 'email', label: 'ایمیل', type: 'email', value: o.values.email ?? u?.email ?? '', dir: 'ltr', error: o.errors.email, disabled })}
    ${(0, ui_1.field)({ name: 'roleId', label: 'نقش', options: roleOptions, value: o.values.roleId ?? (u ? String(u.role_id) : ''), required: true, error: o.errors.roleId, disabled: disabled || (o.mode === 'edit' && o.isSelf), help: o.isSelf ? 'تغییر نقش خودتان مجاز نیست.' : 'فقط نقش‌هایی را می‌بینید که مجوزهای آن‌ها در اختیار شماست.' })}
    ${o.mode === 'create'
        ? (0, ui_1.field)({ name: 'password', label: 'رمز عبور اولیه', type: 'password', required: true, dir: 'ltr', error: o.errors.password, help: 'کاربر در ورود نخست باید رمز را تغییر دهد.', autocomplete: 'new-password' })
        : (0, html_1.raw)('')}
    ${o.mode === 'edit' && o.canUpdate
        ? (0, html_1.html) `<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ذخیره تغییرات</button></div>`
        : (0, html_1.raw)('')}
    ${o.mode === 'create' ? (0, html_1.html) `<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ایجاد کاربر</button><a class="btn btn-ghost" href="/admin/users">انصراف</a></div>` : (0, html_1.raw)('')}
  </form>`;
    const actions = o.mode === 'edit' && !o.isSelf
        ? (0, html_1.html) `<div class="card"><h3>عملیات حساب</h3>
      <div class="action-row">
        ${o.canStatus ? (0, html_1.html) `<form method="post" action="/admin/users/${u.id}/status" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="active" value="${u.status === 'active' ? '0' : '1'}"><button class="btn ${u.status === 'active' ? 'btn-danger' : 'btn-primary'}" type="submit" data-confirm="${u.status === 'active' ? 'این حساب غیرفعال و همه نشست‌های آن بسته می‌شود. ادامه می‌دهید؟' : 'حساب این کاربر فعال شود؟'}">${u.status === 'active' ? 'غیرفعال‌کردن حساب' : 'فعال‌کردن حساب'}</button></form>` : (0, html_1.raw)('')}
        ${o.canResetPassword ? (0, html_1.html) `<form method="post" action="/admin/users/${u.id}/reset-password" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="btn btn-ghost" type="submit" data-confirm="رمز موقت جدید ساخته و همه نشست‌های کاربر بسته می‌شود. ادامه می‌دهید؟">بازنشانی رمز عبور</button></form>` : (0, html_1.raw)('')}
        ${o.canRevoke ? (0, html_1.html) `<form method="post" action="/admin/users/${u.id}/revoke-sessions" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="btn btn-ghost" type="submit" data-confirm="همه نشست‌های فعال این کاربر بسته شود؟">خروج از همه نشست‌ها</button></form>` : (0, html_1.raw)('')}
      </div></div>`
        : (0, html_1.raw)('');
    return (0, html_1.html) `<section class="grid-2">
    <div class="card">${form}</div>
    <div>${actions}</div>
  </section>`;
}
function tempPasswordBody(o) {
    return (0, html_1.html) `<section class="card narrow">
    ${(0, ui_1.alertBox)('warning', 'این رمز موقت فقط یک‌بار نمایش داده می‌شود. آن را به‌صورت امن به کاربر منتقل کنید؛ در ورود بعدی باید رمز را تغییر دهد.')}
    <p>نام کاربری: <strong dir="ltr">${o.username}</strong></p>
    <p>رمز موقت: <code class="secret" dir="ltr">${o.tempPassword}</code></p>
    <a class="btn btn-primary" href="${o.backHref}">بازگشت به کاربر</a>
  </section>`;
}
function rolesListBody(o) {
    return (0, html_1.html) `<section>
    ${(0, ui_1.pageHeader)('نقش‌ها و دسترسی‌ها', 'نقش‌ها مجموعه‌ای از مجوزها هستند. هر کاربر یک نقش دارد.', o.canManage ? (0, html_1.html) `<a class="btn btn-primary" href="/admin/roles/new">نقش جدید</a>` : (0, html_1.raw)(''))}
    <div class="table-wrap"><table class="table"><thead><tr><th>نام نقش</th><th>شناسه</th><th>کاربران</th><th>مجوزها</th><th>وضعیت</th><th>نوع</th><th></th></tr></thead><tbody>
    ${(0, html_1.joinRaw)(o.roles.map((r) => (0, html_1.html) `<tr>
      <td>${r.name_fa}</td><td dir="ltr" class="ltr-cell">${r.slug}</td><td>${(0, format_1.num)(r.user_count)}</td><td>${(0, format_1.num)(r.permission_count)}</td>
      <td>${r.is_active ? (0, ui_1.badge)('فعال', 'ok') : (0, ui_1.badge)('غیرفعال', 'bad')}</td>
      <td>${r.is_system ? (0, ui_1.badge)('سیستمی', 'muted') : (0, ui_1.badge)('سفارشی', 'muted')}</td>
      <td><a class="btn btn-ghost btn-sm" href="/admin/roles/${r.id}">${o.canManage ? 'ویرایش' : 'مشاهده'}</a></td>
    </tr>`))}
    </tbody></table></div>
  </section>`;
}
function roleFormBody(o) {
    const r = o.role;
    const locked = Boolean(r && r.slug === permissions_1.SUPER_ADMIN_ROLE);
    const byModule = new Map();
    for (const p of permissions_1.PERMISSIONS)
        byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    const groups = [...byModule.entries()].map(([mod, list]) => (0, html_1.html) `<fieldset class="perm-group"><legend>${mod}</legend>
    ${(0, html_1.joinRaw)(list.map((p) => {
        const canGrant = o.grantable.has(p.code);
        const checked = o.selected.has(p.code);
        return (0, html_1.html) `<label class="check${canGrant ? '' : ' is-muted'}"><input type="checkbox" name="permissions" value="${p.code}" ${checked ? (0, html_1.raw)('checked') : (0, html_1.raw)('')} ${(!o.canManage || locked || (!canGrant && !checked)) ? (0, html_1.raw)('disabled') : (0, html_1.raw)('')}><span>${p.description}</span><small dir="ltr" class="ltr-cell">${p.code}</small></label>`;
    }))}
  </fieldset>`);
    const action = o.mode === 'create' ? '/admin/roles' : `/admin/roles/${r.id}`;
    return (0, html_1.html) `<section class="grid-2">
    <form method="post" action="${action}" class="card form-grid" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${o.formError ? (0, ui_1.alertBox)('error', o.formError) : (0, html_1.raw)('')}
      ${o.mode === 'create'
        ? (0, ui_1.field)({ name: 'slug', label: 'شناسه نقش (انگلیسی)', value: o.values.slug, required: true, dir: 'ltr', error: o.errors.slug, help: 'مثال: registrar_staff' })
        : (0, ui_1.field)({ name: 'slug', label: 'شناسه نقش', value: r.slug, dir: 'ltr', disabled: true })}
      ${(0, ui_1.field)({ name: 'nameFa', label: 'نام نقش', value: o.values.nameFa, required: true, error: o.errors.nameFa, disabled: !o.canManage })}
      ${(0, ui_1.field)({ name: 'description', label: 'توضیحات', value: o.values.description, rows: 3, full: true, error: o.errors.description, disabled: !o.canManage })}
      <div class="field-full">
        <h3>مجوزها</h3>
        ${locked ? (0, ui_1.alertBox)('info', 'مجوزهای مدیر اصلی ثابت است و همیشه همه مجوزها را دارد.') : (0, html_1.raw)('')}
        <p class="muted">فقط مجوزهایی را می‌بینید و می‌توانید اعطا کنید که خودتان دارید.</p>
        ${o.errors.permissions ? (0, ui_1.alertBox)('error', o.errors.permissions) : (0, html_1.raw)('')}
        <div class="perm-grid">${(0, html_1.joinRaw)(groups)}</div>
      </div>
      ${o.canManage && !locked ? (0, html_1.html) `<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ذخیره نقش</button><a class="btn btn-ghost" href="/admin/roles">بازگشت</a></div>` : (0, html_1.raw)('')}
    </form>
    <div>
      ${o.mode === 'edit' && o.canManage && !locked ? roleActions(r, o.csrf) : (0, html_1.raw)('')}
    </div>
  </section>`;
}
function roleActions(r, csrf) {
    return (0, html_1.html) `<div class="card"><h3>وضعیت نقش</h3>
    <p class="muted">${r.user_count > 0 ? `${r.user_count} کاربر این نقش را دارند.` : 'هیچ کاربری این نقش را ندارد.'}</p>
    <div class="action-row">
      <form method="post" action="/admin/roles/${r.id}/active" class="inline-form"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="active" value="${r.is_active ? '0' : '1'}"><button class="btn btn-ghost" type="submit" data-confirm="${r.is_active ? 'غیرفعال‌کردن نقش؛ کاربران این نقش مجوزی نخواهند داشت. ادامه می‌دهید؟' : 'فعال‌سازی نقش؟'}">${r.is_active ? 'غیرفعال‌کردن' : 'فعال‌کردن'}</button></form>
      ${r.user_count === 0 ? (0, html_1.html) `<form method="post" action="/admin/roles/${r.id}/delete" class="inline-form"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-danger" type="submit" data-confirm="این نقش برای همیشه حذف شود؟">حذف نقش</button></form>` : (0, html_1.raw)('')}
    </div></div>`;
}
function settingsBody(o) {
    const tabs = Object.keys(registry_1.SETTING_GROUP_LABELS).map((g) => (0, html_1.html) `<a class="tab${g === o.group ? ' is-active' : ''}" href="/admin/settings/${g}">${registry_1.SETTING_GROUP_LABELS[g]}</a>`);
    const fields = o.views.map((v) => {
        const def = v.def;
        const current = o.values[def.key] ?? (v.value === undefined || v.value === null ? '' : String(v.value));
        if (def.inputType === 'select') {
            return (0, ui_1.field)({ name: def.key, label: def.labelFa, options: def.options?.map((x) => ({ value: x.value, label: x.labelFa })) ?? [], value: current, error: o.errors[def.key], disabled: !o.canUpdate, full: true });
        }
        return (0, ui_1.field)({
            name: def.key,
            label: def.labelFa,
            type: def.inputType === 'textarea' ? undefined : def.inputType ?? 'text',
            value: current,
            rows: def.multiline ? 3 : undefined,
            error: o.errors[def.key],
            disabled: !o.canUpdate,
            dir: def.inputType === 'tel' || def.inputType === 'email' || def.inputType === 'url' ? 'ltr' : undefined,
            full: def.multiline === true,
            help: def.helpFa,
        });
    });
    return (0, html_1.html) `<section>
    ${(0, ui_1.pageHeader)('تنظیمات', 'تغییر این مقادیر نیازی به ویرایش کد برنامه ندارد و در سراسر سامانه اعمال می‌شود.')}
    <nav class="tabs" aria-label="دسته‌های تنظیمات">${(0, html_1.joinRaw)(tabs)}</nav>
    <form method="post" action="/admin/settings/${o.group}" class="card form-grid" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${o.formError ? (0, ui_1.alertBox)('error', o.formError) : (0, html_1.raw)('')}
      ${(0, html_1.joinRaw)(fields)}
      ${o.canUpdate ? (0, html_1.html) `<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ذخیره تنظیمات</button></div>` : (0, ui_1.alertBox)('info', 'فقط مشاهده. برای ویرایش به مجوز «ویرایش تنظیمات» نیاز دارید.')}
    </form>
  </section>`;
}
function auditBody(o) {
    const table = o.rows.length
        ? (0, html_1.html) `<div class="table-wrap"><table class="table"><thead><tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>موجودیت</th><th>نشانی IP</th><th>جزئیات</th></tr></thead><tbody>
      ${(0, html_1.joinRaw)(o.rows.map((r) => (0, html_1.html) `<tr>
        <td>${(0, format_1.formatDateTime)(r.occurred_at)}</td>
        <td>${r.actor_name ?? (r.actor_user_id ? `#${r.actor_user_id}` : 'سیستم')}</td>
        <td dir="ltr" class="ltr-cell">${r.action}</td>
        <td dir="ltr" class="ltr-cell">${r.entity_type ?? ''}${r.entity_id ? ` #${r.entity_id}` : ''}</td>
        <td dir="ltr" class="ltr-cell">${r.ip_address ?? ''}</td>
        <td><code class="details">${r.details_json ?? ''}</code></td>
      </tr>`))}
      </tbody></table></div>
      ${(0, ui_1.pagerHtml)('/admin/audit', { action: o.filters.action }, o.pageInfo.page, o.pageInfo.totalPages)}`
        : (0, ui_1.emptyState)('رویدادی ثبت نشده است.', 'با ورود کاربران، تغییرات مجوزها و تنظیمات، رویدادها در این بخش نمایش داده می‌شوند.');
    return (0, html_1.html) `<section>
    ${(0, ui_1.pageHeader)('سوابق و رویدادها', `${(0, format_1.num)(o.pageInfo.total)} رویداد`)}
    <form method="get" action="/admin/audit" class="toolbar">
      <input type="search" name="action" value="${o.filters.action}" placeholder="پیشوند رویداد، مثلاً auth." dir="ltr" aria-label="نوع رویداد">
      <button class="btn btn-ghost" type="submit">فیلتر</button>
    </form>
    ${table}
  </section>`;
}
function healthBody(r, csrf, canMigrate) {
    const tone = r.status === 'ok' ? 'ok' : r.status === 'degraded' ? 'warn' : 'bad';
    const label = r.status === 'ok' ? 'سالم' : r.status === 'degraded' ? 'هشدار' : 'خطا';
    return (0, html_1.html) `<section>
    ${(0, ui_1.pageHeader)('سلامت سامانه', 'بررسی وضعیت اجزای سامانه. اطلاعات محرمانه در این صفحه نمایش داده نمی‌شوند.')}
    <div class="kpi-grid">
      <div class="kpi"><span class="kpi-label">وضعیت کلی</span>${(0, ui_1.badge)(label, tone)}</div>
      <div class="kpi"><span class="kpi-label">نسخه برنامه</span><strong class="kpi-value" dir="ltr">${r.version}</strong></div>
      <div class="kpi"><span class="kpi-label">نسخه Node.js</span><strong class="kpi-value" dir="ltr">${r.nodeVersion}</strong></div>
      <div class="kpi"><span class="kpi-label">پایگاه داده</span>${r.database.ok ? (0, ui_1.badge)(`متصل (${(0, format_1.num)(r.database.latencyMs ?? 0)} میلی‌ثانیه)`, 'ok') : (0, ui_1.badge)('متصل نیست', 'bad')}</div>
      <div class="kpi"><span class="kpi-label">فضای ذخیره‌سازی</span>${r.storageWritable ? (0, ui_1.badge)('قابل نوشتن', 'ok') : (0, ui_1.badge)('غیرقابل نوشتن', 'bad')}</div>
      <div class="kpi"><span class="kpi-label">migration اعمال‌شده</span><strong class="kpi-value">${(0, format_1.num)(r.migrations?.appliedCount ?? 0)}</strong></div>
    </div>
    ${r.warnings.length ? (0, html_1.html) `<div class="card"><h3>هشدارها</h3><ul>${(0, html_1.joinRaw)(r.warnings.map((w) => (0, html_1.html) `<li>${w}</li>`))}</ul></div>` : (0, html_1.raw)('')}
    <div class="card"><h3>ماژول‌ها</h3><div class="table-wrap"><table class="table"><thead><tr><th>ماژول</th><th>شناسه</th><th>نسخه</th><th>وابستگی‌ها</th><th>نوع</th></tr></thead><tbody>
      ${(0, html_1.joinRaw)(r.modules.map((m) => (0, html_1.html) `<tr><td>${m.nameFa}</td><td dir="ltr" class="ltr-cell">${m.id}</td><td dir="ltr">${m.version}</td><td dir="ltr" class="ltr-cell">${m.dependencies.join('، ') || '—'}</td><td>${m.core ? (0, ui_1.badge)('هسته', 'muted') : (0, ui_1.badge)('افزونه', 'muted')}</td></tr>`))}
    </tbody></table></div></div>
    ${r.migrations && r.migrations.pending.length
        ? (0, html_1.html) `<div class="card"><h3>به‌روزرسانی پایگاه داده</h3>${(0, ui_1.alertBox)('warning', `migration‌های در انتظار: ${r.migrations.pending.join('، ')}. پیش از اجرا از پایگاه داده نسخه پشتیبان بگیرید.`)}
        ${canMigrate ? (0, html_1.html) `<form method="post" action="/admin/system/migrate" class="inline-form"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-primary" type="submit" data-confirm="پیش از اجرای migration از پایگاه داده نسخه پشتیبان گرفته‌اید؟">اجرای migration</button></form>` : (0, html_1.raw)('')}</div>`
        : (0, html_1.raw)('')}
  </section>`;
}
function passwordBody(o) {
    return (0, html_1.html) `<section class="card narrow">
    <h2>تغییر رمز عبور</h2>
    ${o.mustChange ? (0, ui_1.alertBox)('warning', 'برای ادامه استفاده از سامانه، رمز عبور موقت خود را تغییر دهید.') : (0, html_1.raw)('')}
    ${o.error ? (0, ui_1.alertBox)('error', o.error) : (0, html_1.raw)('')}
    <form method="post" action="/account/password" class="form-stack" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${(0, ui_1.field)({ name: 'currentPassword', label: 'رمز عبور فعلی', type: 'password', required: true, dir: 'ltr', error: o.fieldErrors.currentPassword, autocomplete: 'current-password', full: true })}
      ${(0, ui_1.field)({ name: 'newPassword', label: 'رمز عبور جدید', type: 'password', required: true, dir: 'ltr', error: o.fieldErrors.newPassword, help: `حداقل ${o.minLength} نویسه`, autocomplete: 'new-password', full: true })}
      ${(0, ui_1.field)({ name: 'newPasswordConfirm', label: 'تکرار رمز عبور جدید', type: 'password', required: true, dir: 'ltr', error: o.fieldErrors.newPasswordConfirm, autocomplete: 'new-password', full: true })}
      <button class="btn btn-primary" type="submit">ذخیره رمز جدید</button>
    </form>
  </section>`;
}
function errorBody(status, message) {
    return (0, html_1.html) `<section class="card narrow center">
    <p class="error-code" dir="ltr">${String(status)}</p>
    <h2>${message}</h2>
    <a class="btn btn-ghost" href="/admin">بازگشت به داشبورد</a>
  </section>`;
}
