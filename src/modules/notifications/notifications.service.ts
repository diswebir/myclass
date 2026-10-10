/**
 * Service — in-app notifications.
 * Every notification is user-scoped: list/markRead only ever touch the caller's own rows (IDOR-safe).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { nowDb } from '../../core/db/time';
import { AppError } from '../../core/errors/AppError';

export interface NotifyInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

export class NotificationsService {
  constructor(private readonly db: Kysely<Database>) {}

  /** Create a notification for one user. */
  async notify(userId: number, input: NotifyInput): Promise<number> {
    const res = await this.db
      .insertInto('notifications')
      .values({
        user_id: userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        read_at: null,
        created_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  /** Notify a student via their linked user_id (null when unlinked). */
  async notifyStudent(studentId: number, input: NotifyInput): Promise<number | null> {
    const s = await this.db
      .selectFrom('students')
      .select('user_id')
      .where('id', '=', studentId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!s || !s.user_id) return null;
    return this.notify(Number(s.user_id), input);
  }

  /** List own notifications, newest first. */
  async list(userId: number, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    let q = this.db.selectFrom('notifications').selectAll().where('user_id', '=', userId);
    if (opts.unreadOnly) q = q.where('read_at', 'is', null);
    return q.orderBy('id', 'desc').limit(opts.limit ?? 50).execute();
  }

  async unreadCount(userId: number): Promise<number> {
    const row = await this.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** Mark one notification read — only when it belongs to the caller. */
  async markRead(id: number, userId: number): Promise<void> {
    const own = await this.db
      .selectFrom('notifications')
      .select('id')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!own) throw AppError.notFound('اعلان‌ها یافت نشد.');
    await this.db
      .updateTable('notifications')
      .set({ read_at: nowDb() })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .execute();
  }

  /** Mark all own notifications read. Returns updated count. */
  async markAllRead(userId: number): Promise<number> {
    const res = await this.db
      .updateTable('notifications')
      .set({ read_at: nowDb() })
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0);
  }
}
