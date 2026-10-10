/** سرویس courses — CRUD دوره‌ها (REQ-P2-03). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { AuditService } from '../audit/audit.service';

export class CoursesService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  async list(opts: { q?: string; active?: boolean; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('courses')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('id', 'desc');
    if (opts.q) {
      q = q.where((eb) =>
        eb.or([eb('title', 'like', `%${opts.q}%`), eb('code', 'like', `%${opts.q}%`)]),
      );
    }
    if (opts.active !== undefined) q = q.where('is_active', '=', opts.active ? 1 : 0);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async getById(id: number) {
    const row = await this.db
      .selectFrom('courses')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('دوره یافت نشد.');
    return row;
  }

  async create(actor: AuthUser, input: {
    title: string;
    code: string;
    category?: string;
    level?: string;
    description?: string;
    defaultFee: string;
    durationHours?: number;
    isActive: number;
  }) {
    const exists = await this.db
      .selectFrom('courses')
      .select('id')
      .where('code', '=', input.code.trim())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (exists) throw AppError.conflict('کد دوره تکراری است.');
    const res = await this.db
      .insertInto('courses')
      .values({
        title: input.title.trim(),
        code: input.code.trim(),
        category: input.category || null,
        level: input.level || null,
        description: input.description || null,
        default_fee: input.defaultFee,
        duration_hours: input.durationHours ?? null,
        is_active: input.isActive,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'course_created',
      module: 'courses',
      entityType: 'course',
      entityId: id,
      meta: { code: input.code, title: input.title },
    });
    return id;
  }

  async update(actor: AuthUser, id: number, input: Partial<{
    title: string;
    category: string;
    level: string;
    description: string;
    defaultFee: string;
    durationHours: number;
    isActive: number;
  }>) {
    await this.getById(id);
    const set: Record<string, unknown> = { updated_at: nowDb() };
    if (input.title !== undefined) set.title = input.title.trim();
    if (input.category !== undefined) set.category = input.category || null;
    if (input.level !== undefined) set.level = input.level || null;
    if (input.description !== undefined) set.description = input.description || null;
    if (input.defaultFee !== undefined) set.default_fee = input.defaultFee;
    if (input.durationHours !== undefined) set.duration_hours = input.durationHours ?? null;
    if (input.isActive !== undefined) set.is_active = input.isActive;
    await this.db.updateTable('courses').set(set).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'course_updated',
      module: 'courses',
      entityType: 'course',
      entityId: id,
    });
  }

  async softDelete(actor: AuthUser, id: number) {
    await this.getById(id);
    const active = await this.db
      .selectFrom('classes')
      .select('id')
      .where('course_id', '=', id)
      .where('deleted_at', 'is', null)
      .where('status', 'not in', ['finished', 'cancelled'])
      .limit(1)
      .executeTakeFirst();
    if (active) {
      throw AppError.conflict('این دوره کلاس‌های باز دارد؛ ابتدا کلاس‌ها را مدیریت کنید.');
    }
    await this.db.updateTable('courses').set({ deleted_at: nowDb(), is_active: 0, updated_at: nowDb() }).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'course_deleted',
      module: 'courses',
      entityType: 'course',
      entityId: id,
    });
  }
}
