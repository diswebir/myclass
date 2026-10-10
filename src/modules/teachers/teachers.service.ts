/** سرویس teachers — CRUD، کد داخلی یکتا، تخصص‌ها، وضعیت، تصویر (REQ-P2-01). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { normalizePhone } from '../../core/security/normalize';
import { AuditService } from '../audit/audit.service';

export class TeachersService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  async list(opts: { q?: string; status?: string; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('teachers')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('id', 'desc');
    if (opts.q) {
      q = q.where((eb) =>
        eb.or([
          eb('code', 'like', `%${opts.q}%`),
          eb('first_name', 'like', `%${opts.q}%`),
          eb('last_name', 'like', `%${opts.q}%`),
          eb('phone', 'like', `%${opts.q}%`),
        ]),
      );
    }
    if (opts.status) q = q.where('status', '=', opts.status);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async getById(id: number) {
    const row = await this.db
      .selectFrom('teachers')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('استاد یافت نشد.');
    return row;
  }

  async create(actor: AuthUser, input: {
    code: string;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    specialties: string[];
    status: string;
    startedAt?: string;
    notes?: string;
  }) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
    const exists = await this.db
      .selectFrom('teachers')
      .select('id')
      .where('code', '=', input.code.trim())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (exists) throw AppError.conflict('کد استاد تکراری است.');
    const res = await this.db
      .insertInto('teachers')
      .values({
        code: input.code.trim(),
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        phone,
        email: input.email || null,
        specialties: JSON.stringify(input.specialties),
        status: input.status,
        started_at: input.startedAt || null,
        notes: input.notes || null,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'teacher_created',
      module: 'teachers',
      entityType: 'teacher',
      entityId: id,
      meta: { code: input.code, name: `${input.firstName} ${input.lastName}` },
    });
    return id;
  }

  async update(actor: AuthUser, id: number, input: Partial<{
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    specialties: string[];
    status: string;
    startedAt: string;
    notes: string;
  }>) {
    await this.getById(id);
    const set: Record<string, unknown> = { updated_at: nowDb() };
    if (input.firstName !== undefined) set.first_name = input.firstName.trim();
    if (input.lastName !== undefined) set.last_name = input.lastName.trim();
    if (input.phone !== undefined) {
      const phone = normalizePhone(input.phone);
      if (!phone) throw AppError.badRequest('شماره موبایل نامعتبر است.');
      set.phone = phone;
    }
    if (input.email !== undefined) set.email = input.email || null;
    if (input.specialties !== undefined) set.specialties = JSON.stringify(input.specialties);
    if (input.status !== undefined) set.status = input.status;
    if (input.startedAt !== undefined) set.started_at = input.startedAt || null;
    if (input.notes !== undefined) set.notes = input.notes || null;
    await this.db.updateTable('teachers').set(set).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'teacher_updated',
      module: 'teachers',
      entityType: 'teacher',
      entityId: id,
    });
  }

  /** حذف نرم — نباید تخصیص به کلاس‌ها را از بین ببرد (تاریخچه حفظ می‌شود). */
  async softDelete(actor: AuthUser, id: number) {
    await this.getById(id);
    const active = await this.db
      .selectFrom('class_teachers')
      .select('class_id')
      .where('teacher_id', '=', id)
      .where('removed_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (active) {
      throw AppError.conflict('استاد در کلاس‌های فعال تخصیص دارد؛ ابتدا تخصیص را بردارید یا او را غیرفعال کنید.');
    }
    await this.db.updateTable('teachers').set({ deleted_at: nowDb(), status: 'inactive', updated_at: nowDb() }).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'teacher_deleted',
      module: 'teachers',
      entityType: 'teacher',
      entityId: id,
    });
  }
}
