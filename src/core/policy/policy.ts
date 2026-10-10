/**
 * Policy Layer مرکزی — بررسی «مجوز + مالکیت/عضویت» برای هر منبع.
 * همه سرویس‌ها از این لایه استفاده می‌کنند (per spec §۶-پ).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { AppError } from '../errors/AppError';
import type { AuthUser } from '../http/context';
import { hasPermission } from '../http/context';

export class Policy {
  constructor(private readonly db: Kysely<Database>) {}

  /** بررسی مجوز — پرتاب AppError(403) در صورت فقدان. */
  require(user: AuthUser | undefined, module: string, resource: string, action: string): void {
    if (!user) throw AppError.unauthorized();
    if (!hasPermission(user, module, resource, action)) {
      throw AppError.forbidden();
    }
  }

  /** آیا کاربر license دارد (بدون پرتاب) */
  can(user: AuthUser | undefined, module: string, resource: string, action: string): boolean {
    return !!user && hasPermission(user, module, resource, action);
  }

  // ---------- مالکیت/عضویت ----------

  private async classTeacherIds(classId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('class_teachers')
      .select('teacher_id')
      .where('class_id', '=', classId)
      .where('removed_at', 'is', null)
      .execute();
    return rows.map((r) => Number(r.teacher_id));
  }

  /**
   * کلاس باید موجود باشد و کاربر یا license (manage_all) یا استاد آن کلاس باشد.
   * akademic/admin: manage_all — استاد: مالکیت — در غیر این صورت اگر action داده شده باشد،
   * مجوز همان action بررسی می‌شود (و در نهایت 403).
   */
  async assertClassAccess(user: AuthUser, classId: number, opts: { action?: string } = {}): Promise<void> {
    if (this.can(user, 'classes', 'classes', 'manage_all')) return;
    const cls = await this.db
      .selectFrom('classes')
      .select(['id', 'deleted_at'])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (!cls || cls.deleted_at) throw AppError.notFound('کلاس یافت نشد.');
    // استاد کلاس?
    const teacher = await this.db
      .selectFrom('teachers')
      .select('id')
      .where('user_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (teacher) {
      const ids = await this.classTeacherIds(classId);
      if (ids.includes(Number(teacher.id))) return;
    }
    // نه license، نه استاد کلاس — بررسی مجوز action (در صورت فقدان → 403)
    if (opts.action) this.require(user, 'classes', 'classes', opts.action);
    throw AppError.forbidden();
  }

  /** دسترسی به فراگیر: license یا خود فراگیر یا استاد کلاس‌های او. */
  async assertStudentAccess(user: AuthUser, studentId: number): Promise<void> {
    if (this.can(user, 'students', 'students', 'view_all')) return;
    // خود فراگیر?
    const self = await this.db
      .selectFrom('students')
      .select('id')
      .where('id', '=', studentId)
      .where('user_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (self) return;
    // استاد کلاس‌های این فراگیر?
    const teacher = await this.db
      .selectFrom('teachers')
      .select('id')
      .where('user_id', '=', user.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (teacher) {
      const row = await this.db
        .selectFrom('enrollments')
        .innerJoin('class_teachers', 'class_teachers.class_id', 'enrollments.class_id')
        .select('enrollments.id')
        .where('enrollments.student_id', '=', studentId)
        .where('class_teachers.teacher_id', '=', Number(teacher.id))
        .where('class_teachers.removed_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      if (row) return;
    }
    throw AppError.forbidden();
  }

  /** دسترسی به سبت‌نام (enrollment): از طریق student یا class. */
  async assertEnrollmentAccess(user: AuthUser, enrollmentId: number): Promise<void> {
    if (this.can(user, 'enrollment', 'enrollment', 'view_all')) return;
    const enr = await this.db
      .selectFrom('enrollments')
      .select(['id', 'student_id', 'class_id'])
      .where('id', '=', enrollmentId)
      .executeTakeFirst();
    if (!enr) throw AppError.notFound('سبت‌نام یافت نشد.');
    await this.assertStudentAccess(user, Number(enr.student_id));
    await this.assertClassAccess(user, Number(enr.class_id));
  }

  /** دسترسی به پرداخت: license مالی یا خود فراگیر. */
  async assertPaymentAccess(user: AuthUser, paymentId: number): Promise<void> {
    if (this.can(user, 'finance', 'payments', 'view_all')) return;
    const pay = await this.db
      .selectFrom('payments')
      .select(['id', 'student_id'])
      .where('id', '=', paymentId)
      .executeTakeFirst();
    if (!pay) throw AppError.notFound('پرداخت یافت نشد.');
    await this.assertStudentAccess(user, Number(pay.student_id));
  }

  /** دسترسی به فایل: license یا مالک فایل. */
  async assertFileAccess(user: AuthUser, fileId: number): Promise<void> {
    if (this.can(user, 'files', 'files', 'download_all')) return;
    const file = await this.db
      .selectFrom('files')
      .select(['id', 'owner_type', 'owner_id', 'uploaded_by', 'deleted_at'])
      .where('id', '=', fileId)
      .executeTakeFirst();
    if (!file || file.deleted_at) throw AppError.notFound('فایل یافت نشد.');
    if (file.uploaded_by !== null && Number(file.uploaded_by) === user.id) return;
    if (file.owner_type === 'student') {
      await this.assertStudentAccess(user, Number(file.owner_id));
      return;
    }
    if (file.owner_type === 'teacher') {
      const t = await this.db
        .selectFrom('teachers')
        .select('id')
        .where('user_id', '=', user.id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (t && Number(t.id) === Number(file.owner_id)) return;
    }
    throw AppError.forbidden();
  }

  /** دسترسی به مدرک: license یا خود فراگیر. */
  async assertCertificateAccess(user: AuthUser, certificateId: number): Promise<void> {
    if (this.can(user, 'certificates', 'certificates', 'view_all')) return;
    const cert = await this.db
      .selectFrom('certificates')
      .select(['id', 'student_id'])
      .where('id', '=', certificateId)
      .executeTakeFirst();
    if (!cert) throw AppError.notFound('مدرک یافت نشد.');
    await this.assertStudentAccess(user, Number(cert.student_id));
  }

  /** جلوگیری از خودارتقایی: کاربر نمی‌تواند نقش/مجوز خود را تغییر دهد مگر license rbac داشته باشد. */
  assertCanManageRbac(user: AuthUser): void {
    this.require(user, 'rbac', 'roles', 'update');
  }
}
