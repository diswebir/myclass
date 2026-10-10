/** Migration 0002 — هویت: users, roles, permissions, role_permissions, user_roles, user_sessions */
import type { Kysely } from 'kysely';
import type { MigrateCtx } from './_helpers';
import { idType } from './_helpers';

export async function up(db: Kysely<any>, ctx: MigrateCtx): Promise<void> {
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('username', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('email', 'varchar(191)', (c) => c.unique())
    .addColumn('phone', 'varchar(32)', (c) => c.unique())
    .addColumn('password_hash', 'varchar(255)', (c) => c.notNull())
    .addColumn('full_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('must_change_password', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('failed_login_attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'datetime', (c) => c)
    .addColumn('last_login_at', 'datetime', (c) => c)
    .addColumn('last_login_ip', 'varchar(64)', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .addColumn('deleted_at', 'datetime', (c) => c)
    .execute();

  await db.schema
    .createTable('roles')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('slug', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('description', 'text', (c) => c)
    .addColumn('is_system', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('updated_at', 'datetime', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('permissions')
    .ifNotExists()
    .addColumn('id', idType(ctx), (c) => c.primaryKey().autoIncrement())
    .addColumn('module', 'varchar(64)', (c) => c.notNull())
    .addColumn('resource', 'varchar(64)', (c) => c.notNull())
    .addColumn('action', 'varchar(64)', (c) => c.notNull())
    .addColumn('description', 'varchar(255)', (c) => c)
    .execute();
  await db.schema
    .createIndex('permissions_triple_idx')
    .ifNotExists()
    .on('permissions')
    .columns(['module', 'resource', 'action'])
    .unique()
    .execute();

  await db.schema
    .createTable('role_permissions')
    .ifNotExists()
    .addColumn('role_id', idType(ctx), (c) => c.notNull())
    .addColumn('permission_id', idType(ctx), (c) => c.notNull())
    .addPrimaryKeyConstraint('role_permissions_pk', ['role_id', 'permission_id'])
    .execute();

  await db.schema
    .createTable('user_roles')
    .ifNotExists()
    .addColumn('user_id', idType(ctx), (c) => c.notNull())
    .addColumn('role_id', idType(ctx), (c) => c.notNull())
    .addPrimaryKeyConstraint('user_roles_pk', ['user_id', 'role_id'])
    .execute();

  await db.schema
    .createTable('user_sessions')
    .ifNotExists()
    .addColumn('token_hash', 'varchar(128)', (c) => c.primaryKey())
    .addColumn('user_id', idType(ctx), (c) => c.notNull())
    .addColumn('csrf_token', 'varchar(128)', (c) => c.notNull())
    .addColumn('ip', 'varchar(64)', (c) => c)
    .addColumn('user_agent', 'varchar(255)', (c) => c)
    .addColumn('created_at', 'datetime', (c) => c.notNull())
    .addColumn('expires_at', 'datetime', (c) => c.notNull())
    .addColumn('last_seen_at', 'datetime', (c) => c)
    .addColumn('revoked_at', 'datetime', (c) => c)
    .execute();
  await db.schema
    .createIndex('user_sessions_user_idx')
    .ifNotExists()
    .on('user_sessions')
    .column('user_id')
    .execute();
}
