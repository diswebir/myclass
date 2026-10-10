'use strict';
/**
 * آپلود امن فایل
 * - محدودیت نوع و حجم
 * - بررسی امضای فایل (Magic bytes) برای جلوگیری از آپلود فایل مخرب
 * - نام تصادفی و ذخیره خارج از پوشه عمومی
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { paths } = require('./config');
const { httpError } = require('./utils');

const SIGNATURES = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP',
  gif: (b) => b.slice(0, 3).toString() === 'GIF',
  pdf: (b) => b.slice(0, 4).toString() === '%PDF',
  csv: () => true,
};
const EXT_MAP = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', pdf: 'pdf', csv: 'csv', txt: 'csv' };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {string} folder زیرپوشه در storage/uploads (public = قابل دسترسی عمومی)
 * @param {object} opts { types: ['jpg','png'], maxMB: 5, field: 'file' }
 */
function uploader(folder, opts = {}) {
  const types = opts.types || ['jpg', 'png', 'webp'];
  const maxMB = opts.maxMB || 5;
  const dir = path.join(paths.uploads, folder);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => { ensureDir(dir); cb(null, dir); },
    filename: (req, file, cb) => {
      const ext = EXT_MAP[path.extname(file.originalname).slice(1).toLowerCase()] || 'bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: maxMB * 1024 * 1024, files: opts.maxFiles || 5, fields: 200 },
    fileFilter: (req, file, cb) => {
      const ext = EXT_MAP[path.extname(file.originalname).slice(1).toLowerCase()];
      if (!ext || !types.includes(ext)) return cb(httpError(422, `نوع فایل مجاز نیست. فرمت‌های مجاز: ${types.join('، ')}`));
      cb(null, true);
    },
  });

  const handler = opts.fields ? upload.fields(opts.fields) : upload.single(opts.field || 'file');

  const validate = (req, res, next) => {
    const files = [];
    if (req.file) files.push(req.file);
    if (req.files) for (const arr of Object.values(req.files)) files.push(...[].concat(arr));
    for (const f of files) {
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      const ext = path.extname(f.filename).slice(1);
      const check = SIGNATURES[ext];
      if (!check || !check(buf)) {
        files.forEach((x) => fs.existsSync(x.path) && fs.unlinkSync(x.path));
        return next(httpError(422, 'محتوای فایل با نوع آن مطابقت ندارد.'));
      }
      f.relPath = `${folder}/${f.filename}`;
    }
    next();
  };

  const wrapped = (req, res, next) => handler(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(httpError(422, `حجم فایل بیش از ${maxMB} مگابایت است.`));
      return next(err.status ? err : httpError(422, err.message));
    }
    next();
  });

  // CSRF پیش از این مرحله (توسط csrfProtection و توکن آدرس فرم) بررسی شده است
  return [wrapped, validate];
}

function removeFile(relPath) {
  if (!relPath) return;
  const full = path.join(paths.uploads, relPath);
  if (!full.startsWith(paths.uploads)) return;
  fs.promises.unlink(full).catch(() => {});
}

function filePath(relPath) {
  const full = path.normalize(path.join(paths.uploads, relPath || ''));
  if (!full.startsWith(paths.uploads + path.sep)) return null;
  return full;
}

module.exports = { uploader, removeFile, filePath };
