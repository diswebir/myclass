/** Migration 0005 — حضور و غیاب + مالی: attendance, payment_methods, payments, installments, ledger_entries, card_receipts */
import type { Kysely } from 'kysely';
import type { MigrateCtx } from './_helpers';
import { idType } from './_helpers';

export async function up(db: Kysely<any>, ctx: MigrateCtx): Promise<void> {
  await db.schema
    .createTable('attendance')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('session_id', idType(ctx), (c) => c.notNull())
    .addColumn('student_id', idType(ctx), (c) => c.notNull())
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('unset'))
    .addColumn('note', 'text', (c) => c)
    .addColumn('marked_by', idType(ctx), (c) => c)
    .addColumn('marked_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_by', idType(ctx), (c) => c)
    .addColumn('updated_at', 'datetime', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .execute();
  // یک حضور برای هر (جلسه، فراگیر) — قید یکتا per spec §۶-ب
  await db.schema
    .createIndex('attendance_session_student_uq')
    .ifNotExists()
    .on('attendance')
    .columns(['session_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('attendance_student_idx')
    .ifNotExists()
    .on('attendance')
    .column('student_id')
    .execute();

  await db.schema
    .createTable('payment_methods')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('type', 'varchar(64)', (c) => c.notNull().defaultTo('cash'))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('payments')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('student_id', idType(ctx), (c) => c.notNull())
    .addColumn('enrollment_id', idType(ctx), (c) => c)
    .addColumn('method_id', idType(ctx), (c) => c.notNull())
    .addColumn('amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('idempotency_key', 'varchar(191)', (c) => c.notNull().unique())
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('note', 'text', (c) => c)
    .addColumn('created_by', idType(ctx), (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('approved_by', idType(ctx), (c) => c)
    .addColumn('approved_at', 'datetime', (c) => c)
    .addColumn('reversed_by', idType(ctx), (c) => c)
    .addColumn('reversed_at', 'datetime', (c) => c)
    .addColumn('reversal_payment_id', idType(ctx), (c) => c)
    .execute();
  await db.schema
    .createIndex('payments_student_idx')
    .ifNotExists()
    .on('payments')
    .column('student_id')
    .execute();
  await db.schema
    .createIndex('payments_enrollment_idx')
    .ifNotExists()
    .on('payments')
    .column('enrollment_id')
    .execute();
  await db.schema
    .createIndex('payments_status_idx')
    .ifNotExists()
    .on('payments')
    .column('status')
    .execute();

  await db.schema
    .createTable('installments')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('enrollment_id', idType(ctx), (c) => c.notNull())
    .addColumn('amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('due_date', 'date', (c) => c.notNull())
    .addColumn('paid_amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('note', 'text', (c) => c)
    .addColumn('created_by', idType(ctx), (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('installments_enrollment_due_idx')
    .ifNotExists()
    .on('installments')
    .columns(['enrollment_id', 'due_date'])
    .execute();

  await db.schema
    .createTable('ledger_entries')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('payment_id', idType(ctx), (c) => c.notNull())
    .addColumn('student_id', idType(ctx), (c) => c.notNull())
    .addColumn('entry_type', 'varchar(32)', (c) => c.notNull())
    .addColumn('amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('balance_after', 'bigint', (c) => c)
    .addColumn('description', 'text', (c) => c)
    .addColumn('created_by', idType(ctx), (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('ledger_student_created_idx')
    .ifNotExists()
    .on('ledger_entries')
    .columns(['student_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('ledger_payment_idx')
    .ifNotExists()
    .on('ledger_entries')
    .column('payment_id')
    .execute();

  await db.schema
    .createTable('card_receipts')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('student_id', idType(ctx), (c) => c.notNull())
    .addColumn('enrollment_id', idType(ctx), (c) => c)
    .addColumn('file_id', idType(ctx), (c) => c.notNull())
    .addColumn('amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('review_note', 'text', (c) => c)
    .addColumn('reviewed_by', idType(ctx), (c) => c)
    .addColumn('reviewed_at', 'datetime', (c) => c)
    .addColumn('payment_id', idType(ctx), (c) => c)
    .addColumn('idempotency_key', 'varchar(191)', (c) => c.notNull().unique())
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('card_receipts_status_idx')
    .ifNotExists()
    .on('card_receipts')
    .column('status')
    .execute();
  await db.schema
    .createIndex('card_receipts_student_idx')
    .ifNotExists()
    .on('card_receipts')
    .column('student_id')
    .execute();
}
