/** پنل استاد — کلاس‌های خود، فهرست فراگیران (فیلدهای مجاز)، ثبت حضور، گزارش خود، ویرایش پروفایل (REQ-P3-02). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';

/** فیلدهای مجاز برای استاد در فهرست فراگیران (per A9 — بدون اطلاعات مالی/تماس اضافی) */
const TEACHER_STUDENT_FIELDS = [
  'students.id', 'students.code', 'students.first_name', 'students.last_name', 'students.phone', 'students.status',
] as const;

export class TeacherPanelService {
  readonly attendance: AttendanceService;
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.attendance = new AttendanceService(db);
    this.audit = new AuditService(db);
  }

  private async teacherIdOf(userId: number): Promise<number> {
    const t = await this.db
      .selectFrom('teachers')
      .select('id')
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!t) throw AppError.notFound('پرونده استاد برای این کاربر یافت نشد.');
    return Number(t.id);
  }

  /** کلاس‌های استاد (فعال). */
  async myClasses(userId: number) {
    const teacherId = await this.teacherIdOf(userId);
    return this.db
      .selectFrom('class_teachers')
      .innerJoin('classes', 'classes.id', 'class_teachers.class_id')
      .select([
        'classes.id', 'classes.code', 'classes.title', 'classes.status', 'classes.capacity',
        'classes.start_date', 'classes.end_date', 'classes.location',
      ])
      .where('class_teachers.teacher_id', '=', teacherId)
      .where('class_teachers.removed_at', 'is', null)
      .where('classes.deleted_at', 'is', null)
      .orderBy('classes.start_date')
      .execute();
  }

  /** جلسات استاد (آینده و گذشته) — جلسات خود + جلسات کلاس‌های واگذار‌شده. */
  async mySessions(userId: number, opts: { upcomingOnly?: boolean } = {}) {
    const teacherId = await this.teacherIdOf(userId);
    const assigned = await this.db
      .selectFrom('class_teachers')
      .select('class_id')
      .where('teacher_id', '=', teacherId)
      .where('removed_at', 'is', null)
      .execute();
    const classIds = assigned.map((r) => Number(r.class_id));
    let q = this.db
      .selectFrom('class_sessions')
      .innerJoin('classes', 'classes.id', 'class_sessions.class_id')
      .select([
        'class_sessions.id', 'class_sessions.session_date', 'class_sessions.start_time',
        'class_sessions.topic', 'class_sessions.status', 'class_sessions.class_id',
        'classes.title as class_title', 'classes.code as class_code',
      ])
      .where('class_sessions.deleted_at', 'is', null)
      .where('classes.deleted_at', 'is', null)
      .where((eb) =>
        classIds.length
          ? eb.or([
              eb('class_sessions.teacher_id', '=', teacherId),
              eb('class_sessions.class_id', 'in', classIds),
            ])
          : eb('class_sessions.teacher_id', '=', teacherId),
      )
      .orderBy('class_sessions.session_date', 'desc');
    if (opts.upcomingOnly) {
      const today = nowDb().slice(0, 10);
      q = q.where('class_sessions.session_date', '>=', today);
    }
    return q.execute();
  }

  /** فهرست فراگیران کلاس — فقط فیلدهای مجاز. */
  async classStudents(userId: number, classId: number) {
    const teacherId = await this.teacherIdOf(userId);
    const assigned = await this.db
      .selectFrom('class_teachers')
      .select('class_id')
      .where('class_id', '=', classId)
      .where('teacher_id', '=', teacherId)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    if (!assigned) throw AppError.forbidden('این کلاس متعلق به شما نیست.');
    return this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .select([...TEACHER_STUDENT_FIELDS, 'enrollments.id as enrollment_id', 'enrollments.status as enrollment_status'])
      .where('enrollments.class_id', '=', classId)
      .where('enrollments.status', '=', 'active')
      .where('students.deleted_at', 'is', null)
      .orderBy('students.last_name')
      .execute();
  }

  /** پروفایل استاد — ویرایش فیلدهای own. */
  async getProfile(userId: number) {
    const t = await this.db
      .selectFrom('teachers')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!t) throw AppError.notFound('پرونده استاد یافت نشد.');
    return t;
  }

  async updateProfile(userId: number, input: { phone?: string; email?: string; notes?: string }) {
    const t = await this.getProfile(userId);
    const set: Record<string, unknown> = { updated_at: nowDb() };
    if (input.phone !== undefined) {
      const { normalizePhone } = await import('../../core/security/normalize');
      const phone = normalizePhone(input.phone);
      if (!phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
      set.phone = phone;
    }
    if (input.email !== undefined) set.email = input.email || null;
    if (input.notes !== undefined) set.notes = input.notes || null;
    await this.db.updateTable('teachers').set(set).where('id', '=', Number(t.id)).execute();
    await this.audit.log({
      actorId: userId,
      action: 'teacher_profile_updated',
      module: 'teachers',
      entityType: 'teacher',
      entityId: Number(t.id),
    });
  }

  /** گزارش حضور کلاس‌های استاد — خلاصه. */
  async myReports(userId: number) {
    const classes = await this.myClasses(userId);
    const out = [];
    for (const cls of classes) {
      const report = await this.attendance.classReport(Number(cls.id));
      // محاسبه درصد حضور هر جلسه
      const sessionPercents = report.sessions.map((s) => {
        const sid = Number(s.id);
        const marks = report.students
          .map((st) => report.marks[`${sid}:${st.student_id}`])
          .filter((v) => v && v !== 'unset');
        const present = marks.filter((v) => v === 'present' || v === 'late').length;
        const total = marks.length;
        return {
          sessionId: sid,
          date: s.session_date,
          percent: total > 0 ? Math.round((present / total) * 100) : null,
        };
      });
      out.push({
        classId: Number(cls.id),
        classCode: cls.code,
        classTitle: cls.title,
        studentCount: report.students.length,
        sessionCount: report.sessions.length,
        sessionPercents,
      });
    }
    return out;
  }
}
