/** Migration 0001 — سیستم: settings, system_state, modules_registry, audit_log, rate_limits */
import type { Kysely } from 'kysely';
import type { MigrateCtx } from './_helpers';
import { idType } from './_helpers';

export async function up(db: Kysely<any>, ctx: MigrateCtx): Promise<void> {
  await db.schema
    .createTable('settings')
    .ifNotExists()
    .addColumn('key', 'varchar(191)', (c) => c.primaryKey())
    .addColumn('category', 'varchar(64)', (c) => c.notNull().defaultTo('general'))
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('is_secret', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_by', idType(ctx), (c) => c)
    .execute();

  await db.schema
    .createTable('system_state')
    .ifNotExists()
    .addColumn('key', 'varchar(191)', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('modules_registry')
    .ifNotExists()
    .addColumn('slug', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('version', 'varchar(32)', (c) => c.notNull().defaultTo('1.0.0'))
    .addColumn('status', 'varchar(32)', (c) => c.notNull().defaultTo('enabled'))
    .addColumn('manifest', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('installed_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('audit_log')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('actor_id', idType(ctx), (c) => c)
    .addColumn('action', 'varchar(64)', (c) => c.notNull())
    .addColumn('module', 'varchar(64)', (c) => c.notNull().defaultTo('system'))
    .addColumn('entity_type', 'varchar(64)', (c) => c.notNull().defaultTo('-'))
    .addColumn('entity_id', 'varchar(64)', (c) => c.notNull().defaultTo('-'))
    .addColumn('meta', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('ip', 'varchar(64)', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex('audit_log_actor_idx')
    .ifNotExists()
    .on('audit_log')
    .column('actor_id')
    .execute();
  await db.schema
    .createIndex('audit_log_entity_idx')
    .ifNotExists()
    .on('audit_log')
    .columns(['entity_type', 'entity_id'])
    .execute();
  await db.schema
    .createIndex('audit_log_created_idx')
    .ifNotExists()
    .on('audit_log')
    .column('created_at')
    .execute();
  await db.schema
    .createIndex('audit_log_action_idx')
    .ifNotExists()
    .on('audit_log')
    .column('action')
    .execute();

  await db.schema
    .createTable('rate_limits')
    .ifNotExists()
    .addColumn('key', 'varchar(191)', (c) => c.primaryKey())
    .addColumn('window_start', 'datetime', (c) => c.notNull())
    .addColumn('count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('expires_at', 'datetime', (c) => c.notNull())
    .execute();
}
