/**
 * سرویس پیامک — رویدادمحور با الگوهای قابل تنظیم (IPPanel Pattern SMS)
 * هر رویداد سیستم → یک الگو (پترن) + نگاشت متغیرهای قابل تنظیم
 */
const db = require('../db');
const settings = require('../settings');
const IppanelClient = require('./ippanel');

/**
 * متغیرهای سیستمی قابل استفاده در الگوها
 * (کلید → برچسب فارسی)
 */
const SYSTEM_VARS = {
  full_name: 'نام کامل',
  first_name: 'نام',
  last_name: 'نام خانوادگی',
  username: 'نام کاربری',
  password: 'رمز عبور',
  phone: 'شماره موبایل',
  class_name: 'عنوان کلاس',
  class_code: 'کد کلاس',
  class_date: 'تاریخ جلسه/شروع',
  class_time: 'ساعت کلاس',
  start_date: 'تاریخ شروع',
  end_date: 'تاریخ پایان',
  session_topic: 'موضوع جلسه',
  amount: 'مبلغ',
  tracking_code: 'کد پیگیری',
  due_date: 'تاریخ سررسید',
  serial: 'شماره سریال مدرک',
  grade: 'نمره نهایی',
  date: 'تاریخ',
  time: 'ساعت',
  message: 'متن پیام',
  institute_name: 'نام موسسه',
  link: 'لینک',
};

/** نرمال‌سازی شماره به قالب E.164 (+98...) */
function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+98')) return p;
  if (p.startsWith('0098')) return '+' + p.slice(2);
  if (p.startsWith('98')) return '+' + p;
  if (p.startsWith('0')) return '+98' + p.slice(1);
  if (p.length === 10 && p.startsWith('9')) return '+98' + p;
  return p;
}

/** نمایش امن شماره */
function maskPhone(phone) {
  const p = String(phone || '');
  return p.length > 5 ? p.slice(0, 4) + '***' + p.slice(-3) : p;
}

function jsonParse(str, def = {}) {
  if (!str) return def;
  try {
    return JSON.parse(str);
  } catch {
    return def;
  }
}

/**
 * ارسال پیامک رویدادی
 * @param {string} eventCode کد رویداد مثل enrollment_approved
 * @param {string} phone شماره گیرنده
 * @param {object} vars متغیرهای سیستمی { full_name: '...', class_name: '...' }
 * @param {object} opts { sentBy, force }
 */
async function sendEvent(eventCode, phone, vars = {}, opts = {}) {
  const pattern = await db.one('SELECT * FROM sms_patterns WHERE event_code = ?', [eventCode]);
  const baseVars = {
    institute_name: await settings.get('institute_name', ''),
    date: require('../helpers/jalali').todayJalali(),
    ...vars,
  };

  const logRow = {
    event_code: eventCode,
    pattern_code: pattern ? pattern.ippanel_pattern_code : '',
    recipient: maskPhone(normalizePhone(phone)),
    variables: JSON.stringify(baseVars),
    message_preview: `${(pattern && pattern.title) || eventCode}`,
    status: 'skipped',
    provider_response: '',
    sent_by: opts.sentBy || null,
    created_at: db.now(),
  };

  try {
    const enabled = await settings.get('sms_enabled', '0') === '1';
    const apiKey = await settings.get('sms_api_key', '');

    if (!enabled && !opts.force) {
      logRow.provider_response = 'سرویس پیامک در تنظیمات غیرفعال است';
      await db.insert('sms_logs', logRow);
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    if (!apiKey) {
      logRow.provider_response = 'کلید API پیامک تنظیم نشده است';
      await db.insert('sms_logs', logRow);
      return { ok: false, skipped: true, reason: 'no_api_key' };
    }
    if (!pattern) {
      logRow.provider_response = 'رویداد تعریف نشده است';
      await db.insert('sms_logs', logRow);
      return { ok: false, skipped: true, reason: 'no_pattern' };
    }
    if (!pattern.is_enabled && !opts.force) {
      logRow.provider_response = 'این الگو غیرفعال است';
      await db.insert('sms_logs', logRow);
      return { ok: false, skipped: true, reason: 'pattern_disabled' };
    }
    if (!pattern.ippanel_pattern_code) {
      logRow.provider_response = 'کد الگوی پیامکی (IPPanel Pattern) برای این رویداد تنظیم نشده است';
      await db.insert('sms_logs', logRow);
      return { ok: false, skipped: true, reason: 'no_pattern_code' };
    }

    const to = normalizePhone(phone);
    if (!to || to.length < 12) {
      logRow.provider_response = 'شماره گیرنده نامعتبر است';
      await db.insert('sms_logs', logRow);
      return { ok: false, skipped: true, reason: 'bad_phone' };
    }

    // نگاشت متغیرها: { "کلید در پترن": "کلید متغیر سیستم" }
    const map = jsonParse(pattern.ippanel_params_map, {});
    const params = {};
    for (const [patternKey, sysKey] of Object.entries(map)) {
      params[patternKey] = baseVars[sysKey] !== undefined ? String(baseVars[sysKey]) : '';
    }

    const fromNumber = await settings.get('sms_from_number', '+983000505');
    const baseUrl = await settings.get('sms_base_url', 'https://edge.ippanel.com/v1');
    const client = new IppanelClient(apiKey, baseUrl);
    const res = await client.sendPattern({
      from_number: fromNumber,
      code: pattern.ippanel_pattern_code,
      recipients: [to],
      params,
    });

    const ok = res.statusCode === 200 && res.body && res.body.meta && res.body.meta.status;
    logRow.status = ok ? 'sent' : 'failed';
    logRow.provider_response = (res.raw || '').slice(0, 1000);
    await db.insert('sms_logs', logRow);
    return { ok: !!ok, response: res.body };
  } catch (err) {
    logRow.status = 'failed';
    logRow.provider_response = String(err.message || err).slice(0, 1000);
    await db.insert('sms_logs', logRow);
    return { ok: false, error: err.message };
  }
}

/** ارسال گروهی با تاخیر کنترل‌شده */
async function sendBulk(eventCode, list, opts = {}) {
  const delay = parseInt(await settings.get('sms_send_delay_ms', '200'), 10) || 200;
  const results = [];
  for (const item of list) {
    const r = await sendEvent(eventCode, item.phone, item.vars || {}, opts);
    results.push(r);
    if (delay > 0) await new Promise((res) => setTimeout(res, delay));
  }
  return results;
}

module.exports = {
  sendEvent,
  sendBulk,
  normalizePhone,
  maskPhone,
  SYSTEM_VARS,
};
