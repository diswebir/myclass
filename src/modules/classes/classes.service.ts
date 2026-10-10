/** سرویس classes — کلاس‌ها (فیلدهای کامل، کد یکتا، ظرفیت، وضعیت‌ها) + تخصیص استاد + جلسات (REQ-P2-03/04/08). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { parseJalaali } from '../../core/text/jalaali';
import { toDbDate } from '../../core/db/time';
import { AuditService } from '../audit/audit.service';

const ACTIVE_STATUSES = ['open', 'full', 'running'];

export class ClassesService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  async list(opts: { q?: string; status?: string; courseId?: number; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('classes')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('id', 'desc');
    if (opts.q) {
      q = q.where((eb) =>
        eb.or([eb('title', 'like', `%${opts.q}%`), eb('code', 'like', `%${opts.q}%`)]),
      );
    }
    if (opts.status) q = q.where('status', '=', opts.status);
    if (opts.courseId) q = q.where('course_id', '=', opts.courseId);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async getById(id: number) {
    const row = await this.db
      .selectFrom('classes')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('کلاس یافت نشد.');
    return row;
  }

  async listTeachers(classId: number) {
    await this.getById(classId);
    return this.db
      .selectFrom('class_teachers')
      .innerJoin('teachers', 'teachers.id', 'class_teachers.teacher_id')
      .select([
        'class_teachers.teacher_id', 'class_teachers.assigned_at', 'class_teachers.removed_at',
        'teachers.code', 'teachers.first_name', 'teachers.last_name', 'teachers.phone', 'teachers.status',
      ])
      .where('class_teachers.class_id', '=', classId)
      .orderBy('class_teachers.assigned_at')
      .execute();
  }

  private parseDateField(v: string | undefined | null): string | null {
    if (!v) return null;
    const d = parseJalaali(v);
    if (!d) throw AppError.badRequest(`تاریخ نامعتبر است (شمسی): ${v}`);
    return toDbDate(d);
  }

  async create(actor: AuthUser, input: {
    courseId?: number | null;
    title: string;
    code: string;
    description?: string;
    type?: string;
    category?: string;
    level?: string;
    capacity: number;
    fee: string;
    startDate?: string;
    endDate?: string;
    weekdays: number[];
    startTime?: string;
    endTime?: string;
    location?: string;
    status: string;
    preregEnabled: number;
    preregDeadline?: string;
    prerequisites?: string;
    cancellationPolicy?: string;
  }) {
    const exists = await this.db
      .selectFrom('classes')
      .select('id')
      .where('code', '=', input.code.trim())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (exists) throw AppError.conflict('کد کلاس تکراری است.');
    const startDate = this.parseDateField(input.startDate);
    const endDate = this.parseDateField(input.endDate);
    const preregDeadline = this.parseDateField(input.preregDeadline);
    if (startDate && endDate && endDate < startDate) {
      throw AppError.badRequest('تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد.');
    }
    const res = await this.db
      .insertInto('classes')
      .values({
        course_id: input.courseId ?? null,
        title: input.title.trim(),
        code: input.code.trim(),
        description: input.description || null,
        type: input.type || null,
        category: input.category || null,
        level: input.level || null,
        capacity: input.capacity,
        fee: input.fee,
        start_date: startDate,
        end_date: endDate,
        weekdays: JSON.stringify(input.weekdays),
        start_time: input.startTime || null,
        end_time: input.endTime || null,
        location: input.location || null,
        status: input.status,
        prereg_enabled: input.preregEnabled,
        prereg_deadline: preregDeadline,
        prerequisites: input.prerequisites || null,
        cancellation_policy: input.cancellationPolicy || null,
        created_by: actor.id,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'class_created',
      module: 'classes',
      entityType: 'class',
      entityId: id,
      meta: { code: input.code, title: input.title },
    });
    return id;
  }

  async update(actor: AuthUser, id: number, input: Partial<Parameters<ClassesService['create']>[1]>) {
    const cls = await this.getById(id);
    const set: Record<string, unknown> = { updated_at: nowDb() };
    if (input.title !== undefined) set.title = input.title.trim();
    if (input.description !== undefined) set.description = input.description || null;
    if (input.type !== undefined) set.type = input.type || null;
    if (input.category !== undefined) set.category = input.category || null;
    if (input.level !== undefined) set.level = input.level || null;
    if (input.capacity !== undefined) set.capacity = input.capacity;
    if (input.fee !== undefined) set.fee = input.fee;
    if (input.startDate !== undefined) set.start_date = this.parseDateField(input.startDate);
    if (input.endDate !== undefined) set.end_date = this.parseDateField(input.endDate);
    if (input.weekdays !== undefined) set.weekdays = JSON.stringify(input.weekdays);
    if (input.startTime !== undefined) set.start_time = input.startTime || null;
    if (input.endTime !== undefined) set.end_time = input.endTime || null;
    if (input.location !== undefined) set.location = input.location || null;
    if (input.status !== undefined) set.status = input.status;
    if (input.preregEnabled !== undefined) set.prereg_enabled = input.preregEnabled;
    if (input.preregDeadline !== undefined) set.prereg_deadline = this.parseDateField(input.preregDeadline);
    if (input.prerequisites !== undefined) set.prerequisites = input.prerequisites || null;
    if (input.cancellationPolicy !== undefined) set.cancellation_policy = input.cancellationPolicy || null;
    await this.db.updateTable('classes').set(set).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'class_updated',
      module: 'classes',
      entityType: 'class',
      entityId: id,
      meta: { status: input.status ?? cls.status },
    });
  }

  /** تخصیص استاد — چند استاد برای هر کلاس (REQ-P2-08). */
  async assignTeacher(actor: AuthUser, classId: number, teacherId: number) {
    await this.getById(classId);
    const teacher = await this.db
      .selectFrom('teachers')
      .select('id')
      .where('id', '=', teacherId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!teacher) throw AppError.notFound('استاد فعال یافت نشد.');
    const existing = await this.db
      .selectFrom('class_teachers')
      .selectAll()
      .where('class_id', '=', classId)
      .where('teacher_id', '=', teacherId)
      .executeTakeFirst();
    if (existing) {
      if (existing.removed_at) {
        // فعال‌سازی دوباره تخصیص قبلی
        await this.db
          .updateTable('class_teachers')
          .set({ removed_at: null, assigned_at: nowDb(), assigned_by: actor.id })
          .where('class_id', '=', classId)
          .where('teacher_id', '=', teacherId)
          .execute();
      } else {
        throw AppError.conflict('این استاد قبلاً به کلاس تخصیص یافته است.');
      }
    } else {
      await this.db
        .insertInto('class_teachers')
        .values({ class_id: classId, teacher_id: teacherId, assigned_at: nowDb(), assigned_by: actor.id })
        .execute();
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'class_teacher_assigned',
      module: 'classes',
      entityType: 'class',
      entityId: classId,
      meta: { teacherId },
    });
  }

  /** برداشتن تخصیص استاد — تاریخچه (حضور/جلسات) حفظ می‌شود؛ ردیف حذف نمی‌شود (removed_at). */
  async removeTeacher(actor: AuthUser, classId: number, teacherId: number) {
    const existing = await this.db
      .selectFrom('class_teachers')
      .selectAll()
      .where('class_id', '=', classId)
      .where('teacher_id', '=', teacherId)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    if (!existing) throw AppError.notFound('تخصیص یافت نشد.');
    await this.db
      .updateTable('class_teachers')
      .set({ removed_at: nowDb() })
      .where('class_id', '=', classId)
      .where('teacher_id', '=', teacherId)
      .execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'class_teacher_removed',
      module: 'classes',
      entityType: 'class',
      entityId: classId,
      meta: { teacherId },
    });
  }

  async enrolledCount(classId: number): Promise<number> {
    const row = await this.db
      .selectFrom('enrollments')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('class_id', '=', classId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** تغییر وضعیت — با کنترل (running نیاز به سبت‌نام فعال دارد). */
  async setStatus(actor: AuthUser, classId: number, status: string) {
    const cls = await this.getById(classId);
    if (status === 'open' || status === 'running') {
      const count = await this.enrolledCount(classId);
      if (status === 'running' && count === 0) {
        throw AppError.badRequest('کلاس سبت‌نام فعالی ندارد؛ نمی‌توان «در حال برگزاری» کرد.');
      }
    }
    await this.db.updateTable('classes').set({ status, updated_at: nowDb() }).where('id', '=', classId).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'class_status_changed',
      module: 'classes',
      entityType: 'class',
      entityId: classId,
      meta: { from: cls.status, to: status },
    });
  }

  async softDelete(actor: AuthUser, id: number) {
    await this.getById(id);
    const active = await this.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', id)
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();
    if (active) {
      throw AppError.conflict('کلاس سبت‌نام فعال دارد؛ ابتدا سبت‌نام‌ها را لغو کنید.');
    }
    await this.db.updateTable('classes').set({ deleted_at: nowDb(), status: 'cancelled', updated_at: nowDb() }).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'class_deleted',
      module: 'classes',
      entityType: 'class',
      entityId: id,
    });
  }

  // ---------- جلسات ----------

  async listSessions(classId: number, opts: { from?: string; to?: string } = {}) {
    await this.getById(classId);
    let q = this.db
      .selectFrom('class_sessions')
      .selectAll()
      .where('class_id', '=', classId)
      .where('deleted_at', 'is', null)
      .orderBy('session_date')
      .orderBy('start_time');
    if (opts.from) q = q.where('session_date', '>=', opts.from);
    if (opts.to) q = q.where('session_date', '<=', opts.to);
    return q.execute();
  }

  /** Wizard: تضاد زمانی استاد/مکان شناسایی می‌شود (REQ-P2-04). */
  async findConflicts(input: {
    classId: number;
    sessionDate: string;
    startTime?: string;
    durationMinutes?: number;
    teacherId?: number | null;
    location?: string | null;
    excludeSessionId?: number;
  }): Promise<{ teacherConflicts: unknown[]; locationConflicts: unknown[] }> {
    const cls = await this.getById(input.classId);
    const startTime = input.startTime || cls.start_time || '00:00';
    const duration = input.durationMinutes ?? 90;
    const startMinutes = this.timeToMinutes(startTime);
    const endMinutes = startMinutes + duration;
    // جلسات همان روز
    let q = this.db
      .selectFrom('class_sessions')
      .innerJoin('classes', 'classes.id', 'class_sessions.class_id')
      .select([
        'class_sessions.id', 'class_sessions.class_id', 'class_sessions.session_date',
        'class_sessions.start_time', 'class_sessions.duration_minutes',
        'class_sessions.teacher_id', 'class_sessions.status',
        'classes.title as class_title', 'classes.location',
      ])
      .where('class_sessions.session_date', '=', input.sessionDate)
      .where('class_sessions.deleted_at', 'is', null)
      .where('class_sessions.status', '!=', 'cancelled');
    if (input.excludeSessionId) q = q.where('class_sessions.id', '!=', input.excludeSessionId);
    const sameDay = await q.execute();

    const teacherId = input.teacherId ?? null;
    const location = input.location ?? cls.location ?? null;

    const teacherConflicts: unknown[] = [];
    const locationConflicts: unknown[] = [];
    for (const s of sameDay) {
      const sStart = this.timeToMinutes(s.start_time || '00:00');
      const sEnd = sStart + (Number(s.duration_minutes) || 90);
      const overlap = sStart < endMinutes && startMinutes < sEnd;
      if (!overlap) continue;
      if (teacherId && s.teacher_id && Number(s.teacher_id) === Number(teacherId)) {
        teacherConflicts.push(s);
      }
      if (location && s.location && s.location === location) {
        locationConflicts.push(s);
      }
    }
    return { teacherConflicts, locationConflicts };
  }

  private timeToMinutes(t: string): number {
    const m = t.match(/^(\d{2}):(\d{2})/);
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  async createSession(actor: AuthUser, classId: number, input: {
    sessionDate: string;
    startTime?: string;
    durationMinutes?: number;
    topic?: string;
    teacherId?: number | null;
    status: string;
    statusNote?: string;
  }) {
    const cls = await this.getById(classId);
    const d = parseJalaali(input.sessionDate);
    if (!d) throw AppError.badRequest('تاریخ جلسه نامعتبر است (شمسی).');
    const sessionDate = toDbDate(d);
    // اگر استاد جلسه همان کلاس است یاakat tepisi — warning
    const conflicts = await this.findConflicts({
      classId,
      sessionDate,
      startTime: input.startTime || undefined,
      durationMinutes: input.durationMinutes,
      teacherId: input.teacherId ?? null,
      location: cls.location,
    });
    const res = await this.db
      .insertInto('class_sessions')
      .values({
        class_id: classId,
        session_date: sessionDate,
        start_time: input.startTime || null,
        duration_minutes: input.durationMinutes ?? null,
        topic: input.topic || null,
        teacher_id: input.teacherId ?? null,
        status: input.status,
        status_note: input.statusNote || null,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'session_created',
      module: 'classes',
      entityType: 'class_session',
      entityId: id,
      meta: { classId, sessionDate, conflicts: conflicts.teacherConflicts.length + conflicts.locationConflicts.length },
    });
    return { id, conflicts };
  }

  async updateSession(actor: AuthUser, sessionId: number, input: Partial<{
    sessionDate: string;
    startTime: string;
    durationMinutes: number;
    topic: string;
    teacherId: number | null;
    status: string;
    statusNote: string;
  }>) {
    const session = await this.db
      .selectFrom('class_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!session) throw AppError.notFound('جلسه یافت نشد.');
    const set: Record<string, unknown> = { updated_at: nowDb() };
    if (input.sessionDate !== undefined) {
      const d = parseJalaali(input.sessionDate);
      if (!d) throw AppError.badRequest('تاریخ جلسه نامعتبر است (شمسی).');
      set.session_date = toDbDate(d);
    }
    if (input.startTime !== undefined) set.start_time = input.startTime || null;
    if (input.durationMinutes !== undefined) set.duration_minutes = input.durationMinutes ?? null;
    if (input.topic !== undefined) set.topic = input.topic || null;
    if (input.teacherId !== undefined) set.teacher_id = input.teacherId ?? null;
    if (input.status !== undefined) set.status = input.status;
    if (input.statusNote !== undefined) set.status_note = input.statusNote || null;
    await this.db.updateTable('class_sessions').set(set).where('id', '=', sessionId).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'session_updated',
      module: 'classes',
      entityType: 'class_session',
      entityId: sessionId,
    });
  }
}
