'use strict';
/** سرویس مدارک: قالب پیش‌فرض، بررسی شرایط، صدور و رندر */
const QRCode = require('qrcode');
const { db, insertId } = require('../../core/db');
const settings = require('../../core/settings');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { randomAlnum, fillTemplate, toFaDigits, httpError } = require('../../core/utils');
const { siteUrl } = require('../../core/site');

const DEFAULT_DESIGN = {
  orientation: 'landscape',
  theme: 'classic',
  primary_color: '#1e3a8a',
  accent_color: '#b45309',
  title: 'گواهینامه پایان دوره',
  subtitle: 'Certificate of Completion',
  body: 'بدین‌وسیله گواهی می‌شود {gender_title} {student_name} فرزند {father_name} به کد ملی {national_code}، دوره آموزشی «{class_title}» را به مدت {hours} ساعت از تاریخ {start_date} لغایت {end_date} با موفقیت به پایان رسانده{grade_text} است.',
  footer: 'این گواهینامه از طریق اسکن کد QR یا مراجعه به صفحه استعلام سامانه قابل اعتبارسنجی است.',
  signers: [{ name: '', title: 'مدرس دوره', use_teacher: true }, { name: '', title: 'مدیر موسسه', use_manager: true }],
  show_logo: true,
  show_qr: true,
  show_serial: true,
  border: 'double',
  bg_image: '',
};

const VARIABLES = {
  student_name: 'نام کامل دانشجو', first_name: 'نام', last_name: 'نام خانوادگی', father_name: 'نام پدر', national_code: 'کد ملی',
  gender_title: 'عنوان (آقای/خانم)', class_title: 'عنوان کلاس', class_code: 'کد کلاس', teacher_name: 'نام استاد',
  start_date: 'تاریخ شروع', end_date: 'تاریخ پایان', hours: 'مدت (ساعت)', grade: 'نمره', grade_text: 'عبارت نمره',
  issued_date: 'تاریخ صدور', serial: 'شماره سریال', institute_name: 'نام موسسه', manager_name: 'نام مدیر',
};

async function ensureDefaultTemplate() {
  const t = await db('certificate_templates').orderBy('is_default', 'desc').orderBy('id').first();
  if (t) return t;
  const now = jalali.now();
  const id = await insertId('certificate_templates', { name: 'قالب کلاسیک', design: JSON.stringify(DEFAULT_DESIGN), is_default: true, created_at: now, updated_at: now });
  return db('certificate_templates').where({ id }).first();
}

function designOf(tpl) {
  let d = {};
  try { d = JSON.parse((tpl && tpl.design) || '{}'); } catch (e) { d = {}; }
  return Object.assign({}, DEFAULT_DESIGN, d);
}

/** محاسبه ساعات کلاس */
async function classHours(cls) {
  if (cls.total_hours) return cls.total_hours;
  const sessions = await db('class_sessions').where({ class_id: cls.id }).whereNot('status', 'canceled').select('start_time', 'end_time');
  const mins = sessions.reduce((a, s) => {
    const [h1, m1] = String(s.start_time || '0:0').split(':').map(Number);
    const [h2, m2] = String(s.end_time || '0:0').split(':').map(Number);
    return a + Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1));
  }, 0);
  return Math.round(mins / 60);
}

/** بررسی شرایط صدور برای یک ثبت‌نام */
async function eligibility(enrollment, cls) {
  const issues = [];
  let attendance = null;
  if (settings.get('certificates.check_attendance', true) && registry.isEnabled('attendance')) {
    const { rate } = require('../attendance/service');
    const c = {};
    (await db('attendances').where({ enrollment_id: enrollment.id }).groupBy('status').select('status').count({ c: '*' })).forEach((x) => { c[x.status] = Number(x.c); });
    attendance = rate(c);
    const min = cls.min_attendance !== null && cls.min_attendance !== undefined ? cls.min_attendance : Number(settings.get('attendance.min_percent', 75));
    if (attendance !== null && attendance < min) issues.push(`حضور ${attendance}٪ (حداقل ${min}٪)`);
  }
  let balance = 0;
  if (settings.get('certificates.require_payment', true) && registry.isEnabled('finance')) {
    const row = await db('invoices').where({ user_id: enrollment.user_id, class_id: cls.id }).whereNot('status', 'canceled').select(db.raw('SUM(total - paid) as b')).first();
    balance = Number((row && row.b) || 0);
    if (balance > 0) issues.push('بدهی شهریه');
  }
  const minGrade = Number(settings.get('certificates.min_grade', 0));
  if (minGrade > 0 && (enrollment.grade === null || Number(enrollment.grade) < minGrade)) issues.push(enrollment.grade === null ? 'نمره ثبت نشده' : `نمره کمتر از ${minGrade}`);
  if (enrollment.status === 'withdrawn') issues.push('انصراف از دوره');
  return { ok: issues.length === 0, issues, attendance, balance };
}

async function nextSerial(trx) {
  const prefix = settings.get('certificates.serial_prefix', 'CRT-');
  const jy = jalali.toJalaliParts(jalali.today()).jy;
  const last = await (trx || db)('certificates').where('serial', 'like', `${prefix}${jy}%`).orderBy('id', 'desc').first();
  let n = last ? (parseInt(String(last.serial).slice(-5), 10) || 0) + 1 : 1;
  let serial = `${prefix}${jy}${String(n).padStart(5, '0')}`;
  while (await (trx || db)('certificates').where({ serial }).first()) { n++; serial = `${prefix}${jy}${String(n).padStart(5, '0')}`; }
  return serial;
}

/** صدور مدرک */
async function issue({ enrollmentId, templateId, issuedDate, actorId, notify = true }) {
  const e = await db('enrollments').where({ id: enrollmentId }).first();
  if (!e) throw httpError(404, 'ثبت‌نام یافت نشد.');
  const existing = await db('certificates').where({ enrollment_id: e.id, status: 'valid' }).first();
  if (existing) throw httpError(422, 'برای این دانشجو در این کلاس قبلاً مدرک معتبر صادر شده است.');
  const user = await db('users').where({ id: e.user_id }).first();
  const cls = await db('classes').where({ id: e.class_id }).first();
  const teachers = await db('class_teachers as ct').join('users as u', 'u.id', 'ct.user_id').where('ct.class_id', cls.id).select('u.first_name', 'u.last_name');
  const hours = await classHours(cls);
  let code;
  do { code = randomAlnum(10); } while (await db('certificates').where({ verify_code: code }).first());
  const now = jalali.now();
  const date = issuedDate || jalali.today();
  const snapshot = {
    student_name: `${user.first_name} ${user.last_name}`, first_name: user.first_name, last_name: user.last_name,
    father_name: user.father_name || '—', national_code: user.national_code || '—', gender: user.gender,
    class_title: cls.title, class_code: cls.code, start_date: cls.start_date, end_date: cls.end_date, hours,
    teacher_name: teachers.map((t) => `${t.first_name} ${t.last_name}`).join('، '),
    grade: e.grade !== null && e.grade !== undefined ? Number(e.grade) : null,
    institute_name: settings.get('general.institute_name'), manager_name: settings.get('general.manager_name', ''),
  };
  const id = await db.transaction(async (trx) => {
    const serial = await nextSerial(trx);
    const cid = await insertId('certificates', {
      enrollment_id: e.id, user_id: user.id, class_id: cls.id, template_id: templateId || null, serial, verify_code: code,
      grade: snapshot.grade !== null ? String(snapshot.grade) : null, issued_date: date, status: 'valid',
      snapshot: JSON.stringify(snapshot), issued_by: actorId || null, created_at: now, updated_at: now,
    }, trx);
    if (settings.get('certificates.complete_enrollment', true) && e.status === 'active') {
      await trx('enrollments').where({ id: e.id }).update({ status: 'completed', updated_at: now });
    }
    return cid;
  });
  if (notify) events.emit('certificate.issued', { certificateId: id });
  return id;
}

function verifyUrl(req, code) {
  return siteUrl(`/verify/${code}`, req);
}

/** آماده‌سازی داده‌های رندر مدرک */
async function renderData(cert, req) {
  const tpl = cert.template_id ? await db('certificate_templates').where({ id: cert.template_id }).first() : await ensureDefaultTemplate();
  const design = designOf(tpl);
  const s = JSON.parse(cert.snapshot || '{}');
  const fa = (x) => toFaDigits(x === null || x === undefined ? '' : x);
  const vars = Object.assign({}, s, {
    gender_title: s.gender === 'female' ? 'سرکار خانم' : s.gender === 'male' ? 'جناب آقای' : '',
    start_date: fa(jalali.format(s.start_date, 'medium')), end_date: fa(jalali.format(s.end_date, 'medium')),
    hours: fa(s.hours || '—'), national_code: fa(s.national_code), grade: s.grade !== null && s.grade !== undefined ? fa(s.grade) : '',
    grade_text: s.grade !== null && s.grade !== undefined ? ` و نمره ${fa(s.grade)} را کسب نموده` : '',
    issued_date: fa(jalali.format(cert.issued_date, 'medium')), serial: cert.serial,
  });
  const body = fillTemplate(design.body, vars).replace(/\s+/g, ' ').trim();
  const url = verifyUrl(req, cert.verify_code);
  const qr = design.show_qr ? await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: design.primary_color, light: '#00000000' } }) : '';
  const signers = (design.signers || []).filter((x) => x && (x.title || x.name)).map((x) => ({
    title: x.title, name: x.use_teacher ? (s.teacher_name || x.name) : x.use_manager ? (s.manager_name || x.name) : x.name,
  }));
  return { design, vars, body, qr, verifyUrl: url, signers, certTitle: fillTemplate(design.title, vars), subtitle: fillTemplate(design.subtitle, vars), footer: fillTemplate(design.footer, vars) };
}

module.exports = { DEFAULT_DESIGN, VARIABLES, ensureDefaultTemplate, designOf, eligibility, issue, renderData, verifyUrl, classHours };
