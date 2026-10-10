import path from 'path';
import fs from 'fs';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { config } from './core/config';
import { getDb } from './core/db';
import { csrfMiddleware } from './core/security';
import { toJalaliDate, formatCurrency, getStatusBadge } from './core/view-engine';
import { AppError } from './core/errors';
import { logger } from './core/logger';
import { AuthUser } from './core/types';

import { InstallerService } from './modules/installer/installer.service';
import { HealthService } from './modules/health/health.service';
import { AuthService } from './modules/auth/auth.service';
import { UsersService } from './modules/users/users.service';
import { RbacService } from './modules/rbac/rbac.service';
import { SettingsService } from './modules/settings/settings.service';
import { AuditService } from './modules/audit/audit.service';
import { TeachersService } from './modules/teachers/teachers.service';
import { StudentsService } from './modules/students/students.service';
import { CoursesService } from './modules/courses/courses.service';
import { SessionsService } from './modules/sessions/sessions.service';
import { PreregistrationService } from './modules/preregistration/preregistration.service';
import { EnrollmentService } from './modules/enrollment/enrollment.service';
import { AttendanceService } from './modules/attendance/attendance.service';
import { FinanceService } from './modules/finance/finance.service';
import { CertificatesService } from './modules/certificates/certificates.service';
import { SmsService } from './modules/sms/sms.service';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { BackupService } from './modules/backup/backup.service';
import { ModulesService } from './modules/modules-registry/modules.service';
import { PolicyService } from './core/policy';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function createApp() {
  const app = express();
  const db = getDb();

  // Instantiate Services
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
  const smsService = new SmsService(db, settingsService);
  const dashboardService = new DashboardService(db);
  const backupService = new BackupService(db, policyService, auditService);
  const modulesService = new ModulesService();
  const installerService = new InstallerService(db);
  const healthService = new HealthService(db);

  // View Engine Setup (EJS)
  const viewsDir = path.join(__dirname, 'ui/views');
  app.set('views', viewsDir);
  app.set('view engine', 'ejs');

  // Simple layout renderer helper
  app.use((req, res, next) => {
    const originalRender = res.render.bind(res);
    res.render = function (view: string, options?: any, callback?: any): void {
      const opts = options || {};
      opts.toJalaliDate = toJalaliDate;
      opts.formatCurrency = formatCurrency;
      opts.getStatusBadge = getStatusBadge;
      opts.user = req.user;
      opts.csrfToken = res.locals.csrfToken;

      originalRender(view, opts, (err: Error | null, html: string) => {
        if (err) return next(err);
        if (opts.layout === false) {
          return res.send(html);
        }
        opts.body = html;
        originalRender('layouts/main', opts, callback);
      });
    };
    next();
  });

  // Security Middlewares
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"]
      }
    }
  }));

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.json({ limit: '10mb' }));

  // Static Assets
  app.use('/assets', express.static(path.join(process.cwd(), 'public/assets')));
  app.use('/uploads', express.static(path.join(config.STORAGE_DIR, 'uploads')));

  // Session Authentication Middleware
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const sessionToken = req.cookies?.[config.SESSION_COOKIE_NAME];
    if (sessionToken) {
      try {
        const user = await authService.validateSession(sessionToken);
        if (user) {
          req.user = user;
          res.locals.user = user;
        }
      } catch (err) {
        logger.error('Error resolving session', err);
      }
    }
    next();
  });

  // CSRF Protection
  app.use(csrfMiddleware);

  // Rate Limiter for Login
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'تعداد درخواست‌های ورود بیش از حد مجاز است. لطفاً پس از ۱۵ دقیقه مجدداً تلاش کنید.'
  });

  // ==========================================
  // Public & Health Routes
  // ==========================================
  app.get('/health', async (req, res) => {
    const status = await healthService.getHealthStatus();
    res.json(status);
  });

  // Installer
  app.get('/install', async (req, res) => {
    const isInstalled = await installerService.isInstalled();
    if (isInstalled && req.query.force !== '1') {
      return res.redirect('/auth/login');
    }
    const env = await installerService.checkEnvironment();
    res.render('public/installer', { env, title: 'راه‌اندازی سامانه' });
  });

  app.post('/install', async (req, res, next) => {
    try {
      const {
        institutionName,
        fullName,
        mobile,
        email,
        password,
        dbDialect,
        mysqlHost,
        mysqlPort,
        mysqlDatabase,
        mysqlUser,
        mysqlPassword
      } = req.body;

      const result = await installerService.runInstall({
        institutionName,
        fullName,
        mobile,
        email,
        password,
        dbDialect: dbDialect === 'mysql' ? 'mysql' : 'sqlite',
        mysqlHost,
        mysqlPort: mysqlPort ? Number(mysqlPort) : undefined,
        mysqlDatabase,
        mysqlUser,
        mysqlPassword
      });
      res.render('public/login', { success: result.message, title: 'ورود به سامانه' });
    } catch (err) {
      next(err);
    }
  });

  // Certificate Public Verification Page
  app.get('/verify/:code', async (req, res, next) => {
    try {
      const code = req.params.code;
      const cert = await certificatesService.verifyPublicCertificate(code);
      res.render('public/verify-certificate', {
        certificate: cert,
        title: 'استعلام اصالت گواهینامه'
      });
    } catch (err) {
      next(err);
    }
  });

  // Public Pre-registration Lookup Page
  app.get('/preregister/status', async (req, res, next) => {
    try {
      const trackingCode = req.query.trackingCode as string;
      let result = null;
      if (trackingCode) {
        result = await preregService.getByTrackingCode(trackingCode);
      }
      res.render('public/track-prereg', { trackingCode, result, title: 'پیگیری پیش‌ثبت‌نام' });
    } catch (err) {
      next(err);
    }
  });

  // Public Pre-registration Page per class
  app.get('/preregister/:classId', async (req, res, next) => {
    try {
      const classId = Number(req.params.classId);
      const cls = await coursesService.getClassById(classId);
      res.render('public/preregister', { cls, title: `پیش‌ثبت‌نام ${cls.title}` });
    } catch (err) {
      next(err);
    }
  });

  app.post('/preregister/:classId', async (req, res, next) => {
    try {
      const classId = Number(req.params.classId);
      const { fullName, mobile, email } = req.body;
      const result = await preregService.submitPreregistration({
        classId,
        fullName,
        mobile,
        email
      });
      res.render('public/track-prereg', {
        trackingCode: result.trackingCode,
        success: `درخواست پیش‌ثبت‌نام شما با موفقیت ثبت شد. کد پیگیری شما: ${result.trackingCode}`,
        title: 'پیگیری پیش‌ثبت‌نام'
      });
    } catch (err) {
      next(err);
    }
  });

  // Auth: Login & Logout
  app.get('/auth/login', async (req, res) => {
    const isInstalled = await installerService.isInstalled();
    if (!isInstalled) {
      return res.redirect('/install');
    }
    if (req.user) {
      if (req.user.role_name === 'teacher') return res.redirect('/teacher');
      if (req.user.role_name === 'student') return res.redirect('/student');
      return res.redirect('/admin');
    }
    res.render('public/login', { title: 'ورود به سامانه' });
  });

  app.post('/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const { identifier, password } = req.body;
      const ipAddress = req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Unknown';

      const result = await authService.login(identifier, password, ipAddress, userAgent);

      res.cookie(config.SESSION_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 14 * 24 * 60 * 60 * 1000
      });

      if (result.user.role_name === 'teacher') return res.redirect('/teacher');
      if (result.user.role_name === 'student') return res.redirect('/student');
      res.redirect('/admin');
    } catch (err: any) {
      res.render('public/login', { error: err.message, title: 'ورود به سامانه' });
    }
  });

  app.get('/auth/logout', async (req, res) => {
    const token = req.cookies?.[config.SESSION_COOKIE_NAME];
    if (token) {
      await authService.logout(token);
    }
    res.clearCookie(config.SESSION_COOKIE_NAME);
    res.redirect('/auth/login');
  });

  // ==========================================
  // Authorization Guards
  // ==========================================
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      return res.redirect('/auth/login');
    }
    next();
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return res.redirect('/auth/login');
    if (req.user.role_name === 'teacher' || req.user.role_name === 'student') {
      return res.status(403).render('public/error', {
        title: 'عدم دسترسی',
        message: 'شما دسترسی لازم برای مشاهده این بخش مدیریتی را ندارید.'
      });
    }
    next();
  }

  function requireTeacher(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return res.redirect('/auth/login');
    if (req.user.role_name !== 'teacher' && req.user.role_name !== 'super_admin') {
      return res.status(403).render('public/error', {
        title: 'عدم دسترسی',
        message: 'این بخش صرفاً برای اساتید آموزشگاه در دسترس است.'
      });
    }
    next();
  }

  function requireStudent(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return res.redirect('/auth/login');
    if (req.user.role_name !== 'student' && req.user.role_name !== 'super_admin') {
      return res.status(403).render('public/error', {
        title: 'عدم دسترسی',
        message: 'این بخش صرفاً برای فراگیران آموزشگاه در دسترس است.'
      });
    }
    next();
  }

  app.get('/', async (req, res, next) => {
    try {
      const isInstalled = await installerService.isInstalled();
      if (!isInstalled) {
        return res.redirect('/install');
      }

      if (!req.user) {
        return res.redirect('/auth/login');
      }

      if (req.user?.role_name === 'teacher') return res.redirect('/teacher');
      if (req.user?.role_name === 'student') return res.redirect('/student');
      res.redirect('/admin');
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // Admin Routes
  // ==========================================
  app.get('/admin', requireAdmin, async (req, res, next) => {
    try {
      const kpis = await dashboardService.getAdminKpis(req.user!);
      res.render('admin/dashboard', { kpis, activeMenu: 'dashboard', title: 'داشبورد مدیریت' });
    } catch (err) {
      next(err);
    }
  });

  // Courses & Classes Management
  app.get('/admin/classes', requireAdmin, async (req, res, next) => {
    try {
      const courses = await coursesService.listCourses();
      const { classes } = await coursesService.listClasses({ limit: 100 });
      res.render('admin/classes', {
        courses,
        classes,
        activeMenu: 'classes',
        title: 'مدیریت دوره‌ها و کلاس‌ها'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/courses/create', requireAdmin, async (req, res, next) => {
    try {
      const { title, code, category, level, description } = req.body;
      await coursesService.createCourse({ title, code, category, level, description }, req.user?.id);
      res.redirect('/admin/classes');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/classes/create', requireAdmin, async (req, res, next) => {
    try {
      const {
        courseId,
        title,
        code,
        capacity,
        tuitionFee,
        startDate,
        endDate,
        scheduleDays,
        startTime,
        endTime,
        location
      } = req.body;

      await coursesService.createClass({
        courseId: Number(courseId),
        title,
        code,
        capacity: Number(capacity),
        tuitionFee: Number(tuitionFee),
        startDate,
        endDate,
        scheduleDays,
        startTime,
        endTime,
        location,
        status: 'open_for_prereg',
        preregEnabled: true
      }, req.user?.id);

      res.redirect('/admin/classes');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/classes/:id/sessions/create', requireAdmin, async (req, res, next) => {
    try {
      const classId = Number(req.params.id);
      const { sessionNumber, sessionDate, startTime, endTime, topic } = req.body;
      await sessionsService.createSession({
        classId,
        sessionNumber: Number(sessionNumber),
        sessionDate,
        startTime,
        endTime,
        topic
      }, req.user?.id);

      res.redirect(`/admin/attendance?classId=${classId}`);
    } catch (err) {
      next(err);
    }
  });

  // Teachers Management
  app.get('/admin/teachers', requireAdmin, async (req, res, next) => {
    try {
      const { teachers } = await teachersService.listTeachers({ limit: 100 });
      res.render('admin/teachers', {
        teachers,
        activeMenu: 'teachers',
        title: 'مدیریت اساتید'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/teachers/create', requireAdmin, async (req, res, next) => {
    try {
      const { fullName, mobile, password, internalCode, specialties } = req.body;
      await teachersService.createTeacher({
        fullName,
        mobile,
        password,
        internalCode,
        specialties
      }, req.user?.id);

      res.redirect('/admin/teachers');
    } catch (err) {
      next(err);
    }
  });

  // Students Management
  app.get('/admin/students', requireAdmin, async (req, res, next) => {
    try {
      const { students } = await studentsService.listStudents({ limit: 100 });
      const { items: preregistrations } = await preregService.listPreregistrations({ status: 'pending', limit: 20 });
      res.render('admin/students', {
        students,
        preregistrations,
        activeMenu: 'students',
        title: 'مدیریت فراگیران'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/students/create', requireAdmin, async (req, res, next) => {
    try {
      const { fullName, mobile, nationalId, parentPhone } = req.body;
      await studentsService.createStudent({
        fullName,
        mobile,
        nationalId,
        parentPhone
      }, req.user?.id);

      res.redirect('/admin/students');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/students/import-csv', requireAdmin, async (req, res, next) => {
    try {
      const { csvData } = req.body;
      await studentsService.importStudentsFromCsv(csvData, req.user?.id);
      res.redirect('/admin/students');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/preregistrations/:id/approve', requireAdmin, async (req, res, next) => {
    try {
      const preregId = Number(req.params.id);
      await enrollmentService.convertPreregistrationToEnrollment(preregId, undefined, req.user?.id);
      res.redirect('/admin/students');
    } catch (err) {
      next(err);
    }
  });

  // Attendance Management
  app.get('/admin/attendance', requireAdmin, async (req, res, next) => {
    try {
      const { classes } = await coursesService.listClasses({ limit: 100 });
      const selectedClassId = req.query.classId ? Number(req.query.classId) : (classes[0]?.id || 0);

      let selectedClass = null;
      let attendanceReport: any[] = [];
      let sessions: any[] = [];

      if (selectedClassId) {
        selectedClass = await coursesService.getClassById(selectedClassId);
        attendanceReport = await attendanceService.getClassAttendanceReport(selectedClassId, req.user!);
        sessions = await sessionsService.listSessionsByClass(selectedClassId);
      }

      res.render('admin/attendance', {
        classes,
        selectedClassId,
        selectedClass,
        attendanceReport,
        sessions,
        activeMenu: 'attendance',
        title: 'حضور و غیاب'
      });
    } catch (err) {
      next(err);
    }
  });

  // Finance Management
  app.get('/admin/finance', requireAdmin, async (req, res, next) => {
    try {
      const debtors = await financeService.getDebtorsReport(req.user!);
      const pendingPayments = await db
        .selectFrom('payments')
        .where('status', '=', 'pending')
        .selectAll()
        .execute();

      res.render('admin/finance', {
        debtors,
        pendingPayments,
        activeMenu: 'finance',
        title: 'امور مالی و اقساط'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/finance/payment/:id/review', requireAdmin, async (req, res, next) => {
    try {
      const paymentId = Number(req.params.id);
      const { decision, reason } = req.body;
      await financeService.reviewPayment(paymentId, decision, reason, req.user!);
      res.redirect('/admin/finance');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/finance/payment/manual', requireAdmin, async (req, res, next) => {
    try {
      const { enrollmentId, amount, paymentMethod, receiptNumber } = req.body;
      await financeService.submitPayment({
        enrollmentId: Number(enrollmentId),
        amount: Number(amount),
        paymentMethod,
        receiptNumber
      }, req.user!);

      res.redirect('/admin/finance');
    } catch (err) {
      next(err);
    }
  });

  // Certificates Management
  app.get('/admin/certificates', requireAdmin, async (req, res, next) => {
    try {
      const certificates = await db
        .selectFrom('certificates')
        .selectAll()
        .orderBy('id', 'desc')
        .execute();

      res.render('admin/certificates', {
        certificates,
        activeMenu: 'certificates',
        title: 'مدارک و گواهینامه‌ها'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/certificates/issue', requireAdmin, async (req, res, next) => {
    try {
      const { enrollmentId, overrideChecks } = req.body;
      const host = req.get('host') || '127.0.0.1:3000';
      const protocol = req.protocol;
      const baseUrl = `${protocol}://${host}`;

      await certificatesService.issueCertificate({
        enrollmentId: Number(enrollmentId),
        overrideChecks: overrideChecks === 'true',
        baseUrl
      }, req.user!);

      res.redirect('/admin/certificates');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/certificates/revoke', requireAdmin, async (req, res, next) => {
    try {
      const { certificateCode, reason } = req.body;
      await certificatesService.revokeCertificate(certificateCode, reason, req.user!);
      res.redirect('/admin/certificates');
    } catch (err) {
      next(err);
    }
  });

  // SMS Management
  app.get('/admin/sms', requireAdmin, async (req, res, next) => {
    try {
      const templates = await smsService.listTemplates();
      const { logs } = await smsService.listLogs({ limit: 50 });

      res.render('admin/sms', {
        templates,
        logs,
        activeMenu: 'sms',
        title: 'سامانه پیامک'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/sms/test', requireAdmin, async (req, res, next) => {
    try {
      const { mobile } = req.body;
      const result = await smsService.sendTestSms(mobile, req.user!);
      res.redirect('/admin/sms');
    } catch (err) {
      next(err);
    }
  });

  // Users & RBAC Management
  app.get('/admin/users', requireAdmin, async (req, res, next) => {
    try {
      const { users } = await usersService.listUsers({ limit: 100 });
      const roles = await rbacService.getAllRoles();

      res.render('admin/users', {
        users,
        roles,
        activeMenu: 'users',
        title: 'کاربران و سطوح دسترسی'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/users/create', requireAdmin, async (req, res, next) => {
    try {
      const { fullName, mobile, password, roleId } = req.body;
      await usersService.createUser({
        fullName,
        mobile,
        password,
        roleId: Number(roleId)
      }, req.user?.id);

      res.redirect('/admin/users');
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/roles/create', requireAdmin, async (req, res, next) => {
    try {
      const { name, titleFa, permissions } = req.body;
      const permsArray = Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []);
      await rbacService.createRole({
        name,
        titleFa,
        permissions: permsArray
      });

      res.redirect('/admin/users');
    } catch (err) {
      next(err);
    }
  });

  // Settings Management
  app.get('/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const settings = await settingsService.getAllSettings(false);
      res.render('admin/settings', {
        settings,
        activeMenu: 'settings',
        title: 'تنظیمات آموزشگاه'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const { institution_name, institution_phone, institution_slogan, institution_address, ippanel_api_key } = req.body;
      await settingsService.updateBulk({
        institution_name,
        institution_phone,
        institution_slogan,
        institution_address,
        ippanel_api_key
      }, req.user?.id);

      res.redirect('/admin/settings');
    } catch (err) {
      next(err);
    }
  });

  // Database Backup Management
  app.get('/admin/backup', requireAdmin, async (req, res, next) => {
    try {
      const backups = await backupService.listBackups(req.user!);
      res.render('admin/backup', {
        backups,
        activeMenu: 'backup',
        title: 'پشتیبان‌گیری پایگاه داده'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/admin/backup/create', requireAdmin, async (req, res, next) => {
    try {
      await backupService.generateDatabaseBackup(req.user!);
      res.redirect('/admin/backup');
    } catch (err) {
      next(err);
    }
  });

  app.get('/admin/backup/download/:filename', requireAdmin, async (req, res, next) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(config.STORAGE_DIR, 'backups', filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).send('فایل پشتیبان مورد نظر یافت نشد.');
      }
      res.download(filePath, filename);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // Teacher Portal Routes
  // ==========================================
  app.get('/teacher', requireTeacher, async (req, res, next) => {
    try {
      const data = await dashboardService.getTeacherDashboard(req.user!.id);
      res.render('teacher/dashboard', {
        ...data,
        activeMenu: 'teacher',
        title: 'پنل اختصاصی استاد'
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/teacher/classes', requireTeacher, (req, res) => {
    res.redirect('/teacher');
  });

  app.get('/teacher/attendance', requireTeacher, (req, res) => {
    res.redirect('/teacher');
  });

  app.get('/teacher/class/:classId', requireTeacher, async (req, res, next) => {
    try {
      const classId = Number(req.params.classId);
      await policyService.assertCanAccessClass(req.user!, classId);

      const cls = await coursesService.getClassById(classId);
      const sessions = await sessionsService.listSessionsByClass(classId);

      res.render('teacher/class-sessions', {
        cls,
        sessions,
        activeMenu: 'teacher',
        title: `جلسات ${cls.title}`
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/teacher/session/:sessionId/attendance', requireTeacher, async (req, res, next) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const { session, roster } = await attendanceService.getSessionAttendance(sessionId, req.user!);

      res.render('teacher/session-attendance', {
        session,
        roster,
        activeMenu: 'teacher',
        title: `ثبت حضور و غیاب جلسه ${session.session_number}`
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/teacher/session/:sessionId/attendance', requireTeacher, async (req, res, next) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const { roster } = await attendanceService.getSessionAttendance(sessionId, req.user!);

      const recordsToSave = roster.map(item => {
        const statusKey = `status_${item.studentId}`;
        const noteKey = `note_${item.studentId}`;
        const status = (req.body[statusKey] || 'unrecorded') as any;
        const note = req.body[noteKey] || '';
        return {
          studentId: item.studentId,
          status,
          note
        };
      });

      await attendanceService.recordSessionAttendance(sessionId, recordsToSave, req.user!);
      res.redirect(`/teacher/session/${sessionId}/attendance`);
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // Student Portal Routes
  // ==========================================
  app.get('/student', requireStudent, async (req, res, next) => {
    try {
      const data = await dashboardService.getStudentDashboard(req.user!.id);
      res.render('student/dashboard', {
        ...data,
        activeMenu: 'student',
        title: 'پنل فراگیر'
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/student/finance', requireStudent, async (req, res, next) => {
    try {
      const data = await dashboardService.getStudentDashboard(req.user!.id);
      const studentId = data?.student?.id;

      let payments: any[] = [];
      if (studentId) {
        payments = await db
          .selectFrom('payments')
          .innerJoin('enrollments', 'payments.enrollment_id', 'enrollments.id')
          .where('enrollments.student_id', '=', studentId)
          .selectAll('payments')
          .orderBy('payments.id', 'desc')
          .execute();
      }

      res.render('student/finance', {
        enrollments: data?.enrollments || [],
        payments,
        activeMenu: 'finance',
        title: 'شهریه و اقساط'
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/student/payments/submit', requireStudent, async (req, res, next) => {
    try {
      const { enrollmentId, amount, receiptNumber } = req.body;
      await financeService.submitPayment({
        enrollmentId: Number(enrollmentId),
        amount: Number(amount),
        paymentMethod: 'card_to_card',
        receiptNumber
      }, req.user!);

      res.redirect('/student/finance');
    } catch (err) {
      next(err);
    }
  });

  app.get('/student/certificates', requireStudent, async (req, res, next) => {
    try {
      const data = await dashboardService.getStudentDashboard(req.user!.id);
      res.render('student/certificates', {
        certificates: data?.certificates || [],
        activeMenu: 'certificates',
        title: 'مدارک و گواهینامه‌های من'
      });
    } catch (err) {
      next(err);
    }
  });

  // Cron Job Webhook Endpoint
  app.get('/api/cron/run', async (req, res) => {
    const token = req.query.token as string;
    if (!token || token !== config.CRON_SECRET) {
      return res.status(403).json({ error: 'توکن کران‌جاب نامعتبر است' });
    }

    try {
      const smsResult = await smsService.processQueue(50);
      res.json({ success: true, processedSms: smsResult });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Central Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled request error', err);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'خطای غیرمنتظره‌ای در سرور رخ داده است.';

    if (req.headers.accept?.includes('application/json')) {
      return res.status(statusCode).json({ error: message, details: err.details });
    }

    res.status(statusCode).render('public/error', {
      title: `خطا (${statusCode})`,
      message
    });
  });

  return {
    app,
    services: {
      authService,
      usersService,
      coursesService,
      studentsService,
      financeService,
      certificatesService,
      smsService,
      attendanceService,
      sessionsService,
      preregService,
      enrollmentService,
      rbacService,
      settingsService,
      dashboardService,
      backupService
    }
  };
}
