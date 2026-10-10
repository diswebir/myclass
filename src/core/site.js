'use strict';
/** ساخت آدرس کامل سامانه (برای لینک‌های پیامک، QR مدارک و ...) */
const settings = require('./settings');
const config = require('./config');

let lastOrigin = '';

function remember(req) {
  if (!req || !req.get) return;
  const host = req.get('host');
  if (host) lastOrigin = `${req.protocol}://${host}`;
}

function siteUrl(path = '', req = null) {
  const cfg = String(settings.get('system.base_url', '') || '').trim();
  let base;
  if (cfg) base = cfg.replace(/\/+$/, '');
  else if (req && req.get && req.get('host')) base = `${req.protocol}://${req.get('host')}${config.basePath()}`;
  else base = lastOrigin ? lastOrigin + config.basePath() : '';
  return base + path;
}

module.exports = { siteUrl, remember };
