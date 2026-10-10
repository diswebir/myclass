'use strict';
/* تست‌های واحد بخش‌های مستقل از پایگاه داده — اجرا: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../src/core/utils');
const jalali = require('../src/core/jalali');
const { IPPanel, IPPanelError } = require('../src/modules/sms/providers/ippanel');

test('تبدیل ارقام فارسی و عربی و پارس اعداد', () => {
  assert.equal(utils.toEnDigits('۰۹۱۲۱۲۳٤٥٦٧'), '09121234567');
  assert.equal(utils.num('۱۲,۵۰۰,۰۰۰'), 12500000);
  assert.equal(utils.num('abc', 7), 7);
});

test('نرمال‌سازی موبایل و فرمت E.164 برای IPPanel', () => {
  assert.equal(utils.normalizeMobile('+989121234567'), '09121234567');
  assert.equal(utils.normalizeMobile('9121234567'), '09121234567');
  assert.equal(utils.toE164('۰۹۱۲۱۲۳۴۵۶۷'), '+989121234567');
  assert.equal(utils.toE164('12345'), null);
  assert.ok(utils.isMobile('09351234567'));
});

test('اعتبارسنجی کد ملی', () => {
  assert.ok(utils.isNationalCode('0012345679'));
  assert.ok(!utils.isNationalCode('0012345678'));
  assert.ok(!utils.isNationalCode('1111111111'));
});

test('جایگذاری توکن‌ها در قالب پیامک', () => {
  assert.equal(utils.fillTemplate('سلام {name}، قسط {amount} تومان', { name: 'علی', amount: '1,000' }), 'سلام علی، قسط 1,000 تومان');
  assert.equal(utils.fillTemplate('{missing}-x', {}), '-x');
});

test('تبدیل تاریخ شمسی و میلادی (رفت و برگشت)', () => {
  assert.equal(jalali.toJalali('2025-03-21'), '1404/01/01');
  assert.equal(jalali.fromJalali('۱۴۰۴/۰۱/۰۱'), '2025-03-21');
  assert.equal(jalali.fromJalali('1403/12/30'), '2025-03-20');
  assert.equal(jalali.addDays('2025-03-20', 1), '2025-03-21');
  assert.equal(jalali.fromJalali('1404/13/01'), null);
});

test('فرمت شماره فرستنده IPPanel', () => {
  assert.equal(IPPanel.formatSender('3000505'), '+983000505');
  assert.equal(IPPanel.formatSender('+983000505'), '+983000505');
  assert.equal(IPPanel.formatSender('983000505'), '+983000505');
});

test('ساختار درخواست ارسال پترن مطابق مستندات IPPanel Edge', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { message_outbox_ids: [42] }, meta: { status: true, message: 'انجام شد' } }) };
  });
  const p = new IPPanel({ apiKey: 'KEY', fromNumber: '3000505' });
  const out = await p.sendPattern({ code: 'abc', recipient: '+989121234567', params: { name: 'علی' } });
  assert.deepEqual(out.ids, [42]);
  assert.equal(calls[0].url, 'https://edge.ippanel.com/v1/api/send');
  assert.equal(calls[0].opts.headers.Authorization, 'KEY');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    sending_type: 'pattern', from_number: '+983000505', code: 'abc', recipients: ['+989121234567'], params: { name: 'علی' },
  });
});

test('مدیریت خطای IPPanel', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ meta: { status: false, message: 'خطا', errors: { code: ['کد پترن نامعتبر'] } } }) }));
  const p = new IPPanel({ apiKey: 'KEY', fromNumber: '3000505' });
  await assert.rejects(() => p.sendPattern({ code: 'x', recipient: '+989121234567' }), (e) => e instanceof IPPanelError && /کد پترن نامعتبر/.test(e.message));
  const noKey = new IPPanel({ apiKey: '', fromNumber: '1' });
  await assert.rejects(() => noKey.credit(), IPPanelError);
});
