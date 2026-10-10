'use strict';
/**
 * کپی فایل‌های کتابخانه‌های سمت کاربر به public/vendor و ساخت اسپرایت آیکون‌ها
 * این خروجی‌ها در مخزن قرار می‌گیرند تا روی هاست نیازی به Build نباشد.
 * اجرا: npm run vendor
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'public', 'vendor');

function copy(from, to) {
  const src = path.join(NM, from);
  const dst = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('copied', to);
}

copy('apexcharts/dist/apexcharts.min.js', 'apexcharts/apexcharts.min.js');
copy('@majidh1/jalalidatepicker/dist/jalalidatepicker.min.js', 'jalalidatepicker/jalalidatepicker.min.js');
copy('@majidh1/jalalidatepicker/dist/jalalidatepicker.min.css', 'jalalidatepicker/jalalidatepicker.min.css');
for (const w of ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Light']) copy(`vazirmatn/fonts/webfonts/Vazirmatn-${w}.woff2`, `vazirmatn/Vazirmatn-${w}.woff2`);
copy('vazirmatn/OFL.txt', 'vazirmatn/OFL.txt');

/* ------------------------------ آیکون‌ها ------------------------------ */
const BASE_ICONS = [
  'menu', 'x', 'chevron-down', 'chevron-left', 'chevron-right', 'chevron-up', 'search', 'plus', 'pencil', 'trash-2', 'eye', 'eye-off', 'check', 'check-circle-2',
  'x-circle', 'alert-triangle', 'info', 'bell', 'sun', 'moon', 'log-out', 'user', 'settings', 'download', 'upload', 'printer', 'filter', 'more-vertical',
  'calendar', 'clock', 'map-pin', 'phone', 'mail', 'copy', 'external-link', 'refresh-cw', 'save', 'arrow-left', 'arrow-right', 'trending-up', 'trending-down',
  'list', 'layout-grid', 'loader-2', 'lock', 'key-round', 'shield-check', 'circle-help', 'send', 'wallet', 'receipt', 'credit-card', 'banknote', 'award',
  'graduation-cap', 'users', 'book-open', 'clipboard-check', 'message-square-text', 'layout-dashboard', 'user-plus', 'user-round', 'qr-code', 'file-text',
  'image', 'home', 'circle-dot', 'square-check', 'sparkles', 'zap', 'hash', 'school', 'presentation', 'database', 'server', 'history', 'puzzle', 'palette',
  'phone', 'clock', 'check-circle-2', 'x-circle', 'alert-triangle', 'coffee', 'calendar-clock', 'badge-check', 'ban',
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const used = new Set(BASE_ICONS);
const dynamic = new Set();
for (const f of walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'public', 'js')))) {
  if (!/\.(js|ejs)$/.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const res = [/icon\(\s*'([a-z0-9-]+)'/g, /icon:\s*'([a-z0-9-]+)'/g, /data-icon="([a-z0-9-]+)"/g, /#icon-([a-z0-9-]+)/g, /icon\(\s*"([a-z0-9-]+)"/g];
  for (const re of res) { let m; while ((m = re.exec(s))) used.add(m[1]); }
  // نام‌های داخل عبارات شرطی icon(a ? 'x' : 'y') و emptyIcon
  let m2;
  const call = /icon\(([^()]*)\)/g;
  while ((m2 = call.exec(s))) { const q = /'([a-z0-9-]+)'/g; let k; while ((k = q.exec(m2[1]))) dynamic.add(k[1]); }
  const empty = /emptyIcon:\s*'([a-z0-9-]+)'/g;
  while ((m2 = empty.exec(s))) dynamic.add(m2[1]);
}

const ALIASES = { 'alert-triangle': 'triangle-alert', 'check-circle-2': 'circle-check', 'x-circle': 'circle-x', 'loader-2': 'loader-circle', home: 'house', 'more-vertical': 'ellipsis-vertical', 'edit': 'pencil', 'bar-chart-3': 'chart-column', 'pie-chart': 'chart-pie', 'line-chart': 'chart-line', 'help-circle': 'circle-help', 'layout-template': 'layout-template', 'alert-circle': 'circle-alert', 'check-square': 'square-check', 'filter': 'funnel', 'unlock': 'lock-open' };
const dir = path.join(NM, 'lucide-static', 'icons');
for (const n of dynamic) if (fs.existsSync(path.join(dir, `${n}.svg`)) || (ALIASES[n] && fs.existsSync(path.join(dir, `${ALIASES[n]}.svg`)))) used.add(n);
let sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n';
const missing = [];
for (const name of [...used].sort()) {
  let file = path.join(dir, `${name}.svg`);
  if (!fs.existsSync(file) && ALIASES[name]) file = path.join(dir, `${ALIASES[name]}.svg`);
  if (!fs.existsSync(file)) { missing.push(name); continue; }
  const svg = fs.readFileSync(file, 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '');
  sprite += `<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>\n`;
}
sprite += '</svg>\n';
fs.mkdirSync(path.join(ROOT, 'public', 'img'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public', 'img', 'icons.svg'), sprite);
console.log(`icons: ${used.size - missing.length} written`);
if (missing.length) console.warn('missing icons:', missing.join(', '));
