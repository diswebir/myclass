/** Migration 0004 — آموزشی: courses, classes, class_teachers, class_sessions, prereg_forms, preregistrations, enrollments */
import type { Kysely } from 'kysely';
import type { MigrateCtx } from './_helpers';
import { idType } from './_helpers';

export async function up(db: Kysely<any>, ctx: MigrateCtx): Promise<void> {
  await db.schema
    .createTable('courses')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('title', 'varchar(255)', (c) => c.notNull())
    .addColumn('code', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('category', 'varchar(128)', (c) => c)
    .addColumn('level', 'varchar(64)', (c) => c)
    .addColumn('description', 'text', (c) => c)
    .addColumn('default_fee', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('duration_hours', 'integer', (c) => c)
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();

  await db.schema
    .createTable('classes')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('course_id', idType(ctx), (c) => c)
    .addColumn('title', 'varchar(255)', (c) => c.notNull())
    .addColumn('code', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('description', 'text', (c) => c)
    .addColumn('type', 'varchar(64)', (c) => c)
    .addColumn('category', 'varchar(128)', (c) => c)
    .addColumn('level', 'varchar(64)', (c) => c)
    .addColumn('capacity', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('fee', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('start_date', 'date', (c) => c)
    .addColumn('end_date', 'date', (c) => c)
    .addColumn('weekdays', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('start_time', 'varchar(8)', (c) => c)
    .addColumn('end_time', 'varchar(8)', (c) => c)
    .addColumn('location', 'varchar(191)', (c) => c)
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('draft'))
    .addColumn('poster_file_id', idType(ctx), (c) => c)
    .addColumn('prereg_enabled', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('prereg_deadline', 'date', (c) => c)
    .addColumn('prerequisites', 'text', (c) => c)
    .addColumn('cancellation_policy', 'text', (c) => c)
    .addColumn('created_by', idType(ctx), (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();
  await db.schema
    .createIndex('classes_status_idx')
    .ifNotExists()
    .on('classes')
    .column('status')
    .execute();
  await db.schema
    .createIndex('classes_course_idx')
    .ifNotExists()
    .on('classes')
    .column('course_id')
    .execute();

  await db.schema
    .createTable('class_teachers')
    .ifNotExists()
    .addColumn('class_id', idType(ctx), (c) => c.notNull())
    .addColumn('teacher_id', idType(ctx), (c) => c.notNull())
    .addColumn('assigned_at', 'datetime', (c) => c.notNull())
    .addColumn('assigned_by', idType(ctx), (c) => c)
    .addColumn('removed_at', 'datetime', (c) => c)
    .addPrimaryKeyConstraint('class_teachers_pk', ['class_id', 'teacher_id'])
    .execute();

  await db.schema
    .createTable('class_sessions')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('class_id', idType(ctx), (c) => c.notNull())
    .addColumn('session_date', 'date', (c) => c.notNull())
    .addColumn('start_time', 'varchar(8)', (c) => c)
    .addColumn('duration_minutes', 'integer', (c) => c)
    .addColumn('topic', 'varchar(255)', (c) => c)
    .addColumn('teacher_id', idType(ctx), (c) => c)
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('held'))
    .addColumn('status_note', 'text', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();
  await db.schema
    .createIndex('class_sessions_class_date_idx')
    .ifNotExists()
    .on('class_sessions')
    .columns(['class_id', 'session_date'])
    .execute();

  await db.schema
    .createTable('prereg_forms')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('class_id', idType(ctx), (c) => c.notNull().unique())
    .addColumn('fields', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('preregistrations')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('class_id', idType(ctx), (c) => c.notNull())
    .addColumn('form_id', idType(ctx), (c) => c)
    .addColumn('tracking_code', 'varchar(32)', (c) => c.notNull().unique())
    .addColumn('applicant_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('phone', 'varchar(32)', (c) => c.notNull())
    .addColumn('email', 'varchar(191)', (c) => c)
    .addColumn('field_values', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('review_note', 'text', (c) => c)
    .addColumn('reviewed_by', idType(ctx), (c) => c)
    .addColumn('reviewed_at', 'datetime', (c) => c)
    .addColumn('converted_enrollment_id', idType(ctx), (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('prereg_class_status_idx')
    .ifNotExists()
    .on('preregistrations')
    .columns(['class_id', 'status'])
    .execute();
  await db.schema
    .createIndex('prereg_phone_idx')
    .ifNotExists()
    .on('preregistrations')
    .column('phone')
    .execute();

  await db.schema
    .createTable('enrollments')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('class_id', idType(ctx), (c) => c.notNull())
    .addColumn('student_id', idType(ctx), (c) => c.notNull())
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('active'))
    .addColumn('fee_amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('discount_amount', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('enrolled_by', idType(ctx), (c) => c)
    .addColumn('enrolled_at', 'datetime', (c) => c.notNull())
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();
  // یک سبت‌نام فعال برای هر (کلاس، فراگیر) — قید یکتا per spec §۶-ب
  await db.schema
    .createIndex('enrollments_class_student_uq')
    .ifNotExists()
    .on('enrollments')
    .columns(['class_id', 'student_id'])
    .unique()
    .execute();
  await db.schema
    .createIndex('enrollments_student_idx')
    .ifNotExists()
    .on('enrollments')
    .column('student_id')
    .execute();
}
