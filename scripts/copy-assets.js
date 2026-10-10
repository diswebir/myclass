/**
 * کپی فایل‌های استاتیک (فونت، کتابخانه‌ها) — npm run build:assets
 * اجرای این اسکریپت پس از npm install لازم نیست؛ خروجی در مخزن ذخیره شده است.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');

function copy(from, to) {
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log('copied:', path.relative(root, to));
  } catch (e) {
    console.warn('skip:', path.relative(root, from), e.message);
  }
}

// فونت وزیرمتن
const fonts = ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'];
fonts.forEach((w) => {
  copy(
    path.join(nm, 'vazirmatn', 'fonts', 'webfonts', `Vazirmatn-${w}.woff2`),
    path.join(root, 'src', 'public', 'fonts', `Vazirmatn-${w}.woff2`)
  );
});

// Chart.js
copy(path.join(nm, 'chart.js', 'dist', 'chart.umd.min.js'), path.join(root, 'src', 'public', 'js', 'chart.umd.min.js'));

// jalaali-js
copy(path.join(nm, 'jalaali-js', 'dist', 'jalaali.min.js'), path.join(root, 'src', 'public', 'js', 'jalaali.min.js'));

console.log('assets ready ✔');
