import crypto from 'crypto';
import { Kysely } from 'kysely';
import { DatabaseSchema, AuthUser } from '../../core/types';
import { PolicyService } from '../../core/policy';
import { ValidationError, NotFoundError, ConflictError, AuthorizationError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export interface InstallmentInput {
  installmentNumber: number;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  notes?: string;
}

export class FinanceService {
  constructor(
    private db: Kysely<DatabaseSchema>,
    private policyService: PolicyService,
    private auditService?: AuditService
  ) {}

  // 1. Create installment plan for an enrollment
  async createInstallmentPlan(enrollmentId: number, installments: InstallmentInput[], actorUserId?: number) {
    const enrollment = await this.db
      .selectFrom('enrollments')
      .where('id', '=', enrollmentId)
      .selectAll()
      .executeTakeFirst();

    if (!enrollment) throw new NotFoundError('پرونده ثبت‌نام یافت نشد.');

    // Check sum of installment amounts matches or covers agreed tuition
    const totalInstallments = installments.reduce((acc, curr) => acc + Number(curr.amount), 0);
    const agreedTuition = Number(enrollment.tuition_agreed);

    if (totalInstallments !== agreedTuition) {
      throw new ValidationError(
        `مجموع مبالغ اقساط (${totalInstallments.toLocaleString('fa-IR')} تومان) با شهریه توافق‌شده (${agreedTuition.toLocaleString('fa-IR')} تومان) مطابقت ندارد.`
      );
    }

    // Delete existing unpaid installments if re-planning
    await this.db
      .deleteFrom('installments')
      .where('enrollment_id', '=', enrollmentId)
      .where('paid_amount', '=', 0)
      .execute();

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    for (const inst of installments) {
      await this.db.insertInto('installments').values({
        enrollment_id: enrollmentId,
        installment_number: inst.installmentNumber,
        amount: inst.amount,
        due_date: inst.dueDate,
        status: 'pending',
        paid_amount: 0,
        notes: inst.notes || null,
        created_at: now,
        updated_at: now
      }).execute();
    }

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CREATE_INSTALLMENT_PLAN',
        entityType: 'enrollments',
        entityId: enrollmentId,
        newValues: { installmentCount: installments.length, total: totalInstallments }
      });
    }

    return { message: 'برنامه اقساط با موفقیت ثبت شد.' };
  }

  // 2. Submit payment or card-to-card receipt
  async submitPayment(data: {
    enrollmentId: number;
    installmentId?: number;
    amount: number;
    paymentMethod: 'cash' | 'card_to_card' | 'lump_sum' | 'manual' | 'online_gateway';
    receiptNumber?: string;
    receiptFilePath?: string;
    idempotencyKey?: string;
  }, user: AuthUser) {
    // Assert authorization: Student can submit for their enrollment, staff with permission can submit manual
    if (user.role_name === 'student') {
      await this.policyService.assertCanAccessEnrollment(user, data.enrollmentId);
    } else {
      this.policyService.assertPermission(user, 'finance.record_payment');
    }

    if (data.amount <= 0) {
      throw new ValidationError('مبلغ پرداخت باید بزرگتر از صفر باشد.');
    }

    const idempotencyKey = data.idempotencyKey || crypto.randomBytes(16).toString('hex');

    // Check duplicate submission
    const existing = await this.db
      .selectFrom('payments')
      .where('idempotency_key', '=', idempotencyKey)
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      throw new ConflictError('این تراکنش قبلاً ثبت شده است (کد تکراری).');
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // If submitted by financial staff as cash or manual, it can be automatically approved
    const isAutoApproved = ['cash', 'manual', 'online_gateway'].includes(data.paymentMethod) && user.role_name !== 'student';
    const status = isAutoApproved ? 'approved' : 'pending';

    const result = await this.db.insertInto('payments').values({
      enrollment_id: data.enrollmentId,
      installment_id: data.installmentId || null,
      amount: data.amount,
      payment_method: data.paymentMethod,
      status,
      receipt_number: data.receiptNumber || null,
      receipt_file_path: data.receiptFilePath || null,
      reject_reason: null,
      paid_at: now,
      verified_by_user_id: isAutoApproved ? user.id : null,
      idempotency_key: idempotencyKey,
      created_at: now,
      updated_at: now
    }).execute();

    const paymentId = Number(result[0]?.insertId);

    // If auto-approved, update installment / balance
    if (isAutoApproved && data.installmentId) {
      await this.applyPaymentToInstallment(data.installmentId, data.amount);
    }

    if (this.auditService) {
      await this.auditService.log({
        userId: user.id,
        action: 'SUBMIT_PAYMENT',
        entityType: 'payments',
        entityId: paymentId,
        newValues: { amount: data.amount, method: data.paymentMethod, status }
      });
    }

    return { paymentId, status };
  }

  // 3. Review card-to-card receipt (financial staff)
  async reviewPayment(paymentId: number, decision: 'approved' | 'rejected', reason: string | undefined, user: AuthUser) {
    this.policyService.assertPermission(user, 'finance.review_receipts');

    const payment = await this.db.selectFrom('payments').where('id', '=', paymentId).selectAll().executeTakeFirst();
    if (!payment) throw new NotFoundError('فیش پرداختی یافت نشد.');

    if (payment.status !== 'pending') {
      throw new ValidationError('این فیش قبلاً تعیین وضعیت شده است و امکان تغییر وضعیت مجدد وجود ندارد.');
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (decision === 'approved') {
      await this.db
        .updateTable('payments')
        .set({
          status: 'approved',
          verified_by_user_id: user.id,
          updated_at: now
        })
        .where('id', '=', paymentId)
        .execute();

      // Apply payment to installment if designated
      if (payment.installment_id) {
        await this.applyPaymentToInstallment(payment.installment_id, Number(payment.amount));
      }
    } else {
      await this.db
        .updateTable('payments')
        .set({
          status: 'rejected',
          reject_reason: reason || 'عدم تطابق اطلاعات فیش با حساب بانکی',
          verified_by_user_id: user.id,
          updated_at: now
        })
        .where('id', '=', paymentId)
        .execute();
    }

    if (this.auditService) {
      await this.auditService.log({
        userId: user.id,
        action: `REVIEW_PAYMENT_${decision.toUpperCase()}`,
        entityType: 'payments',
        entityId: paymentId,
        newValues: { decision, reason }
      });
    }

    return { message: decision === 'approved' ? 'پرداخت با موفقیت تأیید شد.' : 'فیش پرداختی رد شد.' };
  }

  private async applyPaymentToInstallment(installmentId: number, amount: number) {
    const inst = await this.db.selectFrom('installments').where('id', '=', installmentId).selectAll().executeTakeFirst();
    if (!inst) return;

    const newPaidAmount = Number(inst.paid_amount) + amount;
    const totalAmount = Number(inst.amount);

    let newStatus: 'paid' | 'partially_paid' | 'pending' = 'partially_paid';
    if (newPaidAmount >= totalAmount) {
      newStatus = 'paid';
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await this.db
      .updateTable('installments')
      .set({
        paid_amount: newPaidAmount,
        status: newStatus,
        updated_at: now
      })
      .where('id', '=', installmentId)
      .execute();
  }

  // 4. Financial Status & Balance Calculation for an enrollment
  async getEnrollmentFinancialStatus(enrollmentId: number, user: AuthUser) {
    await this.policyService.assertCanAccessEnrollment(user, enrollmentId);

    const enrollment = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'enrollments.student_id', 'students.id')
      .innerJoin('users', 'students.user_id', 'users.id')
      .innerJoin('classes', 'enrollments.class_id', 'classes.id')
      .where('enrollments.id', '=', enrollmentId)
      .select([
        'enrollments.id',
        'enrollments.tuition_agreed',
        'students.id as student_id',
        'students.student_code',
        'users.full_name as student_name',
        'classes.id as class_id',
        'classes.title as class_title'
      ])
      .executeTakeFirst();

    if (!enrollment) throw new NotFoundError('پرونده ثبت‌نام یافت نشد.');

    const installments = await this.db
      .selectFrom('installments')
      .where('enrollment_id', '=', enrollmentId)
      .selectAll()
      .orderBy('installment_number', 'asc')
      .execute();

    const payments = await this.db
      .selectFrom('payments')
      .where('enrollment_id', '=', enrollmentId)
      .selectAll()
      .orderBy('id', 'desc')
      .execute();

    // Sum of approved payments
    const totalPaid = payments
      .filter(p => p.status === 'approved')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalAgreed = Number(enrollment.tuition_agreed);
    const balanceRemaining = Math.max(0, totalAgreed - totalPaid);
    const isFullyPaid = balanceRemaining === 0;

    const todayStr = new Date().toISOString().substring(0, 10);
    let overdueAmount = 0;
    for (const inst of installments) {
      if (inst.status !== 'paid' && inst.due_date < todayStr) {
        overdueAmount += (Number(inst.amount) - Number(inst.paid_amount));
      }
    }

    return {
      enrollment,
      totalAgreed,
      totalPaid,
      balanceRemaining,
      isFullyPaid,
      overdueAmount,
      installments,
      payments
    };
  }

  // 5. Debtors Report (Financial Staff only)
  async getDebtorsReport(user: AuthUser) {
    this.policyService.assertPermission(user, 'reports.finance');

    const enrollments = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'enrollments.student_id', 'students.id')
      .innerJoin('users', 'students.user_id', 'users.id')
      .innerJoin('classes', 'enrollments.class_id', 'classes.id')
      .where('enrollments.status', '=', 'active')
      .select([
        'enrollments.id as enrollment_id',
        'enrollments.tuition_agreed',
        'students.id as student_id',
        'students.student_code',
        'users.full_name as student_name',
        'users.mobile as student_mobile',
        'classes.title as class_title'
      ])
      .execute();

    const todayStr = new Date().toISOString().substring(0, 10);
    const debtors: any[] = [];

    for (const enr of enrollments) {
      const enrollmentId = enr.enrollment_id!;
      const payments = await this.db
        .selectFrom('payments')
        .where('enrollment_id', '=', enrollmentId)
        .where('status', '=', 'approved')
        .select('amount')
        .execute();

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(enr.tuition_agreed) - totalPaid;

      if (remaining > 0) {
        debtors.push({
          enrollmentId,
          studentName: enr.student_name,
          studentMobile: enr.student_mobile,
          studentCode: enr.student_code,
          classTitle: enr.class_title,
          tuitionAgreed: Number(enr.tuition_agreed),
          totalPaid,
          balanceRemaining: remaining
        });
      }
    }

    return debtors;
  }
}
