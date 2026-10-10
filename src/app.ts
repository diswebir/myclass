import path from 'path';
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
    if (await installerService.isInstalled()) {
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
  app.get('/auth/login', (req, res) => {
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
  // Protected Routes
  // ==========================================
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      return res.redirect('/auth/login');
    }
    next();
  }

  app.get('/', requireAuth, (req, res) => {
    if (req.user?.role_name === 'teacher') return res.redirect('/teacher');
    if (req.user?.role_name === 'student') return res.redirect('/student');
    res.redirect('/admin');
  });

  // Admin Dashboard
  app.get('/admin', requireAuth, async (req, res, next) => {
    try {
      const kpis = await dashboardService.getAdminKpis(req.user!);
      res.render('admin/dashboard', { kpis, activeMenu: 'dashboard', title: 'داشبورد مدیریت' });
    } catch (err) {
      next(err);
    }
  });

  // Teacher Portal
  app.get('/teacher', requireAuth, async (req, res, next) => {
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

  // Student Portal
  app.get('/student', requireAuth, async (req, res, next) => {
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
      message,
      layout: false
    });
  });

  return { app, services: { authService, usersService, coursesService, studentsService, financeService, certificatesService, smsService } };
}
