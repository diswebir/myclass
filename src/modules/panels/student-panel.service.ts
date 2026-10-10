/** پنل فراگیر — پروفایل، کلاس‌ها، برنامه، حضور، مالی، آپلود رسید، مدارک، تغییر رمز (REQ-P3-03). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { AttendanceService } from '../attendance/attendance.service';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { FilesService } from '../files/files.service';
import type { Config } from '../../core/config/env';
import { AuditService } from '../audit/audit.service';

export class StudentPanelService {
  readonly attendance: AttendanceService;
  readonly enrollment: EnrollmentService;
  readonly files: FilesService;
  readonly audit: AuditService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.attendance = new AttendanceService(db);
    this.enrollment = new EnrollmentService(db);
    this.files = new FilesService(db, config);
    this.audit = new AuditService(db);
  }

  private async studentIdOf(userId: number): Promise<number> {
    const s = await this.db
      .selectFrom('students')
      .select('id')
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!s) throw AppError.notFound('پرونده فراگیر برای این کاربر یافت نشد.');
    return Number(s.id);
  }

  async getProfile(userId: number) {
    const studentId = await this.studentIdOf(userId);
    return this.db
      .selectFrom('students')
      .selectAll()
      .where('id', '=', studentId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
  }

  async updateProfile(userId: number, input: { phone?: string; email?: string; guardianName?: string; guardianPhone?: string; notes?: string }) {
    const studentId = await this.studentIdOf(userId);
    const set: Record<string, unknown> = { updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    if (input.phone !== undefined) {
      const { normalizePhone } = await import('../../core/security/normalize');
      const phone = normalizePhone(input.phone);
      if (!phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
      set.phone = phone;
    }
    if (input.email !== undefined) set.email = input.email || null;
    if (input.guardianName !== undefined) set.guardian_name = input.guardianName || null;
    if (input.guardianPhone !== undefined) {
      const { normalizePhone } = await import('../../core/security/normalize');
      const gp = input.guardianPhone ? normalizePhone(input.guardianPhone) : null;
      if (input.guardianPhone && !gp) throw AppError.badRequest('شماره موبایل سرپرست نامعتبر است.');
      set.guardian_phone = gp;
    }
    if (input.notes !== undefined) set.notes = input.notes || null;
    await this.db.updateTable('students').set(set).where('id', '=', studentId).execute();
    await this.audit.log({
      actorId: userId,
      action: 'student_profile_updated',
      module: 'students',
      entityType: 'student',
      entityId: studentId,
    });
  }

  /** کلاس‌های فراگیر + برنامه. */
  async myClasses(userId: number) {
    const studentId = await this.studentIdOf(userId);
    return this.db
      .selectFrom('enrollments')
      .innerJoin('classes', 'classes.id', 'enrollments.class_id')
      .select([
        'enrollments.id as enrollment_id', 'enrollments.status as enrollment_status',
        'enrollments.fee_amount', 'enrollments.discount_amount',
        'classes.id as class_id', 'classes.code', 'classes.title', 'classes.status as class_status',
        'classes.start_date', 'classes.end_date', 'classes.start_time', 'classes.end_time',
        'classes.location', 'classes.weekdays',
      ])
      .where('enrollments.student_id', '=', studentId)
      .where('classes.deleted_at', 'is', null)
      .orderBy('classes.start_date')
      .execute();
  }

  async myAttendance(userId: number) {
    const studentId = await this.studentIdOf(userId);
    return this.attendance.studentReport(studentId);
  }

  /** مالی فراگیر — مانده هر ثبت‌نام + پرداخت‌ها. */
  async myFinance(userId: number) {
    const studentId = await this.studentIdOf(userId);
    const enrollments = await this.db
      .selectFrom('enrollments')
      .innerJoin('classes', 'classes.id', 'enrollments.class_id')
      .select([
        'enrollments.id', 'enrollments.class_id', 'enrollments.status',
        'enrollments.fee_amount', 'enrollments.discount_amount', 'enrollments.enrolled_at',
        'classes.title as class_title', 'classes.code as class_code',
      ])
      .where('enrollments.student_id', '=', studentId)
      .execute();
    const out = [];
    for (const enr of enrollments) {
      const balance = await this.enrollment.balance(Number(enr.id));
      out.push({ enrollment: enr, ...balance });
    }
    const payments = await this.db
      .selectFrom('payments')
      .selectAll()
      .where('student_id', '=', studentId)
      .orderBy('id', 'desc')
      .execute();
    return { enrollments: out, payments };
  }

  /** آپلود رسید کارت‌به‌کارت — فایل + مبلغ + idempotency. */
  async uploadReceipt(userId: number, opts: {
    buffer: Buffer;
    originalName: string;
    enrollmentId: number;
    amount: string;
    idempotencyKey: string;
  }) {
    const studentId = await this.studentIdOf(userId);
    // مالکیت ثبت‌نام
    const enr = await this.db
      .selectFrom('enrollments')
      .select('id')
      .where('id', '=', opts.enrollmentId)
      .where('student_id', '=', studentId)
      .executeTakeFirst();
    if (!enr) throw AppError.forbidden('این ثبت‌نام متعلق به شما نیست.');
    // ضدتکرار — idempotency
    const dup = await this.db
      .selectFrom('card_receipts')
      .select('id')
      .where('idempotency_key', '=', opts.idempotencyKey)
      .executeTakeFirst();
    if (dup) throw AppError.conflict('این رسید قبلاً ثبت شده است.');
    const file = await this.files.upload({
      buffer: opts.buffer,
      originalName: opts.originalName,
      ownerType: 'student',
      ownerId: studentId,
      uploadedBy: userId,
    });
    const { parseMoneyInput } = await import('../../core/security/money');
    const amount = parseMoneyInput(opts.amount);
    if (amount === null) throw AppError.badRequest('مبلغ رسید نامعتبر است.');
    const { nowDb } = await import('../../core/db/time');
    const res = await this.db
      .insertInto('card_receipts')
      .values({
        student_id: studentId,
        enrollment_id: opts.enrollmentId,
        file_id: file.id,
        amount,
        status: 'pending',
        idempotency_key: opts.idempotencyKey,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const receiptId = Number(res.insertId);
    await this.audit.log({
      actorId: userId,
      action: 'receipt_uploaded',
      module: 'finance',
      entityType: 'card_receipt',
      entityId: receiptId,
      meta: { enrollmentId: opts.enrollmentId, amount },
    });
    return { receiptId, fileId: file.id };
  }

  async myCertificates(userId: number) {
    const studentId = await this.studentIdOf(userId);
    return this.db
      .selectFrom('certificates')
      .innerJoin('classes', 'classes.id', 'certificates.class_id')
      .select([
        'certificates.id', 'certificates.code', 'certificates.status', 'certificates.issued_at',
        'certificates.file_id', 'certificates.verification_token',
        'classes.title as class_title', 'classes.code as class_code',
      ])
      .where('certificates.student_id', '=', studentId)
      .orderBy('certificates.id', 'desc')
      .execute();
  }
}
