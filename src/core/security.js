/**
 * سرویس‌های امنیتی — هدرها، محدودسازی نرخ درخواست و تنظیمات عمومی
 */
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');

function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

/** محدودکننده عمومی */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید.' },
});

/** محدودکننده ورود */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد تلاش ورود بیش از حد مجاز است.' },
});

/** محدودکننده فرم‌های عمومی (پیش‌ثبت‌نام) */
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد ارسال فرم بیش از حد مجاز است.' },
});

/** محدودکننده ارسال پیامک */
const smsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد ارسال پیامک بیش از حد مجاز است.' },
});

module.exports = {
  securityHeaders,
  generalLimiter,
  loginLimiter,
  publicFormLimiter,
  smsLimiter,
};
