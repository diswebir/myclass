/**
 * ماژول پنل پیامک — الگوها (پترن‌ها)، نگاشت متغیرها، گزارش ارسال و ارسال تست/دستی
 * سرویس: IPPanel Edge API
 */
const express = require('express');
const router = express.Router();
const db = require('../../core/db');
const { requireAuth } = require('../../core/auth');
const { canMiddleware } = require('../../core/rbac');
const { flash } = require('../../core/viewHelpers');
const audit = require('../../core/audit');
const settings = require('../../core/settings');
const smsService = require('../../core/sms/smsService');
const { smsLimiter } = require('../../core/security');
const IppanelClient = require('../../core/sms/ippanel');

router.use(requireAuth);

/** داشبورد پیامک */
router.get('/', canMiddleware('sms.view'), async (req, res, next) => {
  try {
    const stats = {
      total: Number((await db.one('SELECT COUNT(*) AS c FROM sms_logs')).c),
      sent: Number((await db.one("SELECT COUNT(*) AS c FROM sms_logs WHERE status = 'sent'")).c),
      failed: Number((await db.one("SELECT COUNT(*) AS c FROM sms_logs WHERE status = 'failed'")).c),
      today: Number(
        (await db.one('SELECT COUNT(*) AS c FROM sms_logs WHERE created_at >= ?', [db.today() + ' 00:00:00'])).c
      ),
    };
    const recent = await db.query('SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT 15');
    const patterns = await db.query('SELECT * FROM sms_patterns ORDER BY id');

    res.render('sms/index', {
      title: 'پنل پیامک',
      page: 'sms',
      stats,
      recent,
      patterns,
      gateway: {
        enabled: (await settings.get('sms_enabled', '0')) === '1',
        api_key: await settings.get('sms_api_key', ''),
        from_number: await settings.get('sms_from_number', ''),
        base_url: await settings.get('sms_base_url', ''),
      },
    });
  } catch (e) {
    next(e);
  }
});

/** الگوها */
router.get('/patterns', canMiddleware('sms.view'), async (req, res, next) => {
  try {
    const patterns = await db.query('SELECT * FROM sms_patterns ORDER BY id');
    res.render('sms/patterns', {
      title: 'الگوهای پیامکی',
      page: 'sms',
      patterns,
      systemVars: smsService.SYSTEM_VARS,
    });
  } catch (e) {
    next(e);
  }
});

/** ویرایش الگو (کد پترن + نگاشت متغیرها) */
router.post('/patterns/:id', canMiddleware('sms.manage'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pattern = await db.one('SELECT * FROM sms_patterns WHERE id = ?', [id]);
    if (!pattern) return res.status(404).render('errors/404', { title: 'الگو یافت نشد' });

    const b = req.body || {};
    const mapKeys = Array.isArray(b.map_key) ? b.map_key : [];
    const mapVals = Array.isArray(b.map_val) ? b.map_val : [];
    const map = {};
    mapKeys.forEach((k, i) => {
      const key = String(k || '').trim();
      const val = String(mapVals[i] || '').trim();
      if (key && val) map[key] = val;
    });

    await db.update(
      'sms_patterns',
      {
        title: String(b.title || pattern.title).trim(),
        description: String(b.description || '').trim(),
        is_enabled: b.is_enabled ? 1 : 0,
        ippanel_pattern_code: String(b.ippanel_pattern_code || '').trim(),
        ippanel_params_map: JSON.stringify(map),
        updated_at: db.now(),
      },
      'id = ?',
      [id]
    );

    await audit.log(req, 'sms.pattern_update', 'sms_pattern', id, pattern.event_code);
    flash(req, 'success', 'الگوی پیامکی ذخیره شد');
    res.redirect('/panel/sms/patterns');
  } catch (e) {
    next(e);
  }
});

/** صفحه ارسال پیامک */
router.get('/send', canMiddleware('sms.send'), async (req, res, next) => {
  try {
    const patterns = await db.query('SELECT * FROM sms_patterns ORDER BY title');
    res.render('sms/send', {
      title: 'ارسال پیامک',
      page: 'sms',
      patterns,
      systemVars: smsService.SYSTEM_VARS,
    });
  } catch (e) {
    next(e);
  }
});

/** ارسال تستی / دستی */
router.post('/send', canMiddleware('sms.send'), smsLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    const phone = String(b.phone || '').trim();
    const eventCode = String(b.event_code || 'custom');
    if (!phone) {
      flash(req, 'danger', 'شماره موبایل را وارد کنید');
      return res.redirect('/panel/sms/send');
    }

    const vars = {};
    const varKeys = Array.isArray(b.var_key) ? b.var_key : [];
    const varVals = Array.isArray(b.var_val) ? b.var_val : [];
    varKeys.forEach((k, i) => {
      if (k) vars[String(k).trim()] = String(varVals[i] || '').trim();
    });
    if (b.message) vars.message = String(b.message).trim();

    const result = await smsService.sendEvent(eventCode, phone, vars, {
      sentBy: req.user.id,
      force: b.force === '1',
    });

    await audit.log(req, 'sms.send', 'sms', '', `${eventCode} → ${smsService.maskPhone(phone)}`);
    if (result.ok) {
      flash(req, 'success', 'پیامک ارسال شد');
    } else {
      flash(req, 'danger', `ارسال انجام نشد: ${result.reason || result.error || 'نامشخص'}`);
    }
    res.redirect('/panel/sms/send');
  } catch (e) {
    next(e);
  }
});

/** ارسال گروهی به دانش‌آموزان یک کلاس */
router.post('/send-class/:id', canMiddleware('sms.send'), smsLimiter, async (req, res, next) => {
  try {
    const classId = parseInt(req.params.id, 10);
    const eventCode = String(req.body.event_code || 'class_reminder');
    const cls = await db.one('SELECT * FROM classes WHERE id = ?', [classId]);
    if (!cls) return res.status(404).render('errors/404', { title: 'کلاس یافت نشد' });

    const students = await db.query(
      `SELECT u.* FROM class_students cs JOIN users u ON u.id = cs.student_id
       WHERE cs.class_id = ? AND u.phone != ''`,
      [classId]
    );

    const list = students.map((s) => ({
      phone: s.phone,
      vars: {
        full_name: `${s.first_name} ${s.last_name}`,
        class_name: cls.title,
        class_date: cls.start_date ? require('../../core/helpers/jalali').jalaliLong(cls.start_date) : '',
        class_time: cls.start_time ? String(cls.start_time).slice(0, 5) : '',
        message: String(req.body.message || '').trim(),
      },
    }));

    const results = await smsService.sendBulk(eventCode, list, { sentBy: req.user.id, force: true });
    const okCount = results.filter((r) => r.ok).length;
    await audit.log(req, 'sms.bulk_send', 'class', classId, `${okCount}/${list.length} → ${eventCode}`);
    flash(req, 'success', `${okCount} پیامک از ${list.length} ارسال شد`);
    res.redirect('/panel/sms');
  } catch (e) {
    next(e);
  }
});

/** گزارش ارسال */
router.get('/logs', canMiddleware('sms.view'), async (req, res, next) => {
  try {
    const { status, event_code, q } = req.query;
    let where = '1=1';
    const params = [];
    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }
    if (event_code) {
      where += ' AND event_code = ?';
      params.push(event_code);
    }
    if (q) {
      where += ' AND recipient LIKE ?';
      params.push(`%${q}%`);
    }
    const page = parseInt(req.query.page || '1', 10);
    const result = await db.paginate(
      `SELECT * FROM sms_logs WHERE ${where} ORDER BY created_at DESC`,
      params,
      page,
      30
    );
    res.render('sms/logs', {
      title: 'گزارش پیامک‌ها',
      page: 'sms',
      ...result,
      filters: { status: status || '', event_code: event_code || '', q: q || '' },
    });
  } catch (e) {
    next(e);
  }
});

/** تست اتصال به IPPanel */
router.post('/test-connection', canMiddleware('sms.manage'), async (req, res, next) => {
  try {
    const apiKey = await settings.get('sms_api_key', '');
    const baseUrl = await settings.get('sms_base_url', 'https://edge.ippanel.com/v1');
    if (!apiKey) {
      flash(req, 'danger', 'ابتدا کلید API را در تنظیمات پیامک وارد کنید');
      return res.redirect('/panel/sms');
    }
    const client = new IppanelClient(apiKey, baseUrl);
    const resApi = await client.post('/api/user/info', {});
    const ok = resApi.statusCode === 200 && resApi.body && resApi.body.meta && resApi.body.meta.status;
    flash(req, ok ? 'success' : 'danger', ok ? 'اتصال به سرویس پیامک برقرار است ✔' : `خطا در اتصال: ${resApi.raw && resApi.raw.slice(0, 200)}`);
    res.redirect('/panel/sms');
  } catch (e) {
    flash(req, 'danger', 'خطا در اتصال: ' + e.message);
    res.redirect('/panel/sms');
  }
});

module.exports = router;
