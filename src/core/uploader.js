/**
 * آپلود فایل — پیکربندی multer + اعتبارسنجی پسوند و حجم
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');

const ALLOWED_EXT = {
  image: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'],
  doc: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
};

function ensureDirs() {
  const dirs = [
    config.upload.dir,
    path.join(config.upload.dir, 'avatars'),
    path.join(config.upload.dir, 'logos'),
    path.join(config.upload.dir, 'receipts'),
    path.join(config.upload.dir, 'classes'),
    path.join(config.upload.dir, 'misc'),
  ];
  dirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));
}
ensureDirs();

function makeUploader(subdir = 'misc', kinds = ['image'], maxMb = null) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.upload.dir, subdir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      cb(null, name);
    },
  });

  const allowed = kinds.flatMap((k) => ALLOWED_EXT[k] || []);

  return multer({
    storage,
    limits: { fileSize: (maxMb || config.upload.maxMb) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.includes(ext)) {
        return cb(new Error(`فرمت فایل مجاز نیست. فرمت‌های قابل قبول: ${allowed.join('، ')}`));
      }
      // بررسی نوع MIME گزارش‌شده
      const okMime = /^(image\/(jpeg|png|webp|gif|svg\+xml)|application\/pdf)$/.test(file.mimetype);
      if (!okMime) return cb(new Error('نوع فایل مجاز نیست'));
      cb(null, true);
    },
  });
}

/** حذف امن فایل آپلودشده */
function removeUpload(relPath) {
  if (!relPath) return;
  const abs = path.join(config.upload.dir, relPath);
  // جلوگیری از path traversal
  if (!abs.startsWith(config.upload.dir)) return;
  fs.unlink(abs, () => {});
}

module.exports = { makeUploader, removeUpload, ensureDirs, ALLOWED_EXT };
