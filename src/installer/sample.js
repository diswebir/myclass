'use strict';
/**
 * داده‌های نمونه برای آشنایی با سامانه (اختیاری در زمان نصب)
 */
const { db, insertId } = require('../core/db');
const jalali = require('../core/jalali');
const { hashPassword } = require('../core/auth');

const FIRST_M = ['علی', 'محمد', 'حسین', 'رضا', 'امیر', 'مهدی', 'سینا', 'پارسا', 'آرین', 'کیان'];
const FIRST_F = ['زهرا', 'فاطمه', 'سارا', 'مریم', 'نگار', 'ریحانه', 'هانیه', 'یاسمن', 'الناز', 'نازنین'];
const LAST = ['محمدی', 'حسینی', 'احمدی', 'رضایی', 'کریمی', 'موسوی', 'جعفری', 'صادقی', 'رحیمی', 'کاظمی', 'نوری', 'شریفی', 'قاسمی', 'یوسفی'];

let seed = 7;
const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

function nationalCode() {
  const d = [];
  for (let i = 0; i < 9; i++) d.push(Math.floor(rnd() * 10));
  if (d.every((x) => x === d[0])) d[0] = (d[0] + 1) % 10;
  const s = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  d.push(s < 2 ? s : 11 - s);
  return d.join('');
}

async function run(actorId) {
  const today = jalali.today();
  const now = jalali.now();
  const roles = {};
  (await db('roles')).forEach((r) => { roles[r.slug] = r.id; });
  const pass = await hashPassword('12345678');

  // دسته‌بندی‌ها
  const cats = [];
  for (const [name, color] of [['برنامه‌نویسی', '#2563eb'], ['زبان‌های خارجی', '#16a34a'], ['طراحی و گرافیک', '#db2777'], ['مهارت‌های اداری', '#ea580c']]) {
    cats.push(await insertId('categories', { name, color, sort: cats.length, created_at: now }));
  }

  // اساتید
  const teachers = [];
  for (const [f, l, g] of [['رضا', 'احمدی', 'male'], ['مینا', 'صالحی', 'female'], ['کامران', 'فرهادی', 'male']]) {
    const mobile = '0912' + String(1000000 + teachers.length * 111111 + 345).slice(0, 7);
    teachers.push(await insertId('users', {
      role_id: roles.teacher, first_name: f, last_name: l, username: mobile, mobile, gender: g, password_hash: pass,
      is_active: true, must_change_password: false, created_by: actorId, created_at: now, updated_at: now,
    }));
  }

  // دانشجویان
  const students = [];
  const usedMobiles = new Set();
  for (let i = 0; i < 26; i++) {
    const female = rnd() < 0.5;
    let mobile;
    do { mobile = '09' + pick(['12', '13', '19', '35', '36', '01', '02']) + String(Math.floor(rnd() * 9000000) + 1000000); } while (usedMobiles.has(mobile));
    usedMobiles.add(mobile);
    students.push(await insertId('users', {
      role_id: roles.student, first_name: pick(female ? FIRST_F : FIRST_M), last_name: pick(LAST), username: mobile, mobile,
      national_code: nationalCode(), gender: female ? 'female' : 'male', father_name: pick(FIRST_M), password_hash: pass,
      is_active: true, must_change_password: false, created_by: actorId, created_at: jalali.addDays(today, -Math.floor(rnd() * 150)) + ' 10:00:00', updated_at: now,
    }));
  }

  // کلاس‌ها
  const defs = [
    { title: 'دوره جامع برنامه‌نویسی پایتون', cat: 0, start: -75, end: 30, days: '6,1', st: '16:00', et: '18:00', status: 'running', price: 9800000, cap: 15, t: 0, n: 12, color: '#2563eb', level: 'مقدماتی تا پیشرفته' },
    { title: 'زبان انگلیسی مکالمه - سطح متوسط', cat: 1, start: -50, end: 45, days: '0,2', st: '17:30', et: '19:00', status: 'running', price: 6500000, cap: 12, t: 1, n: 10, color: '#16a34a', level: 'متوسط' },
    { title: 'طراحی رابط کاربری با Figma', cat: 2, start: -120, end: -15, days: '3', st: '10:00', et: '13:00', status: 'finished', price: 7200000, cap: 10, t: 2, n: 8, color: '#db2777', level: 'مقدماتی' },
    { title: 'آموزش ICDL و مهارت‌های هفت‌گانه', cat: 3, start: 12, end: 80, days: '6,1,3', st: '09:00', et: '11:00', status: 'open', price: 4500000, cap: 20, t: 0, n: 5, color: '#ea580c', level: 'مقدماتی' },
    { title: 'برنامه‌نویسی وب با React', cat: 0, start: 25, end: 120, days: '1,3', st: '18:00', et: '20:30', status: 'open', price: 12500000, cap: 14, t: 2, n: 0, color: '#7c3aed', level: 'پیشرفته' },
  ];
  const classIds = [];
  const fsvc = require('../modules/finance/service');
  const csvc = require('../modules/classes/service');
  let si = 0;
  for (let k = 0; k < defs.length; k++) {
    const d = defs[k];
    const id = await insertId('classes', {
      category_id: cats[d.cat], title: d.title, code: `CL-${String(k + 1).padStart(4, '0')}`, capacity: d.cap,
      description: `${d.title} با رویکرد کاملاً عملی و پروژه‌محور. در پایان دوره به شرکت‌کنندگانی که شرایط لازم را کسب کنند گواهینامه معتبر اعطا می‌شود.`,
      start_date: jalali.addDays(today, d.start), end_date: jalali.addDays(today, d.end), start_time: d.st, end_time: d.et, week_days: d.days,
      location: `کلاس ${k + 1}، طبقه دوم`, level: d.level, status: d.status, is_public: true, prereg_enabled: d.status === 'open' || d.status === 'running',
      min_attendance: 75, price: d.price, color: d.color, created_by: actorId, created_at: now, updated_at: now,
    });
    classIds.push(id);
    await db('class_teachers').insert({ class_id: id, user_id: teachers[d.t] });
    await csvc.generateSessions(id);
    const enrolled = [];
    for (let j = 0; j < d.n; j++) {
      const uid = students[(si + j) % students.length];
      const eid = await csvc.enroll(id, uid, { actorId, notify: false, force: true });
      enrolled.push({ eid, uid });
      const inst = rnd() < 0.55;
      const invId = await fsvc.createInvoice({
        userId: uid, classId: id, enrollmentId: eid, amount: d.price, discount: rnd() < 0.2 ? 500000 : 0,
        paymentType: inst ? 'installment' : 'cash', installments: 3, downPayment: Math.round(d.price * 0.4 / 100000) * 100000, notify: false, actorId,
      });
      // تاریخ‌گذاری اقساط بر اساس شروع کلاس
      const items = await db('installments').where({ invoice_id: invId }).orderBy('seq');
      for (let x = 0; x < items.length; x++) {
        await db('installments').where({ id: items[x].id }).update({ due_date: jalali.addDays(today, d.start + x * 30) });
      }
      // پرداخت‌ها
      for (let x = 0; x < items.length; x++) {
        const due = jalali.addDays(today, d.start + x * 30);
        if (due > today) break;
        if (rnd() < 0.82) {
          await fsvc.addPayment({ invoiceId: invId, amount: items[x].amount, method: pick(['cash', 'card_to_card', 'card_to_card', 'pos', 'bank_transfer']), paidDate: jalali.addDays(due, Math.floor(rnd() * 4)), trackingCode: String(Math.floor(rnd() * 900000) + 100000), actorId, notify: false });
        }
      }
    }
    si += d.n;
    // حضور و غیاب جلسات گذشته
    const sessions = await db('class_sessions').where({ class_id: id }).where('date', '<', today).orderBy('date');
    for (const s of sessions) {
      const rows = enrolled.map((e) => {
        const r = rnd();
        return { session_id: s.id, enrollment_id: e.eid, status: r < 0.84 ? 'present' : r < 0.91 ? 'late' : r < 0.98 ? 'absent' : 'excused', recorded_by: teachers[d.t], recorded_at: s.date + ' 20:00:00' };
      });
      if (rows.length) await db('attendances').insert(rows);
      await db('class_sessions').where({ id: s.id }).update({ status: 'held', topic: `جلسه ${s.session_no || ''}` });
    }
  }

  // رسید کارت به کارت در انتظار بررسی
  const unpaid = await db('invoices').whereIn('status', ['unpaid', 'partial']).limit(3);
  for (const inv of unpaid) {
    await fsvc.addPayment({ invoiceId: inv.id, amount: Math.min(1500000, Number(inv.total) - Number(inv.paid)), method: 'card_to_card', status: 'pending', trackingCode: String(Math.floor(rnd() * 90000000) + 10000000), payerCard: '4821', paidDate: jalali.addDays(today, -1), actorId: inv.user_id });
  }

  // پیش‌ثبت‌نام‌ها
  for (let i = 0; i < 6; i++) {
    const female = rnd() < 0.5;
    await insertId('preregistrations', {
      class_id: classIds[3 + (i % 2)], first_name: pick(female ? FIRST_F : FIRST_M), last_name: pick(LAST), mobile: '0915' + String(Math.floor(rnd() * 9000000) + 1000000),
      gender: female ? 'female' : 'male', city: pick(['تهران', 'کرج', 'مشهد', 'اصفهان']), how_found: pick(['اینستاگرام', 'معرفی دوستان', 'جستجوی گوگل']),
      payment_preference: pick(['cash', 'installment']), status: i < 4 ? 'pending' : 'contacted', tracking_code: String(23456789 + i * 1111),
      created_at: jalali.addDays(today, -i) + ' 12:00:00', updated_at: now,
    });
  }

  // صدور مدرک برای کلاس پایان‌یافته
  const cert = require('../modules/certificates/service');
  await cert.ensureDefaultTemplate();
  const finished = classIds[2];
  const enr = await db('enrollments').where({ class_id: finished });
  for (const e of enr.slice(0, 5)) {
    await db('enrollments').where({ id: e.id }).update({ grade: 15 + Math.floor(rnd() * 5) });
    try { await cert.issue({ enrollmentId: e.id, actorId, notify: false, issuedDate: jalali.addDays(today, -10) }); } catch (err) { /* ignore */ }
  }
}

module.exports = { run };
