'use strict';
/**
 * رجیستری ماژول‌ها
 * هر ماژول یک پوشه در src/modules است که فایل index.js آن یک «مانیفست» صادر می‌کند.
 * با افزودن/حذف پوشه یا غیرفعال کردن از تنظیمات، قابلیت‌ها کم و زیاد می‌شوند.
 */
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const modules = [];
let loaded = false;

const MENU_SECTIONS = {
  main: { label: 'اصلی', order: 1 },
  education: { label: 'آموزش', order: 2 },
  portal: { label: 'پنل من', order: 3 },
  finance: { label: 'مالی', order: 4 },
  communication: { label: 'ارتباطات', order: 5 },
  system: { label: 'سیستم', order: 9 },
};

function load() {
  if (loaded) return modules;
  const dirs = fs.readdirSync(MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    const file = path.join(MODULES_DIR, d.name, 'index.js');
    if (!fs.existsSync(file)) continue;
    const m = require(file);
    m.key = m.key || d.name;
    m.dir = path.join(MODULES_DIR, d.name);
    m.order = m.order || 50;
    m.permissions = m.permissions || [];
    m.menu = m.menu || [];
    m.settings = m.settings || [];
    m.settingsTabs = m.settingsTabs || [];
    m.smsEvents = m.smsEvents || [];
    m.migrations = m.migrations || [];
    m.tasks = m.tasks || [];
    modules.push(m);
  }
  modules.sort((a, b) => a.order - b.order);
  // ثبت مقادیر پیش‌فرض تنظیمات
  const defs = {};
  for (const m of modules) for (const s of m.settings) if (s.key) defs[s.key] = s.default;
  settings.registerDefaults(defs);
  loaded = true;
  return modules;
}

function all() {
  return load();
}

function get(key) {
  return load().find((m) => m.key === key);
}

function disabledList() {
  const v = settings.get('modules.disabled', []);
  return Array.isArray(v) ? v : [];
}

function isEnabled(key) {
  const m = get(key);
  if (!m) return false;
  if (m.core) return true;
  const disabled = disabledList();
  if (disabled.includes(key)) return false;
  // وابستگی‌ها
  return (m.requires || []).every((r) => isEnabled(r));
}

function enabled() {
  return load().filter((m) => isEnabled(m.key));
}

/** همه مجوزها گروه‌بندی شده بر اساس ماژول */
function permissionGroups() {
  return load()
    .filter((m) => m.permissions.length)
    .map((m) => ({ key: m.key, name: m.name, icon: m.icon, enabled: isEnabled(m.key), permissions: m.permissions }));
}

function allPermissionKeys() {
  return load().flatMap((m) => m.permissions.map((p) => p.key));
}

function smsEvents() {
  return enabled().flatMap((m) => m.smsEvents.map((e) => Object.assign({ module: m.key }, e)));
}

function allSmsEvents() {
  return load().flatMap((m) => m.smsEvents.map((e) => Object.assign({ module: m.key }, e)));
}

function settingsTabs() {
  const tabs = [];
  for (const m of enabled()) for (const t of m.settingsTabs) tabs.push(Object.assign({ module: m.key }, t));
  return tabs.sort((a, b) => (a.order || 50) - (b.order || 50));
}

function settingsFields(tab) {
  const out = [];
  for (const m of enabled()) for (const s of m.settings) if (s.tab === tab) out.push(s);
  return out;
}

function migrations() {
  return load().flatMap((m) => m.migrations.map((mg) => Object.assign({ module: m.key }, mg)));
}

module.exports = {
  load, all, get, isEnabled, enabled, disabledList, permissionGroups, allPermissionKeys, smsEvents, allSmsEvents,
  settingsTabs, settingsFields, migrations, MENU_SECTIONS,
};
