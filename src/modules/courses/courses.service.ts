import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { ValidationError, NotFoundError, ConflictError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export class CoursesService {
  constructor(private db: Kysely<DatabaseSchema>, private auditService?: AuditService) {}

  // 1. Course Management
  async listCourses() {
    return this.db
      .selectFrom('courses')
      .where('deleted_at', 'is', null)
      .selectAll()
      .orderBy('id', 'desc')
      .execute();
  }

  async createCourse(data: { title: string; code: string; category: string; level: string; description?: string }, actorUserId?: number) {
    const code = data.code.trim().toUpperCase();
    const existing = await this.db.selectFrom('courses').where('code', '=', code).where('deleted_at', 'is', null).select('id').executeTakeFirst();
    if (existing) {
      throw new ConflictError('دوره‌ای با این کد قبلاً ثبت شده است.');
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const result = await this.db.insertInto('courses').values({
      title: data.title.trim(),
      code,
      category: data.category.trim(),
      level: data.level.trim(),
      description: data.description || null,
      created_at: now,
      updated_at: now,
      deleted_at: null
    }).execute();

    const courseId = Number(result[0]?.insertId);
    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CREATE_COURSE',
        entityType: 'courses',
        entityId: courseId,
        newValues: { title: data.title, code }
      });
    }

    return courseId;
  }

  // 2. Class Management
  async listClasses(options: { courseId?: number; status?: string; teacherId?: number; limit?: number; offset?: number }) {
    const limit = options.limit || 30;
    const offset = options.offset || 0;

    let query = this.db
      .selectFrom('classes')
      .innerJoin('courses', 'classes.course_id', 'courses.id')
      .where('classes.deleted_at', 'is', null)
      .where('courses.deleted_at', 'is', null);

    if (options.courseId) {
      query = query.where('classes.course_id', '=', options.courseId);
    }

    if (options.status) {
      query = query.where('classes.status', '=', options.status as any);
    }

    if (options.teacherId) {
      query = query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('class_teachers')
            .whereRef('class_teachers.class_id', '=', 'classes.id')
            .where('class_teachers.teacher_id', '=', options.teacherId!)
        )
      );
    }

    const totalRes = await query.select(this.db.fn.count('classes.id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const classes = await query
      .select([
        'classes.id',
        'classes.course_id',
        'classes.title',
        'classes.code',
        'classes.capacity',
        'classes.tuition_fee',
        'classes.start_date',
        'classes.end_date',
        'classes.schedule_days',
        'classes.start_time',
        'classes.end_time',
        'classes.location',
        'classes.status',
        'classes.prereg_enabled',
        'classes.min_attendance_percent',
        'courses.title as course_title',
        'courses.category as course_category'
      ])
      .orderBy('classes.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Attach active enrollment counts and teachers
    const classesWithDetails = await Promise.all(classes.map(async (cls) => {
      const enrCountRes = await this.db
        .selectFrom('enrollments')
        .where('class_id', '=', cls.id!)
        .where('status', '=', 'active')
        .select(this.db.fn.count('id').as('count'))
        .executeTakeFirst();

      const teachers = await this.db
        .selectFrom('class_teachers')
        .innerJoin('teachers', 'class_teachers.teacher_id', 'teachers.id')
        .innerJoin('users', 'teachers.user_id', 'users.id')
        .where('class_teachers.class_id', '=', cls.id!)
        .select(['teachers.id', 'users.full_name', 'class_teachers.role_in_class'])
        .execute();

      return {
        ...cls,
        enrolledCount: Number(enrCountRes?.count || 0),
        teachers
      };
    }));

    return { classes: classesWithDetails, total, limit, offset };
  }

  async getClassById(classId: number) {
    const cls = await this.db
      .selectFrom('classes')
      .innerJoin('courses', 'classes.course_id', 'courses.id')
      .where('classes.id', '=', classId)
      .where('classes.deleted_at', 'is', null)
      .select([
        'classes.id',
        'classes.course_id',
        'classes.title',
        'classes.code',
        'classes.capacity',
        'classes.tuition_fee',
        'classes.start_date',
        'classes.end_date',
        'classes.schedule_days',
        'classes.start_time',
        'classes.end_time',
        'classes.location',
        'classes.status',
        'classes.poster_path',
        'classes.prereg_enabled',
        'classes.prereg_fields_json',
        'classes.min_attendance_percent',
        'courses.title as course_title'
      ])
      .executeTakeFirst();

    if (!cls) throw new NotFoundError('کلاس مورد نظر یافت نشد.');

    const teachers = await this.db
      .selectFrom('class_teachers')
      .innerJoin('teachers', 'class_teachers.teacher_id', 'teachers.id')
      .innerJoin('users', 'teachers.user_id', 'users.id')
      .where('class_teachers.class_id', '=', classId)
      .select(['teachers.id', 'users.full_name', 'class_teachers.role_in_class'])
      .execute();

    const enrCountRes = await this.db
      .selectFrom('enrollments')
      .where('class_id', '=', classId)
      .where('status', '=', 'active')
      .select(this.db.fn.count('id').as('count'))
      .executeTakeFirst();

    return {
      ...cls,
      teachers,
      enrolledCount: Number(enrCountRes?.count || 0)
    };
  }

  async createClass(data: {
    courseId: number;
    title: string;
    code: string;
    capacity: number;
    tuitionFee: number;
    startDate: string;
    endDate: string;
    scheduleDays: string;
    startTime: string;
    endTime: string;
    location: string;
    status?: 'draft' | 'open_for_prereg' | 'enrolling' | 'capacity_full' | 'in_progress' | 'completed' | 'cancelled';
    preregEnabled?: boolean;
    preregFields?: any;
    minAttendancePercent?: number;
    teacherIds?: { teacherId: number; role?: string }[];
  }, actorUserId?: number) {
    const code = data.code.trim().toUpperCase();
    const existing = await this.db.selectFrom('classes').where('code', '=', code).where('deleted_at', 'is', null).select('id').executeTakeFirst();
    if (existing) {
      throw new ConflictError('کلاسی با این کد یکتا قبلاً تعریف شده است.');
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const result = await this.db.insertInto('classes').values({
      course_id: data.courseId,
      title: data.title.trim(),
      code,
      capacity: data.capacity,
      tuition_fee: data.tuitionFee,
      start_date: data.startDate,
      end_date: data.endDate,
      schedule_days: data.scheduleDays.trim(),
      start_time: data.startTime.trim(),
      end_time: data.endTime.trim(),
      location: data.location.trim(),
      status: data.status || 'draft',
      poster_path: null,
      prereg_enabled: data.preregEnabled ? 1 : 0,
      prereg_fields_json: data.preregFields ? JSON.stringify(data.preregFields) : null,
      min_attendance_percent: data.minAttendancePercent || 70,
      created_at: now,
      updated_at: now,
      deleted_at: null
    }).execute();

    const classId = Number(result[0]?.insertId);

    // Assign teachers if provided
    if (data.teacherIds && data.teacherIds.length > 0) {
      for (const t of data.teacherIds) {
        await this.db.insertInto('class_teachers').values({
          class_id: classId,
          teacher_id: t.teacherId,
          role_in_class: t.role || 'primary',
          created_at: now
        }).execute();
      }
    }

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CREATE_CLASS',
        entityType: 'classes',
        entityId: classId,
        newValues: { title: data.title, code }
      });
    }

    return classId;
  }

  async assignTeacherToClass(classId: number, teacherId: number, role = 'primary', actorUserId?: number) {
    await this.getClassById(classId);

    const existing = await this.db
      .selectFrom('class_teachers')
      .where('class_id', '=', classId)
      .where('teacher_id', '=', teacherId)
      .select('id')
      .executeTakeFirst();

    if (existing) return;

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await this.db.insertInto('class_teachers').values({
      class_id: classId,
      teacher_id: teacherId,
      role_in_class: role,
      created_at: now
    }).execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'ASSIGN_TEACHER',
        entityType: 'class_teachers',
        entityId: `${classId}-${teacherId}`,
        newValues: { classId, teacherId, role }
      });
    }
  }

  async removeTeacherFromClass(classId: number, teacherId: number, actorUserId?: number) {
    await this.db
      .deleteFrom('class_teachers')
      .where('class_id', '=', classId)
      .where('teacher_id', '=', teacherId)
      .execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'UNASSIGN_TEACHER',
        entityType: 'class_teachers',
        entityId: `${classId}-${teacherId}`
      });
    }
  }
}
