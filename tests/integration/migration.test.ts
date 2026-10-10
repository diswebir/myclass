/** تست‌های integration — migration: اجرا، idempotency، قیود یکتا، ایندکس‌ها. */
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config/env';
import { createDatabase } from '../../src/core/db/database';
import { migrateToLatest, listExecuted } from '../../src/core/db/migrate';
import type { Kysely } from 'kysely';

async function freshDb(): Promise<Kysely<any>> {
  const config = loadConfig({ DB_DRIVER: 'sqlite', DB_SQLITE_PATH: ':memory:', NODE_ENV: 'test' });
  return createDatabase(config);
}

describe('migration', () => {
  it('همه migrationها اجرا می‌شوند و در جدول migrations سبت می‌شوند', async () => {
    const db = await freshDb();
    try {
      const res = await migrateToLatest(db);
      expect(res.ran.length).toBe(6);
      const executed = await listExecuted(db);
      expect(executed.size).toBe(6);
    } finally {
      await db.destroy();
    }
  });

  it('اجرای مجدد idempotent است (هیچ migration جدیدی اجرا نمی‌شود)', async () => {
    const db = await freshDb();
    try {
      await migrateToLatest(db);
      const res2 = await migrateToLatest(db);
      expect(res2.ran).toEqual([]);
    } finally {
      await db.destroy();
    }
  });

  it('همه جداول اصلی ساخته می‌شوند', async () => {
    const db = await freshDb();
    try {
      await migrateToLatest(db);
      const rows = (await db
        .selectFrom('sqlite_master' as never)
        .select('name' as never)
        .where('type' as never, '=', 'table')
        .execute()) as Array<{ name: string }>;
      const tables = new Set(rows.map((r) => r.name));
      const expected = [
        'settings', 'system_state', 'modules_registry', 'audit_log', 'rate_limits',
        'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'user_sessions',
        'files', 'teachers', 'students', 'courses', 'classes', 'class_teachers',
        'class_sessions', 'prereg_forms', 'preregistrations', 'enrollments',
        'attendance', 'payment_methods', 'payments', 'installments', 'ledger_entries',
        'card_receipts', 'certificate_templates', 'certificates',
        'sms_patterns', 'sms_events', 'sms_queue', 'notifications', 'migrations',
      ];
      for (const t of expected) {
        expect(tables.has(t), `جدول ${t} باید ساخته شود`).toBe(true);
      }
    } finally {
      await db.destroy();
    }
  });

  it('قید یکتا — enrollments: یک سبت‌نام برای هر (class, student)', async () => {
    const db = await freshDb();
    try {
      await migrateToLatest(db);
      const now = '2026-10-10 00:00:00';
      await db.insertInto('classes').values({
        title: 'کلاس تست', code: 'C1', capacity: 10, fee: '0', status: 'open',
        weekdays: '[]', prereg_enabled: 0, created_at: now, updated_at: now,
      }).execute();
      await db.insertInto('students').values({
        code: 'S1', first_name: 'علی', last_name: 'رضایی', phone: '09120000001',
        status: 'active', created_at: now, updated_at: now,
      }).execute();
      const cls = await db.selectFrom('classes').select('id').where('code', '=', 'C1').executeTakeFirstOrThrow();
      const stu = await db.selectFrom('students').select('id').where('code', '=', 'S1').executeTakeFirstOrThrow();
      const values = {
        class_id: Number(cls.id), student_id: Number(stu.id), status: 'active',
        fee_amount: '0', discount_amount: '0', enrolled_at: now, created_at: now, updated_at: now,
      };
      await db.insertInto('enrollments').values(values).execute();
      // تکراری → باید خطا بدهد (UNIQUE)
      await expect(db.insertInto('enrollments').values(values).execute()).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });

  it('قید یکتا — attendance: یک حضور برای هر (session, student)', async () => {
    const db = await freshDb();
    try {
      await migrateToLatest(db);
      const now = '2026-10-10 00:00:00';
      await db.insertInto('classes').values({
        title: 'کلاس تست', code: 'C1', capacity: 10, fee: '0', status: 'open',
        weekdays: '[]', prereg_enabled: 0, created_at: now, updated_at: now,
      }).execute();
      await db.insertInto('students').values({
        code: 'S1', first_name: 'علی', last_name: 'رضایی', phone: '09120000001',
        status: 'active', created_at: now, updated_at: now,
      }).execute();
      const cls = await db.selectFrom('classes').select('id').where('code', '=', 'C1').executeTakeFirstOrThrow();
      await db.insertInto('class_sessions').values({
        class_id: Number(cls.id), session_date: '2026-10-10', status: 'held', created_at: now, updated_at: now,
      }).execute();
      const session = await db.selectFrom('class_sessions').select('id').limit(1).executeTakeFirstOrThrow();
      const stu = await db.selectFrom('students').select('id').where('code', '=', 'S1').executeTakeFirstOrThrow();
      const values = {
        session_id: Number(session.id), student_id: Number(stu.id),
        status: 'present', marked_at: now, created_at: now,
      };
      await db.insertInto('attendance').values(values).execute();
      await expect(db.insertInto('attendance').values(values).execute()).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });

  it('قید یکتا — students.code و teachers.code', async () => {
    const db = await freshDb();
    try {
      await migrateToLatest(db);
      const now = '2026-10-10 00:00:00';
      const student = {
        code: 'S1', first_name: 'علی', last_name: 'رضایی', phone: '09120000001',
        status: 'active', created_at: now, updated_at: now,
      };
      await db.insertInto('students').values(student).execute();
      await expect(db.insertInto('students').values(student).execute()).rejects.toThrow();
      const teacher = {
        code: 'T1', first_name: 'محمد', last_name: 'استاد', phone: '09120000002',
        specialties: '[]', status: 'active', created_at: now, updated_at: now,
      };
      await db.insertInto('teachers').values(teacher).execute();
      await expect(db.insertInto('teachers').values(teacher).execute()).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });
});
