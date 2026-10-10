/** سرویس attendance — جلسه‌محور، ۵ وضعیت، سبت سریع، یکتایی (جلسه، فراگیر)، اصلاح با audit، گزارش، درصد، هشدار غیبت (REQ-P3-01). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { AuditService } from '../audit/audit.service';
import { upsertByKey } from '../../core/db/upsert';
import type { AttendanceStatus } from './attendance.schemas';

export class AttendanceService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  private async getSession(sessionId: number) {
    const session = await this.db
      .selectFrom('class_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!session) throw AppError.notFound('جلسه یافت نشد.');
    return session;
  }

  /** سبت/اصلاح حضور — upsert per (session_id, student_id) — اصلاح با audit. */
  async markSession(actor: AuthUser, sessionId: number, entries: Array<{ studentId: number; status: AttendanceStatus; note?: string }>) {
    const session = await this.getSession(sessionId);
    const classId = Number(session.class_id);
    //Membership: همه studentIdها باید در کلاس سبت‌نام فعال داشته باشند
    const ids = entries.map((e) => e.studentId);
    const enrolled = await this.db
      .selectFrom('enrollments')
      .select('student_id')
      .where('class_id', '=', classId)
      .where('status', '=', 'active')
      .where('student_id', 'in', ids)
      .execute();
    const enrolledIds = new Set(enrolled.map((r) => Number(r.student_id)));
    const notEnrolled = ids.filter((id) => !enrolledIds.has(id));
    if (notEnrolled.length) {
      throw AppError.badRequest(`این فراگیران در کلاس سبت‌نام فعال ندارند: ${notEnrolled.join(', ')}`);
    }
    let marked = 0;
    let corrected = 0;
    for (const e of entries) {
      const existing = await this.db
        .selectFrom('attendance')
        .selectAll()
        .where('session_id', '=', sessionId)
        .where('student_id', '=', e.studentId)
        .executeTakeFirst();
      // 'unset' یعنی «حذف علامت» — رکورد موجود پاک می‌شود (رکورد 'unset' ذخیره نمی‌شود)
      if (e.status === 'unset') {
        if (existing) {
          await this.db.deleteFrom('attendance').where('id', '=', Number(existing.id)).execute();
          corrected++;
          await this.audit.log({
            actorId: actor.id,
            action: 'attendance_corrected',
            module: 'attendance',
            entityType: 'attendance',
            entityId: Number(existing.id),
            meta: { sessionId, studentId: e.studentId, from: existing.status, to: 'unset' },
          });
        }
        continue;
      }
      if (existing) {
        const newNote = e.note || null;
        // بدون تغییر → رد شود (idempotent — فرم HTML همه‌ی سطرها را می‌فرستد)
        if (existing.status === e.status && (existing.note ?? null) === newNote) continue;
        await this.db
          .updateTable('attendance')
          .set({
            status: e.status,
            note: newNote,
            updated_by: actor.id,
            updated_at: nowDb(),
          })
          .where('id', '=', Number(existing.id))
          .execute();
        corrected++;
        await this.audit.log({
          actorId: actor.id,
          action: 'attendance_corrected',
          module: 'attendance',
          entityType: 'attendance',
          entityId: Number(existing.id),
          meta: { sessionId, studentId: e.studentId, from: existing.status, to: e.status },
        });
      } else {
        await this.db
          .insertInto('attendance')
          .values({
            session_id: sessionId,
            student_id: e.studentId,
            status: e.status,
            note: e.note || null,
            marked_by: actor.id,
            marked_at: nowDb(),
            created_at: nowDb(),
          })
          .execute();
        marked++;
      }
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'attendance_marked',
      module: 'attendance',
      entityType: 'class_session',
      entityId: sessionId,
      meta: { classId, marked, corrected },
    });
    return { marked, corrected };
  }

  async listSession(sessionId: number) {
    await this.getSession(sessionId);
    return this.db
      .selectFrom('attendance')
      .innerJoin('students', 'students.id', 'attendance.student_id')
      .select([
        'attendance.id', 'attendance.session_id', 'attendance.student_id', 'attendance.status',
        'attendance.note', 'attendance.marked_at', 'attendance.updated_at',
        'students.code', 'students.first_name', 'students.last_name', 'students.phone',
      ])
      .where('attendance.session_id', '=', sessionId)
      .orderBy('students.last_name')
      .execute();
  }

  /** فهرست فراگیران کلاس برای سبت سریع (status فعلی جلسه — اگر وجود داشته باشد unset). */
  async classSessionRoster(classId: number, sessionId: number) {
    const session = await this.getSession(sessionId);
    if (Number(session.class_id) !== classId) {
      throw AppError.badRequest('جلسه متعلق به این کلاس نیست.');
    }
    const rows = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .leftJoin('attendance', (join) =>
        join.onRef('attendance.student_id', '=', 'enrollments.student_id').on('attendance.session_id', '=', sessionId),
      )
      .select([
        'students.id as student_id', 'students.code', 'students.first_name', 'students.last_name',
        'attendance.status as current_status', 'attendance.id as attendance_id',
      ])
      .where('enrollments.class_id', '=', classId)
      .where('enrollments.status', '=', 'active')
      .where('students.deleted_at', 'is', null)
      .orderBy('students.last_name')
      .execute();
    return rows.map((r) => ({
      ...r,
      current_status: r.current_status ?? 'unset',
    }));
  }

  /** گزارش حضور یک فراگیر — درصد + فهرست. */
  async studentReport(studentId: number) {
    const rows = await this.db
      .selectFrom('attendance')
      .innerJoin('class_sessions', 'class_sessions.id', 'attendance.session_id')
      .innerJoin('classes', 'classes.id', 'class_sessions.class_id')
      .select([
        'attendance.status', 'attendance.session_id', 'attendance.marked_at',
        'class_sessions.session_date', 'class_sessions.class_id',
        'classes.title as class_title', 'classes.code as class_code',
      ])
      .where('attendance.student_id', '=', studentId)
      .where('class_sessions.deleted_at', 'is', null)
      .where('attendance.status', '!=', 'unset')
      .orderBy('class_sessions.session_date')
      .execute();
    const total = rows.length;
    const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
    const absent = rows.filter((r) => r.status === 'absent').length;
    const excused = rows.filter((r) => r.status === 'excused').length;
    const percent = total > 0 ? Math.round((present / total) * 100) : 0;
    return { rows, total, present, absent, excused, percent };
  }

  /** گزارش حضور کلاس — ماتریس (جلسه × فراگیر). */
  async classReport(classId: number) {
    const sessions = await this.db
      .selectFrom('class_sessions')
      .select(['id', 'session_date', 'start_time', 'topic', 'status'])
      .where('class_id', '=', classId)
      .where('deleted_at', 'is', null)
      .orderBy('session_date')
      .execute();
    const students = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .select(['students.id as student_id', 'students.code', 'students.first_name', 'students.last_name'])
      .where('enrollments.class_id', '=', classId)
      .where('enrollments.status', '=', 'active')
      .where('students.deleted_at', 'is', null)
      .orderBy('students.last_name')
      .execute();
    const sessionIds = sessions.map((s) => Number(s.id));
    const marks = sessionIds.length
      ? await this.db
          .selectFrom('attendance')
          .select(['session_id', 'student_id', 'status'])
          .where('session_id', 'in', sessionIds)
          .execute()
      : [];
    const markMap = new Map<string, string>();
    for (const m of marks) markMap.set(`${m.session_id}:${m.student_id}`, m.status);
    return {
      sessions,
      students,
      marks: Object.fromEntries(markMap),
    };
  }

  /** هشدار حد غیبت — از تنظیمات attendance.max_absence_warn. */
  async absenceWarnings(maxAbsence: number) {
    const rows = await this.db
      .selectFrom('attendance')
      .select(['student_id'])
      .select((eb) => eb.fn.countAll().as('absent_count'))
      .where('status', '=', 'absent')
      .groupBy('student_id')
      .having((eb) => eb.fn.countAll(), '>=', maxAbsence)
      .execute();
    const ids = rows.map((r) => Number(r.student_id));
    if (!ids.length) return [];
    const students = await this.db
      .selectFrom('students')
      .selectAll()
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .execute();
    const byId = new Map(students.map((s) => [Number(s.id), s]));
    return rows.map((r) => ({
      student: byId.get(Number(r.student_id)),
      absentCount: Number(r.absent_count),
    }));
  }
}
