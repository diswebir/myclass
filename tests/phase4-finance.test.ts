import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { PolicyService } from '../src/core/policy';
import { UsersService } from '../src/modules/users/users.service';
import { StudentsService } from '../src/modules/students/students.service';
import { CoursesService } from '../src/modules/courses/courses.service';
import { EnrollmentService } from '../src/modules/enrollment/enrollment.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthUser } from '../src/core/types';

describe('Phase 4: Finance, Tuition, Installments, Card-to-Card Receipts & Reports', () => {
  const db = getDb();
  const policyService = new PolicyService(db);
  const auditService = new AuditService(db);
  const usersService = new UsersService(db, auditService);
  const studentsService = new StudentsService(db, usersService, auditService);
  const coursesService = new CoursesService(db, auditService);
  const enrollmentService = new EnrollmentService(db, studentsService, auditService);
  const financeService = new FinanceService(db, policyService, auditService);

  let financeStaffUser: AuthUser;
  let studentUser: AuthUser;
  let classId: number;
  let enrollmentId: number;
  let installment1Id: number;
  let installment2Id: number;

  beforeAll(async () => {
    await runMigrations(db);

    // 1. Create Financial Staff User
    const staffUserRes = await usersService.createUser({
      fullName: 'کارشناس مالی',
      mobile: '09123000001',
      password: 'Password123!',
      roleId: 5 // finance_staff
    });
    const staffId = Number(staffUserRes[0]?.insertId);
    financeStaffUser = {
      id: staffId,
      full_name: 'کارشناس مالی',
      mobile: '09123000001',
      email: null,
      role_id: 5,
      role_name: 'finance_staff',
      role_title_fa: 'کارشناس مالی',
      permissions: ['finance.*', 'students.read', 'enrollment.read', 'reports.finance'],
      status: 'active',
      avatar_path: null
    };

    // 2. Create Student
    const student = await studentsService.createStudent({
      fullName: 'بهرام صادقی',
      mobile: '09123000002'
    });
    studentUser = {
      id: student.userId,
      full_name: 'بهرام صادقی',
      mobile: '09123000002',
      email: null,
      role_id: 8,
      role_name: 'student',
      role_title_fa: 'فراگیر',
      permissions: ['student_portal.access'],
      status: 'active',
      avatar_path: null,
      student_id: student.studentId
    };

    // 3. Create Course & Class
    const course = await coursesService.createCourse({
      title: 'دوره حسابداری تخصصی',
      code: 'CRS-FIN-01',
      category: 'مالی',
      level: 'مقدماتی'
    });

    classId = await coursesService.createClass({
      courseId: course,
      title: 'کلاس حسابداری ویژه بازار کار',
      code: 'CLS-FIN-101',
      capacity: 20,
      tuitionFee: 6000000, // 6,000,000 Tomans
      startDate: '2026-11-01',
      endDate: '2027-01-01',
      scheduleDays: 'شنبه، چهارشنبه',
      startTime: '18:00',
      endTime: '20:00',
      location: 'آنلاین'
    });

    // 4. Enroll Student
    enrollmentId = await enrollmentService.enrollStudent({
      studentId: student.studentId,
      classId,
      tuitionAgreed: 6000000
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('1. Installment Planning & Validation', () => {
    it('rejects installment plan if sum of installments does not match tuition', async () => {
      await expect(
        financeService.createInstallmentPlan(
          enrollmentId,
          [
            { installmentNumber: 1, amount: 2000000, dueDate: '2026-11-10' },
            { installmentNumber: 2, amount: 2000000, dueDate: '2026-12-10' }
            // Total = 4,000,000 while tuition is 6,000,000!
          ],
          financeStaffUser.id
        )
      ).rejects.toThrow(/با شهریه توافق‌شده .* مطابقت ندارد/);
    });

    it('creates a valid 2-part installment plan', async () => {
      const res = await financeService.createInstallmentPlan(
        enrollmentId,
        [
          { installmentNumber: 1, amount: 3000000, dueDate: '2026-11-10', notes: 'قسط اول' },
          { installmentNumber: 2, amount: 3000000, dueDate: '2026-12-10', notes: 'قسط دوم' }
        ],
        financeStaffUser.id
      );

      expect(res.message).toContain('موفقیت');

      const status = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
      expect(status.installments.length).toBe(2);
      expect(status.totalAgreed).toBe(6000000);
      expect(status.totalPaid).toBe(0);
      expect(status.balanceRemaining).toBe(6000000);
      expect(status.isFullyPaid).toBe(false);

      installment1Id = status.installments[0].id!;
      installment2Id = status.installments[1].id!;
    });
  });

  describe('2. Card-to-Card Receipt Submission & Review Workflow', () => {
    let paymentId: number;

    it('student submits card-to-card receipt for installment 1 (starts as pending)', async () => {
      const res = await financeService.submitPayment(
        {
          enrollmentId,
          installmentId: installment1Id,
          amount: 3000000,
          paymentMethod: 'card_to_card',
          receiptNumber: 'FISH-998877',
          receiptFilePath: '/storage/receipts/fish1.jpg',
          idempotencyKey: 'IDEM-PAY-001'
        },
        studentUser
      );

      expect(res.paymentId).toBeDefined();
      expect(res.status).toBe('pending');
      paymentId = res.paymentId;

      // Pending receipt MUST NOT count as paid balance yet!
      const status = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
      expect(status.totalPaid).toBe(0);
      expect(status.balanceRemaining).toBe(6000000);
    });

    it('prevents duplicate payment submission with same idempotency key', async () => {
      await expect(
        financeService.submitPayment(
          {
            enrollmentId,
            installmentId: installment1Id,
            amount: 3000000,
            paymentMethod: 'card_to_card',
            idempotencyKey: 'IDEM-PAY-001' // duplicate!
          },
          studentUser
        )
      ).rejects.toThrow(/این تراکنش قبلاً ثبت شده است/);
    });

    it('financial staff approves receipt, updating installment and remaining balance', async () => {
      const res = await financeService.reviewPayment(paymentId, 'approved', undefined, financeStaffUser);
      expect(res.message).toContain('موفقیت');

      const status = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
      expect(status.totalPaid).toBe(3000000);
      expect(status.balanceRemaining).toBe(3000000);

      // Verify installment 1 status is paid
      const inst1 = status.installments.find(i => i.id === installment1Id);
      expect(inst1?.status).toBe('paid');
      expect(Number(inst1?.paid_amount)).toBe(3000000);
    });

    it('prevents reviewing an already reviewed payment', async () => {
      await expect(
        financeService.reviewPayment(paymentId, 'rejected', 'تغییر نظر', financeStaffUser)
      ).rejects.toThrow(/قبلاً تعیین وضعیت شده است/);
    });

    it('handles rejected card-to-card receipt with reason', async () => {
      // Student submits for installment 2
      const p2 = await financeService.submitPayment(
        {
          enrollmentId,
          installmentId: installment2Id,
          amount: 3000000,
          paymentMethod: 'card_to_card',
          receiptNumber: 'FAKE-FISH',
          idempotencyKey: 'IDEM-PAY-002'
        },
        studentUser
      );

      // Staff rejects it
      await financeService.reviewPayment(p2.paymentId, 'rejected', 'فیش ناخوانا است', financeStaffUser);

      const status = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
      expect(status.totalPaid).toBe(3000000); // Still 3,000,000
      expect(status.balanceRemaining).toBe(3000000);

      const rejectedPay = status.payments.find(p => p.id === p2.paymentId);
      expect(rejectedPay?.status).toBe('rejected');
      expect(rejectedPay?.reject_reason).toBe('فیش ناخوانا است');
    });

    it('settles remaining balance with manual payment by staff', async () => {
      await financeService.submitPayment(
        {
          enrollmentId,
          installmentId: installment2Id,
          amount: 3000000,
          paymentMethod: 'cash',
          receiptNumber: 'CASH-REC-101',
          idempotencyKey: 'IDEM-PAY-003'
        },
        financeStaffUser // auto-approved for staff cash payment
      );

      const status = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
      expect(status.totalPaid).toBe(6000000);
      expect(status.balanceRemaining).toBe(0);
      expect(status.isFullyPaid).toBe(true);
    });
  });

  describe('3. Financial Reports & Debtors', () => {
    it('generates debtors report accurately', async () => {
      // Create another student with unpaid tuition
      const unpaidStudent = await studentsService.createStudent({
        fullName: 'دانشجوی بدهکار',
        mobile: '09124440000'
      });

      const unpaidEnrollmentId = await enrollmentService.enrollStudent({
        studentId: unpaidStudent.studentId,
        classId,
        tuitionAgreed: 5000000
      });

      const debtors = await financeService.getDebtorsReport(financeStaffUser);
      const target = debtors.find(d => d.enrollmentId === unpaidEnrollmentId);

      expect(target).toBeDefined();
      expect(target?.studentName).toBe('دانشجوی بدهکار');
      expect(target?.balanceRemaining).toBe(5000000);
    });
  });
});
