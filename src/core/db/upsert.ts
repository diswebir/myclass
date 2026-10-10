/** Upsert قابل حمل (update-first, insert-on-miss) — بین MySQL و SQLite کار می‌کند. */
import type { Kysely } from 'kysely';

/**
 * upsert بر اساس یک ستون کلید.
 * ابتدا UPDATE؛ اگر ردیفی نبود INSERT؛ در صورت race → دوباره UPDATE.
 */
export async function upsertByKey(
  db: Kysely<any>,
  table: string,
  keyColumn: string,
  keyValue: string | number,
  values: Record<string, unknown>,
): Promise<void> {
  const upd = await db
    .updateTable(table)
    .set(values)
    .where(keyColumn, '=', keyValue)
    .executeTakeFirstOrThrow();
  if (Number(upd.numUpdatedRows ?? 0) > 0) return;
  try {
    await db
      .insertInto(table)
      .values({ [keyColumn]: keyValue, ...values })
      .execute();
  } catch {
    // race — ردیف همزمان ساخته شد؛ دوباره update
    await db
      .updateTable(table)
      .set(values)
      .where(keyColumn, '=', keyValue)
      .execute();
  }
}
