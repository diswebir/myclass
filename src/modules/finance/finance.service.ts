/**
 * سرویس مالی — پرداخت‌ها (idempotency + approve/reject/reverse + ledger append-only)،
 * اقساط، رسید کارت‌به‌کارت (review → approve/reject)، گزارش‌های مالی (REQ-P4-02..04).
 * مبالغ: BIGINT (واحد کوچک) به‌صورت string — هرگز FLOAT.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import type { Config } from '../../core/config/env';
import { nowDb } from '../../core/db/time';
import { AuditService } from '../audit/audit.service';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { addMoney, subMoney, compareMoney, ZERO, type Money } from '../../core/security/money';
import { parseMoneyInput } from '../../core/security/money';

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'reversed';

export class FinanceService {
  readonly audit: AuditService;
  readonly enrollment: EnrollmentService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config?: Config,
  ) {
    this.audit = new AuditService(db);
    this.enrollment = new EnrollmentService(db, this.config);
  }

  // ---------- پرداخت ----------

  /** ثبت پرداخت — idempotencyKey یکتا (409 در تکرار). اگر تأیید ثبت در دفتر کل می‌شود. */
  async createPayment(
    actor: AuthUser,
    input: { studentId: number; enrollmentId?: number | null; methodId: number; amount: string; idempotencyKey: string; note?: string; status?: PaymentStatus },
  ) {
    const amount = parseMoneyInput(input.amount);
    if (amount === null || compareMoney(amount, ZERO) <= 0) {
      throw AppError.badRequest('مبلغ پرداخت نامعتبر است.');
    }
    // ضدتکرار — idempotency
    const dup = await this.db
      .selectFrom('payments')
      .select('id')
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    if (dup) throw AppError.conflict('این پرداخت قبلاً ثبت شده است (idempotencyKey).');
    // روش پرداخت معتبر + فعال
    const method = await this.db
      .selectFrom('payment_methods')
      .selectAll()
      .where('id', '=', input.methodId)
      .where('is_active', '=', 1)
      .executeTakeFirst();
    if (!method) throw AppError.badRequest('روش پرداخت نامعتبر است.');
    // بررسی مالکیت — فراگیر و ثبت‌نام باید موجود باشدو
    const student = await this.db
      .selectFrom('students')
      .select('id')
      .where('id', '=', input.studentId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!student) throw AppError.notFound('فراگیر یافت نشد.');
    if (input.enrollmentId) {
      const enr = await this.db
        .selectFrom('enrollments')
        .select('id')
        .where('id', '=', input.enrollmentId)
        .where('student_id', '=', input.studentId)
        .executeTakeFirst();
      if (!enr) throw AppError.badRequest('این ثبت‌نام متعلق به این فراگیر نیست.');
    }
    const status: PaymentStatus = input.status ?? 'approved';
    const now = nowDb();
    const res = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('payments')
        .values({
          student_id: input.studentId,
          enrollment_id: input.enrollmentId ?? null,
          method_id: input.methodId,
          amount,
          idempotency_key: input.idempotencyKey,
          status,
          note: input.note || null,
          created_by: actor.id,
          created_at: now,
          approved_by: status === 'approved' ? actor.id : null,
          approved_at: status === 'approved' ? now : null,
        })
        .executeTakeFirstOrThrow();
      const paymentId = Number(r.insertId);
      if (status === 'approved') {
        await this.appendLedger(trx, paymentId, input.studentId, 'credit', amount, 'پرداخت ثبت و تأیید شد');
        await this.applyToInstallments(trx, input.studentId, input.enrollmentId ?? null, amount);
      }
      return paymentId;
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'payment_created',
      module: 'finance',
      entityType: 'payment',
      entityId: res,
      meta: { studentId: input.studentId, amount, status, methodId: input.methodId },
    });
    if (this.config && status === 'approved') {
      const { notifyPaymentApproved } = await import('../sms/hooks');
      await notifyPaymentApproved(this.db, this.config, {
        paymentId: res,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId ?? null,
        amount,
      });
    }
    return { paymentId: res, status };
  }

  /** تأیید پرداخت در انتظار — ledger + قسط‌ها + audit. */
  async approvePayment(actor: AuthUser, paymentId: number) {
    const pay = await this.getPayment(paymentId);
    if (pay.status !== 'pending') throw AppError.badRequest('فقط پرداخت «در انتظار» قابل تأیید است.');
    const now = nowDb();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('payments')
        .set({ status: 'approved', approved_by: actor.id, approved_at: now })
        .where('id', '=', paymentId)
        .execute();
      await this.appendLedger(trx, paymentId, Number(pay.student_id), 'credit', String(pay.amount), 'پرداخت تأیید شد');
      await this.applyToInstallments(trx, Number(pay.student_id), pay.enrollment_id ? Number(pay.enrollment_id) : null, String(pay.amount));
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'payment_approved',
      module: 'finance',
      entityType: 'payment',
      entityId: paymentId,
      meta: { amount: String(pay.amount) },
    });
    if (this.config) {
      const { notifyPaymentApproved } = await import('../sms/hooks');
      await notifyPaymentApproved(this.db, this.config, {
        paymentId,
        studentId: Number(pay.student_id),
        enrollmentId: pay.enrollment_id ? Number(pay.enrollment_id) : null,
        amount: String(pay.amount),
      });
    }
  }

  /** رد پرداخت در انتظار — با علت + audit. */
  async rejectPayment(actor: AuthUser, paymentId: number, note?: string) {
    const pay = await this.getPayment(paymentId);
    if (pay.status !== 'pending') throw AppError.badRequest('فقط پرداخت «در انتظار» قابل رد است.');
    await this.db
      .updateTable('payments')
      .set({ status: 'rejected', note: note || pay.note })
      .where('id', '=', paymentId)
      .execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'payment_rejected',
      module: 'finance',
      entityType: 'payment',
      entityId: paymentId,
      meta: { note: note || null },
    });
  }

  /** برگشت پرداخت تأییدشده — تراکنش معکوس در ledger + audit (هيچ‌گاه حذف فیزیکی). */
  async reversePayment(actor: AuthUser, paymentId: number, reason?: string) {
    const pay = await this.getPayment(paymentId);
    if (pay.status !== 'approved') throw AppError.badRequest('فقط پرداخت «تأییدشده» قابل برگشت است.');
    const now = nowDb();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('payments')
        .set({ status: 'reversed', reversed_by: actor.id, reversed_at: now, note: reason || pay.note })
        .where('id', '=', paymentId)
        .execute();
      await this.appendLedger(
        trx,
        paymentId,
        Number(pay.student_id),
        'reversal',
        String(pay.amount),
        `برگشت پرداخت — ${reason ?? 'بدون علت'}`,
      );
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'payment_reversed',
      module: 'finance',
      entityType: 'payment',
      entityId: paymentId,
      meta: { amount: String(pay.amount), reason: reason ?? null },
    });
  }

  async listPayments(opts: { studentId?: number; status?: string; from?: string; to?: string; limit?: number } = {}) {
    let q = this.db
      .selectFrom('payments')
      .innerJoin('students', 'students.id', 'payments.student_id')
      .innerJoin('payment_methods', 'payment_methods.id', 'payments.method_id')
      .select([
        'payments.id', 'payments.student_id', 'payments.enrollment_id', 'payments.amount', 'payments.status',
        'payments.note', 'payments.created_at', 'payments.approved_at',
        'students.code as student_code', 'students.first_name', 'students.last_name',
        'payment_methods.name as method_name', 'payment_methods.type as method_type',
      ])
      .orderBy('payments.id', 'desc');
    if (opts.studentId) q = q.where('payments.student_id', '=', opts.studentId);
    if (opts.status) q = q.where('payments.status', '=', opts.status);
    if (opts.from) q = q.where('payments.created_at', '>=', `${opts.from} 00:00:00`);
    if (opts.to) q = q.where('payments.created_at', '<=', `${opts.to} 23:59:59`);
    return q.limit(opts.limit ?? 100).execute();
  }

  private async getPayment(paymentId: number) {
    const pay = await this.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirst();
    if (!pay) throw AppError.notFound('پرداخت یافت نشد.');
    return pay;
  }

  // ---------- دفتر کل (append-only) ----------

  /** append-only — ledger entry با balance_after — داخل تراکنش قبلی. */
  private async appendLedger(
    trx: Kysely<Database>,
    paymentId: number,
    studentId: number,
    entryType: 'debit' | 'credit' | 'reversal',
    amount: Money,
    description: string,
  ) {
    const last = await trx
      .selectFrom('ledger_entries')
      .select('balance_after')
      .where('student_id', '=', studentId)
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    const prev = last?.balance_after ? String(last.balance_after) : ZERO;
    // credit = واریز (بستانکاری), reversal = برگشت
    const balanceAfter =
      entryType === 'credit' ? addMoney(prev, amount) : entryType === 'reversal' ? subMoney(prev, amount) : prev;
    await trx
      .insertInto('ledger_entries')
      .values({
        payment_id: paymentId,
        student_id: studentId,
        entry_type: entryType,
        amount,
        balance_after: balanceAfter,
        description,
        created_at: nowDb(),
      })
      .execute();
  }

  async ledgerForStudent(studentId: number) {
    return this.db
      .selectFrom('ledger_entries')
      .selectAll()
      .where('student_id', '=', studentId)
      .orderBy('id')
      .execute();
  }

  // ---------- اقساط ----------

  /** ایجاد برنامه‌ی اقساط برای یک ثبت‌نام — count قسط با سررسید ماهانه. */
  async createSchedule(
    actor: AuthUser,
    input: { enrollmentId: number; count: number; firstDueDate: string; amount?: string; note?: string },
  ) {
    const enr = await this.enrollment.getById(input.enrollmentId);
    // مبلغ پیش‌فرض: مانده‌ی ثبت‌نام تقسیم بر count
    const balance = await this.enrollment.balance(input.enrollmentId);
    const totalDue = balance.balance;
    const perAmount = input.amount ? parseMoneyInput(input.amount) : null;
    if (!perAmount && compareMoney(totalDue, ZERO) <= 0) {
      throw AppError.badRequest('مانده‌ی این ثبت‌نام صفر است؛ مبلغ قسط را مشخص کنید.');
    }
    const each = perAmount ?? divMoneyLocal(totalDue, input.count);
    if (compareMoney(each, ZERO) <= 0) throw AppError.badRequest('مبلغ قسط نامعتبر است.');
    // سررسیدها ماهانه، از firstDueDate
    const first = new Date(`${input.firstDueDate}T00:00:00Z`);
    if (Number.isNaN(first.getTime())) throw AppError.badRequest('تاریخ سررسید نامعتبر است.');
    const now = nowDb();
    const created: number[] = [];
    await this.db.transaction().execute(async (trx) => {
      for (let i = 0; i < input.count; i++) {
        const due = new Date(first.getTime());
        due.setUTCMonth(due.getUTCMonth() + i);
        const r = await trx
          .insertInto('installments')
          .values({
            enrollment_id: input.enrollmentId,
            amount: each,
            due_date: due.toISOString().slice(0, 10),
            paid_amount: ZERO,
            status: 'pending',
            note: input.note || null,
            created_by: actor.id,
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirstOrThrow();
        created.push(Number(r.insertId));
      }
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'installments_created',
      module: 'finance',
      entityType: 'enrollment',
      entityId: input.enrollmentId,
      meta: { count: input.count, each },
    });
    return { created, each };
  }

  async listInstallments(enrollmentId: number) {
    return this.db
      .selectFrom('installments')
      .selectAll()
      .where('enrollment_id', '=', enrollmentId)
      .orderBy('due_date')
      .execute();
  }

  async installmentsReport(opts: { status?: string } = {}) {
    let q = this.db
      .selectFrom('installments')
      .innerJoin('enrollments', 'enrollments.id', 'installments.enrollment_id')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .select([
        'installments.id', 'installments.enrollment_id', 'installments.amount', 'installments.paid_amount',
        'installments.due_date', 'installments.status',
        'students.code as student_code', 'students.first_name', 'students.last_name',
      ])
      .orderBy('installments.due_date');
    if (opts.status) q = q.where('installments.status', '=', opts.status);
    return q.execute();
  }

  /** پرداخت به قدیمی‌ترین قسط «unpaid» تخصیص می‌یابد. */
  private async applyToInstallments(trx: Kysely<Database>, studentId: number, enrollmentId: number | null, amount: Money) {
    let remaining = amount;
    const scope = enrollmentId
      ? trx.selectFrom('installments').selectAll().where('enrollment_id', '=', enrollmentId)
      : trx
          .selectFrom('installments')
          .innerJoin('enrollments', 'enrollments.id', 'installments.enrollment_id')
          .selectAll('installments')
          .where('enrollments.student_id', '=', studentId);
    const rows = await scope
      .where('installments.status', 'in', ['pending', 'partial', 'overdue'])
      .orderBy('due_date')
      .execute();
    for (const row of rows) {
      if (compareMoney(remaining, ZERO) <= 0) break;
      const paid = String(row.paid_amount ?? ZERO);
      const due = String(row.amount);
      const missing = subMoney(due, paid);
      if (compareMoney(missing, ZERO) <= 0) continue;
      const apply = compareMoney(remaining, missing) >= 0 ? missing : remaining;
      const newPaid = addMoney(paid, apply);
      const newStatus = compareMoney(newPaid, due) >= 0 ? 'paid' : 'partial';
      await trx
        .updateTable('installments')
        .set({ paid_amount: newPaid, status: newStatus, updated_at: nowDb() })
        .where('id', '=', Number(row.id))
        .execute();
      remaining = subMoney(remaining, apply);
    }
  }

  // ---------- رسید کارت‌به‌کارت ----------

  async listReceipts(opts: { status?: string } = {}) {
    let q = this.db
      .selectFrom('card_receipts')
      .innerJoin('students', 'students.id', 'card_receipts.student_id')
      .select([
        'card_receipts.id', 'card_receipts.student_id', 'card_receipts.enrollment_id', 'card_receipts.file_id',
        'card_receipts.amount', 'card_receipts.status', 'card_receipts.review_note', 'card_receipts.reviewed_at',
        'card_receipts.payment_id', 'card_receipts.created_at',
        'students.code as student_code', 'students.first_name', 'students.last_name',
      ])
      .orderBy('card_receipts.id', 'desc');
    if (opts.status) q = q.where('card_receipts.status', '=', opts.status);
    return q.execute();
  }

  /**
   * بررسی رسید — approve: پرداخت approved (روش کارت‌به‌کارت) + ledger + لینک payment;
   * reject: رد با علت. هر رسید فقط یک‌بار قابل بررسی است.
   */
  async reviewReceipt(actor: AuthUser, receiptId: number, action: 'approve' | 'reject', note?: string) {
    const receipt = await this.db
      .selectFrom('card_receipts')
      .selectAll()
      .where('id', '=', receiptId)
      .executeTakeFirst();
    if (!receipt) throw AppError.notFound('رسید یافت نشد.');
    if (receipt.status !== 'pending') throw AppError.badRequest('این رسید قبلاً بررسی شده است.');
    const now = nowDb();
    if (action === 'reject') {
      await this.db
        .updateTable('card_receipts')
        .set({ status: 'rejected', review_note: note || null, reviewed_by: actor.id, reviewed_at: now, updated_at: now })
        .where('id', '=', receiptId)
        .execute();
      await this.audit.log({
        actorId: actor.id,
        action: 'receipt_rejected',
        module: 'finance',
        entityType: 'card_receipt',
        entityId: receiptId,
        meta: { note: note || null },
      });
      return { status: 'rejected' };
    }
    // approve → روش «card» + پرداخت approved + ledger
    const cardMethod = await this.db
      .selectFrom('payment_methods')
      .select('id')
      .where('type', '=', 'card')
      .where('is_active', '=', 1)
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();
    if (!cardMethod) throw AppError.internal('روش پرداخت «کارت‌به‌کارت» تعریف نشده است.');
    let paymentId = 0;
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('payments')
        .values({
          student_id: Number(receipt.student_id),
          enrollment_id: receipt.enrollment_id ? Number(receipt.enrollment_id) : null,
          method_id: Number(cardMethod.id),
          amount: String(receipt.amount),
          idempotency_key: `receipt-${receiptId}`,
          status: 'approved',
          note: 'تأیید رسید کارت‌به‌کارت',
          created_by: actor.id,
          created_at: now,
          approved_by: actor.id,
          approved_at: now,
        })
        .executeTakeFirstOrThrow();
      paymentId = Number(r.insertId);
      await trx
        .updateTable('card_receipts')
        .set({ status: 'approved', review_note: note || null, reviewed_by: actor.id, reviewed_at: now, payment_id: paymentId, updated_at: now })
        .where('id', '=', receiptId)
        .execute();
      await this.appendLedger(trx, paymentId, Number(receipt.student_id), 'credit', String(receipt.amount), 'تأیید رسید کارت‌به‌کارت');
      await this.applyToInstallments(trx, Number(receipt.student_id), receipt.enrollment_id ? Number(receipt.enrollment_id) : null, String(receipt.amount));
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'receipt_approved',
      module: 'finance',
      entityType: 'card_receipt',
      entityId: receiptId,
      meta: { paymentId, amount: String(receipt.amount) },
    });
    return { status: 'approved', paymentId };
  }

  // ---------- گزارش‌ها ----------

  /** درآمد: sum پرداخت‌های approved در بازه — per روش. */
  async revenueReport(opts: { from?: string; to?: string } = {}) {
    let q = this.db
      .selectFrom('payments')
      .innerJoin('payment_methods', 'payment_methods.id', 'payments.method_id')
      .select(['payment_methods.name as method_name', 'payment_methods.type as method_type'])
      .select((eb) => eb.fn.sum('payments.amount').as('total'))
      .select((eb) => eb.fn.countAll().as('cnt'))
      .where('payments.status', '=', 'approved')
      .groupBy(['payment_methods.name', 'payment_methods.type']);
    if (opts.from) q = q.where('payments.created_at', '>=', `${opts.from} 00:00:00`);
    if (opts.to) q = q.where('payments.created_at', '<=', `${opts.to} 23:59:59`);
    const byMethod = await q.execute();
    const totalRow = await this.db
      .selectFrom('payments')
      .select((eb) => eb.fn.sum('amount').as('total'))
      .where('status', '=', 'approved')
      .executeTakeFirstOrThrow();
    return {
      byMethod: byMethod.map((r) => ({ method: r.method_name, type: r.method_type, total: String(r.total ?? ZERO), count: Number(r.cnt) })),
      total: String(totalRow.total ?? ZERO),
    };
  }

  /** بدهکاران: ثبت‌نام‌هایی با مانده > 0. */
  async debtorsReport() {
    const enrollments = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .innerJoin('classes', 'classes.id', 'enrollments.class_id')
      .select([
        'enrollments.id', 'enrollments.student_id', 'enrollments.class_id', 'enrollments.fee_amount',
        'enrollments.discount_amount', 'enrollments.status as enrollment_status',
        'students.code as student_code', 'students.first_name', 'students.last_name',
        'classes.title as class_title', 'classes.code as class_code',
      ])
      .where('enrollments.status', '=', 'active')
      .where('students.deleted_at', 'is', null)
      .execute();
    const out = [];
    for (const enr of enrollments) {
      const { due, paid, balance } = await this.enrollment.balance(Number(enr.id));
      if (compareMoney(balance, ZERO) > 0) {
        out.push({ ...enr, due, paid, balance });
      }
    }
    return out.sort((a, b) => compareMoney(b.balance, a.balance));
  }

  /** مالی کلاس: ثبت‌نام‌ها + مانده‌ها. */
  async classFinance(classId: number) {
    const enrollments = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .select([
        'enrollments.id', 'enrollments.student_id', 'enrollments.fee_amount', 'enrollments.discount_amount', 'enrollments.status',
        'students.code as student_code', 'students.first_name', 'students.last_name',
      ])
      .where('enrollments.class_id', '=', classId)
      .where('students.deleted_at', 'is', null)
      .execute();
    const rows = [];
    for (const enr of enrollments) {
      const { due, paid, balance } = await this.enrollment.balance(Number(enr.id));
      rows.push({ ...enr, due, paid, balance });
    }
    return rows;
  }
}

/** تقسیم Money صحیح (floor) — برای قسط مساوی. */
function divMoneyLocal(a: Money, divisor: number): Money {
  const av = BigInt(a || '0');
  const q = av / BigInt(divisor);
  return q.toString();
}
