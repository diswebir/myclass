import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { InstallerService } from '../src/modules/installer/installer.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { RbacService } from '../src/modules/rbac/rbac.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PolicyService } from '../src/core/policy';
import {
  normalizeDigits,
  normalizeMobile,
  isValidIranianMobile,
  sanitizeForCsv,
  hashPassword,
  verifyPassword
} from '../src/core/security';
import fs from 'fs';
import path from 'path';
import { config } from '../src/core/config';

describe('Phase 1: Core, Security, Installer, Auth, RBAC & Policy', () => {
  const db = getDb();
  const installerService = new InstallerService(db);
  const auditService = new AuditService(db);
  const authService = new AuthService(db);
  const rbacService = new RbacService(db);
  const settingsService = new SettingsService(db, auditService);
  const policyService = new PolicyService(db);

  const lockPath = path.join(config.STORAGE_DIR, 'installed.lock');

  beforeAll(() => {
    // Remove lock file if exists before test suite runs
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  });

  afterAll(async () => {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
    await closeDb();
  });

  describe('1. Security & Sanitization Helpers', () => {
    it('normalizes Persian and Arabic digits correctly', () => {
      expect(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
      expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
      expect(normalizeDigits('کد۱۲۳')).toBe('کد123');
    });

    it('normalizes and validates Iranian mobile formats', () => {
      expect(normalizeMobile('+989123456789')).toBe('09123456789');
      expect(normalizeMobile('00989123456789')).toBe('09123456789');
      expect(normalizeMobile('9123456789')).toBe('09123456789');
      expect(normalizeMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
      expect(isValidIranianMobile('09123456789')).toBe(true);
      expect(isValidIranianMobile('08123456789')).toBe(false);
      expect(isValidIranianMobile('12345')).toBe(false);
    });

    it('prevents formula injection in CSV exports', () => {
      expect(sanitizeForCsv('=SUM(A1:A10)')).toBe(`'=SUM(A1:A10)`);
      expect(sanitizeForCsv('+12345')).toBe(`'+12345`);
      expect(sanitizeForCsv('-calc')).toBe(`'-calc`);
      expect(sanitizeForCsv('@cmd')).toBe(`'@cmd`);
      expect(sanitizeForCsv('علی رضایی')).toBe('علی رضایی');
      expect(sanitizeForCsv('متن با , کاما')).toBe('"متن با , کاما"');
    });

    it('hashes and verifies passwords with pure JS bcryptjs', async () => {
      const pass = 'SecretPass123!';
      const hash = await hashPassword(pass);
      expect(hash).not.toBe(pass);
      expect(hash.startsWith('$2')).toBe(true);

      const isValid = await verifyPassword(pass, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('WrongPass', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('2. Web Installer & Lock Mechanism', () => {
    it('checks environment readiness', async () => {
      const env = await installerService.checkEnvironment();
      expect(env.nodeValid).toBe(true);
      expect(env.storageWritable).toBe(true);
      expect(env.publicWritable).toBe(true);
      expect(env.dbConnected).toBe(true);
    });

    it('executes migrations and provisions primary admin', async () => {
      const res = await installerService.runInstall({
        fullName: 'مدیر کل سیستم',
        mobile: '09121111111',
        email: 'superadmin@example.com',
        password: 'AdminPassword123!',
        institutionName: 'مؤسسه آموزشی البرز'
      });

      expect(res.message).toContain('موفقیت');
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(await installerService.isInstalled()).toBe(true);
    });

    it('prevents re-installation when locked', async () => {
      await expect(installerService.runInstall({
        fullName: 'نفوذگر',
        mobile: '09129999999',
        password: 'AttackerPassword!',
      })).rejects.toThrow(/قبلاً نصب شده است/);
    });
  });

  describe('3. Authentication, Sessions & Audit', () => {
    let sessionToken: string;

    it('logs in the primary admin successfully', async () => {
      const res = await authService.login('09121111111', 'AdminPassword123!', '127.0.0.1', 'Vitest-Agent');
      expect(res.sessionToken).toBeDefined();
      expect(res.user.mobile).toBe('09121111111');
      expect(res.user.role_name).toBe('super_admin');
      expect(res.user.permissions).toContain('*');
      sessionToken = res.sessionToken;
    });

    it('fails login with wrong password', async () => {
      await expect(
        authService.login('09121111111', 'WrongPassword!', '127.0.0.1', 'Vitest-Agent')
      ).rejects.toThrow(/صحیح نمی‌باشد/);
    });

    it('validates active session and returns user profile', async () => {
      const user = await authService.validateSession(sessionToken);
      expect(user).not.toBeNull();
      expect(user?.mobile).toBe('09121111111');
    });

    it('records audit logs without exposing secret credentials', async () => {
      await auditService.log({
        userId: 1,
        action: 'TEST_ACTION',
        entityType: 'test',
        entityId: 10,
        oldValues: { password: 'plain_password', apiKey: 'secret_123', name: 'Alireza' }
      });

      const logs = await auditService.getRecentLogs(5);
      const testLog = logs.find(l => l.action === 'TEST_ACTION');
      expect(testLog).toBeDefined();
      expect(testLog?.old_values_json).toContain('[REDACTED]');
      expect(testLog?.old_values_json).not.toContain('plain_password');
    });

    it('terminates session on logout', async () => {
      await authService.logout(sessionToken);
      const user = await authService.validateSession(sessionToken);
      expect(user).toBeNull();
    });
  });

  describe('4. RBAC & Policy Layer', () => {
    it('prohibits deleting system roles', async () => {
      const superAdminRole = await db.selectFrom('roles').where('name', '=', 'super_admin').select('id').executeTakeFirst();
      await expect(rbacService.deleteRole(superAdminRole!.id!)).rejects.toThrow(/قابل حذف نیستند/);
    });

    it('creates custom role with granular permissions', async () => {
      await rbacService.createRole({
        name: 'course_supervisor',
        titleFa: 'سرپرست دوره‌های آموزشی',
        permissions: ['courses.read', 'classes.read', 'classes.write']
      });

      const roles = await rbacService.getAllRoles();
      const customRole = roles.find(r => r.name === 'course_supervisor');
      expect(customRole).toBeDefined();
      expect(customRole?.permissions).toContain('classes.write');
    });

    it('enforces PolicyService permission checks with wildcards', () => {
      const mockAdminUser = {
        id: 1,
        full_name: 'Admin',
        mobile: '09121111111',
        email: null,
        role_id: 1,
        role_name: 'super_admin',
        role_title_fa: 'مدیر',
        permissions: ['*'],
        status: 'active' as const,
        avatar_path: null
      };

      const mockTeacherUser = {
        id: 2,
        full_name: 'Teacher',
        mobile: '09122222222',
        email: null,
        role_id: 7,
        role_name: 'teacher',
        role_title_fa: 'استاد',
        permissions: ['teacher_portal.access', 'attendance.record', 'sessions.read'],
        status: 'active' as const,
        avatar_path: null
      };

      expect(policyService.hasPermission(mockAdminUser, 'finance.installments')).toBe(true);
      expect(policyService.hasPermission(mockTeacherUser, 'attendance.record')).toBe(true);
      expect(policyService.hasPermission(mockTeacherUser, 'finance.installments')).toBe(false);
    });
  });

  describe('5. System Settings Management', () => {
    it('reads and updates settings, masking secret keys', async () => {
      await settingsService.setSetting('test_secret_key', 'super_secret_token_value', 'security', true, 1);
      const settings = await settingsService.getAllSettings(true);
      expect(settings.test_secret_key).toBe('••••••••');

      const rawVal = await settingsService.getSetting('test_secret_key');
      expect(rawVal).toBe('super_secret_token_value');
    });
  });
});
