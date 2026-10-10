/** سرویس enrollment — ثبت‌نام قطعی، تبدیل پیش‌ثبت‌نام، کنترل ظرفیت (REQ-P2-06). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { normalizePhone } from '../../core/security/normalize';
import { parseMoneyInput, addMoney, subMoney } from '../../core/security/money';
import { AuditService } from '../audit/audit.service';

export class EnrollmentService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  async list(opts: { classId?: number; studentId?: number; status?: string; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('enrollments')
      .selectAll()
      .orderBy('id', 'desc');
    if (opts.classId) q = q.where('class_id', '=', opts.classId);
    if (opts.studentId) q = q.where('student_id', '=', opts.studentId);
    if (opts.status) q = q.where('status', '=', opts.status);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async getById(id: number) {
    const row = await this.db
      .selectFrom('enrollments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('ثبت‌نام یافت نشد.');
    return row;
  }

  async activeCount(classId: number): Promise<number> {
    const row = await this.db
      .selectFrom('enrollments')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('class_id', '=', classId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** ثبت‌نام — با کنترل ظرفیت و ضدتکرار (UNIQUE class+student). */
  async enroll(actor: AuthUser, input: {
    classId: number;
    studentId: number;
    feeAmount?: string;
    discountAmount?: string;
  }) {
    const cls = await this.db
      .selectFrom('classes')
      .selectAll()
      .where('id', '=', input.classId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!cls) throw AppError.notFound('کلاس یافت نشد.');
    if (cls.status === 'cancelled' || cls.status === 'finished') {
      throw AppError.badRequest('این کلاس در وضعیت قابل ثبت‌نام نیست.');
    }
    const student = await this.db
      .selectFrom('students')
      .select('id')
      .where('id', '=', input.studentId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!student) throw AppError.notFound('فراگیر یافت نشد.');

    // ضدتکرار — یک ثبت‌نام فعال برای هر (کلاس، فراگیر)
    const existing = await this.db
      .selectFrom('enrollments')
      .select('id')
      .where('class_id', '=', input.classId)
      .where('student_id', '=', input.studentId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (existing) {
      throw AppError.conflict('این فراگیر قبلاً در این کلاس ثبت‌نام کرده است.');
    }

    // کنترل ظرفیت
    const count = await this.activeCount(input.classId);
    if (count >= Number(cls.capacity)) {
      throw AppError.conflict('ظرفیت کلاس تکمیل است.');
    }

    const feeAmount = input.feeAmount ?? cls.fee;
    const parsedFee = parseMoneyInput(feeAmount);
    if (parsedFee === null) throw AppError.badRequest('مبلغ شهریه نامعتبر است.');
    const discount = parseMoneyInput(input.discountAmount ?? '0');
    if (discount === null) throw AppError.badRequest('مبلغ تخفیف نامعتبر است.');

    const res = await this.db
      .insertInto('enrollments')
      .values({
        class_id: input.classId,
        student_id: input.studentId,
        status: 'active',
        fee_amount: parsedFee,
        discount_amount: discount,
        enrolled_by: actor.id,
        enrolled_at: nowDb(),
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);

    // به‌روزرسانی وضعیت کلاس — full?
    const newCount = await this.activeCount(input.classId);
    if (newCount >= Number(cls.capacity) && cls.status === 'open') {
      await this.db.updateTable('classes').set({ status: 'full', updated_at: nowDb() }).where('id', '=', input.classId).execute();
    }

    await this.audit.log({
      actorId: actor.id,
      action: 'enrollment_created',
      module: 'enrollment',
      entityType: 'enrollment',
      entityId: id,
      meta: { classId: input.classId, studentId: input.studentId, fee: parsedFee },
    });
    return id;
  }

  /** تبدیل پیش‌ثبت‌نام به ثبت‌نام — student ساخته می‌شود (اگر تکراری نباشد) و enrollment درج می‌شود. */
  async convertPrereg(actor: AuthUser, preregId: number) {
    const prereg = await this.db
      .selectFrom('preregistrations')
      .selectAll()
      .where('id', '=', preregId)
      .executeTakeFirst();
    if (!prereg) throw AppError.notFound('پیش‌ثبت‌نام یافت نشد.');
    if (prereg.status !== 'approved') {
      throw AppError.badRequest('فقط پیش‌ثبت‌نام‌های تأییدشده قابل تبدیل هستند.');
    }
    if (prereg.converted_enrollment_id) {
      throw AppError.conflict('این پیش‌ثبت‌نام قبلاً تبدیل شده است.');
    }
    // student — بر اساس موبایل (تکراری → خطا)
    const existingStudent = await this.db
      .selectFrom('students')
      .select('id')
      .where('phone', '=', prereg.phone)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (existingStudent) {
      throw AppError.conflict('فراگیری با این شماره موبایل موجود است؛ ابتدا او را به کلاس ثبت‌نام کنید.');
    }
    const nameParts = prereg.applicant_name.trim().split(/\s+/);
    const firstName = nameParts[0] ?? prereg.applicant_name;
    const lastName = nameParts.slice(1).join(' ') || '-';
    const code = `ST-${prereg.tracking_code.replace(/^PR-/, '')}`;
    const stuRes = await this.db
      .insertInto('students')
      .values({
        code,
        first_name: firstName,
        last_name: lastName,
        phone: prereg.phone,
        email: prereg.email,
        status: 'active',
        joined_at: nowDb().slice(0, 10),
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const studentId = Number(stuRes.insertId);

    const cls = await this.db
      .selectFrom('classes')
      .select(['id', 'fee', 'capacity'])
      .where('id', '=', Number(prereg.class_id))
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();

    const enrollmentId = await this.enroll(actor, {
      classId: Number(prereg.class_id),
      studentId,
      feeAmount: cls.fee,
    });

    await this.db
      .updateTable('preregistrations')
      .set({ converted_enrollment_id: enrollmentId, updated_at: nowDb() })
      .where('id', '=', preregId)
      .execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'prereg_converted',
      module: 'enrollment',
      entityType: 'preregistration',
      entityId: preregId,
      meta: { enrollmentId, studentId },
    });
    return { enrollmentId, studentId };
  }

  /** لغو ثبت‌نام (soft) — با ثبت دلیل در audit (per A10: شرایط انصراف در کلاس). */
  async cancel(actor: AuthUser, enrollmentId: number, reason?: string) {
    const enr = await this.getById(enrollmentId);
    if (enr.status !== 'active') throw AppError.conflict('این ثبت‌نام فعال نیست.');
    await this.db
      .updateTable('enrollments')
      .set({ status: 'cancelled', updated_at: nowDb() })
      .where('id', '=', enrollmentId)
      .execute();
    // اگر کلاس full بود → باز شود
    const cls = await this.db
      .selectFrom('classes')
      .select(['id', 'status', 'capacity'])
      .where('id', '=', Number(enr.class_id))
      .executeTakeFirst();
    if (cls && cls.status === 'full') {
      const count = await this.activeCount(Number(enr.class_id));
      if (count < Number(cls.capacity)) {
        await this.db.updateTable('classes').set({ status: 'open', updated_at: nowDb() }).where('id', '=', Number(enr.class_id)).execute();
      }
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'enrollment_cancelled',
      module: 'enrollment',
      entityType: 'enrollment',
      entityId: enrollmentId,
      meta: { reason: reason ?? null },
    });
  }

  /** بدهی/مانده ثبت‌نام — شهریه منهای تخفیف منهای پرداخت‌های تأییدشده. */
  async balance(enrollmentId: number) {
    const enr = await this.getById(enrollmentId);
    const due = subMoney(enr.fee_amount, enr.discount_amount);
    const paidRow = await this.db
      .selectFrom('payments')
      .select((eb) => eb.fn.sum('amount').as('s'))
      .where('enrollment_id', '=', enrollmentId)
      .where('status', '=', 'approved')
      .executeTakeFirstOrThrow();
    const paid = String(paidRow.s ?? '0');
    return { due, paid, balance: subMoney(due, paid) };
  }
}
