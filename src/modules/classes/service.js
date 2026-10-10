'use strict';
/** سرویس کلاس‌ها: ثبت‌نام، تولید جلسات، آمار */
const { db, insertId } = require('../../core/db');
const settings = require('../../core/settings');
const jalali = require('../../core/jalali');
const events = require('../../core/events');
const { httpError } = require('../../core/utils');

async function activeCount(classId, trx) {
  const row = await (trx || db)('enrollments').where({ class_id: classId }).whereIn('status', ['active', 'completed']).count({ c: '*' }).first();
  return Number(row.c);
}

/** ثبت‌نام دانشجو در کلاس */
async function enroll(classId, userId, { actorId = null, source = 'admin', force = false, notify = true, trx = null } = {}) {
  const q = trx || db;
  const cls = await q('classes').where({ id: classId }).first();
  if (!cls) throw httpError(404, 'کلاس یافت نشد.');
  const user = await q('users').where({ id: userId }).first();
  if (!user) throw httpError(404, 'کاربر یافت نشد.');
  const exists = await q('enrollments').where({ class_id: classId, user_id: userId }).first();
  if (exists) {
    if (exists.status === 'withdrawn') {
      await q('enrollments').where({ id: exists.id }).update({ status: 'active', updated_at: jalali.now() });
      return exists.id;
    }
    throw httpError(422, `${user.first_name} ${user.last_name} قبلاً در این کلاس ثبت‌نام شده است.`);
  }
  if (cls.capacity > 0 && !force && !settings.get('classes.allow_over_capacity', false)) {
    const n = await activeCount(classId, trx);
    if (n >= cls.capacity) throw httpError(422, `ظرفیت کلاس «${cls.title}» تکمیل است (${cls.capacity} نفر).`);
  }
  const now = jalali.now();
  const id = await insertId('enrollments', {
    class_id: classId, user_id: userId, status: 'active', enrolled_at: jalali.today(), source, created_by: actorId, created_at: now, updated_at: now,
  }, trx);
  if (notify) events.emit('enrollment.created', { enrollmentId: id, user, cls });
  return id;
}

/** تولید خودکار جلسات بر اساس روزهای هفته و بازه تاریخ کلاس */
async function generateSessions(classId, { replace = false } = {}) {
  const cls = await db('classes').where({ id: classId }).first();
  if (!cls) throw httpError(404);
  if (!cls.start_date || !cls.end_date || !cls.week_days) throw httpError(422, 'برای تولید جلسات، تاریخ شروع و پایان و روزهای برگزاری کلاس را مشخص کنید.');
  const days = String(cls.week_days).split(',').filter((x) => x !== '').map(Number);
  if (!days.length) throw httpError(422, 'روزهای برگزاری کلاس مشخص نشده است.');
  const total = jalali.diffDays(cls.start_date, cls.end_date);
  if (total < 0) throw httpError(422, 'تاریخ پایان باید بعد از تاریخ شروع باشد.');
  if (total > 1500) throw httpError(422, 'بازه زمانی کلاس بیش از حد طولانی است.');

  return db.transaction(async (trx) => {
    if (replace) {
      const withAtt = trx('attendances').select('session_id');
      await trx('class_sessions').where({ class_id: classId, status: 'scheduled' }).whereNotIn('id', withAtt).del();
    }
    const existing = new Set((await trx('class_sessions').where({ class_id: classId }).pluck('date')).map((d) => String(d).slice(0, 10)));
    const now = jalali.now();
    const rows = [];
    for (let i = 0; i <= total; i++) {
      const d = jalali.addDays(cls.start_date, i);
      if (!days.includes(jalali.weekday(d))) continue;
      if (existing.has(d)) continue;
      rows.push({ class_id: classId, date: d, start_time: cls.start_time, end_time: cls.end_time, status: 'scheduled', created_at: now, updated_at: now });
    }
    for (let i = 0; i < rows.length; i += 100) await trx('class_sessions').insert(rows.slice(i, i + 100));
    await renumber(classId, trx);
    return rows.length;
  });
}

async function renumber(classId, trx) {
  const q = trx || db;
  const list = await q('class_sessions').where({ class_id: classId }).orderBy([{ column: 'date' }, { column: 'start_time' }, { column: 'id' }]).select('id', 'status');
  let n = 0;
  for (const s of list) {
    n += s.status === 'canceled' ? 0 : 1;
    await q('class_sessions').where({ id: s.id }).update({ session_no: s.status === 'canceled' ? null : n });
  }
}

/** آمار خلاصه برای مجموعه‌ای از کلاس‌ها */
async function classStats(classIds) {
  const out = {};
  if (!classIds.length) return out;
  classIds.forEach((id) => { out[id] = { students: 0, sessions: 0, held: 0, teachers: [] }; });
  (await db('enrollments').whereIn('class_id', classIds).whereIn('status', ['active', 'completed']).groupBy('class_id').select('class_id').count({ c: '*' }))
    .forEach((x) => { out[x.class_id].students = Number(x.c); });
  (await db('class_sessions').whereIn('class_id', classIds).whereNot('status', 'canceled').groupBy('class_id').select('class_id').count({ c: '*' }))
    .forEach((x) => { out[x.class_id].sessions = Number(x.c); });
  (await db('class_sessions').whereIn('class_id', classIds).where(function () {
    this.where('status', 'held').orWhere(function () { this.where('status', 'scheduled').where('date', '<', jalali.today()); });
  }).groupBy('class_id').select('class_id').count({ c: '*' }))
    .forEach((x) => { out[x.class_id].held = Number(x.c); });
  (await db('class_teachers as ct').join('users as u', 'u.id', 'ct.user_id').whereIn('ct.class_id', classIds)
    .select('ct.class_id', 'u.id', 'u.first_name', 'u.last_name', 'u.avatar'))
    .forEach((x) => { out[x.class_id].teachers.push(x); });
  return out;
}

function weekDaysLabel(str) {
  if (!str) return '';
  const days = String(str).split(',').filter((x) => x !== '').map(Number);
  return jalali.WEEK_ORDER.filter((d) => days.includes(d)).map((d) => jalali.weekdayName(d)).join('، ');
}

async function nextCode() {
  const prefix = settings.get('classes.code_prefix', 'CL-');
  const last = await db('classes').max({ m: 'id' }).first();
  let n = Number((last && last.m) || 0) + 1;
  let code = `${prefix}${String(n).padStart(4, '0')}`;
  while (await db('classes').where({ code }).first()) {
    n++;
    code = `${prefix}${String(n).padStart(4, '0')}`;
  }
  return code;
}

module.exports = { enroll, generateSessions, renumber, classStats, weekDaysLabel, nextCode, activeCount };
