/**
 * Dashboard service — KPIهای واقعی از DB + ۷ مجموعه داده نمودار (Chart.js self-host).
 * محتوای per نقش: admin/مدیر KPIs کامل؛ استاد محدود به کلاس‌های خودش؛ فراگیر محدود به خودش. (REQ-P7-01)
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { AuthUser } from '../../core/http/context';
import { hasPermission } from '../../core/http/context';
import { toDbDate } from '../../core/db/time';

export type RangeDays = 7 | 30 | 90;

export class DashboardService {
  constructor(private readonly db: Kysely<Database>) {}

  private isFullAccess(user: AuthUser): boolean {
    // managerial roles (the '*:*' wildcard is expanded to concrete permissions at seed time)
    if (user.roles.includes('super_admin') || user.roles.includes('admin')) return true;
    return user.permissions.includes('*:*');
  }

  private async teacherClassIds(userId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('classes')
      .innerJoin('class_teachers', 'class_teachers.class_id', 'classes.id')
      .innerJoin('teachers', 'teachers.id', 'class_teachers.teacher_id')
      .select('classes.id')
      .where('teachers.user_id', '=', userId)
      .where('classes.deleted_at', 'is', null)
      .execute();
    return rows.map((r) => Number(r.id));
  }

  private async studentRowId(userId: number): Promise<number | null> {
    const row = await this.db.selectFrom('students').select('id').where('user_id', '=', userId).executeTakeFirst();
    return row ? Number(row.id) : null;
  }

  /** KPIs — admin: کامل؛ استاد: کلاس‌های خودش؛ فراگیر: خودش. */
  async kpis(user: AuthUser) {
    const today = toDbDate(new Date());
    const full = this.isFullAccess(user);
    if (full) {
      const [
        studentsTotal,
        studentsActive,
        teachersActive,
        classesByStatus,
        preregTotal,
        preregPending,
        sessionsToday,
        attendanceToday,
        feeRow,
        paidRow,
        overdueRow,
        pendingPayments,
        certsActive,
        smsStats,
      ] = await Promise.all([
        this.db.selectFrom('students').select((eb) => eb.fn.countAll().as('c')).where('deleted_at', 'is', null).executeTakeFirstOrThrow(),
        this.db.selectFrom('students').select((eb) => eb.fn.countAll().as('c')).where('deleted_at', 'is', null).where('status', '=', 'active').executeTakeFirstOrThrow(),
        this.db.selectFrom('teachers').select((eb) => eb.fn.countAll().as('c')).where('status', '=', 'active').executeTakeFirstOrThrow(),
        this.db.selectFrom('classes').select(['status']).select((eb) => eb.fn.countAll().as('c')).where('deleted_at', 'is', null).groupBy('status').execute(),
        this.db.selectFrom('preregistrations').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow(),
        this.db.selectFrom('preregistrations').select((eb) => eb.fn.countAll().as('c')).where('status', '=', 'pending').executeTakeFirstOrThrow(),
        this.db.selectFrom('class_sessions').select((eb) => eb.fn.countAll().as('c')).where('session_date', '=', today).where('deleted_at', 'is', null).executeTakeFirstOrThrow(),
        this.db
          .selectFrom('attendance')
          .innerJoin('class_sessions', 'class_sessions.id', 'attendance.session_id')
          .select(['attendance.status'])
          .select((eb) => eb.fn.countAll().as('c'))
          .where('class_sessions.session_date', '=', today)
          .where('attendance.status', '!=', 'unset')
          .groupBy('attendance.status')
          .execute(),
        this.db.selectFrom('enrollments').select((eb) => eb.fn.sum('fee_amount').as('s')).executeTakeFirstOrThrow(),
        this.db.selectFrom('payments').select((eb) => eb.fn.sum('amount').as('s')).where('status', '=', 'approved').executeTakeFirstOrThrow(),
        this.db
          .selectFrom('installments')
          .select((eb) => eb.fn.countAll().as('c'))
          .where('status', '=', 'unpaid')
          .where('due_date', '<', today)
          .executeTakeFirstOrThrow(),
        this.db.selectFrom('payments').select((eb) => eb.fn.countAll().as('c')).where('status', '=', 'pending').executeTakeFirstOrThrow(),
        this.db.selectFrom('certificates').select((eb) => eb.fn.countAll().as('c')).where('status', '=', 'active').executeTakeFirstOrThrow(),
        this.db
          .selectFrom('sms_queue')
          .select(['status'])
          .select((eb) => eb.fn.countAll().as('c'))
          .groupBy('status')
          .execute(),
      ]);
      const attendanceMap: Record<string, number> = {};
      for (const r of attendanceToday) attendanceMap[r.status] = Number(r.c);
      const smsMap: Record<string, number> = {};
      for (const r of smsStats) smsMap[r.status] = Number(r.c);
      const classesMap: Record<string, number> = {};
      for (const r of classesByStatus) classesMap[r.status] = Number(r.c);
      const fee = String(feeRow.s ?? '0');
      const paid = String(paidRow.s ?? '0');
      return {
        scope: 'full' as const,
        students: { total: Number(studentsTotal.c), active: Number(studentsActive.c) },
        teachers: { active: Number(teachersActive.c) },
        classes: classesMap,
        prereg: { total: Number(preregTotal.c), pending: Number(preregPending.c) },
        sessionsToday: Number(sessionsToday.c),
        attendanceToday: attendanceMap,
        finance: { feeRegistered: fee, received: paid, receivables: String(BigInt(fee) - BigInt(paid)) },
        installmentsOverdue: Number(overdueRow.c),
        paymentsPending: Number(pendingPayments.c),
        certificatesActive: Number(certsActive.c),
        sms: smsMap,
      };
    }
    // استاد — محدود به کلاس‌های خودش
    if (user.roles.includes('teacher')) {
      const classIds = await this.teacherClassIds(user.id);
      if (classIds.length === 0) return { scope: 'teacher' as const, classIds, students: 0, sessions: 0, attendance: {} };
      const enrollments = await this.db
        .selectFrom('enrollments')
        .select((eb) => eb.fn.countAll().as('c'))
        .where('class_id', 'in', classIds)
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      const sessions = await this.db
        .selectFrom('class_sessions')
        .select((eb) => eb.fn.countAll().as('c'))
        .where('class_id', 'in', classIds)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const att = await this.db
        .selectFrom('attendance')
        .innerJoin('class_sessions', 'class_sessions.id', 'attendance.session_id')
        .select(['attendance.status'])
        .select((eb) => eb.fn.countAll().as('c'))
        .where('class_sessions.class_id', 'in', classIds)
        .where('attendance.status', '!=', 'unset')
        .groupBy('attendance.status')
        .execute();
      const attendance: Record<string, number> = {};
      for (const r of att) attendance[r.status] = Number(r.c);
      return {
        scope: 'teacher' as const,
        classIds,
        students: Number(enrollments.c),
        sessions: Number(sessions.c),
        attendance,
      };
    }
    // فراگیر — خودش
    const studentId = await this.studentRowId(user.id);
    if (!studentId) return { scope: 'student' as const, enrollments: 0, balance: '0', certificates: 0, attendancePercent: 0 };
    const enrollments = await this.db
      .selectFrom('enrollments')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('student_id', '=', studentId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    const paidRow = await this.db
      .selectFrom('payments')
      .select((eb) => eb.fn.sum('amount').as('s'))
      .where('student_id', '=', studentId)
      .where('status', '=', 'approved')
      .executeTakeFirstOrThrow();
    const dueRow = await this.db
      .selectFrom('enrollments')
      .select((eb) => eb.fn.sum('fee_amount').as('f'))
      .select((eb) => eb.fn.sum('discount_amount').as('d'))
      .where('student_id', '=', studentId)
      .executeTakeFirstOrThrow();
    const certs = await this.db
      .selectFrom('certificates')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('student_id', '=', studentId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    const att = await this.db
      .selectFrom('attendance')
      .select(['status'])
      .select((eb) => eb.fn.countAll().as('c'))
      .where('student_id', '=', studentId)
      .where('status', '!=', 'unset')
      .groupBy('status')
      .execute();
    const attendance: Record<string, number> = {};
    for (const r of att) attendance[r.status] = Number(r.c);
    const total = Object.values(attendance).reduce((a, b) => a + b, 0);
    const present = (attendance.present ?? 0) + (attendance.late ?? 0);
    const due = BigInt(String(dueRow.f ?? '0')) - BigInt(String(dueRow.d ?? '0'));
    const paid = BigInt(String(paidRow.s ?? '0'));
    return {
      scope: 'student' as const,
      enrollments: Number(enrollments.c),
      balance: String(due - paid),
      certificates: Number(certs.c),
      attendancePercent: total > 0 ? Math.round((present / total) * 100) : 0,
    };
  }

  /** ۷ نمودار — داده واقعی per محدوده زمانی (فقط دسترسی کامل). */
  async charts(user: AuthUser, range: RangeDays) {
    if (!this.isFullAccess(user)) return null;
    const days = range;
    const since = new Date(Date.now() - days * 86400000);
    const sinceDate = toDbDate(since);

    // 1. روند ثبت‌نام (per روز)
    const enrollRows = await this.db
      .selectFrom('enrollments')
      .select((eb) => eb.fn.countAll().as('c'))
      .select('enrolled_at')
      .where('enrolled_at', '>=', `${sinceDate} 00:00:00`)
      .groupBy('enrolled_at')
      .orderBy('enrolled_at')
      .execute();
    const enrollmentTrend = this.fillDays(days, enrollRows.map((r) => ({ d: String(r.enrolled_at).slice(0, 10), c: Number(r.c) })));

    // 2+6. مقایسه کلاس‌ها + ظرفیت در برابر ثبت‌نام
    const classRows = await this.db
      .selectFrom('classes')
      .select(['classes.id', 'classes.title', 'classes.capacity'])
      .select((eb) => eb.fn.countAll().as('c'))
      .leftJoin('enrollments', (j) => j.onRef('enrollments.class_id', '=', 'classes.id').on('enrollments.status', '=', 'active'))
      .where('classes.deleted_at', 'is', null)
      .groupBy(['classes.id', 'classes.title', 'classes.capacity'])
      .execute();
    const classComparison = classRows.map((r) => ({ title: r.title, enrolled: Number(r.c) }));
    const capacityVsEnrollment = classRows.map((r) => ({ title: r.title, capacity: Number(r.capacity), enrolled: Number(r.c) }));

    // 3. روند درآمد (پرداخت‌های تأییدشده per روز)
    const revenueRows = await this.db
      .selectFrom('payments')
      .select((eb) => eb.fn.sum('amount').as('s'))
      .select('created_at')
      .where('status', '=', 'approved')
      .where('created_at', '>=', `${sinceDate} 00:00:00`)
      .groupBy('created_at')
      .orderBy('created_at')
      .execute();
    const revenueTrend = this.fillDays(days, revenueRows.map((r) => ({ d: String(r.created_at).slice(0, 10), c: Number(r.s ?? 0) })));

    // 4. توزیع وضعیت پرداخت
    const payStatus = await this.db
      .selectFrom('payments')
      .select(['status'])
      .select((eb) => eb.fn.countAll().as('c'))
      .groupBy('status')
      .execute();
    const paymentStatus = payStatus.map((r) => ({ status: r.status, count: Number(r.c) }));

    // 5. حضور و غیاب (در محدوده)
    const attRows = await this.db
      .selectFrom('attendance')
      .innerJoin('class_sessions', 'class_sessions.id', 'attendance.session_id')
      .select(['attendance.status'])
      .select((eb) => eb.fn.countAll().as('c'))
      .where('class_sessions.session_date', '>=', sinceDate)
      .where('attendance.status', '!=', 'unset')
      .groupBy('attendance.status')
      .execute();
    const attendance = attRows.map((r) => ({ status: r.status, count: Number(r.c) }));

    // 7. آمار پیامک (در محدوده)
    const smsRows = await this.db
      .selectFrom('sms_queue')
      .select(['status'])
      .select((eb) => eb.fn.countAll().as('c'))
      .where('created_at', '>=', `${sinceDate} 00:00:00`)
      .groupBy('status')
      .execute();
    const sms = smsRows.map((r) => ({ status: r.status, count: Number(r.c) }));

    return {
      range: days,
      enrollmentTrend,
      classComparison,
      revenueTrend,
      paymentStatus,
      attendance,
      capacityVsEnrollment,
      sms,
    };
  }

  /** پر کردن روزهای بدون داده با صفر (برای نمودارهای پیوسته). */
  private fillDays(days: number, rows: Array<{ d: string; c: number }>): Array<{ date: string; count: number }> {
    const map = new Map(rows.map((r) => [r.d, r.c]));
    const out: Array<{ date: string; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = toDbDate(new Date(Date.now() - i * 86400000));
      out.push({ date: d, count: map.get(d) ?? 0 });
    }
    return out;
  }
}
