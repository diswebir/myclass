import { errors } from '../lib/errors';
import { esc, html, raw, Raw, joinRaw } from '../http/html';
import { formatDateOnly, formatDateTime, num } from '../http/format';
import type { DashboardStats } from '../modules/dashboard/dashboard.service';
import type { CheckResult } from '../modules/install/install.service';
import type { AuditRow } from '../modules/audit/audit.service';
import type { HealthReport } from '../modules/system/health.service';
import type { RoleRow } from '../modules/roles/roles.service';
import type { UserRow } from '../modules/users/users.service';
import type { SettingView } from '../modules/settings/settings.service';
import { PERMISSIONS, SUPER_ADMIN_ROLE } from '../rbac/permissions';
import { SETTING_GROUP_LABELS, type SettingGroup } from '../settings/registry';
import { alertBox, badge, checkbox, emptyState, field, pageHeader, pagerHtml } from './ui';
import type { PageInfo } from '../http/pagination';

export function loginBody(o: { csrf: string; error?: string; username?: string; instituteName: string; notice?: string }): Raw {
  return html`<section class="auth-card">
    <div class="auth-brand"><span class="brand-mark" aria-hidden="true"></span><h1>${o.instituteName}</h1><p class="muted">ورود به سامانه مدیریت آموزش</p></div>
    ${o.notice ? alertBox('info', o.notice) : raw('')}
    ${o.error ? alertBox('error', o.error) : raw('')}
    <form method="post" action="/login" class="form-stack" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${field({ name: 'username', label: 'نام کاربری', value: o.username ?? '', required: true, dir: 'ltr', autocomplete: 'username', full: true })}
      ${field({ name: 'password', label: 'رمز عبور', type: 'password', required: true, dir: 'ltr', autocomplete: 'current-password', full: true })}
      <button type="submit" class="btn btn-primary btn-block">ورود</button>
    </form>
  </section>`;
}

export function installBody(o: { csrf: string; checks: CheckResult[]; errors: Record<string, string>; values: Record<string, string>; formError?: string; canInstall: boolean }): Raw {
  const rows = o.checks.map(
    (c) => html`<li class="check-row check-${c.level}"><span class="check-dot" aria-hidden="true"></span><div><strong>${c.labelFa}</strong><div class="muted">${c.messageFa}</div></div></li>`,
  );
  const blocked = o.checks.some((c) => c.level === 'error');
  return html`<section class="install">
    ${pageHeader('نصب و راه‌اندازی', 'این صفحه فقط تا پیش از نصب موفق فعال است. پس از نصب به‌صورت خودکار بسته می‌شود.')}
    <div class="card">
      <h3>۱. بررسی سازگاری محیط</h3>
      <ul class="check-list">${joinRaw(rows as Raw[])}</ul>
      ${blocked ? alertBox('error', 'برخی بررسی‌ها ناموفق بودند. تا برطرف‌شدن موارد خطا، فرم نصب فعال نمی‌شود.') : alertBox('success', 'محیط برای نصب آماده است.')}
    </div>
    ${o.canInstall && !blocked
      ? html`<div class="card">
      <h3>۲. ایجاد پایگاه داده و حساب مدیر اصلی</h3>
      <p class="muted">جداول پایگاه داده ساخته می‌شوند و مدیر اصلی تعریف می‌شود. توکن نصب همان مقداری است که در متغیر INSTALL_TOKEN تنظیم کرده‌اید.</p>
      ${o.formError ? alertBox('error', o.formError) : raw('')}
      <form method="post" action="/install" class="form-grid" novalidate>
        <input type="hidden" name="_csrf" value="${o.csrf}">
        ${field({ name: 'token', label: 'توکن نصب', type: 'password', required: true, dir: 'ltr', error: o.errors.token, full: true, autocomplete: 'off' })}
        ${field({ name: 'instituteName', label: 'نام رسمی مؤسسه', value: o.values.instituteName ?? '', required: true, error: o.errors.instituteName })}
        ${field({ name: 'fullName', label: 'نام و نام خانوادگی مدیر', value: o.values.fullName ?? '', required: true, error: o.errors.fullName })}
        ${field({ name: 'username', label: 'نام کاربری مدیر', value: o.values.username ?? '', required: true, dir: 'ltr', error: o.errors.username, help: 'حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط' })}
        ${field({ name: 'email', label: 'ایمیل مدیر (اختیاری)', type: 'email', value: o.values.email ?? '', dir: 'ltr', error: o.errors.email })}
        ${field({ name: 'password', label: 'رمز عبور مدیر', type: 'password', required: true, dir: 'ltr', error: o.errors.password, help: 'حداقل ۱۰ نویسه', autocomplete: 'new-password' })}
        ${field({ name: 'passwordConfirm', label: 'تکرار رمز عبور', type: 'password', required: true, dir: 'ltr', error: o.errors.passwordConfirm, autocomplete: 'new-password' })}
        <div class="form-actions field-full"><button type="submit" class="btn btn-primary">نصب سامانه</button></div>
      </form>
    </div>`
      : raw('')}
  </section>`;
}

export function dashboardBody(o: { stats: DashboardStats; name: string; links: { href: string; label: string; allowed: boolean }[] }): Raw {
  const cards: [string, number][] = [
    ['کاربران ثبت‌شده', o.stats.usersTotal],
    ['کاربران فعال', o.stats.usersActive],
    ['نقش‌های فعال', o.stats.rolesActive],
    ['نشست‌های فعال', o.stats.activeSessions],
    ['رویدادهای ۲۴ ساعت گذشته', o.stats.auditLast24h],
    ['ورود ناموفق ۲۴ ساعت گذشته', o.stats.failedLoginsLast24h],
  ];
  return html`<section class="dashboard">
    <p class="greeting">خوش آمدید، ${o.name}.</p>
    <div class="kpi-grid">${joinRaw(cards.map(([label, value]) => html`<div class="kpi"><span class="kpi-label">${label}</span><strong class="kpi-value">${num(value)}</strong></div>`) as Raw[])}</div>
    <div class="card">
      <h3>دسترسی سریع</h3>
      <div class="quick-links">${joinRaw(o.links.filter((l) => l.allowed).map((l) => html`<a class="quick-link" href="${l.href}">${l.label}</a>`) as Raw[])}</div>
    </div>
  </section>`;
}

export function usersListBody(o: {
  rows: UserRow[];
  pageInfo: PageInfo;
  filters: { q: string; status: string; roleId: string };
  roles: RoleRow[];
  canCreate: boolean;
  canUpdate: boolean;
}): Raw {
  const body = o.rows.length
    ? html`<div class="table-wrap"><table class="table"><thead><tr>
        <th>نام</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th><th>عملیات</th></tr></thead><tbody>
        ${joinRaw(o.rows.map((u) => html`<tr>
          <td>${u.full_name}</td>
          <td dir="ltr" class="ltr-cell">${u.username}</td>
          <td>${u.role_name}</td>
          <td>${u.status === 'active' ? badge('فعال', 'ok') : badge('غیرفعال', 'bad')}${u.must_change_password ? badge('تغییر رمز', 'warn') : raw('')}</td>
          <td>${formatDateTime(u.last_login_at)}</td>
          <td>${o.canUpdate ? html`<a class="btn btn-ghost btn-sm" href="/admin/users/${u.id}">مشاهده / ویرایش</a>` : raw('')}</td>
        </tr>`) as Raw[])}
        </tbody></table></div>
        ${pagerHtml('/admin/users', { q: o.filters.q, status: o.filters.status, roleId: o.filters.roleId }, o.pageInfo.page, o.pageInfo.totalPages)}`
    : emptyState('کاربری با این مشخصات یافت نشد.', 'فیلترها را تغییر دهید یا با دکمه «کاربر جدید» اولین کاربر را ثبت کنید.');
  return html`<section>
    ${pageHeader('کاربران', `${num(o.pageInfo.total)} کاربر`, o.canCreate ? html`<a class="btn btn-primary" href="/admin/users/new">کاربر جدید</a>` : raw(''))}
    <form method="get" action="/admin/users" class="toolbar">
      <input type="search" name="q" value="${o.filters.q}" placeholder="جست‌وجو با نام، نام کاربری، موبایل یا ایمیل" aria-label="جست‌وجو">
      <select name="status" aria-label="وضعیت">
        <option value="">همه وضعیت‌ها</option>
        <option value="active" ${o.filters.status === 'active' ? raw('selected') : raw('')}>فعال</option>
        <option value="disabled" ${o.filters.status === 'disabled' ? raw('selected') : raw('')}>غیرفعال</option>
      </select>
      <select name="roleId" aria-label="نقش">
        <option value="">همه نقش‌ها</option>
        ${joinRaw(o.roles.map((r) => html`<option value="${r.id}" ${o.filters.roleId === String(r.id) ? raw('selected') : raw('')}>${r.name_fa}</option>`) as Raw[])}
      </select>
      <button class="btn btn-ghost" type="submit">اعمال فیلتر</button>
    </form>
    ${body}
  </section>`;
}

export function userFormBody(o: {
  mode: 'create' | 'edit';
  user?: UserRow;
  roles: RoleRow[];
  values: Record<string, string>;
  errors: Record<string, string>;
  formError?: string;
  csrf: string;
  canUpdate: boolean;
  canStatus: boolean;
  canResetPassword: boolean;
  canRevoke: boolean;
  isSelf: boolean;
}): Raw {
  const u = o.user;
  const roleOptions = o.roles.filter((r) => r.is_active || (u && r.id === u.role_id)).map((r) => ({ value: String(r.id), label: r.name_fa + (r.is_active ? '' : ' (غیرفعال)') }));
  const action = o.mode === 'create' ? '/admin/users' : `/admin/users/${u!.id}`;
  const disabled = o.mode === 'edit' && !o.canUpdate;
  const form = html`<form method="post" action="${action}" class="form-grid" novalidate>
    <input type="hidden" name="_csrf" value="${o.csrf}">
    ${o.formError ? alertBox('error', o.formError) : raw('')}
    ${o.mode === 'create'
      ? field({ name: 'username', label: 'نام کاربری', value: o.values.username ?? '', required: true, dir: 'ltr', error: o.errors.username, help: 'حروف انگلیسی کوچک، عدد، نقطه، خط تیره یا زیرخط' })
      : field({ name: 'username', label: 'نام کاربری', value: u!.username, dir: 'ltr', disabled: true, help: 'نام کاربری پس از ثبت قابل تغییر نیست.' })}
    ${field({ name: 'fullName', label: 'نام و نام خانوادگی', value: o.values.fullName ?? u?.full_name ?? '', required: true, error: o.errors.fullName, disabled })}
    ${field({ name: 'phone', label: 'شماره همراه', value: o.values.phone ?? u?.phone ?? '', dir: 'ltr', error: o.errors.phone, help: 'مثال: ۰۹۱۲۱۲۳۴۵۶۷', disabled })}
    ${field({ name: 'email', label: 'ایمیل', type: 'email', value: o.values.email ?? u?.email ?? '', dir: 'ltr', error: o.errors.email, disabled })}
    ${field({ name: 'roleId', label: 'نقش', options: roleOptions, value: o.values.roleId ?? (u ? String(u.role_id) : ''), required: true, error: o.errors.roleId, disabled: disabled || (o.mode === 'edit' && o.isSelf), help: o.isSelf ? 'تغییر نقش خودتان مجاز نیست.' : 'فقط نقش‌هایی را می‌بینید که مجوزهای آن‌ها در اختیار شماست.' })}
    ${o.mode === 'create'
      ? field({ name: 'password', label: 'رمز عبور اولیه', type: 'password', required: true, dir: 'ltr', error: o.errors.password, help: 'کاربر در ورود نخست باید رمز را تغییر دهد.', autocomplete: 'new-password' })
      : raw('')}
    ${o.mode === 'edit' && o.canUpdate
      ? html`<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ذخیره تغییرات</button></div>`
      : raw('')}
    ${o.mode === 'create' ? html`<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ایجاد کاربر</button><a class="btn btn-ghost" href="/admin/users">انصراف</a></div>` : raw('')}
  </form>`;
  const actions = o.mode === 'edit' && !o.isSelf
    ? html`<div class="card"><h3>عملیات حساب</h3>
      <div class="action-row">
        ${o.canStatus ? html`<form method="post" action="/admin/users/${u!.id}/status" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="active" value="${u!.status === 'active' ? '0' : '1'}"><button class="btn ${u!.status === 'active' ? 'btn-danger' : 'btn-primary'}" type="submit" data-confirm="${u!.status === 'active' ? 'این حساب غیرفعال و همه نشست‌های آن بسته می‌شود. ادامه می‌دهید؟' : 'حساب این کاربر فعال شود؟'}">${u!.status === 'active' ? 'غیرفعال‌کردن حساب' : 'فعال‌کردن حساب'}</button></form>` : raw('')}
        ${o.canResetPassword ? html`<form method="post" action="/admin/users/${u!.id}/reset-password" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="btn btn-ghost" type="submit" data-confirm="رمز موقت جدید ساخته و همه نشست‌های کاربر بسته می‌شود. ادامه می‌دهید؟">بازنشانی رمز عبور</button></form>` : raw('')}
        ${o.canRevoke ? html`<form method="post" action="/admin/users/${u!.id}/revoke-sessions" class="inline-form"><input type="hidden" name="_csrf" value="${o.csrf}"><button class="btn btn-ghost" type="submit" data-confirm="همه نشست‌های فعال این کاربر بسته شود؟">خروج از همه نشست‌ها</button></form>` : raw('')}
      </div></div>`
    : raw('');
  return html`<section class="grid-2">
    <div class="card">${form}</div>
    <div>${actions}</div>
  </section>`;
}

export function tempPasswordBody(o: { username: string; tempPassword: string; backHref: string }): Raw {
  return html`<section class="card narrow">
    ${alertBox('warning', 'این رمز موقت فقط یک‌بار نمایش داده می‌شود. آن را به‌صورت امن به کاربر منتقل کنید؛ در ورود بعدی باید رمز را تغییر دهد.')}
    <p>نام کاربری: <strong dir="ltr">${o.username}</strong></p>
    <p>رمز موقت: <code class="secret" dir="ltr">${o.tempPassword}</code></p>
    <a class="btn btn-primary" href="${o.backHref}">بازگشت به کاربر</a>
  </section>`;
}

export function rolesListBody(o: { roles: RoleRow[]; canManage: boolean }): Raw {
  return html`<section>
    ${pageHeader('نقش‌ها و دسترسی‌ها', 'نقش‌ها مجموعه‌ای از مجوزها هستند. هر کاربر یک نقش دارد.', o.canManage ? html`<a class="btn btn-primary" href="/admin/roles/new">نقش جدید</a>` : raw(''))}
    <div class="table-wrap"><table class="table"><thead><tr><th>نام نقش</th><th>شناسه</th><th>کاربران</th><th>مجوزها</th><th>وضعیت</th><th>نوع</th><th></th></tr></thead><tbody>
    ${joinRaw(o.roles.map((r) => html`<tr>
      <td>${r.name_fa}</td><td dir="ltr" class="ltr-cell">${r.slug}</td><td>${num(r.user_count)}</td><td>${num(r.permission_count)}</td>
      <td>${r.is_active ? badge('فعال', 'ok') : badge('غیرفعال', 'bad')}</td>
      <td>${r.is_system ? badge('سیستمی', 'muted') : badge('سفارشی', 'muted')}</td>
      <td><a class="btn btn-ghost btn-sm" href="/admin/roles/${r.id}">${o.canManage ? 'ویرایش' : 'مشاهده'}</a></td>
    </tr>`) as Raw[])}
    </tbody></table></div>
  </section>`;
}

export function roleFormBody(o: {
  mode: 'create' | 'edit';
  role?: RoleRow & { permissions: string[] };
  values: { slug: string; nameFa: string; description: string };
  selected: Set<string>;
  errors: Record<string, string>;
  formError?: string;
  csrf: string;
  canManage: boolean;
  grantable: Set<string>;
}): Raw {
  const r = o.role;
  const locked = Boolean(r && r.slug === SUPER_ADMIN_ROLE);
  const byModule = new Map<string, typeof PERMISSIONS[number][]>();
  for (const p of PERMISSIONS) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
  const groups = [...byModule.entries()].map(([mod, list]) => html`<fieldset class="perm-group"><legend>${mod}</legend>
    ${joinRaw(list.map((p) => {
      const canGrant = o.grantable.has(p.code);
      const checked = o.selected.has(p.code);
      return html`<label class="check${canGrant ? '' : ' is-muted'}"><input type="checkbox" name="permissions" value="${p.code}" ${checked ? raw('checked') : raw('')} ${(!o.canManage || locked || (!canGrant && !checked)) ? raw('disabled') : raw('')}><span>${p.description}</span><small dir="ltr" class="ltr-cell">${p.code}</small></label>`;
    }) as Raw[])}
  </fieldset>`);
  const action = o.mode === 'create' ? '/admin/roles' : `/admin/roles/${r!.id}`;
  return html`<section class="grid-2">
    <form method="post" action="${action}" class="card form-grid" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${o.formError ? alertBox('error', o.formError) : raw('')}
      ${o.mode === 'create'
        ? field({ name: 'slug', label: 'شناسه نقش (انگلیسی)', value: o.values.slug, required: true, dir: 'ltr', error: o.errors.slug, help: 'مثال: registrar_staff' })
        : field({ name: 'slug', label: 'شناسه نقش', value: r!.slug, dir: 'ltr', disabled: true })}
      ${field({ name: 'nameFa', label: 'نام نقش', value: o.values.nameFa, required: true, error: o.errors.nameFa, disabled: !o.canManage })}
      ${field({ name: 'description', label: 'توضیحات', value: o.values.description, rows: 3, full: true, error: o.errors.description, disabled: !o.canManage })}
      <div class="field-full">
        <h3>مجوزها</h3>
        ${locked ? alertBox('info', 'مجوزهای مدیر اصلی ثابت است و همیشه همه مجوزها را دارد.') : raw('')}
        <p class="muted">فقط مجوزهایی را می‌بینید و می‌توانید اعطا کنید که خودتان دارید.</p>
        ${o.errors.permissions ? alertBox('error', o.errors.permissions) : raw('')}
        <div class="perm-grid">${joinRaw(groups as Raw[])}</div>
      </div>
      ${o.canManage && !locked ? html`<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ذخیره نقش</button><a class="btn btn-ghost" href="/admin/roles">بازگشت</a></div>` : raw('')}
    </form>
    <div>
      ${o.mode === 'edit' && o.canManage && !locked ? roleActions(r!, o.csrf) : raw('')}
    </div>
  </section>`;
}

function roleActions(r: RoleRow, csrf: string): Raw {
  return html`<div class="card"><h3>وضعیت نقش</h3>
    <p class="muted">${r.user_count > 0 ? `${r.user_count} کاربر این نقش را دارند.` : 'هیچ کاربری این نقش را ندارد.'}</p>
    <div class="action-row">
      <form method="post" action="/admin/roles/${r.id}/active" class="inline-form"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="active" value="${r.is_active ? '0' : '1'}"><button class="btn btn-ghost" type="submit" data-confirm="${r.is_active ? 'غیرفعال‌کردن نقش؛ کاربران این نقش مجوزی نخواهند داشت. ادامه می‌دهید؟' : 'فعال‌سازی نقش؟'}">${r.is_active ? 'غیرفعال‌کردن' : 'فعال‌کردن'}</button></form>
      ${r.user_count === 0 ? html`<form method="post" action="/admin/roles/${r.id}/delete" class="inline-form"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-danger" type="submit" data-confirm="این نقش برای همیشه حذف شود؟">حذف نقش</button></form>` : raw('')}
    </div></div>`;
}

export function settingsBody(o: { group: SettingGroup; views: SettingView[]; csrf: string; canUpdate: boolean; errors: Record<string, string>; values: Record<string, string>; formError?: string }): Raw {
  const tabs = (Object.keys(SETTING_GROUP_LABELS) as SettingGroup[]).map(
    (g) => html`<a class="tab${g === o.group ? ' is-active' : ''}" href="/admin/settings/${g}">${SETTING_GROUP_LABELS[g]}</a>`,
  );
  const fields = o.views.map((v) => {
    const def = v.def;
    const current = o.values[def.key] ?? (v.value === undefined || v.value === null ? '' : String(v.value));
    if (def.inputType === 'select') {
      return field({ name: def.key, label: def.labelFa, options: def.options?.map((x) => ({ value: x.value, label: x.labelFa })) ?? [], value: current, error: o.errors[def.key], disabled: !o.canUpdate, full: true });
    }
    return field({
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
  return html`<section>
    ${pageHeader('تنظیمات', 'تغییر این مقادیر نیازی به ویرایش کد برنامه ندارد و در سراسر سامانه اعمال می‌شود.')}
    <nav class="tabs" aria-label="دسته‌های تنظیمات">${joinRaw(tabs as Raw[])}</nav>
    <form method="post" action="/admin/settings/${o.group}" class="card form-grid" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${o.formError ? alertBox('error', o.formError) : raw('')}
      ${joinRaw(fields as Raw[])}
      ${o.canUpdate ? html`<div class="form-actions field-full"><button class="btn btn-primary" type="submit">ذخیره تنظیمات</button></div>` : alertBox('info', 'فقط مشاهده. برای ویرایش به مجوز «ویرایش تنظیمات» نیاز دارید.')}
    </form>
  </section>`;
}

export function auditBody(o: { rows: AuditRow[]; pageInfo: PageInfo; filters: { action: string } }): Raw {
  const table = o.rows.length
    ? html`<div class="table-wrap"><table class="table"><thead><tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>موجودیت</th><th>نشانی IP</th><th>جزئیات</th></tr></thead><tbody>
      ${joinRaw(o.rows.map((r) => html`<tr>
        <td>${formatDateTime(r.occurred_at)}</td>
        <td>${r.actor_name ?? (r.actor_user_id ? `#${r.actor_user_id}` : 'سیستم')}</td>
        <td dir="ltr" class="ltr-cell">${r.action}</td>
        <td dir="ltr" class="ltr-cell">${r.entity_type ?? ''}${r.entity_id ? ` #${r.entity_id}` : ''}</td>
        <td dir="ltr" class="ltr-cell">${r.ip_address ?? ''}</td>
        <td><code class="details">${r.details_json ?? ''}</code></td>
      </tr>`) as Raw[])}
      </tbody></table></div>
      ${pagerHtml('/admin/audit', { action: o.filters.action }, o.pageInfo.page, o.pageInfo.totalPages)}`
    : emptyState('رویدادی ثبت نشده است.', 'با ورود کاربران، تغییرات مجوزها و تنظیمات، رویدادها در این بخش نمایش داده می‌شوند.');
  return html`<section>
    ${pageHeader('سوابق و رویدادها', `${num(o.pageInfo.total)} رویداد`)}
    <form method="get" action="/admin/audit" class="toolbar">
      <input type="search" name="action" value="${o.filters.action}" placeholder="پیشوند رویداد، مثلاً auth." dir="ltr" aria-label="نوع رویداد">
      <button class="btn btn-ghost" type="submit">فیلتر</button>
    </form>
    ${table}
  </section>`;
}

export function healthBody(r: HealthReport, csrf: string, canMigrate: boolean): Raw {
  const tone = r.status === 'ok' ? 'ok' : r.status === 'degraded' ? 'warn' : 'bad';
  const label = r.status === 'ok' ? 'سالم' : r.status === 'degraded' ? 'هشدار' : 'خطا';
  return html`<section>
    ${pageHeader('سلامت سامانه', 'بررسی وضعیت اجزای سامانه. اطلاعات محرمانه در این صفحه نمایش داده نمی‌شوند.')}
    <div class="kpi-grid">
      <div class="kpi"><span class="kpi-label">وضعیت کلی</span>${badge(label, tone)}</div>
      <div class="kpi"><span class="kpi-label">نسخه برنامه</span><strong class="kpi-value" dir="ltr">${r.version}</strong></div>
      <div class="kpi"><span class="kpi-label">نسخه Node.js</span><strong class="kpi-value" dir="ltr">${r.nodeVersion}</strong></div>
      <div class="kpi"><span class="kpi-label">پایگاه داده</span>${r.database.ok ? badge(`متصل (${num(r.database.latencyMs ?? 0)} میلی‌ثانیه)`, 'ok') : badge('متصل نیست', 'bad')}</div>
      <div class="kpi"><span class="kpi-label">فضای ذخیره‌سازی</span>${r.storageWritable ? badge('قابل نوشتن', 'ok') : badge('غیرقابل نوشتن', 'bad')}</div>
      <div class="kpi"><span class="kpi-label">migration اعمال‌شده</span><strong class="kpi-value">${num(r.migrations?.appliedCount ?? 0)}</strong></div>
    </div>
    ${r.warnings.length ? html`<div class="card"><h3>هشدارها</h3><ul>${joinRaw(r.warnings.map((w) => html`<li>${w}</li>`) as Raw[])}</ul></div>` : raw('')}
    <div class="card"><h3>ماژول‌ها</h3><div class="table-wrap"><table class="table"><thead><tr><th>ماژول</th><th>شناسه</th><th>نسخه</th><th>وابستگی‌ها</th><th>نوع</th></tr></thead><tbody>
      ${joinRaw(r.modules.map((m) => html`<tr><td>${m.nameFa}</td><td dir="ltr" class="ltr-cell">${m.id}</td><td dir="ltr">${m.version}</td><td dir="ltr" class="ltr-cell">${m.dependencies.join('، ') || '—'}</td><td>${m.core ? badge('هسته', 'muted') : badge('افزونه', 'muted')}</td></tr>`) as Raw[])}
    </tbody></table></div></div>
    ${r.migrations && r.migrations.pending.length
      ? html`<div class="card"><h3>به‌روزرسانی پایگاه داده</h3>${alertBox('warning', `migration‌های در انتظار: ${r.migrations.pending.join('، ')}. پیش از اجرا از پایگاه داده نسخه پشتیبان بگیرید.`)}
        ${canMigrate ? html`<form method="post" action="/admin/system/migrate" class="inline-form"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-primary" type="submit" data-confirm="پیش از اجرای migration از پایگاه داده نسخه پشتیبان گرفته‌اید؟">اجرای migration</button></form>` : raw('')}</div>`
      : raw('')}
  </section>`;
}

export function passwordBody(o: { csrf: string; error?: string; mustChange: boolean; minLength: number; fieldErrors: Record<string, string> }): Raw {
  return html`<section class="card narrow">
    <h2>تغییر رمز عبور</h2>
    ${o.mustChange ? alertBox('warning', 'برای ادامه استفاده از سامانه، رمز عبور موقت خود را تغییر دهید.') : raw('')}
    ${o.error ? alertBox('error', o.error) : raw('')}
    <form method="post" action="/account/password" class="form-stack" novalidate>
      <input type="hidden" name="_csrf" value="${o.csrf}">
      ${field({ name: 'currentPassword', label: 'رمز عبور فعلی', type: 'password', required: true, dir: 'ltr', error: o.fieldErrors.currentPassword, autocomplete: 'current-password', full: true })}
      ${field({ name: 'newPassword', label: 'رمز عبور جدید', type: 'password', required: true, dir: 'ltr', error: o.fieldErrors.newPassword, help: `حداقل ${o.minLength} نویسه`, autocomplete: 'new-password', full: true })}
      ${field({ name: 'newPasswordConfirm', label: 'تکرار رمز عبور جدید', type: 'password', required: true, dir: 'ltr', error: o.fieldErrors.newPasswordConfirm, autocomplete: 'new-password', full: true })}
      <button class="btn btn-primary" type="submit">ذخیره رمز جدید</button>
    </form>
  </section>`;
}

export function errorBody(status: number, message: string): Raw {
  return html`<section class="card narrow center">
    <p class="error-code" dir="ltr">${String(status)}</p>
    <h2>${message}</h2>
    <a class="btn btn-ghost" href="/admin">بازگشت به داشبورد</a>
  </section>`;
}

export { esc, checkbox, errors, formatDateOnly };
