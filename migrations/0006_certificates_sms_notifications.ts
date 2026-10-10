/** Migration 0006 — مدارک، پیامک، اعلان‌ها */
import type { Kysely } from 'kysely';
import type { MigrateCtx } from './_helpers';
import { idType } from './_helpers';

export async function up(db: Kysely<any>, ctx: MigrateCtx): Promise<void> {
  await db.schema
    .createTable('certificate_templates')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('design', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('file_id', idType(ctx), (c) => c)
    .addColumn('conditions', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('certificates')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('template_id', idType(ctx), (c) => c)
    .addColumn('student_id', idType(ctx), (c) => c.notNull())
    .addColumn('class_id', idType(ctx), (c) => c)
    .addColumn('code', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('issued'))
    .addColumn('revoke_reason', 'text', (c) => c)
    .addColumn('issued_by', idType(ctx), (c) => c)
    .addColumn('issued_at', 'datetime', (c) => c.notNull())
    .addColumn('file_id', idType(ctx), (c) => c)
    .addColumn('verification_token', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('revoked_by', idType(ctx), (c) => c)
    .addColumn('revoked_at', 'datetime', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('certificates_student_idx')
    .ifNotExists()
    .on('certificates')
    .column('student_id')
    .execute();

  await db.schema
    .createTable('sms_patterns')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('pattern_code', 'varchar(191)', (c) => c.notNull())
    .addColumn('provider', 'varchar(64)', (c) => c.notNull().defaultTo('ippanel'))
    .addColumn('variables', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('sms_events')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('event_key', 'varchar(128)', (c) => c.notNull().unique())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('pattern_id', idType(ctx), (c) => c)
    .addColumn('enabled', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('delay_minutes', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('mapping', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('condition', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('recipient', 'varchar(64)', (c) => c.notNull().defaultTo('student'))
    .addColumn('retry_max', 'integer', (c) => c.notNull().defaultTo(3))
    .addColumn('retry_backoff_minutes', 'integer', (c) => c.notNull().defaultTo(5))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('sms_queue')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('event_id', idType(ctx), (c) => c)
    .addColumn('recipient', 'varchar(32)', (c) => c.notNull())
    .addColumn('variables', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('dedupe_key', 'varchar(191)', (c) => c.notNull().unique())
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'datetime', (c) => c)
    .addColumn('last_error', 'text', (c) => c)
    .addColumn('sent_at', 'datetime', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('sms_queue_status_next_idx')
    .ifNotExists()
    .on('sms_queue')
    .columns(['status', 'next_attempt_at'])
    .execute();

  await db.schema
    .createTable('notifications')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('user_id', idType(ctx), (c) => c.notNull())
    .addColumn('type', 'varchar(64)', (c) => c.notNull())
    .addColumn('title', 'varchar(255)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c)
    .addColumn('link', 'varchar(255)', (c) => c)
    .addColumn('read_at', 'datetime', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('notifications_user_read_idx')
    .ifNotExists()
    .on('notifications')
    .columns(['user_id', 'read_at'])
    .execute();
}
