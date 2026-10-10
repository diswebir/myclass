import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { StudentsService } from '../students/students.service';
import { ValidationError, NotFoundError, ConflictError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export class EnrollmentService {
  constructor(
    private db: Kysely<DatabaseSchema>,
    private studentsService: StudentsService,
    private auditService?: AuditService
  ) {}

  async enrollStudent(data: {
    studentId: number;
    classId: number;
    preregistrationId?: number;
    tuitionAgreed?: number;
    notes?: string;
  }, actorUserId?: number) {
    // 1. Verify student and class exist
    const student = await this.studentsService.getStudentById(data.studentId);
    const cls = await this.db.selectFrom('classes').where('id', '=', data.classId).where('deleted_at', 'is', null).selectAll().executeTakeFirst();
    if (!cls) throw new NotFoundError('کلاس مورد نظر یافت نشد.');

    // 2. Check for duplicate active enrollment
    const existingEnrollment = await this.db
      .selectFrom('enrollments')
      .where('student_id', '=', data.studentId)
      .where('class_id', '=', data.classId)
      .where('status', '=', 'active')
      .select('id')
      .executeTakeFirst();

    if (existingEnrollment) {
      throw new ConflictError('این فراگیر هم‌اکنون در این کلاس ثبت‌نام فعال دارد.');
    }

    // 3. Check capacity
    const enrCountRes = await this.db
      .selectFrom('enrollments')
      .where('class_id', '=', data.classId)
      .where('status', '=', 'active')
      .select(this.db.fn.count('id').as('count'))
      .executeTakeFirst();

    const currentCount = Number(enrCountRes?.count || 0);
    if (currentCount >= cls.capacity) {
      throw new ValidationError(`ظرفیت کلاس (${cls.capacity} نفر) تکمیل شده است.`);
    }

    const tuition = data.tuitionAgreed !== undefined ? data.tuitionAgreed : Number(cls.tuition_fee);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const result = await this.db.insertInto('enrollments').values({
      student_id: data.studentId,
      class_id: data.classId,
      preregistration_id: data.preregistrationId || null,
      status: 'active',
      tuition_agreed: tuition,
      notes: data.notes || null,
      created_at: now,
      updated_at: now
    }).execute();

    const enrollmentId = Number(result[0]?.insertId);

    // Update capacity status if reached full
    if (currentCount + 1 >= cls.capacity) {
      await this.db.updateTable('classes').set({ status: 'capacity_full' }).where('id', '=', data.classId).execute();
    }

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'ENROLL_STUDENT',
        entityType: 'enrollments',
        entityId: enrollmentId,
        newValues: { studentId: data.studentId, classId: data.classId, tuition }
      });
    }

    return enrollmentId;
  }

  async convertPreregistrationToEnrollment(preregistrationId: number, options?: { tuitionAgreed?: number }, actorUserId?: number) {
    const prereg = await this.db
      .selectFrom('preregistrations')
      .where('id', '=', preregistrationId)
      .selectAll()
      .executeTakeFirst();

    if (!prereg) throw new NotFoundError('درخواست پیش‌ثبت‌نام یافت نشد.');

    // 1. Find existing student by mobile or create one
    let student = await this.db
      .selectFrom('students')
      .innerJoin('users', 'students.user_id', 'users.id')
      .where('users.mobile', '=', prereg.mobile)
      .where('students.deleted_at', 'is', null)
      .select('students.id')
      .executeTakeFirst();

    let studentId: number;
    if (student && student.id) {
      studentId = student.id;
    } else {
      const created = await this.studentsService.createStudent({
        fullName: prereg.full_name,
        mobile: prereg.mobile,
        email: prereg.email || undefined
      }, actorUserId);
      studentId = created.studentId;
    }

    // 2. Perform enrollment
    const enrollmentId = await this.enrollStudent({
      studentId,
      classId: prereg.class_id,
      preregistrationId: prereg.id,
      tuitionAgreed: options?.tuitionAgreed
    }, actorUserId);

    // 3. Mark pre-registration as approved
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await this.db
      .updateTable('preregistrations')
      .set({ status: 'approved', updated_at: now })
      .where('id', '=', preregistrationId)
      .execute();

    return { enrollmentId, studentId };
  }

  async listEnrollmentsByClass(classId: number) {
    return this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'enrollments.student_id', 'students.id')
      .innerJoin('users', 'students.user_id', 'users.id')
      .where('enrollments.class_id', '=', classId)
      .select([
        'enrollments.id',
        'enrollments.student_id',
        'enrollments.class_id',
        'enrollments.status',
        'enrollments.tuition_agreed',
        'enrollments.created_at',
        'students.student_code',
        'users.full_name',
        'users.mobile'
      ])
      .orderBy('enrollments.id', 'asc')
      .execute();
  }
}
