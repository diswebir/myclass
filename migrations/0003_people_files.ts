/** Migration 0003 — فایل‌ها و اشخاص: files, teachers, students */
import type { Kysely } from 'kysely';
import type { MigrateCtx } from './_helpers';
import { idType } from './_helpers';

export async function up(db: Kysely<any>, ctx: MigrateCtx): Promise<void> {
  await db.schema
    .createTable('files')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('owner_type', 'varchar(64)', (c) => c.notNull())
    .addColumn('owner_id', idType(ctx), (c) => c.notNull())
    .addColumn('stored_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('original_name', 'varchar(255)', (c) => c.notNull())
    .addColumn('mime', 'varchar(128)', (c) => c.notNull())
    .addColumn('size', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('storage_path', 'varchar(255)', (c) => c.notNull())
    .addColumn('uploaded_by', idType(ctx), (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();
  await db.schema
    .createIndex('files_owner_idx')
    .ifNotExists()
    .on('files')
    .columns(['owner_type', 'owner_id'])
    .execute();

  await db.schema
    .createTable('teachers')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('user_id', idType(ctx), (c) => c.unique())
    .addColumn('code', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('first_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('last_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('phone', 'varchar(32)', (c) => c.notNull())
    .addColumn('email', 'varchar(191)', (c) => c)
    .addColumn('specialties', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('active'))
    .addColumn('started_at', 'date', (c) => c)
    .addColumn('photo_file_id', idType(ctx), (c) => c)
    .addColumn('notes', 'text', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();
  await db.schema
    .createIndex('teachers_phone_idx')
    .ifNotExists()
    .on('teachers')
    .column('phone')
    .execute();

  await db.schema
    .createTable('students')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('user_id', idType(ctx), (c) => c.unique())
    .addColumn('code', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('first_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('last_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('phone', 'varchar(32)', (c) => c.notNull())
    .addColumn('email', 'varchar(191)', (c) => c)
    .addColumn('national_id', 'varchar(32)', (c) => c.unique())
    .addColumn('guardian_name', 'varchar(191)', (c) => c)
    .addColumn('guardian_phone', 'varchar(32)', (c) => c)
    .addColumn('birth_date', 'date', (c) => c)
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('active'))
    .addColumn('joined_at', 'date', (c) => c)
    .addColumn('notes', 'text', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();
  await db.schema
    .createIndex('students_phone_idx')
    .ifNotExists()
    .on('students')
    .column('phone')
    .execute();
}
