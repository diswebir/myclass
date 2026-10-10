import crypto from 'crypto';
import QRCode from 'qrcode';
import { Kysely } from 'kysely';
import { DatabaseSchema, AuthUser } from '../../core/types';
import { PolicyService } from '../../core/policy';
import { AttendanceService } from '../attendance/attendance.service';
import { FinanceService } from '../finance/finance.service';
import { ValidationError, NotFoundError, ConflictError, AuthorizationError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';
import { toJalaliDate } from '../../core/view-engine';

export class CertificatesService {
  constructor(
    private db: Kysely<DatabaseSchema>,
    private policyService: PolicyService,
    private attendanceService: AttendanceService,
    private financeService: FinanceService,
    private auditService?: AuditService
  ) {}

  generateUniqueCertificateCode(): string {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const year = new Date().getFullYear();
    return `CERT-${year}-${randomHex}`;
  }

  // Check issuance eligibility
  async checkEligibility(enrollmentId: number, adminUser: AuthUser): Promise<{
    eligible: boolean;
    attendancePassed: boolean;
    attendancePercent: number;
    requiredAttendancePercent: number;
    financialCleared: boolean;
    balanceRemaining: number;
    reasons: string[];
  }> {
    const enr = await this.db
      .selectFrom('enrollments')
      .innerJoin('classes', 'enrollments.class_id', 'classes.id')
      .where('enrollments.id', '=', enrollmentId)
      .select([
        'enrollments.student_id',
        'enrollments.class_id',
        'classes.min_attendance_percent'
      ])
      .executeTakeFirst();

    if (!enr) throw new NotFoundError('پرونده ثبت‌نام یافت نشد.');

    // 1. Check Attendance
    const attendanceReports = await this.attendanceService.getClassAttendanceReport(enr.class_id, adminUser);
    const studentReport = attendanceReports.find(r => r.studentId === enr.student_id);
    const attendancePercent = studentReport ? studentReport.attendancePercent : 100;
    const requiredAttendancePercent = enr.min_attendance_percent || 70;
    const attendancePassed = attendancePercent >= requiredAttendancePercent;

    // 2. Check Financial Clearance
    const finStatus = await this.financeService.getEnrollmentFinancialStatus(enrollmentId, adminUser);
    const financialCleared = finStatus.isFullyPaid;

    const reasons: string[] = [];
    if (!attendancePassed) {
      reasons.push(
        `حدنصاب حضور در کلاس کسب نشده است (حضور: ${attendancePercent}%، حداقل موردنیاز: ${requiredAttendancePercent}%).`
      );
    }
    if (!financialCleared) {
      reasons.push(
        `شهریه دوره تسویه نشده است (مانده بدهی: ${finStatus.balanceRemaining.toLocaleString('fa-IR')} تومان).`
      );
    }

    return {
      eligible: attendancePassed && financialCleared,
      attendancePassed,
      attendancePercent,
      requiredAttendancePercent,
      financialCleared,
      balanceRemaining: finStatus.balanceRemaining,
      reasons
    };
  }

  // Issue Certificate
  async issueCertificate(data: {
    enrollmentId: number;
    templateId?: number;
    baseUrl?: string;
    overrideChecks?: boolean;
  }, user: AuthUser) {
    this.policyService.assertPermission(user, 'certificates.issue');

    // Check if certificate already exists
    const existing = await this.db
      .selectFrom('certificates')
      .where('enrollment_id', '=', data.enrollmentId)
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      throw new ConflictError(`مدرک این دوره قبلاً با کد رهگیری «${existing.certificate_code}» صادر شده است.`);
    }

    // Eligibility check
    if (!data.overrideChecks) {
      const eligibility = await this.checkEligibility(data.enrollmentId, user);
      if (!eligibility.eligible) {
        throw new ValidationError(`عدم احراز شرایط صدور مدرک: ${eligibility.reasons.join(' | ')}`);
      }
    }

    const enr = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'enrollments.student_id', 'students.id')
      .innerJoin('users', 'students.user_id', 'users.id')
      .innerJoin('classes', 'enrollments.class_id', 'classes.id')
      .innerJoin('courses', 'classes.course_id', 'courses.id')
      .where('enrollments.id', '=', data.enrollmentId)
      .select([
        'users.full_name as recipient_name',
        'classes.title as class_title',
        'courses.title as course_title'
      ])
      .executeTakeFirst();

    if (!enr) throw new NotFoundError('اطلاعات ثبت‌نام یافت نشد.');

    let templateId = data.templateId;
    if (!templateId) {
      const defaultTmpl = await this.db
        .selectFrom('certificate_templates')
        .where('is_default', '=', 1)
        .select('id')
        .executeTakeFirst();
      templateId = defaultTmpl?.id || 1;
    }

    const certificateCode = this.generateUniqueCertificateCode();
    const issueDate = new Date().toISOString().substring(0, 10);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Generate QR Code Data URL (pointing to public verify URL)
    const verifyBaseUrl = data.baseUrl || 'https://academy.example.com';
    const verifyUrl = `${verifyBaseUrl}/verify/${certificateCode}`;
    const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 1,
      width: 200,
      color: { dark: '#1e3a8a', light: '#ffffff' }
    });

    const res = await this.db.insertInto('certificates').values({
      enrollment_id: data.enrollmentId,
      certificate_code: certificateCode,
      template_id: templateId,
      title: `گواهینامه پایان دوره ${enr.course_title}`,
      recipient_name: enr.recipient_name,
      course_title: enr.course_title,
      issue_date: issueDate,
      file_path: null,
      qr_code_path: qrCodeDataUrl,
      status: 'active',
      revoke_reason: null,
      revoked_at: null,
      revoked_by_user_id: null,
      created_at: now,
      updated_at: now
    }).execute();

    const certificateId = Number(res[0]?.insertId);

    if (this.auditService) {
      await this.auditService.log({
        userId: user.id,
        action: 'ISSUE_CERTIFICATE',
        entityType: 'certificates',
        entityId: certificateId,
        newValues: { certificateCode, recipientName: enr.recipient_name }
      });
    }

    return { certificateId, certificateCode, verifyUrl };
  }

  // Public Verification Query (Safe, no private contact info leaked)
  async verifyPublicCertificate(certificateCode: string) {
    const cert = await this.db
      .selectFrom('certificates')
      .where('certificate_code', '=', certificateCode.trim().toUpperCase())
      .select([
        'certificate_code',
        'title',
        'recipient_name',
        'course_title',
        'issue_date',
        'status',
        'revoke_reason',
        'revoked_at'
      ])
      .executeTakeFirst();

    if (!cert) return null;

    return {
      certificateCode: cert.certificate_code,
      title: cert.title,
      recipientName: cert.recipient_name,
      courseTitle: cert.course_title,
      issueDateJalali: toJalaliDate(cert.issue_date),
      status: cert.status,
      isValid: cert.status === 'active',
      revokeReason: cert.revoke_reason,
      revokedAtJalali: cert.revoked_at ? toJalaliDate(cert.revoked_at) : null
    };
  }

  // Revoke Certificate
  async revokeCertificate(certificateCode: string, reason: string, user: AuthUser) {
    this.policyService.assertPermission(user, 'certificates.revoke');

    const cert = await this.db
      .selectFrom('certificates')
      .where('certificate_code', '=', certificateCode.trim().toUpperCase())
      .selectAll()
      .executeTakeFirst();

    if (!cert) throw new NotFoundError('مدرک مورد نظر یافت نشد.');

    if (cert.status === 'revoked') {
      throw new ValidationError('این مدرک قبلاً ابطال شده است.');
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    await this.db
      .updateTable('certificates')
      .set({
        status: 'revoked',
        revoke_reason: reason.trim(),
        revoked_at: now,
        revoked_by_user_id: user.id,
        updated_at: now
      })
      .where('id', '=', cert.id!)
      .execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: user.id,
        action: 'REVOKE_CERTIFICATE',
        entityType: 'certificates',
        entityId: cert.id!,
        newValues: { reason }
      });
    }

    return { message: 'گواهینامه با موفقیت باطل شد.' };
  }
}
