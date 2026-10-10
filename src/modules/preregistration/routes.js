'use strict';
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { db, insertId, paginate } = require('../../core/db');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { requirePerm, can } = require('../../core/auth');
const { audit } = require('../../core/audit');
const {
  str, text, int, num, bool, httpError, normalizeMobile, isMobile, isNationalCode, isEmail, toEnDigits, randomAlnum, sendCsv,
} = require('../../core/utils');
const classSvc = require('../classes/service');

const v = (name) => path.join(__dirname, 'views', name);

function newCaptcha(req) {
  const a = crypto.randomInt(1, 10);
  const b = crypto.randomInt(1, 10);
  req.session.captcha = String(a + b);
  return `${a} + ${b}`;
}

async function publicClasses() {
  const rows = await db('classes as c').leftJoin('categories as cat', 'cat.id', 'c.category_id')
    .where('c.is_public', true).whereIn('c.status', ['open', 'running'])
    .select('c.*', 'cat.name as category_name', 'cat.color as category_color')
    .orderByRaw("CASE c.status WHEN 'open' THEN 1 ELSE 2 END").orderBy('c.start_date');
  const stats = await classSvc.classStats(rows.map((x) => x.id));
  return rows.map((c) => Object.assign(c, {
    students: stats[c.id].students, teachers: stats[c.id].teachers, sessions: stats[c.id].sessions,
    full: c.capacity > 0 && stats[c.id].students >= c.capacity,
    canRegister: !!c.prereg_enabled && settings.get('prereg.enabled', true),
  }));
}

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => { req.flash('error', 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید.'); res.go('/register'); },
});

function pub(r) {
  /** صفحه اصلی عمومی: معرفی موسسه و دوره‌ها */
  r.get('/', async (req, res, next) => {
    if (!settings.get('appearance.home_enabled', true)) return next();
    const classes = await publicClasses();
    const categories = [...new Map(classes.filter((c) => c.category_id).map((c) => [c.category_id, { id: c.category_id, name: c.category_name, color: c.category_color }])).values()];
    const totalStudents = Number((await db('enrollments').count({ c: '*' }).first()).c);
    res.page(v('home'), { title: settings.get('general.institute_name'), classes, categories, totalStudents, weekDaysLabel: classSvc.weekDaysLabel }, 'layouts/public');
  });

  r.get('/courses/:id', async (req, res, next) => {
    const classes = await publicClasses();
    const cls = classes.find((c) => c.id === int(req.params.id));
    if (!cls) return next(httpError(404, 'دوره یافت نشد.'));
    const sessions = await db('class_sessions').where({ class_id: cls.id }).whereNot('status', 'canceled').orderBy('date').limit(60);
    res.page(v('course'), { title: cls.title, cls, sessions, weekDaysLabel: classSvc.weekDaysLabel }, 'layouts/public');
  });

  r.get('/register', async (req, res) => {
    if (!settings.get('prereg.enabled', true)) {
      return res.page(v('closed'), { title: 'پیش‌ثبت‌نام' }, 'layouts/public');
    }
    const classes = (await publicClasses()).filter((c) => c.canRegister);
    res.page(v('form'), {
      title: settings.get('prereg.title', 'فرم پیش‌ثبت‌نام'), classes, selected: int(req.query.class) || int(res.locals.old('class_id')),
      captcha: settings.get('prereg.captcha', true) ? newCaptcha(req) : null,
    }, 'layouts/public');
  });

  r.post('/register', submitLimiter, async (req, res) => {
    if (!settings.get('prereg.enabled', true)) return res.go('/register');
    const b = req.body;
    const errors = {};
    if (b.website) return res.go('/register'); // Honeypot ضد ربات
    if (settings.get('prereg.captcha', true)) {
      const expected = req.session.captcha;
      delete req.session.captcha;
      if (!expected || toEnDigits(b.captcha || '').trim() !== expected) errors.captcha = 'پاسخ سؤال امنیتی اشتباه است.';
    }
    const data = {
      class_id: int(b.class_id) || null,
      first_name: str(b.first_name, 100),
      last_name: str(b.last_name, 100),
      mobile: normalizeMobile(b.mobile),
      national_code: toEnDigits(b.national_code || '').replace(/\D/g, '') || null,
      email: settings.get('prereg.field_email') ? (str(b.email, 191).toLowerCase() || null) : null,
      birth_date: settings.get('prereg.field_birth_date', true) && b.birth_date ? jalali.fromJalali(b.birth_date) : null,
      gender: ['male', 'female'].includes(b.gender) ? b.gender : null,
      education: str(b.education, 100) || null,
      city: str(b.city, 100) || null,
      how_found: str(b.how_found, 100) || null,
      payment_preference: ['cash', 'installment'].includes(b.payment_preference) ? b.payment_preference : null,
      message: text(b.message, 2000) || null,
    };
    if (!data.first_name) errors.first_name = 'نام الزامی است.';
    if (!data.last_name) errors.last_name = 'نام خانوادگی الزامی است.';
    if (!isMobile(data.mobile)) errors.mobile = 'شماره موبایل معتبر نیست.';
    if (settings.get('prereg.require_national_code', true) && !data.national_code) errors.national_code = 'کد ملی الزامی است.';
    if (data.national_code && !isNationalCode(data.national_code)) errors.national_code = 'کد ملی معتبر نیست.';
    if (data.email && !isEmail(data.email)) errors.email = 'ایمیل معتبر نیست.';
    if (b.birth_date && settings.get('prereg.field_birth_date', true) && !data.birth_date) errors.birth_date = 'تاریخ تولد معتبر نیست.';
    if (settings.get('prereg.terms') && !bool(b.accept_terms)) errors.accept_terms = 'پذیرش قوانین و شرایط الزامی است.';
    let cls = null;
    if (data.class_id) {
      cls = (await publicClasses()).find((c) => c.id === data.class_id && c.canRegister);
      if (!cls) errors.class_id = 'دوره انتخاب‌شده برای پیش‌ثبت‌نام فعال نیست.';
    } else if (!settings.get('prereg.allow_general', true)) errors.class_id = 'لطفاً دوره مورد نظر را انتخاب کنید.';
    if (!Object.keys(errors).length) {
      const dup = await db('preregistrations').where({ mobile: data.mobile, class_id: data.class_id }).whereIn('status', ['pending', 'contacted']).first();
      if (dup) errors.mobile = `برای این دوره قبلاً با این شماره درخواست ثبت شده است (کد رهگیری: ${dup.tracking_code}).`;
    }
    if (Object.keys(errors).length) return req.backWithErrors(errors, res.locals.url('/register') + (data.class_id ? `?class=${data.class_id}` : ''));

    let code;
    do { code = randomAlnum(8, '23456789'); } while (await db('preregistrations').where({ tracking_code: code }).first());
    const now = jalali.now();
    const id = await insertId('preregistrations', Object.assign(data, { tracking_code: code, status: 'pending', ip: String(req.ip || '').slice(0, 45), created_at: now, updated_at: now }));
    events.emit('prereg.submitted', { preregId: id });
    req.session.lastPrereg = code;
    res.go(`/register/done/${code}`);
  });

  r.get('/register/done/:code', async (req, res, next) => {
    if (req.session.lastPrereg !== req.params.code) return res.go('/track');
    const p = await db('preregistrations as p').leftJoin('classes as c', 'c.id', 'p.class_id').select('p.*', 'c.title as class_title').where('p.tracking_code', req.params.code).first();
    if (!p) return next(httpError(404));
    res.page(v('done'), { title: 'ثبت موفق', p }, 'layouts/public');
  });

  r.get('/track', (req, res) => res.page(v('track'), { title: 'پیگیری پیش‌ثبت‌نام', result: null }, 'layouts/public'));

  r.post('/track', submitLimiter, async (req, res) => {
    const code = toEnDigits(str(req.body.code, 20)).toUpperCase();
    const mobile = normalizeMobile(req.body.mobile);
    const p = await db('preregistrations as p').leftJoin('classes as c', 'c.id', 'p.class_id').select('p.tracking_code', 'p.status', 'p.first_name', 'p.created_at', 'c.title as class_title')
      .where({ 'p.tracking_code': code, 'p.mobile': mobile }).first();
    res.page(v('track'), { title: 'پیگیری پیش‌ثبت‌نام', result: p || false }, 'layouts/public');
  });
}

function panel(r) {
  const listQuery = (req) => {
    const q = db('preregistrations as p').leftJoin('classes as c', 'c.id', 'p.class_id').select('p.*', 'c.title as class_title').orderBy('p.id', 'desc');
    if (req.query.status) q.where('p.status', str(req.query.status, 20));
    if (req.query.class) q.where('p.class_id', int(req.query.class));
    if (req.query.q) {
      const t = `%${toEnDigits(str(req.query.q, 100))}%`;
      q.where((w) => w.where('p.first_name', 'like', t).orWhere('p.last_name', 'like', t).orWhere('p.mobile', 'like', t).orWhere('p.tracking_code', 'like', t).orWhere('p.national_code', 'like', t));
    }
    return q;
  };

  r.get('/preregistrations', requirePerm('prereg.view'), async (req, res) => {
    const data = await paginate(listQuery(req), req.query.page, settings.get('general.items_per_page', 20));
    const counts = {};
    (await db('preregistrations').groupBy('status').select('status').count({ c: '*' })).forEach((x) => { counts[x.status] = Number(x.c); });
    const classes = await db('classes').whereIn('id', db('preregistrations').select('class_id').whereNotNull('class_id')).select('id', 'title');
    res.page(v('list'), { title: 'پیش‌ثبت‌نام‌ها', data, counts, classes, breadcrumbs: [{ label: 'پیش‌ثبت‌نام‌ها' }] });
  });

  r.get('/preregistrations/export', requirePerm('prereg.view'), async (req, res) => {
    const rows = await listQuery(req).limit(20000);
    sendCsv(res, `preregistrations-${jalali.toJalali(jalali.today(), '-')}.csv`, [
      { label: 'کد رهگیری', key: 'tracking_code' }, { label: 'نام', key: 'first_name' }, { label: 'نام خانوادگی', key: 'last_name' },
      { label: 'موبایل', key: 'mobile' }, { label: 'کد ملی', key: 'national_code' }, { label: 'دوره', key: 'class_title' },
      { label: 'روش پرداخت', key: 'payment_preference' }, { label: 'نحوه آشنایی', key: 'how_found' }, { label: 'وضعیت', key: 'status' },
      { label: 'تاریخ', value: (x) => jalali.formatDateTime(x.created_at) },
    ], rows);
  });

  r.get('/preregistrations/:id', requirePerm('prereg.view'), async (req, res, next) => {
    const p = await db('preregistrations as p').leftJoin('classes as c', 'c.id', 'p.class_id').leftJoin('users as r', 'r.id', 'p.reviewed_by')
      .select('p.*', 'c.title as class_title', 'c.price as class_price', 'c.capacity', 'r.first_name as reviewer_first', 'r.last_name as reviewer_last')
      .where('p.id', int(req.params.id)).first();
    if (!p) return next(httpError(404));
    const existingUser = await db('users').where('mobile', p.mobile).modify((q) => { if (p.national_code) q.orWhere('national_code', p.national_code); }).first();
    const classes = await db('classes').whereIn('status', ['draft', 'open', 'running']).select('id', 'title', 'price').orderBy('id', 'desc');
    const history = await db('preregistrations as p').leftJoin('classes as c', 'c.id', 'p.class_id').where('p.mobile', p.mobile).whereNot('p.id', p.id).select('p.*', 'c.title as class_title').orderBy('p.id', 'desc');
    res.page(v('show'), {
      title: `پیش‌ثبت‌نام ${p.first_name} ${p.last_name}`, p, existingUser, classes, history,
      financeOn: registry.isEnabled('finance') && can(req.user, 'finance.invoices'),
      breadcrumbs: [{ label: 'پیش‌ثبت‌نام‌ها', href: '/panel/preregistrations' }, { label: `${p.first_name} ${p.last_name}` }],
    });
  });

  r.post('/preregistrations/:id/status', requirePerm('prereg.manage'), async (req, res, next) => {
    const p = await db('preregistrations').where({ id: int(req.params.id) }).first();
    if (!p) return next(httpError(404));
    const status = ['pending', 'contacted', 'rejected'].includes(req.body.status) ? req.body.status : p.status;
    const note = text(req.body.admin_note, 2000);
    await db('preregistrations').where({ id: p.id }).update({ status, admin_note: note || p.admin_note, reviewed_by: req.user.id, reviewed_at: jalali.now(), updated_at: jalali.now() });
    if (status === 'rejected' && p.status !== 'rejected' && bool(req.body.notify)) events.emit('prereg.rejected', { preregId: p.id, extra: { reason: note } });
    await audit(req, 'prereg.status', 'prereg', p.id, { status });
    req.flash('success', 'وضعیت درخواست به‌روزرسانی شد.');
    res.go(`/panel/preregistrations/${p.id}`);
  });

  /** تأیید و تبدیل به ثبت‌نام قطعی */
  r.post('/preregistrations/:id/approve', requirePerm('prereg.manage'), async (req, res, next) => {
    const p = await db('preregistrations').where({ id: int(req.params.id) }).first();
    if (!p) return next(httpError(404));
    if (p.status === 'approved') { req.flash('warning', 'این درخواست قبلاً تأیید شده است.'); return res.go(`/panel/preregistrations/${p.id}`); }
    const classId = int(req.body.class_id) || p.class_id;
    if (!classId) { req.flash('error', 'برای تأیید، کلاس را انتخاب کنید.'); return res.go(`/panel/preregistrations/${p.id}`); }
    const usersSvc = require('../users/service');
    let user = await db('users').where('mobile', p.mobile).modify((q) => { if (p.national_code) q.orWhere('national_code', p.national_code); }).first();
    let password = null;
    try {
      if (!user) {
        if (!settings.get('prereg.auto_create_account', true) && !bool(req.body.create_account)) throw httpError(422, 'کاربری با این مشخصات وجود ندارد. ساخت حساب را فعال کنید.');
        const role = await usersSvc.studentRole();
        const out = await usersSvc.createUser({
          first_name: p.first_name, last_name: p.last_name, mobile: p.mobile, national_code: p.national_code, email: p.email,
          birth_date: p.birth_date, gender: p.gender, education: p.education, username: p.mobile,
        }, { roleId: role.id, actorId: req.user.id });
        user = await db('users').where({ id: out.id }).first();
        password = out.password;
      }
      const enrollmentId = await classSvc.enroll(classId, user.id, { actorId: req.user.id, source: 'prereg', force: bool(req.body.force), notify: false });
      if (bool(req.body.create_invoice) && registry.isEnabled('finance') && can(req.user, 'finance.invoices')) {
        const cls = await db('classes').where({ id: classId }).first();
        await require('../finance/service').createInvoice({
          userId: user.id, classId, enrollmentId, amount: Math.round(num(req.body.amount)) || cls.price, discount: Math.round(num(req.body.discount)),
          paymentType: req.body.payment_type === 'installment' ? 'installment' : 'cash', installments: int(req.body.installments_count, 2),
          downPayment: Math.round(num(req.body.down_payment)), actorId: req.user.id, notify: bool(req.body.notify),
        });
      }
      await db('preregistrations').where({ id: p.id }).update({ status: 'approved', class_id: classId, user_id: user.id, reviewed_by: req.user.id, reviewed_at: jalali.now(), updated_at: jalali.now(), admin_note: text(req.body.admin_note, 2000) || p.admin_note });
      if (bool(req.body.notify)) events.emit('prereg.approved', { preregId: p.id, extra: { username: user.username, password: password || '' } });
      await audit(req, 'prereg.approve', 'prereg', p.id, { user_id: user.id, class_id: classId });
      req.flash('success', `ثبت‌نام قطعی انجام شد${password ? `. حساب کاربری ساخته شد (نام کاربری: ${user.username} - رمز: ${password})` : ''}.`);
      res.go(`/panel/users/${user.id}`);
    } catch (e) {
      req.flash('error', e.message);
      res.go(`/panel/preregistrations/${p.id}`);
    }
  });

  r.post('/preregistrations/:id/delete', requirePerm('prereg.manage'), async (req, res) => {
    await db('preregistrations').where({ id: int(req.params.id) }).del();
    await audit(req, 'prereg.delete', 'prereg', int(req.params.id));
    req.flash('success', 'درخواست حذف شد.');
    res.go('/panel/preregistrations');
  });
}

module.exports = { public: pub, panel };
