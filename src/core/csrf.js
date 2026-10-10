/**
 * محافظت CSRF — توکن جلسه‌محور برای تمام فرم‌ها و درخواست‌های نوشتنی
 */
const crypto = require('crypto');

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

/** میدل‌ور: ساخت توکن برای همه درخواست‌ها + اعتبارسنجی درخواست‌های نوشتنی */
function csrfProtection(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();
  // مسیرهای نصب وب‌محور و API پیامک تست داخلی هم محافظت می‌شوند

  const sent =
    (req.body && (req.body._csrf || req.body.csrf_token)) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  if (!sent || String(sent).length !== token.length ||
      !crypto.timingSafeEqual(Buffer.from(String(sent)), Buffer.from(token))) {
    return res.status(403).render('errors/403', {
      title: 'درخواست نامعتبر',
      message: 'توکن امنیتی منقضی شده است. لطفاً صفحه را دوباره باز کنید.',
      layout: 'layouts/auth',
    });
  }
  return next();
}

module.exports = { csrfProtection, ensureToken };
