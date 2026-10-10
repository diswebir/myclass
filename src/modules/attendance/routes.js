'use strict';
const path = require('path');
const { db } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { requirePerm, can, scopeClassIds, applyClassScope, assertClassAccess } = require('../../core/auth');
const { audit } = require('../../core/audit');
const { str, int, bool, httpError, sendCsv } = require('../../core/utils');
const { rate } = require('./service');

const v = (name) => path.join(__dirname, 'views', name);
const STATUSES = ['present', 'absent', 'late', 'excused'];

/** ماتریس حضور و غیاب یک کلاس (دانشجویان × جلسات) */
async function buildMatrix(classId) {
  const sessions = await db('class_sessions').where({ class_id: classId }).whereNot('status', 'canceled').orderBy('date').orderBy('start_time');
  const students = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', classId)
    .whereIn('e.status', ['active', 'completed', 'suspended']).select('e.id', 'e.status', 'u.id as user_id', 'u.first_name', 'u.last_name', 'u.avatar').orderBy('u.last_name');
  const records = students.length ? await db('attendances').whereIn('enrollment_id', students.map((s) => s.id)) : [];
  const map = {};
  records.forEach((r) => { map[`${r.enrollment_id}:${r.session_id}`] = r; });
  const summary = {};
  students.forEach((s) => {
    const c = { present: 0, absent: 0, late: 0, excused: 0 };
    sessions.forEach((se) => { const r = map[`${s.id}:${se.id}`]; if (r) c[r.status]++; });
    summary[s.id] = Object.assign(c, { rate: rate(c) });
  });
  const totals = { present: 0, absent: 0, late: 0, excused: 0 };
  records.forEach((r) => { totals[r.status] = (totals[r.status] || 0) + 1; });
  return { sessions, students, map, summary, totals, overall: rate(totals) };
}

function canEditSession(req, session) {
  if (can(req.user, 'attendance.edit_past')) return { ok: true };
  const today = jalali.today();
  const d = String(session.date).slice(0, 10);
  if (d > today && !settings.get('attendance.allow_future', false)) return { ok: false, reason: 'ثبت حضور و غیاب برای جلسات آینده مجاز نیست.' };
  const days = Number(settings.get('attendance.edit_days', 3));
  if (jalali.diffDays(d, today) > days) return { ok: false, reason: `مهلت ثبت حضور و غیاب این جلسه (${days} روز) به پایان رسیده است.` };
  return { ok: true };
}

function mount(r) {
  r.get('/attendance', requirePerm('attendance.view', 'attendance.manage'), async (req, res) => {
    const ids = await scopeClassIds(req);
    const date = req.query.date ? jalali.fromJalali(req.query.date) || jalali.today() : jalali.today();
    const q = db('class_sessions as s').join('classes as c', 'c.id', 's.class_id')
      .whereIn('c.status', ['open', 'running', 'finished']).select('s.*', 'c.title as class_title', 'c.code', 'c.color', 'c.location').orderBy('s.start_time');
    if (req.query.class) q.where('s.class_id', int(req.query.class)).orderBy('s.date', 'desc');
    else q.where('s.date', date);
    applyClassScope(q, 'c.id', ids);
    const sessions = await q.limit(200);
    const sessionIds = sessions.map((s) => s.id);
    const recorded = {};
    if (sessionIds.length) {
      (await db('attendances').whereIn('session_id', sessionIds).groupBy('session_id', 'status').select('session_id', 'status').count({ c: '*' }))
        .forEach((x) => { recorded[x.session_id] = recorded[x.session_id] || {}; recorded[x.session_id][x.status] = Number(x.c); });
    }
    const studentCounts = {};
    const classIds = [...new Set(sessions.map((s) => s.class_id))];
    if (classIds.length) {
      (await db('enrollments').whereIn('class_id', classIds).where('status', 'active').groupBy('class_id').select('class_id').count({ c: '*' }))
        .forEach((x) => { studentCounts[x.class_id] = Number(x.c); });
    }
    const cq = db('classes').whereIn('status', ['open', 'running', 'finished']).select('id', 'title').orderBy('id', 'desc');
    applyClassScope(cq, 'id', ids);
    // سه جلسه بعدی برای دسترسی سریع
    const pendingQ = db('class_sessions as s').join('classes as c', 'c.id', 's.class_id').where('s.date', '<', jalali.today())
      .where('s.date', '>=', jalali.addDays(jalali.today(), -Number(settings.get('attendance.edit_days', 3))))
      .where('s.status', 'scheduled').whereIn('c.status', ['running', 'open']).whereNotIn('s.id', db('attendances').select('session_id'))
      .select('s.*', 'c.title as class_title').orderBy('s.date', 'desc').limit(10);
    applyClassScope(pendingQ, 'c.id', ids);
    res.page(v('index'), {
      title: 'حضور و غیاب', sessions, recorded, studentCounts, date, classes: await cq, pending: await pendingQ,
      breadcrumbs: [{ label: 'حضور و غیاب' }],
    });
  });

  r.get('/attendance/session/:id', requirePerm('attendance.view', 'attendance.manage'), async (req, res, next) => {
    const session = await db('class_sessions').where({ id: int(req.params.id) }).first();
    if (!session) return next(httpError(404, 'جلسه یافت نشد.'));
    await assertClassAccess(req, session.class_id);
    const cls = await db('classes').where({ id: session.class_id }).first();
    const students = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', cls.id)
      .whereIn('e.status', ['active', 'suspended']).select('e.id', 'e.status as enroll_status', 'u.id as user_id', 'u.first_name', 'u.last_name', 'u.avatar', 'u.mobile').orderBy('u.last_name');
    const records = {};
    (await db('attendances').where({ session_id: session.id })).forEach((r) => { records[r.enrollment_id] = r; });
    // تعداد غیبت قبلی هر دانشجو
    const absences = {};
    if (students.length) {
      (await db('attendances').whereIn('enrollment_id', students.map((s) => s.id)).where('status', 'absent').groupBy('enrollment_id').select('enrollment_id').count({ c: '*' }))
        .forEach((x) => { absences[x.enrollment_id] = Number(x.c); });
    }
    const siblings = await db('class_sessions').where({ class_id: cls.id }).whereNot('status', 'canceled').orderBy('date').select('id', 'date', 'session_no');
    const idx = siblings.findIndex((s) => s.id === session.id);
    const editable = can(req.user, 'attendance.manage') ? canEditSession(req, session) : { ok: false, reason: 'شما مجوز ثبت حضور و غیاب ندارید.' };
    res.page(v('session'), {
      title: `حضور و غیاب - ${cls.title}`, session, cls, students, records, absences, editable,
      prevSession: siblings[idx - 1], nextSession: siblings[idx + 1],
      hasRecords: Object.keys(records).length > 0,
      breadcrumbs: [{ label: 'حضور و غیاب', href: '/panel/attendance' }, { label: cls.title, href: `/panel/classes/${cls.id}?tab=attendance` }, { label: `جلسه ${session.session_no || ''}` }],
    });
  });

  r.post('/attendance/session/:id', requirePerm('attendance.manage'), async (req, res, next) => {
    const session = await db('class_sessions').where({ id: int(req.params.id) }).first();
    if (!session) return next(httpError(404));
    await assertClassAccess(req, session.class_id);
    const editable = canEditSession(req, session);
    if (!editable.ok) return next(httpError(422, editable.reason));
    const cls = await db('classes').where({ id: session.class_id }).first();
    const enrollments = await db('enrollments as e').join('users as u', 'u.id', 'e.user_id').where('e.class_id', cls.id).select('e.id', 'u.*', 'e.id as enrollment_id');
    const byId = {};
    enrollments.forEach((e) => { byId[e.enrollment_id] = e; });
    const statuses = req.body.status || {};
    const notes = req.body.note || {};
    const now = jalali.now();
    const old = {};
    (await db('attendances').where({ session_id: session.id })).forEach((r) => { old[r.enrollment_id] = r.status; });
    const changed = [];
    await db.transaction(async (trx) => {
      for (const [eid, st] of Object.entries(statuses)) {
        const enrollmentId = int(eid);
        if (!byId[enrollmentId] || !STATUSES.includes(st)) continue;
        const note = str(notes[eid], 255) || null;
        const existing = await trx('attendances').where({ session_id: session.id, enrollment_id: enrollmentId }).first();
        if (existing) await trx('attendances').where({ id: existing.id }).update({ status: st, note, recorded_by: req.user.id, recorded_at: now });
        else await trx('attendances').insert({ session_id: session.id, enrollment_id: enrollmentId, status: st, note, recorded_by: req.user.id, recorded_at: now });
        if (old[enrollmentId] !== st) changed.push({ enrollmentId, status: st });
      }
      const upd = { status: 'held', updated_at: now };
      if (req.body.topic !== undefined) upd.topic = str(req.body.topic, 255) || session.topic;
      await trx('class_sessions').where({ id: session.id }).update(upd);
    });

    // اطلاع‌رسانی پیامکی
    const notifyAbsent = bool(req.body.notify_absent);
    const notifyLate = bool(req.body.notify_late);
    const threshold = Number(settings.get('attendance.warning_threshold', 3));
    let notified = 0;
    for (const c of changed) {
      const u = byId[c.enrollmentId];
      if (c.status === 'absent') {
        const cnt = Number((await db('attendances').where({ enrollment_id: c.enrollmentId, status: 'absent' }).count({ c: '*' }).first()).c);
        if (notifyAbsent) { events.emit('attendance.absent', { user: u, cls, session, extra: { absent_count: cnt } }); notified++; }
        if (threshold > 0 && cnt === threshold) events.emit('attendance.warning', { user: u, cls, session, extra: { absent_count: cnt } });
      }
      if (c.status === 'late' && notifyLate) { events.emit('attendance.late', { user: u, cls, session }); notified++; }
    }
    events.emit('attendance.saved', { sessionId: session.id, classId: cls.id });
    await audit(req, 'attendance.save', 'session', session.id, { class_id: cls.id, changed: changed.length });
    req.flash('success', `حضور و غیاب ذخیره شد${notified ? ` و ${notified} پیامک در صف ارسال قرار گرفت` : ''}.`);
    if (req.body.next_session) return res.go(`/panel/attendance/session/${int(req.body.next_session)}`);
    res.go(`/panel/attendance/session/${session.id}`);
  });

  r.get('/attendance/class/:id.csv', requirePerm('attendance.view'), async (req, res) => {
    const id = int(req.params.id);
    await assertClassAccess(req, id);
    const cls = await db('classes').where({ id }).first();
    const m = await buildMatrix(id);
    const L = { present: 'ح', absent: 'غ', late: 'ت', excused: 'م' };
    const headers = [{ label: 'نام', value: (s) => `${s.first_name} ${s.last_name}` }];
    m.sessions.forEach((se) => headers.push({ label: `ج${se.session_no || ''} ${jalali.toJalali(se.date)}`, value: (s) => { const r = m.map[`${s.id}:${se.id}`]; return r ? L[r.status] : ''; } }));
    headers.push({ label: 'حاضر', value: (s) => m.summary[s.id].present }, { label: 'غایب', value: (s) => m.summary[s.id].absent },
      { label: 'تأخیر', value: (s) => m.summary[s.id].late }, { label: 'موجه', value: (s) => m.summary[s.id].excused },
      { label: 'درصد حضور', value: (s) => (m.summary[s.id].rate === null ? '' : m.summary[s.id].rate + '%') });
    sendCsv(res, `attendance-${cls.code}.csv`, headers, m.students);
  });
}

module.exports = { mount, buildMatrix, canEditSession };
