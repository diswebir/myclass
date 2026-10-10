/**
 * Certificates service — قالب‌ها، صدور (با شرط حضور/مالی)، دسته‌ای، لغو، راستی‌آزمایی عمومی.
 * PDF az tarigh certificate-pdf.ts (pipeline spike) + QR + safhe amumi /verify/:token.
 * (REQ-P5-01..04)
 */
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { AuthUser } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { SettingsService } from '../settings/settings.service';
import { compareMoney, ZERO } from '../../core/security/money';
import { nowDb, fromDbDate } from '../../core/db/time';
import { formatJalaali, toJalaali } from '../../core/text/jalaali';
import { renderCertificatePdf, type CertificateDesign } from './certificate-pdf';
import type { Config } from '../../core/config/env';

interface TemplateConditions {
  min_attendance_percent?: number;
  require_payment_cleared?: boolean;
}

export class CertificatesService {
  private readonly audit: AuditService;
  private readonly files: FilesService;
  private readonly settings: SettingsService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.audit = new AuditService(db);
    this.files = new FilesService(db, this.config);
    this.settings = new SettingsService(db, this.config);
  }

  // ---------- قالب‌ها ----------

  async listTemplates() {
    return this.db
      .selectFrom('certificate_templates')
      .selectAll()
      .orderBy('id')
      .execute();
  }

  async getTemplate(id: number) {
    const t = await this.db
      .selectFrom('certificate_templates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!t) throw AppError.notFound('قالب یافت نشد.');
    return t;
  }

  async createTemplate(actor: AuthUser, input: {
    name: string;
    design?: CertificateDesign;
    conditions?: TemplateConditions;
    isActive?: boolean;
  }) {
    const id = await this.db
      .insertInto('certificate_templates')
      .values({
        name: input.name,
        design: JSON.stringify(input.design ?? {}),
        conditions: JSON.stringify(input.conditions ?? {}),
        is_active: input.isActive === false ? 0 : 1,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    await this.audit.log({
      actorId: actor.id,
      action: 'certificate_template_created',
      module: 'certificates',
      entityType: 'certificate_template',
      entityId: Number(id.insertId),
      meta: { name: input.name },
    });
    return this.getTemplate(Number(id.insertId));
  }

  async updateTemplate(actor: AuthUser, id: number, patch: {
    name?: string;
    design?: CertificateDesign;
    conditions?: TemplateConditions;
    isActive?: boolean;
  }) {
    await this.getTemplate(id);
    const sets: Record<string, unknown> = { updated_at: nowDb() };
    if (patch.name !== undefined) sets.name = patch.name;
    if (patch.design !== undefined) sets.design = JSON.stringify(patch.design);
    if (patch.conditions !== undefined) sets.conditions = JSON.stringify(patch.conditions);
    if (patch.isActive !== undefined) sets.is_active = patch.isActive ? 1 : 0;
    await this.db.updateTable('certificate_templates').set(sets).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'certificate_template_updated',
      module: 'certificates',
      entityType: 'certificate_template',
      entityId: id,
      meta: { patch: Object.keys(patch) },
    });
    return this.getTemplate(id);
  }

  // ---------- مدارک ----------

  async listCertificates(opts: { studentId?: number; classId?: number; status?: string } = {}) {
    let q = this.db
      .selectFrom('certificates')
      .innerJoin('students', 'students.id', 'certificates.student_id')
      .leftJoin('classes', 'classes.id', 'certificates.class_id')
      .select([
        'certificates.id', 'certificates.code', 'certificates.status', 'certificates.student_id',
        'certificates.class_id', 'certificates.issued_at', 'certificates.revoke_reason', 'certificates.file_id',
        'certificates.verification_token',
        'students.first_name', 'students.last_name', 'students.code as student_code',
        'classes.title as class_title', 'classes.code as class_code',
      ])
      .orderBy('certificates.id', 'desc');
    if (opts.studentId) q = q.where('certificates.student_id', '=', opts.studentId);
    if (opts.classId) q = q.where('certificates.class_id', '=', opts.classId);
    if (opts.status) q = q.where('certificates.status', '=', opts.status);
    return q.execute();
  }

  async getById(id: number) {
    const c = await this.db.selectFrom('certificates').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) throw AppError.notFound('مدرک یافت نشد.');
    return c;
  }

  /** درصد حضور فراگیر در کلاس (present+late / all marked). */
  async attendancePercent(studentId: number, classId: number): Promise<number> {
    const rows = await this.db
      .selectFrom('attendance')
      .innerJoin('class_sessions', 'class_sessions.id', 'attendance.session_id')
      .select('attendance.status')
      .where('attendance.student_id', '=', studentId)
      .where('class_sessions.class_id', '=', classId)
      .where('class_sessions.deleted_at', 'is', null)
      .where('attendance.status', '!=', 'unset')
      .execute();
    const total = rows.length;
    if (total === 0) return 0;
    const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
    return Math.round((present / total) * 100);
  }

  /** بررسی شرایط: ثبت‌نام فعال + درصد حضور + تسویه مالی (طبق قالب/تنظیمات). */
  async checkConditions(
    studentId: number,
    classId: number,
    conditions?: TemplateConditions,
  ): Promise<{ ok: boolean; reasons: string[]; attendancePercent: number; balance: string }> {
    const reasons: string[] = [];
    const enr = await this.db
      .selectFrom('enrollments')
      .selectAll()
      .where('student_id', '=', studentId)
      .where('class_id', '=', classId)
      .where('status', 'in', ['active', 'completed'])
      .executeTakeFirst();
    if (!enr) {
      reasons.push('ثبت‌نام فعالی برای این فراگیر در این کلاس وجود ندارد.');
      return { ok: false, reasons, attendancePercent: 0, balance: ZERO };
    }
    const defs = await this.settings.getMany([
      'certificates.min_attendance_percent',
      'certificates.require_payment_cleared',
    ]);
    const minAttendance = conditions?.min_attendance_percent ?? Number(defs['certificates.min_attendance_percent'] ?? 70);
    const requireCleared = conditions?.require_payment_cleared ?? Boolean(defs['certificates.require_payment_cleared'] ?? true);

    const percent = await this.attendancePercent(studentId, classId);
    if (percent < minAttendance) {
      reasons.push(`درصد حضور ${percent}% کمتر از حد مجاز ${minAttendance}% است.`);
    }
    let balance = ZERO;
    if (requireCleared) {
      const fee = await this.db
        .selectFrom('enrollments')
        .select(['fee_amount', 'discount_amount'])
        .where('id', '=', enr.id)
        .executeTakeFirstOrThrow();
      const due = String(BigInt(fee.fee_amount) - BigInt(fee.discount_amount || '0'));
      const paidRow = await this.db
        .selectFrom('payments')
        .select((eb) => eb.fn.sum('amount').as('s'))
        .where('enrollment_id', '=', enr.id)
        .where('status', '=', 'approved')
        .executeTakeFirstOrThrow();
      const paid = String(paidRow.s ?? '0');
      balance = String(BigInt(due) - BigInt(paid));
      if (compareMoney(balance, ZERO) > 0) {
        reasons.push('مانده مالی فراگیر تسویه نشده است.');
      }
    }
    return { ok: reasons.length === 0, reasons, attendancePercent: percent, balance };
  }

  /** تولید کد یکتا: MC-<سال جلالی>-<۵ رقم>. */
  private async generateCode(): Promise<string> {
    const year = toJalaali(new Date()).jy;
    const prefix = `MC-${year}-`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.db
        .selectFrom('certificates')
        .select((eb) => eb.fn.countAll().as('c'))
        .where('code', 'like', `${prefix}%`)
        .executeTakeFirstOrThrow();
      const next = Number(row.c) + 1 + attempt;
      const code = `${prefix}${String(next).padStart(5, '0')}`;
      const exists = await this.db
        .selectFrom('certificates')
        .select('id')
        .where('code', '=', code)
        .executeTakeFirst();
      if (!exists) return code;
    }
    // fallback: random suffix
    return `${prefix}${randomBytes(3).toString('hex').slice(0, 5)}`;
  }

  /** رندر + ذخیره PDF — returns file_id. */
  private async renderAndStore(opts: {
    certId: number;
    actorId: number;
    code: string;
    studentName: string;
    classTitle: string;
    issuedAt: Date;
    verifyToken: string;
    design?: CertificateDesign;
    revoked?: boolean;
    revokeReason?: string | null;
  }): Promise<number> {
    const branding = await this.settings.getInstituteBranding();
    const baseUrl = this.config.APP_BASE_URL.replace(/\/$/, '');
    const pdf = await renderCertificatePdf({
      instituteName: String(branding['institute.name'] ?? ''),
      headerNote: branding['institute.header_note'] != null ? String(branding['institute.header_note']) : null,
      studentName: opts.studentName,
      classTitle: opts.classTitle,
      code: opts.code,
      issuedAtJalaali: formatJalaali(opts.issuedAt),
      verifyUrl: `${baseUrl}/verify/${opts.verifyToken}`,
      design: opts.design,
      revoked: opts.revoked,
      revokeReason: opts.revokeReason,
    });
    const up = await this.files.upload({
      buffer: pdf,
      originalName: `certificate-${opts.code}.pdf`,
      ownerType: 'certificate',
      ownerId: opts.certId,
      uploadedBy: opts.actorId,
    });
    return up.id;
  }

  /** صدور مدرک تکی — با بررسی کامل شرایط. */
  async issueCertificate(actor: AuthUser, input: { studentId: number; classId: number; templateId?: number }) {
    let conditions: TemplateConditions | undefined;
    let design: CertificateDesign | undefined;
    if (input.templateId) {
      const tpl = await this.getTemplate(input.templateId);
      if (!tpl.is_active) throw AppError.badRequest('قالب غیرفعال است.');
      conditions = JSON.parse(tpl.conditions || '{}') as TemplateConditions;
      design = JSON.parse(tpl.design || '{}') as CertificateDesign;
    }
    const check = await this.checkConditions(input.studentId, input.classId, conditions);
    if (!check.ok) throw AppError.badRequest(check.reasons.join(' '));

    const existing = await this.db
      .selectFrom('certificates')
      .select('id')
      .where('student_id', '=', input.studentId)
      .where('class_id', '=', input.classId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (existing) throw AppError.conflict('مدرک فعالی برای این فراگیر در این کلاس ثبت شده است.');

    const student = await this.db
      .selectFrom('students')
      .select(['first_name', 'last_name'])
      .where('id', '=', input.studentId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!student) throw AppError.notFound('فراگیر یافت نشد.');
    const cls = await this.db
      .selectFrom('classes')
      .select('title')
      .where('id', '=', input.classId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!cls) throw AppError.notFound('کلاس یافت نشد.');

    const code = await this.generateCode();
    const token = randomBytes(16).toString('hex');
    const issuedAt = nowDb();
    const ins = await this.db
      .insertInto('certificates')
      .values({
        template_id: input.templateId ?? null,
        student_id: input.studentId,
        class_id: input.classId,
        code,
        status: 'active',
        issued_by: actor.id,
        issued_at: issuedAt,
        verification_token: token,
        created_at: issuedAt,
        updated_at: issuedAt,
      })
      .executeTakeFirstOrThrow();
    const certId = Number(ins.insertId);
    const fileId = await this.renderAndStore({
      certId,
      actorId: actor.id,
      code,
      studentName: `${student.first_name} ${student.last_name}`,
      classTitle: cls.title,
      issuedAt: fromDbDate(issuedAt) ?? new Date(),
      verifyToken: token,
      design,
    });
    await this.db.updateTable('certificates').set({ file_id: fileId, updated_at: nowDb() }).where('id', '=', certId).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'certificate_issued',
      module: 'certificates',
      entityType: 'certificate',
      entityId: certId,
      meta: { studentId: input.studentId, classId: input.classId, code, attendancePercent: check.attendancePercent },
    });
    // هوک پیامک — best-effort
    const { notifyCertificateIssued } = await import('../sms/hooks');
    await notifyCertificateIssued(this.db, this.config, {
      certificateId: certId,
      studentId: input.studentId,
      classId: input.classId,
      code,
      studentName: `${student.first_name} ${student.last_name}`,
      classTitle: cls.title,
    });
    return this.getById(certId);
  }

  /** صدور دسته‌ای برای کلاس — dryRun فقط گزارش می‌دهد. */
  async issueBatch(actor: AuthUser, input: { classId: number; templateId?: number; dryRun?: boolean }) {
    let conditions: TemplateConditions | undefined;
    let design: CertificateDesign | undefined;
    if (input.templateId) {
      const tpl = await this.getTemplate(input.templateId);
      if (!tpl.is_active) throw AppError.badRequest('قالب غیرفعال است.');
      conditions = JSON.parse(tpl.conditions || '{}') as TemplateConditions;
      design = JSON.parse(tpl.design || '{}') as CertificateDesign;
    }
    const enrollments = await this.db
      .selectFrom('enrollments')
      .innerJoin('students', 'students.id', 'enrollments.student_id')
      .select(['enrollments.student_id', 'students.first_name', 'students.last_name'])
      .where('enrollments.class_id', '=', input.classId)
      .where('enrollments.status', '=', 'active')
      .where('students.deleted_at', 'is', null)
      .orderBy('students.last_name')
      .execute();
    const issued: Array<{ studentId: number; certificateId: number; code: string }> = [];
    const skipped: Array<{ studentId: number; studentName: string; reasons: string[] }> = [];
    for (const enr of enrollments) {
      const studentId = Number(enr.student_id);
      const check = await this.checkConditions(studentId, input.classId, conditions);
      const existing = await this.db
        .selectFrom('certificates')
        .select('id')
        .where('student_id', '=', studentId)
        .where('class_id', '=', input.classId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (existing) {
        skipped.push({ studentId, studentName: `${enr.first_name} ${enr.last_name}`, reasons: ['مدرک فعالی از قبل صادر شده است.'] });
        continue;
      }
      if (!check.ok) {
        skipped.push({ studentId, studentName: `${enr.first_name} ${enr.last_name}`, reasons: check.reasons });
        continue;
      }
      if (input.dryRun) {
        issued.push({ studentId, certificateId: 0, code: '(dry-run)' });
        continue;
      }
      const cert = await this.issueCertificate(actor, { studentId, classId: input.classId, templateId: input.templateId });
      issued.push({ studentId, certificateId: Number(cert.id), code: cert.code });
    }
    return { issued, skipped, designApplied: Boolean(design) };
  }

  /** لغو مدرک + بازتولید PDF با واترمارک (کد ثابت می‌ماند) + audit. */
  async revokeCertificate(actor: AuthUser, certId: number, reason: string) {
    const cert = await this.getById(certId);
    if (cert.status === 'revoked') throw AppError.conflict('این مدرک قبلاً لغو شده است.');
    const student = await this.db
      .selectFrom('students')
      .select(['first_name', 'last_name'])
      .where('id', '=', cert.student_id)
      .executeTakeFirstOrThrow();
    const cls = cert.class_id
      ? await this.db.selectFrom('classes').select('title').where('id', '=', cert.class_id).executeTakeFirst()
      : null;
    let design: CertificateDesign | undefined;
    if (cert.template_id) {
      const tpl = await this.db
        .selectFrom('certificate_templates')
        .select('design')
        .where('id', '=', cert.template_id)
        .executeTakeFirst();
      if (tpl) design = JSON.parse(tpl.design || '{}') as CertificateDesign;
    }
    await this.db
      .updateTable('certificates')
      .set({ status: 'revoked', revoke_reason: reason, revoked_by: actor.id, revoked_at: nowDb(), updated_at: nowDb() })
      .where('id', '=', certId)
      .execute();
    // regenerate file with watermark (code unchanged)
    const fileId = await this.renderAndStore({
      certId,
      actorId: actor.id,
      code: cert.code,
      studentName: `${student.first_name} ${student.last_name}`,
      classTitle: cls?.title ?? '',
      issuedAt: fromDbDate(cert.issued_at) ?? new Date(),
      verifyToken: cert.verification_token,
      design,
      revoked: true,
      revokeReason: reason,
    });
    await this.db.updateTable('certificates').set({ file_id: fileId, updated_at: nowDb() }).where('id', '=', certId).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'certificate_revoked',
      module: 'certificates',
      entityType: 'certificate',
      entityId: certId,
      meta: { code: cert.code, studentId: cert.student_id, reason },
    });
    return this.getById(certId);
  }

  /** صفحه عمومی /verify/:token — حداقل اطلاعات. */
  async verifyByToken(token: string) {
    const cert = await this.db
      .selectFrom('certificates')
      .selectAll()
      .where('verification_token', '=', token)
      .executeTakeFirst();
    if (!cert) return null;
    const student = await this.db
      .selectFrom('students')
      .select(['first_name', 'last_name'])
      .where('id', '=', cert.student_id)
      .executeTakeFirst();
    const cls = cert.class_id
      ? await this.db.selectFrom('classes').select(['title', 'code']).where('id', '=', cert.class_id).executeTakeFirst()
      : null;
    return {
      code: cert.code,
      status: cert.status,
      studentName: student ? `${student.first_name} ${student.last_name}` : null,
      classTitle: cls?.title ?? null,
      classCode: cls?.code ?? null,
      issuedAt: cert.issued_at,
      issuedAtJalaali: formatJalaali(fromDbDate(cert.issued_at) ?? new Date()),
      revokeReason: cert.revoke_reason,
      revokedAt: cert.revoked_at,
    };
  }
}
