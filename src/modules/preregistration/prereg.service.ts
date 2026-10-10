/** سرویس preregistration — فرم قابل پیکربندی، کد پیگیری، ضدتکرار، فرم عمومی با rate limit، review (REQ-P2-05). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { normalizePhone } from '../../core/security/normalize';
import { randomToken } from '../../core/security/tokens';
import { AuditService } from '../audit/audit.service';

export class PreregService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  // ---------- فرم ----------

  async getFormForClass(classId: number) {
    const cls = await this.db
      .selectFrom('classes')
      .select(['id', 'code', 'title', 'prereg_enabled', 'prereg_deadline', 'capacity', 'fee'])
      .where('id', '=', classId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!cls) throw AppError.notFound('کلاس یافت نشد.');
    if (cls.prereg_enabled !== 1) throw AppError.badRequest('پیش‌ثبت‌نام برای این کلاس فعال نیست.');
    if (cls.prereg_deadline) {
      const deadline = new Date(cls.prereg_deadline + 'T23:59:59Z');
      if (deadline.getTime() < Date.now()) throw AppError.badRequest('مهلت پیش‌ثبت‌نام گذشته است.');
    }
    const form = await this.db
      .selectFrom('prereg_forms')
      .selectAll()
      .where('class_id', '=', classId)
      .where('is_active', '=', 1)
      .executeTakeFirst();
    return { class: cls, form };
  }

  async getFormByClassCode(code: string) {
    const cls = await this.db
      .selectFrom('classes')
      .select('id')
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!cls) throw AppError.notFound('کلاس یافت نشد.');
    return this.getFormForClass(Number(cls.id));
  }

  async upsertForm(actor: AuthUser, classId: number, fields: unknown[]) {
    const existing = await this.db
      .selectFrom('prereg_forms')
      .select('id')
      .where('class_id', '=', classId)
      .executeTakeFirst();
    const fieldsJson = JSON.stringify(fields);
    if (existing) {
      await this.db
        .updateTable('prereg_forms')
        .set({ fields: fieldsJson, is_active: 1, updated_at: nowDb() })
        .where('id', '=', Number(existing.id))
        .execute();
    } else {
      await this.db
        .insertInto('prereg_forms')
        .values({ class_id: classId, fields: fieldsJson, is_active: 1, created_at: nowDb(), updated_at: nowDb() })
        .execute();
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'prereg_form_updated',
      module: 'prereg',
      entityType: 'class',
      entityId: classId,
    });
  }

  // ---------- ثبت عمومی ----------

  async submitPublic(classId: number, input: {
    applicantName: string;
    phone: string;
    email?: string;
    fieldValues: Record<string, string>;
  }, ip: string | null) {
    // honeypot — controlada در route
    const { form } = await this.getFormForClass(classId);
    const phone = normalizePhone(input.phone);
    if (!phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
    // ضدتکرار — یک درخواست در انتظار برای هر (کلاس، موبایل)
    const dup = await this.db
      .selectFrom('preregistrations')
      .select('id')
      .where('class_id', '=', classId)
      .where('phone', '=', phone)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (dup) {
      throw AppError.conflict('شما قبلاً برای این کلاس پیش‌ثبت‌نام کرده‌اید. کد پیگیری خود را پیگیری کنید.');
    }
    // اعتبارسنجی فیلدهای فرم
    let fields: Array<{ key: string; label: string; type: string; required: boolean }> = [];
    if (form) {
      try {
        fields = JSON.parse(form.fields);
      } catch {
        fields = [];
      }
    }
    for (const f of fields) {
      const v = (input.fieldValues?.[f.key] ?? '').trim();
      if (f.required && !v) {
        throw AppError.badRequest(`فیلد «${f.label}» الزامی است.`);
      }
      if (v && f.type === 'phone' && !normalizePhone(v)) {
        throw AppError.badRequest(`فیلد «${f.label}» موبایل معتبر نیست.`);
      }
      if (v && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        throw AppError.badRequest(`فیلد «${f.label}» ایمیل معتبر نیست.`);
      }
    }
    // کد پیگیری
    let trackingCode = '';
    for (let i = 0; i < 5; i++) {
      trackingCode = `PR-${randomToken(4).toUpperCase()}`;
      const exists = await this.db
        .selectFrom('preregistrations')
        .select('id')
        .where('tracking_code', '=', trackingCode)
        .executeTakeFirst();
      if (!exists) break;
    }
    const res = await this.db
      .insertInto('preregistrations')
      .values({
        class_id: classId,
        form_id: form ? Number(form.id) : null,
        tracking_code: trackingCode,
        applicant_name: input.applicantName.trim(),
        phone,
        email: input.email || null,
        field_values: JSON.stringify(input.fieldValues ?? {}),
        status: 'pending',
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      action: 'prereg_submitted',
      module: 'prereg',
      entityType: 'preregistration',
      entityId: id,
      meta: { classId, trackingCode },
      ip,
    });
    return { id, trackingCode };
  }

  // ---------- review ----------

  async list(opts: { classId?: number; status?: string; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('preregistrations')
      .selectAll()
      .orderBy('id', 'desc');
    if (opts.classId) q = q.where('class_id', '=', opts.classId);
    if (opts.status) q = q.where('status', '=', opts.status);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async getByTrackingCode(code: string) {
    const row = await this.db
      .selectFrom('preregistrations')
      .selectAll()
      .where('tracking_code', '=', code)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('درخواست یافت نشد.');
    return row;
  }

  async review(actor: AuthUser, id: number, status: 'approved' | 'rejected' | 'needs_fix', note: string | null) {
    const row = await this.db
      .selectFrom('preregistrations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('درخواست یافت نشد.');
    if (row.status !== 'pending') {
      throw AppError.conflict('این درخواست قبلاً بررسی شده است.');
    }
    await this.db
      .updateTable('preregistrations')
      .set({ status, review_note: note, reviewed_by: actor.id, reviewed_at: nowDb(), updated_at: nowDb() })
      .where('id', '=', id)
      .execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'prereg_reviewed',
      module: 'prereg',
      entityType: 'preregistration',
      entityId: id,
      meta: { status },
    });
  }
}
