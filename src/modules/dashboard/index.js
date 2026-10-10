'use strict';
/**
 * داشبورد مدیریتی با نمودارهای تحلیلی
 * محتوای داشبورد بر اساس نقش و محدوده دسترسی کاربر ساخته می‌شود.
 */
const path = require('path');
const { db } = require('../../core/db');
const registry = require('../../core/modules');
const jalali = require('../../core/jalali');
const { can, scopeClassIds, applyClassScope } = require('../../core/auth');

const v = (name) => path.join(__dirname, 'views', name);

async function countOf(q) {
  const r = await q.count({ c: '*' }).first();
  return Number((r && r.c) || 0);
}

async function adminData(req, ids) {
  const today = jalali.today();
  const scoped = (q, col) => applyClassScope(q, col, ids);
  const data = {};

  data.kpi = {};
  // تعداد دانشجویان فعال (یکتا)
  const st = await scoped(db('enrollments').where('status', 'active'), 'class_id').countDistinct({ c: 'user_id' }).first();
  data.kpi.students = Number((st && st.c) || 0);
  data.kpi.classes = await countOf(scoped(db('classes').whereIn('status', ['open', 'running']), 'id'));
  data.kpi.teachers = ids === null ? await countOf(db('users as u').join('roles as r', 'r.id', 'u.role_id').where('r.kind', 'teacher').where('u.is_active', true)) : null;
  data.kpi.todaySessions = await countOf(scoped(db('class_sessions').where('date', today).whereNot('status', 'canceled'), 'class_id'));
  data.kpi.newStudents = await countOf(scoped(db('enrollments').where('created_at', '>=', jalali.addDays(today, -30) + ' 00:00:00'), 'class_id'));

  // جلسات امروز
  data.todaySessions = await scoped(db('class_sessions as s').join('classes as c', 'c.id', 's.class_id').where('s.date', today).whereNot('s.status', 'canceled')
    .select('s.*', 'c.title as class_title', 'c.location', 'c.color'), 's.class_id').orderBy('s.start_time');
  if (registry.isEnabled('attendance') && data.todaySessions.length) {
    const rec = await db('attendances').whereIn('session_id', data.todaySessions.map((s) => s.id)).groupBy('session_id').select('session_id').count({ c: '*' });
    const m = {};
    rec.forEach((r) => { m[r.session_id] = Number(r.c); });
    data.todaySessions.forEach((s) => { s.recorded = m[s.id] || 0; });
  }

  // روند ثبت‌نام ۶ ماه اخیر
  const months = jalali.lastJalaliMonths(6);
  const enr = await scoped(db('enrollments').where('created_at', '>=', months[0].start + ' 00:00:00'), 'class_id').select('created_at');
  data.enrollChart = {
    labels: months.map((m) => m.label),
    values: months.map((m) => enr.filter((e) => jalali.jalaliMonthKey(String(e.created_at).slice(0, 10)) === m.key).length),
  };

  // وضعیت کلاس‌ها
  const cs = await scoped(db('classes'), 'id').groupBy('status').select('status').count({ c: '*' });
  data.classStatus = {};
  cs.forEach((r) => { data.classStatus[r.status] = Number(r.c); });

  // نرخ حضور ۸ هفته اخیر
  if (registry.isEnabled('attendance') && can(req.user, 'attendance.view')) {
    const { rate } = require('../attendance/service');
    const from = jalali.addDays(today, -55);
    const rows = await scoped(db('attendances as a').join('class_sessions as s', 's.id', 'a.session_id').where('s.date', '>=', from).where('s.date', '<=', today), 's.class_id')
      .select('s.date', 'a.status');
    const weeks = [];
    for (let i = 0; i < 8; i++) {
      const ws = jalali.addDays(from, i * 7);
      const we = jalali.addDays(ws, 6);
      const c = {};
      rows.filter((r) => r.date >= ws && r.date <= we).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
      weeks.push({ label: jalali.toJalali(ws).slice(5), rate: rate(c) });
    }
    data.attendanceChart = { labels: weeks.map((w) => w.label), values: weeks.map((w) => (w.rate === null ? 0 : w.rate)) };
    const all = {};
    rows.forEach((r) => { all[r.status] = (all[r.status] || 0) + 1; });
    data.kpi.attendanceRate = rate(all);
    data.attendanceBreakdown = all;
  }

  // مالی
  if (registry.isEnabled('finance') && can(req.user, 'finance.view')) {
    const fm = jalali.lastJalaliMonths(12);
    const pays = await scoped(db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('p.status', 'approved').where('p.paid_date', '>=', fm[0].start), 'i.class_id')
      .select('p.paid_date', 'p.amount', 'p.method');
    data.revenueChart = {
      labels: fm.map((m) => m.label),
      values: fm.map((m) => pays.filter((p) => jalali.jalaliMonthKey(p.paid_date) === m.key).reduce((a, p) => a + Number(p.amount), 0)),
    };
    const cur = jalali.currentJalaliMonthRange();
    data.kpi.monthIncome = pays.filter((p) => p.paid_date >= cur.start && p.paid_date <= cur.end).reduce((a, p) => a + Number(p.amount), 0);
    const prev = fm[fm.length - 2];
    data.kpi.prevMonthIncome = prev ? data.revenueChart.values[fm.length - 2] : 0;
    const ov = await scoped(db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').whereNot('i.status', 'canceled')
      .whereIn('it.status', ['pending', 'partial', 'overdue']).where('it.due_date', '<', today), 'i.class_id')
      .select(db.raw('COUNT(*) as c'), db.raw('SUM(it.amount - it.paid_amount) as s')).first();
    data.kpi.overdueCount = Number((ov && ov.c) || 0);
    data.kpi.overdueAmount = Number((ov && ov.s) || 0);
    const debt = await scoped(db('invoices').whereNot('status', 'canceled'), 'class_id').select(db.raw('SUM(total) as t'), db.raw('SUM(paid) as p')).first();
    data.kpi.totalBilled = Number((debt && debt.t) || 0);
    data.kpi.totalPaid = Number((debt && debt.p) || 0);
    data.kpi.pendingPayments = await countOf(scoped(db('payments as p').join('invoices as i', 'i.id', 'p.invoice_id').where('p.status', 'pending'), 'i.class_id'));
    data.upcoming = await scoped(db('installments as it').join('invoices as i', 'i.id', 'it.invoice_id').join('users as u', 'u.id', 'i.user_id')
      .whereNot('i.status', 'canceled').whereIn('it.status', ['pending', 'partial']).where('it.due_date', '>=', today).where('it.due_date', '<=', jalali.addDays(today, 7)), 'i.class_id')
      .select('it.*', 'i.invoice_no', 'i.id as invoice_id', 'u.first_name', 'u.last_name').orderBy('it.due_date').limit(6);
    const methods = {};
    pays.filter((p) => p.paid_date >= fm[9].start).forEach((p) => { methods[p.method] = (methods[p.method] || 0) + Number(p.amount); });
    data.methods = methods;
  }

  if (registry.isEnabled('preregistration') && can(req.user, 'prereg.view')) {
    data.kpi.pendingPrereg = await countOf(db('preregistrations').where('status', 'pending'));
    data.recentPrereg = await db('preregistrations as p').leftJoin('classes as c', 'c.id', 'p.class_id').select('p.*', 'c.title as class_title').orderBy('p.id', 'desc').limit(5);
  }

  // پرجمعیت‌ترین کلاس‌ها
  data.topClasses = await scoped(db('classes as c').leftJoin('enrollments as e', function j() { this.on('e.class_id', 'c.id').andOnVal('e.status', '=', 'active'); })
    .whereIn('c.status', ['open', 'running']).groupBy('c.id', 'c.title', 'c.capacity', 'c.color').select('c.id', 'c.title', 'c.capacity', 'c.color').count({ students: 'e.id' }), 'c.id')
    .orderBy('students', 'desc').limit(6);

  if (can(req.user, 'audit.view')) {
    data.activity = await db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id').select('a.*', 'u.first_name', 'u.last_name').orderBy('a.id', 'desc').limit(8);
  }
  return data;
}

module.exports = {
  key: 'dashboard',
  name: 'داشبورد',
  description: 'داشبورد تحلیلی با نمودارها و شاخص‌های کلیدی',
  icon: 'layout-dashboard',
  order: 70,

  permissions: [{ key: 'dashboard.stats', label: 'مشاهده آمار و نمودارهای داشبورد' }],
  menu: [{ label: 'داشبورد', icon: 'layout-dashboard', href: '/panel', section: 'main', order: 1, hideForKinds: ['student'] }],

  routes(r) {
    r.get('/', async (req, res) => {
      if (req.user.kind === 'student' && can(req.user, 'portal.access') && registry.isEnabled('portal')) return res.go('/panel/my');
      const ids = await scopeClassIds(req);
      const full = can(req.user, 'dashboard.stats');
      let data = {};
      if (full || req.user.kind === 'teacher' || ids !== null) data = await adminData(req, ids);
      // کلاس‌های من (استاد)
      let myClasses = [];
      if (req.user.kind === 'teacher') {
        myClasses = await db('classes as c').join('class_teachers as ct', 'ct.class_id', 'c.id').where('ct.user_id', req.user.id)
          .whereNot('c.status', 'canceled').select('c.*').orderBy('c.start_date', 'desc');
        if (myClasses.length) {
          const { classStats } = require('../classes/service');
          const st = await classStats(myClasses.map((c) => c.id));
          myClasses.forEach((c) => { c.stats = st[c.id] || {}; });
        }
      }
      let pendingAttendance = [];
      if (registry.isEnabled('attendance') && can(req.user, 'attendance.manage')) {
        const q = db('class_sessions as s').join('classes as c', 'c.id', 's.class_id')
          .where('s.date', '<=', jalali.today()).where('s.date', '>=', jalali.addDays(jalali.today(), -14)).where('s.status', 'scheduled')
          .whereNotExists(db('attendances').whereRaw('attendances.session_id = s.id').select(db.raw('1')))
          .select('s.*', 'c.title as class_title').orderBy('s.date', 'desc').limit(8);
        applyClassScope(q, 's.class_id', ids);
        pendingAttendance = await q;
      }
      res.page(v('index'), { title: 'داشبورد', d: data, full, myClasses, pendingAttendance, greeting: greeting() });
    });
  },
};

function greeting() {
  const h = Number(jalali.nowTime().slice(0, 2));
  if (h < 5) return 'شب بخیر';
  if (h < 12) return 'صبح بخیر';
  if (h < 17) return 'روز بخیر';
  if (h < 20) return 'عصر بخیر';
  return 'شب بخیر';
}
