import { Kysely } from 'kysely';
import { DatabaseSchema, AuthUser } from '../../core/types';

export class DashboardService {
  constructor(private db: Kysely<DatabaseSchema>) {}

  async getAdminKpis(user: AuthUser) {
    // 1. Students Count
    const studentsRes = await this.db
      .selectFrom('students')
      .where('deleted_at', 'is', null)
      .select(this.db.fn.count('id').as('count'))
      .executeTakeFirst();
    const totalStudents = Number(studentsRes?.count || 0);

    // 2. Teachers Count
    const teachersRes = await this.db
      .selectFrom('teachers')
      .where('contract_status', '=', 'active')
      .select(this.db.fn.count('id').as('count'))
      .executeTakeFirst();
    const activeTeachers = Number(teachersRes?.count || 0);

    // 3. Classes by status
    const classes = await this.db
      .selectFrom('classes')
      .where('deleted_at', 'is', null)
      .select(['status'])
      .execute();

    const activeClasses = classes.filter(c => ['open_for_prereg', 'enrolling', 'in_progress'].includes(c.status)).length;

    // 4. Pending Pre-registrations
    const preregRes = await this.db
      .selectFrom('preregistrations')
      .where('status', '=', 'pending')
      .select(this.db.fn.count('id').as('count'))
      .executeTakeFirst();
    const pendingPreregistrations = Number(preregRes?.count || 0);

    // 5. Financial metrics
    const payments = await this.db.selectFrom('payments').selectAll().execute();
    const pendingReceipts = payments.filter(p => p.status === 'pending').length;
    const totalRevenue = payments
      .filter(p => p.status === 'approved')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // 6. Overdue installments
    const todayStr = new Date().toISOString().substring(0, 10);
    const installments = await this.db.selectFrom('installments').selectAll().execute();
    let overdueCount = 0;
    let overdueAmount = 0;
    for (const inst of installments) {
      if (inst.status !== 'paid' && inst.due_date < todayStr) {
        overdueCount++;
        overdueAmount += (Number(inst.amount) - Number(inst.paid_amount));
      }
    }

    // 7. Certificates issued
    const certsRes = await this.db
      .selectFrom('certificates')
      .where('status', '=', 'active')
      .select(this.db.fn.count('id').as('count'))
      .executeTakeFirst();
    const activeCertificates = Number(certsRes?.count || 0);

    return {
      totalStudents,
      activeTeachers,
      activeClasses,
      pendingPreregistrations,
      pendingReceipts,
      totalRevenue,
      overdueCount,
      overdueAmount,
      activeCertificates
    };
  }

  async getTeacherDashboard(teacherUserId: number) {
    const teacher = await this.db
      .selectFrom('teachers')
      .where('user_id', '=', teacherUserId)
      .selectAll()
      .executeTakeFirst();

    if (!teacher) return null;

    const assignedClasses = await this.db
      .selectFrom('class_teachers')
      .innerJoin('classes', 'class_teachers.class_id', 'classes.id')
      .where('class_teachers.teacher_id', '=', teacher.id!)
      .where('classes.deleted_at', 'is', null)
      .select([
        'classes.id',
        'classes.title',
        'classes.code',
        'classes.status',
        'classes.start_date',
        'classes.end_date',
        'classes.location',
        'classes.schedule_days',
        'classes.start_time',
        'classes.end_time'
      ])
      .execute();

    const classIds = assignedClasses.map(c => c.id).filter((id): id is number => typeof id === 'number');

    let totalStudents = 0;
    if (classIds.length > 0) {
      const enrRes = await this.db
        .selectFrom('enrollments')
        .where('class_id', 'in', classIds)
        .where('status', '=', 'active')
        .select(this.db.fn.count('id').as('count'))
        .executeTakeFirst();
      totalStudents = Number(enrRes?.count || 0);
    }

    return {
      teacher,
      assignedClasses,
      totalClasses: assignedClasses.length,
      totalStudents
    };
  }

  async getStudentDashboard(studentUserId: number) {
    const student = await this.db
      .selectFrom('students')
      .where('user_id', '=', studentUserId)
      .where('deleted_at', 'is', null)
      .selectAll()
      .executeTakeFirst();

    if (!student) return null;

    const enrollments = await this.db
      .selectFrom('enrollments')
      .innerJoin('classes', 'enrollments.class_id', 'classes.id')
      .where('enrollments.student_id', '=', student.id!)
      .select([
        'enrollments.id as enrollment_id',
        'enrollments.status as enrollment_status',
        'enrollments.tuition_agreed',
        'classes.id as class_id',
        'classes.title as class_title',
        'classes.start_date',
        'classes.end_date',
        'classes.location',
        'classes.schedule_days',
        'classes.start_time',
        'classes.end_time'
      ])
      .execute();

    const certificates = await this.db
      .selectFrom('certificates')
      .innerJoin('enrollments', 'certificates.enrollment_id', 'enrollments.id')
      .where('enrollments.student_id', '=', student.id!)
      .select([
        'certificates.certificate_code',
        'certificates.title',
        'certificates.course_title',
        'certificates.issue_date',
        'certificates.status'
      ])
      .execute();

    return {
      student,
      enrollments,
      certificates
    };
  }
}
