import crypto from 'crypto';
import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { normalizeMobile, isValidIranianMobile } from '../../core/security';
import { ValidationError, NotFoundError, ConflictError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export class PreregistrationService {
  constructor(private db: Kysely<DatabaseSchema>, private auditService?: AuditService) {}

  generateTrackingCode(): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = 'PR-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async submitPreregistration(data: {
    classId: number;
    fullName: string;
    mobile: string;
    email?: string;
    extraData?: any;
    attachmentPath?: string;
  }) {
    const mobile = normalizeMobile(data.mobile);
    if (!isValidIranianMobile(mobile)) {
      throw new ValidationError('شماره همراه نامعتبر است.');
    }

    if (!data.fullName || data.fullName.trim().length < 3) {
      throw new ValidationError('نام و نام‌خانوادگی الزامی است.');
    }

    const cls = await this.db.selectFrom('classes').where('id', '=', data.classId).where('deleted_at', 'is', null).selectAll().executeTakeFirst();
    if (!cls) throw new NotFoundError('کلاس مورد نظر یافت نشد.');

    // Check if class accepts pre-registration
    if (!cls.prereg_enabled && cls.status !== 'open_for_prereg' && cls.status !== 'enrolling') {
      throw new ValidationError('پیش‌ثبت‌نام برای این کلاس فعال نمی‌باشد.');
    }

    // Check existing pending preregistration
    const existing = await this.db
      .selectFrom('preregistrations')
      .where('class_id', '=', data.classId)
      .where('mobile', '=', mobile)
      .where('status', 'in', ['pending', 'needs_correction'])
      .select('id')
      .executeTakeFirst();

    if (existing) {
      throw new ConflictError('شما قبلاً یک درخواست پیش‌ثبت‌نام در انتظار بررسی برای این کلاس ثبت کرده‌اید.');
    }

    const trackingCode = this.generateTrackingCode();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const res = await this.db.insertInto('preregistrations').values({
      class_id: data.classId,
      tracking_code: trackingCode,
      full_name: data.fullName.trim(),
      mobile,
      email: data.email ? data.email.trim().toLowerCase() : null,
      extra_data_json: data.extraData ? JSON.stringify(data.extraData) : null,
      attachment_path: data.attachmentPath || null,
      status: 'pending',
      reject_reason: null,
      created_at: now,
      updated_at: now
    }).execute();

    return {
      id: Number(res[0]?.insertId),
      trackingCode,
      classTitle: cls.title
    };
  }

  async getByTrackingCode(trackingCode: string) {
    const req = await this.db
      .selectFrom('preregistrations')
      .innerJoin('classes', 'preregistrations.class_id', 'classes.id')
      .where('preregistrations.tracking_code', '=', trackingCode.trim().toUpperCase())
      .select([
        'preregistrations.id',
        'preregistrations.tracking_code',
        'preregistrations.full_name',
        'preregistrations.mobile',
        'preregistrations.status',
        'preregistrations.reject_reason',
        'preregistrations.created_at',
        'classes.title as class_title',
        'classes.tuition_fee',
        'classes.start_date'
      ])
      .executeTakeFirst();

    if (!req) throw new NotFoundError('درخواستی با این کد پیگیری یافت نشد.');
    return req;
  }

  async listPreregistrations(options: { classId?: number; status?: string; search?: string; limit?: number; offset?: number }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = this.db
      .selectFrom('preregistrations')
      .innerJoin('classes', 'preregistrations.class_id', 'classes.id');

    if (options.classId) {
      query = query.where('preregistrations.class_id', '=', options.classId);
    }

    if (options.status) {
      query = query.where('preregistrations.status', '=', options.status as any);
    }

    if (options.search) {
      const s = `%${options.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('preregistrations.full_name', 'like', s),
          eb('preregistrations.mobile', 'like', s),
          eb('preregistrations.tracking_code', 'like', s)
        ])
      );
    }

    const totalRes = await query.select(this.db.fn.count('preregistrations.id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const items = await query
      .select([
        'preregistrations.id',
        'preregistrations.class_id',
        'preregistrations.tracking_code',
        'preregistrations.full_name',
        'preregistrations.mobile',
        'preregistrations.email',
        'preregistrations.extra_data_json',
        'preregistrations.attachment_path',
        'preregistrations.status',
        'preregistrations.reject_reason',
        'preregistrations.created_at',
        'classes.title as class_title',
        'classes.tuition_fee'
      ])
      .orderBy('preregistrations.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return { items, total, limit, offset };
  }

  async updateStatus(id: number, status: 'approved' | 'rejected' | 'needs_correction', reason?: string, actorUserId?: number) {
    const req = await this.db.selectFrom('preregistrations').where('id', '=', id).selectAll().executeTakeFirst();
    if (!req) throw new NotFoundError('درخواست پیش‌ثبت‌نام یافت نشد.');

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await this.db
      .updateTable('preregistrations')
      .set({
        status,
        reject_reason: reason || null,
        updated_at: now
      })
      .where('id', '=', id)
      .execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'UPDATE_PREREG_STATUS',
        entityType: 'preregistrations',
        entityId: id,
        oldValues: { status: req.status },
        newValues: { status, reason }
      });
    }
  }
}
