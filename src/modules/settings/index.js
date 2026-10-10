/**
 * ماژول تنظیمات — جامع: موسسه، آموزشی، مالی، پیامک، مدرک، امنیت، ظاهر
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const settings = require('../../core/settings');
const { makeUploader, removeUpload } = require('../../core/uploader');

router.use(requireAuth, canMiddleware('settings.view'));

const TABS = [
  { id: 'institute', title: 'اطلاعات موسسه', icon: 'home' },
  { id: 'academic', title: 'تنظیمات آموزشی', icon: 'book' },
  { id: 'payment', title: 'مالی و پرداخت', icon: 'wallet' },
  { id: 'sms', title: 'پیامک (IPPanel)', icon: 'message' },
  { id: 'certificate', title: 'مدرک و گواهی', icon: 'award' },
  { id: 'security', title: 'امنیت', icon: 'shield' },
  { id: 'general', title: 'ظاهر و عمومی', icon: 'settings' },
];

const FIELDS = {
  institute: [
    'institute_name', 'institute_slogan', 'institute_logo', 'institute_address',
    'institute_phone', 'institute_email', 'institute_website', 'institute_description',
  ],
  academic: ['academic_year', 'academic_term', 'week_start', 'registration_open'],
  payment: [
    'currency_label', 'payment_enable_cash', 'payment_enable_card', 'payment_cards',
    'payment_card_receipt_required', 'installment_default_count', 'installment_interval_days',
  ],
  sms: [
    'sms_enabled', 'sms_api_key', 'sms_from_number', 'sms_base_url',
    'sms_send_delay_ms', 'sms_signature',
  ],
  certificate: [
    'cert_title', 'cert_subtitle', 'cert_footer_text',
    'cert_sign1_name', 'cert_sign1_title', 'cert_sign2_name', 'cert_sign2_title', 'cert_show_qr',
  ],
  security: ['security_password_min', 'security_session_hours'],
  general: ['panel_title', 'theme_accent'],
};

/** صفحه تنظیمات */
router.get('/', async (req, res, next) => {
  try {
    const tab = TABS.some((t) => t.id === req.query.tab) ? req.query.tab : 'institute';
    const all = await settings.all(true);
    const values = {};
    for (const f of FIELDS[tab]) values[f] = all[f] !== undefined ? all[f] : '';

    let cards = [];
    if (tab === 'payment') {
      try {
        cards = JSON.parse(all.payment_cards || '[]');
      } catch {
        cards = [];
      }
    }

    res.render('settings/index', {
      title: 'تنظیمات',
      page: 'settings',
      tabs: TABS,
      tab,
      values,
      cards,
    });
  } catch (e) {
    next(e);
  }
});

/** ذخیره تنظیمات هر تب */
router.post('/save', canMiddleware('settings.manage'), makeUploader('logos', ['image']).single('institute_logo'), async (req, res, next) => {
  try {
    const tab = TABS.some((t) => t.id === req.body.tab) ? req.body.tab : 'institute';
    const b = req.body || {};

    for (const f of FIELDS[tab]) {
      if (f === 'payment_cards') continue;
      if (f === 'institute_logo') {
        if (req.file) {
          const old = await settings.get('institute_logo', '');
          if (old) removeUpload(old);
          await settings.set('institute_logo', `logos/${req.file.filename}`, tab);
        }
        continue;
      }
      let val = b[f];
      if (val === undefined) {
        // چک‌باکس‌ها
        if (['payment_enable_cash', 'payment_enable_card', 'payment_card_receipt_required', 'cert_show_qr', 'sms_enabled', 'registration_open'].includes(f)) {
          val = '0';
        } else {
          continue;
        }
      }
      if (['payment_enable_cash', 'payment_enable_card', 'payment_card_receipt_required', 'cert_show_qr', 'sms_enabled', 'registration_open'].includes(f)) {
        val = val ? '1' : '0';
      }
      await settings.set(f, String(val).trim(), tab);
    }

    // کارت‌های بانکی
    if (tab === 'payment') {
      const holders = Array.isArray(b.card_holder) ? b.card_holder : [];
      const numbers = Array.isArray(b.card_number) ? b.card_number : [];
      const banks = Array.isArray(b.card_bank) ? b.card_bank : [];
      const cards = [];
      holders.forEach((h, i) => {
        const number = String(numbers[i] || '').trim();
        if (h && number) {
          cards.push({ bank: String(banks[i] || '').trim(), holder: String(h).trim(), number });
        }
      });
      await settings.set('payment_cards', JSON.stringify(cards), 'payment');
    }

    await audit.log(req, 'settings.update', 'settings', tab, '');
    flash(req, 'success', 'تنظیمات ذخیره شد');
    res.redirect(`/panel/settings?tab=${tab}`);
  } catch (e) {
    flash(req, 'danger', 'خطا در ذخیره تنظیمات: ' + e.message);
    res.redirect(`/panel/settings?tab=${req.body.tab || 'institute'}`);
  }
});

module.exports = router;
