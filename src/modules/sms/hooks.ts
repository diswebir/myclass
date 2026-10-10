/**
 * Domain event hooks → صف پیامک. Best-effort: هیچ خطایی به flow اصلی برنمی‌گردد.
 * (REQ-P6-03/04 — رویدادهای enrollment_created / payment_approved / certificate_issued)
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { Config } from '../../core/config/env';
import { logger } from '../../core/logger/logger';
import { SmsService, tryEnqueue } from './sms.service';

async function fetchStudentName(db: Kysely<Database>, studentId: number): Promise<string> {
  const row = await db
    .selectFrom('students')
    .select(['first_name', 'last_name'])
    .where('id', '=', studentId)
    .executeTakeFirst();
  return row ? `${row.first_name} ${row.last_name}` : '';
}

export async function notifyEnrollmentCreated(
  db: Kysely<Database>,
  config: Config,
  ctx: { enrollmentId: number; classId: number; studentId: number },
): Promise<void> {
  try {
    const studentName = await fetchStudentName(db, ctx.studentId);
    await tryEnqueue(
      new SmsService(db, config),
      'enrollment_created',
      { entityType: 'enrollment', entityId: ctx.enrollmentId, studentId: ctx.studentId, classId: ctx.classId },
      { student_name: studentName },
    );
  } catch (err) {
    logger.warn('sms hook enrollment_created failed (ignored)', { error: (err as Error).message });
  }
}

export async function notifyPaymentApproved(
  db: Kysely<Database>,
  config: Config,
  ctx: { paymentId: number; studentId: number; enrollmentId: number | null; amount: string },
): Promise<void> {
  try {
    const studentName = await fetchStudentName(db, ctx.studentId);
    let classTitle = '';
    if (ctx.enrollmentId) {
      const row = await db
        .selectFrom('enrollments')
        .innerJoin('classes', 'classes.id', 'enrollments.class_id')
        .select('classes.title')
        .where('enrollments.id', '=', ctx.enrollmentId)
        .executeTakeFirst();
      classTitle = row?.title ?? '';
    }
    await tryEnqueue(
      new SmsService(db, config),
      'payment_approved',
      {
        entityType: 'payment',
        entityId: ctx.paymentId,
        studentId: ctx.studentId,
        classId: ctx.enrollmentId ?? undefined,
      },
      { student_name: studentName, amount: ctx.amount, class_title: classTitle },
    );
  } catch (err) {
    logger.warn('sms hook payment_approved failed (ignored)', { error: (err as Error).message });
  }
}

export async function notifyCertificateIssued(
  db: Kysely<Database>,
  config: Config,
  ctx: { certificateId: number; studentId: number; classId: number | null; code: string; studentName: string; classTitle: string },
): Promise<void> {
  try {
    await tryEnqueue(
      new SmsService(db, config),
      'certificate_issued',
      { entityType: 'certificate', entityId: ctx.certificateId, studentId: ctx.studentId, classId: ctx.classId ?? undefined },
      { student_name: ctx.studentName, class_title: ctx.classTitle, cert_code: ctx.code },
    );
  } catch (err) {
    logger.warn('sms hook certificate_issued failed (ignored)', { error: (err as Error).message });
  }
}
