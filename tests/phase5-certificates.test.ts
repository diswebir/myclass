import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { PolicyService } from '../src/core/policy';
import { UsersService } from '../src/modules/users/users.service';
import { TeachersService } from '../src/modules/teachers/teachers.service';
import { StudentsService } from '../src/modules/students/students.service';
import { CoursesService } from '../src/modules/courses/courses.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { EnrollmentService } from '../src/modules/enrollment/enrollment.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { CertificatesService } from '../src/modules/certificates/certificates.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthUser } from '../src/core/types';

describe('Phase 5: Certificates, Eligibility Checks, QR Code & Public Verification', () => {
  const db = getDb();
  const policyService = new PolicyService(db);
  const auditService = new AuditService(db);
  const usersService = new UsersService(db, auditService);
  const teachersService = new TeachersService(db, usersService, auditService);
  const studentsService = new StudentsService(db, usersService, auditService);
  const coursesService = new CoursesService(db, auditService);
  const sessionsService = new SessionsService(db, auditService);
  const enrollmentService = new EnrollmentService(db, studentsService, auditService);
  const attendanceService = new AttendanceService(db, policyService, auditService);
  const financeService = new FinanceService(db, policyService, auditService);
  const certificatesService = new CertificatesService(db, policyService, attendanceService, financeService, auditService);

  let adminUser: AuthUser;
  let enrollmentId: number;
  let studentId: number;
  let sessionId: number;
  let issuedCertificateCode: string;

  beforeAll(async () => {
    await runMigrations(db);

    // 1. Admin user with full permissions
    adminUser = {
      id: 1,
      full_name: 'مدیر سامانه',
      mobile: '09121111111',
      email: null,
      role_id: 1,
      role_name: 'super_admin',
      role_title_fa: 'مدیر اصلی',
      permissions: ['*'],
      status: 'active',
      avatar_path: null
    };

    // 2. Teacher
    const teacher = await teachersService.createTeacher({
      fullName: 'دکتر صمیمی',
      mobile: '09125000001',
      password: 'Password123!',
      internalCode: 'TCH-P5'
    });

    // 3. Student
    const student = await studentsService.createStudent({
      fullName: 'امیررضا حسینی',
      mobile: '09125000002'
    });
    studentId = student.studentId;

    // 4. Course & Class (Tuition = 2,000,000, min attendance = 70%)
    const course = await coursesService.createCourse({
      title: 'دوره فلاتر پیشرفته',
      code: 'CRS-FLT-01',
      category: 'موبایل',
      level: 'پیشرفته'
    });

    const classId = await coursesService.createClass({
      courseId: course,
      title: 'کلاس فلاتر',
      code: 'CLS-FLT-01',
      capacity: 10,
      tuitionFee: 2000000,
      startDate: '2026-10-01',
      endDate: '2026-11-01',
      scheduleDays: 'شنبه',
      startTime: '10:00',
      endTime: '12:00',
      location: 'آنلاین',
      minAttendancePercent: 70,
      teacherIds: [{ teacherId: teacher.teacherId }]
    });

    // 5. Enroll Student
    enrollmentId = await enrollmentService.enrollStudent({
      studentId,
      classId,
      tuitionAgreed: 2000000
    });

    // 6. Create Session
    sessionId = await sessionsService.createSession({
      classId,
      sessionNumber: 1,
      sessionDate: '2026-10-01',
      startTime: '10:00',
      endTime: '12:00',
      teacherId: teacher.teacherId
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('1. Certificate Issuance Rules Enforcement', () => {
    it('refuses issuance when tuition is unpaid and attendance unrecorded', async () => {
      const eligibility = await certificatesService.checkEligibility(enrollmentId, adminUser);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.financialCleared).toBe(false);

      await expect(
        certificatesService.issueCertificate({ enrollmentId }, adminUser)
      ).rejects.toThrow(/عدم احراز شرایط صدور مدرک/);
    });

    it('refuses issuance if only tuition is paid but attendance requirement not met', async () => {
      // Record attendance as absent
      await attendanceService.recordSessionAttendance(
        sessionId,
        [{ studentId, status: 'absent' }],
        adminUser
      );

      // Pay full tuition
      await financeService.submitPayment(
        {
          enrollmentId,
          amount: 2000000,
          paymentMethod: 'cash',
          idempotencyKey: 'IDEM-P5-PAY-01'
        },
        adminUser
      );

      const eligibility = await certificatesService.checkEligibility(enrollmentId, adminUser);
      expect(eligibility.financialCleared).toBe(true);
      expect(eligibility.attendancePassed).toBe(false); // 0% attendance < 70% required!
      expect(eligibility.eligible).toBe(false);

      await expect(
        certificatesService.issueCertificate({ enrollmentId }, adminUser)
      ).rejects.toThrow(/حدنصاب حضور در کلاس کسب نشده است/);
    });

    it('successfully issues certificate when attendance and financial clearance are fulfilled', async () => {
      // Fix attendance: update to present
      await attendanceService.recordSessionAttendance(
        sessionId,
        [{ studentId, status: 'present' }],
        adminUser
      );

      const eligibility = await certificatesService.checkEligibility(enrollmentId, adminUser);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.attendancePassed).toBe(true);
      expect(eligibility.financialCleared).toBe(true);

      const certRes = await certificatesService.issueCertificate(
        { enrollmentId, baseUrl: 'https://academy.test' },
        adminUser
      );

      expect(certRes.certificateCode).toBeDefined();
      expect(certRes.certificateCode.startsWith('CERT-')).toBe(true);
      expect(certRes.verifyUrl).toContain(certRes.certificateCode);

      issuedCertificateCode = certRes.certificateCode;
    });

    it('prohibits duplicate certificate issuance for same enrollment', async () => {
      await expect(
        certificatesService.issueCertificate({ enrollmentId }, adminUser)
      ).rejects.toThrow(/مدرک این دوره قبلاً .* صادر شده است/);
    });
  });

  describe('2. Public Verification & Safe Data Exposure', () => {
    it('returns valid certificate information on public query without leaking private details', async () => {
      const publicInfo = await certificatesService.verifyPublicCertificate(issuedCertificateCode);

      expect(publicInfo).not.toBeNull();
      expect(publicInfo?.isValid).toBe(true);
      expect(publicInfo?.recipientName).toBe('امیررضا حسینی');
      expect(publicInfo?.courseTitle).toBe('دوره فلاتر پیشرفته');
      expect(publicInfo?.issueDateJalali).toBeDefined();

      // Ensure no private student phone or national ID is in public object
      expect((publicInfo as any).mobile).toBeUndefined();
      expect((publicInfo as any).nationalId).toBeUndefined();
      expect((publicInfo as any).tuition).toBeUndefined();
    });

    it('returns null for unknown certificate code', async () => {
      const result = await certificatesService.verifyPublicCertificate('NON-EXISTENT-CODE');
      expect(result).toBeNull();
    });
  });

  describe('3. Certificate Revocation', () => {
    it('revokes certificate with reason and reflects on public verification', async () => {
      const revokeRes = await certificatesService.revokeCertificate(
        issuedCertificateCode,
        'انصراف پس از صدور و ابطال مدارک',
        adminUser
      );

      expect(revokeRes.message).toContain('با موفقیت باطل شد');

      const publicInfo = await certificatesService.verifyPublicCertificate(issuedCertificateCode);
      expect(publicInfo?.isValid).toBe(false);
      expect(publicInfo?.status).toBe('revoked');
      expect(publicInfo?.revokeReason).toBe('انصراف پس از صدور و ابطال مدارک');
      expect(publicInfo?.revokedAtJalali).toBeDefined();
    });
  });
});
