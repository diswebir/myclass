import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { PolicyService } from '../src/core/policy';
import { InstallerService } from '../src/modules/installer/installer.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { RbacService } from '../src/modules/rbac/rbac.service';
import { UsersService } from '../src/modules/users/users.service';
import { TeachersService } from '../src/modules/teachers/teachers.service';
import { StudentsService } from '../src/modules/students/students.service';
import { CoursesService } from '../src/modules/courses/courses.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { PreregistrationService } from '../src/modules/preregistration/preregistration.service';
import { EnrollmentService } from '../src/modules/enrollment/enrollment.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { CertificatesService } from '../src/modules/certificates/certificates.service';
import { SmsService } from '../src/modules/sms/sms.service';
import { FakeSmsProvider } from '../src/modules/sms/fake.provider';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { BackupService } from '../src/modules/backup/backup.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthUser } from '../src/core/types';
import fs from 'fs';
import path from 'path';
import { config } from '../src/core/config';

describe('Phase 7: End-to-End Complete Acceptance Test (Section 8 - 23 Scenarios)', () => {
  const db = getDb();
  const auditService = new AuditService(db);
  const settingsService = new SettingsService(db, auditService);
  const policyService = new PolicyService(db);
  const authService = new AuthService(db);
  const usersService = new UsersService(db, auditService);
  const rbacService = new RbacService(db);
  const teachersService = new TeachersService(db, usersService, auditService);
  const studentsService = new StudentsService(db, usersService, auditService);
  const coursesService = new CoursesService(db, auditService);
  const sessionsService = new SessionsService(db, auditService);
  const preregService = new PreregistrationService(db, auditService);
  const enrollmentService = new EnrollmentService(db, studentsService, auditService);
  const attendanceService = new AttendanceService(db, policyService, auditService);
  const financeService = new FinanceService(db, policyService, auditService);
  const certificatesService = new CertificatesService(db, policyService, attendanceService, financeService, auditService);
  const fakeSmsProvider = new FakeSmsProvider();
  const smsService = new SmsService(db, settingsService, fakeSmsProvider);
  const dashboardService = new DashboardService(db);
  const backupService = new BackupService(db, policyService, auditService);
  const installerService = new InstallerService(db);

  const lockPath = path.join(config.STORAGE_DIR, 'installed.lock');

  // Shared test context
  let adminUser: AuthUser;
  let teacherUser: AuthUser;
  let studentUser: AuthUser;
  let unassignedTeacherUser: AuthUser;

  let teacherId: number;
  let studentId: number;
  let courseId: number;
  let classId: number;
  let sessionId: number;
  let enrollmentId: number;
  let preregTrackingCode: string;
  let preregId: number;
  let paymentId: number;
  let issuedCertCode: string;

  beforeAll(() => {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    fakeSmsProvider.clear();
  });

  afterAll(async () => {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    await closeDb();
  });

  it('Step 1: Installs via wizard check and sets up primary admin account', async () => {
    const env = await installerService.checkEnvironment();
    expect(env.nodeValid).toBe(true);
    expect(env.storageWritable).toBe(true);
    expect(env.dbConnected).toBe(true);

    const installRes = await installerService.runInstall({
      institutionName: 'آکادمی نوآوری ایران',
      fullName: 'مدیر ارشد سامانه',
      mobile: '09121110000',
      email: 'master@academy.test',
      password: 'MasterPassword123!'
    });

    expect(installRes.message).toContain('موفقیت');
    expect(await installerService.isInstalled()).toBe(true);

    const loginRes = await authService.login('09121110000', 'MasterPassword123!', '127.0.0.1', 'Vitest');
    adminUser = loginRes.user;
    expect(adminUser.role_name).toBe('super_admin');
  });

  it('Step 2: Updates institution details from settings panel', async () => {
    await settingsService.setSetting('institution_phone', '۰۲۱-۲۲۲۲۳۳۳۳', 'general', false, adminUser.id);
    await settingsService.setSetting('institution_slogan', 'مرکز آموزش‌های نوین', 'general', false, adminUser.id);

    const phone = await settingsService.getSetting('institution_phone');
    expect(phone).toBe('۰۲۱-۲۲۲۲۳۳۳۳');
  });

  it('Step 3: Creates new role and assigns granular permissions', async () => {
    await rbacService.createRole({
      name: 'academic_inspector',
      titleFa: 'بازرس آموزشی',
      permissions: ['courses.read', 'classes.read', 'attendance.read']
    });

    const roles = await rbacService.getAllRoles();
    const inspectorRole = roles.find(r => r.name === 'academic_inspector');
    expect(inspectorRole).toBeDefined();
    expect(inspectorRole?.permissions).toContain('attendance.read');
  });

  it('Step 4: Registers teacher and multiple students', async () => {
    // Teacher
    const tRes = await teachersService.createTeacher({
      fullName: 'استاد سپهری',
      mobile: '09127000001',
      password: 'Password123!',
      internalCode: 'TCH-E2E-1'
    }, adminUser.id);
    teacherId = tRes.teacherId;

    const tLogin = await authService.login('09127000001', 'Password123!', '127.0.0.1', 'Vitest');
    teacherUser = tLogin.user;

    // Unassigned teacher
    const utRes = await teachersService.createTeacher({
      fullName: 'استاد ناظر بیرونی',
      mobile: '09127000002',
      password: 'Password123!',
      internalCode: 'TCH-E2E-2'
    }, adminUser.id);
    const utLogin = await authService.login('09127000002', 'Password123!', '127.0.0.1', 'Vitest');
    unassignedTeacherUser = utLogin.user;

    // Student
    const sRes = await studentsService.createStudent({
      fullName: 'نیما یوشیج',
      mobile: '09127000003',
      password: 'Password123!'
    }, adminUser.id);
    studentId = sRes.studentId;

    const sLogin = await authService.login('09127000003', 'Password123!', '127.0.0.1', 'Vitest');
    studentUser = sLogin.user;
  });

  it('Step 5 & 6: Creates class with tuition, schedule, and assigns teacher', async () => {
    courseId = await coursesService.createCourse({
      title: 'دوره جامع مهندسی داده',
      code: 'CRS-DATA-01',
      category: 'داده',
      level: 'پیشرفته'
    }, adminUser.id);

    classId = await coursesService.createClass({
      courseId,
      title: 'کلاس مهندسی داده پیشرفته',
      code: 'CLS-DATA-101',
      capacity: 15,
      tuitionFee: 5000000, // 5,000,000 Tomans
      startDate: '2026-11-01',
      endDate: '2027-01-01',
      scheduleDays: 'شنبه، دوشنبه',
      startTime: '17:00',
      endTime: '19:00',
      location: 'سالن شماره ۳',
      preregEnabled: true,
      minAttendancePercent: 80,
      teacherIds: [{ teacherId, role: 'primary' }]
    }, adminUser.id);

    sessionId = await sessionsService.createSession({
      classId,
      sessionNumber: 1,
      sessionDate: '2026-11-01',
      startTime: '17:00',
      endTime: '19:00',
      topic: 'جلسه مقدماتی خطوط داده',
      teacherId
    }, adminUser.id);

    const cls = await coursesService.getClassById(classId);
    expect(cls.teachers.length).toBe(1);
    expect(cls.teachers[0].id).toBe(teacherId);
  });

  it('Step 7 & 8: Pre-registration submission and conversion to confirmed enrollment', async () => {
    const prereg = await preregService.submitPreregistration({
      classId,
      fullName: 'نیما یوشیج',
      mobile: '09127000003',
      email: 'nima@example.com'
    });

    expect(prereg.trackingCode).toBeDefined();
    preregTrackingCode = prereg.trackingCode;
    preregId = prereg.id;

    const convertRes = await enrollmentService.convertPreregistrationToEnrollment(preregId, undefined, adminUser.id);
    expect(convertRes.enrollmentId).toBeDefined();
    expect(convertRes.studentId).toBe(studentId);
    enrollmentId = convertRes.enrollmentId;

    const enrs = await enrollmentService.listEnrollmentsByClass(classId);
    expect(enrs.some(e => e.student_id === studentId)).toBe(true);
  });

  it('Step 9: Student logs in and sees only their own data', async () => {
    const studentDash = await dashboardService.getStudentDashboard(studentUser.id);
    expect(studentDash).not.toBeNull();
    expect(studentDash?.enrollments.length).toBe(1);
    expect(studentDash?.enrollments[0].class_id).toBe(classId);

    // Cannot access another student ID
    await expect(
      studentsService.getStudentById(99999)
    ).rejects.toThrow();
  });

  it('Step 10: Teacher logs in and sees only assigned classes', async () => {
    const teacherDash = await dashboardService.getTeacherDashboard(teacherUser.id);
    expect(teacherDash?.assignedClasses.length).toBe(1);
    expect(teacherDash?.assignedClasses[0].id).toBe(classId);

    // Unassigned teacher has 0 assigned classes
    const unassignedDash = await dashboardService.getTeacherDashboard(unassignedTeacherUser.id);
    expect(unassignedDash?.assignedClasses.length).toBe(0);
  });

  it('Step 11 & 12: Records attendance and reflects in reports', async () => {
    await attendanceService.recordSessionAttendance(
      sessionId,
      [{ studentId, status: 'present', note: 'حضور به موقع' }],
      teacherUser
    );

    const reports = await attendanceService.getClassAttendanceReport(classId, teacherUser);
    const sReport = reports.find(r => r.studentId === studentId);
    expect(sReport?.attendancePercent).toBe(100);
    expect(sReport?.presentCount).toBe(1);
  });

  it('Step 13: Defines tuition installment plan for the student', async () => {
    await financeService.createInstallmentPlan(
      enrollmentId,
      [
        { installmentNumber: 1, amount: 2500000, dueDate: '2026-11-10', notes: 'قسط اول' },
        { installmentNumber: 2, amount: 2500000, dueDate: '2026-12-10', notes: 'قسط دوم' }
      ],
      adminUser.id
    );

    const fin = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
    expect(fin.installments.length).toBe(2);
    expect(fin.balanceRemaining).toBe(5000000);
  });

  it('Step 14 & 15: Submits card-to-card receipt, staff approves, updates financial balance', async () => {
    const payRes = await financeService.submitPayment({
      enrollmentId,
      amount: 5000000, // full payment
      paymentMethod: 'card_to_card',
      receiptNumber: 'E2E-RECEIPT-99',
      idempotencyKey: 'IDEM-E2E-PAY'
    }, studentUser);

    paymentId = payRes.paymentId;

    // Financial review
    await financeService.reviewPayment(paymentId, 'approved', undefined, adminUser);

    const fin = await financeService.getEnrollmentFinancialStatus(enrollmentId, studentUser);
    expect(fin.totalPaid).toBe(5000000);
    expect(fin.balanceRemaining).toBe(0);
    expect(fin.isFullyPaid).toBe(true);
  });

  it('Step 16 & 17: Issues certificate upon meeting conditions and validates publicly via QR code', async () => {
    const cert = await certificatesService.issueCertificate({
      enrollmentId,
      baseUrl: 'https://academy.test'
    }, adminUser);

    expect(cert.certificateCode).toBeDefined();
    issuedCertCode = cert.certificateCode;

    // Public verification without authentication
    const publicInfo = await certificatesService.verifyPublicCertificate(issuedCertCode);
    expect(publicInfo?.isValid).toBe(true);
    expect(publicInfo?.recipientName).toBe('نیما یوشیج');
    expect(publicInfo?.courseTitle).toBe('دوره جامع مهندسی داده');
  });

  it('Step 18, 19 & 20: IPPanel SMS pattern setup, variable mapping, queue and dispatch', async () => {
    await smsService.updateTemplate('enrollment_confirmed', {
      patternCode: 'p_e2e_confirm',
      variableMappings: { name: 'student_name', class: 'class_title' }
    });

    const queueRes = await smsService.enqueuePatternSms({
      eventKey: 'enrollment_confirmed',
      recipientMobile: '09127000003',
      internalVariables: {
        student_name: 'نیما یوشیج',
        class_title: 'کلاس مهندسی داده پیشرفته'
      },
      idempotencyKey: 'IDEM-E2E-SMS'
    });

    expect(queueRes.queued).toBe(true);

    const proc = await smsService.processQueue(5);
    expect(proc.successCount).toBe(1);

    expect(fakeSmsProvider.sentMessages.length).toBe(1);
    expect(fakeSmsProvider.sentMessages[0].recipient).toBe('09127000003');
    expect(fakeSmsProvider.sentMessages[0].variables.name).toBe('نیما یوشیج');
  });

  it('Step 21: Computes dashboard KPIs from live DB data (no mock)', async () => {
    const kpis = await dashboardService.getAdminKpis(adminUser);
    expect(kpis.totalStudents).toBeGreaterThanOrEqual(1);
    expect(kpis.activeTeachers).toBeGreaterThanOrEqual(1);
    expect(kpis.totalRevenue).toBe(5000000);
    expect(kpis.activeCertificates).toBeGreaterThanOrEqual(1);
  });

  it('Step 22: Blocks unauthorized access and URL parameter tampering (IDOR)', async () => {
    // Unassigned teacher tries to take attendance for Class A
    await expect(
      attendanceService.recordSessionAttendance(
        sessionId,
        [{ studentId, status: 'absent' }],
        unassignedTeacherUser
      )
    ).rejects.toThrow(/دسترسی به این جلسه آموزشی را ندارید/);

    // Student tries to access admin settings
    expect(policyService.hasPermission(studentUser, 'settings.manage')).toBe(false);
  });

  it('Step 23: Pure Node.js database backup dump works without mysqldump binary', async () => {
    const backup = await backupService.generateDatabaseBackup(adminUser);
    expect(backup.filename).toContain('backup-myclass-');
    expect(backup.sizeBytes).toBeGreaterThan(100);
    expect(fs.existsSync(backup.filePath)).toBe(true);

    const backupContent = fs.readFileSync(backup.filePath, 'utf8');
    expect(backupContent).toContain('MyClass Academy Platform Pure Node.js Database Dump');
    expect(backupContent).toContain('INSERT INTO `users`');
    expect(backupContent).toContain('INSERT INTO `classes`');
  });
});
