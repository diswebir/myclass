"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttendanceService = void 0;
const errors_1 = require("../../core/errors");
class AttendanceService {
    db;
    policyService;
    auditService;
    constructor(db, policyService, auditService) {
        this.db = db;
        this.policyService = policyService;
        this.auditService = auditService;
    }
    async getSessionAttendance(sessionId, user) {
        await this.policyService.assertCanAccessSession(user, sessionId);
        const session = await this.db.selectFrom('class_sessions').where('id', '=', sessionId).selectAll().executeTakeFirst();
        if (!session)
            throw new errors_1.NotFoundError('جلسه آموزشی یافت نشد.');
        // Fetch all active enrolled students in this class
        const enrollments = await this.db
            .selectFrom('enrollments')
            .innerJoin('students', 'enrollments.student_id', 'students.id')
            .innerJoin('users', 'students.user_id', 'users.id')
            .where('enrollments.class_id', '=', session.class_id)
            .where('enrollments.status', '=', 'active')
            .select([
            'students.id as student_id',
            'students.student_code',
            'users.full_name as student_name',
            'users.mobile'
        ])
            .orderBy('users.full_name', 'asc')
            .execute();
        // Fetch recorded attendance for this session
        const records = await this.db
            .selectFrom('attendance_records')
            .where('session_id', '=', sessionId)
            .selectAll()
            .execute();
        const recordMap = new Map();
        for (const r of records) {
            recordMap.set(r.student_id, r);
        }
        const roster = enrollments.map((enr) => {
            const studentId = enr.student_id;
            const rec = recordMap.get(studentId);
            return {
                studentId,
                studentName: enr.student_name,
                studentCode: enr.student_code,
                status: rec ? rec.status : 'unrecorded',
                note: rec?.note || '',
                updatedAt: rec?.updated_at || null
            };
        });
        return { session, roster };
    }
    async recordSessionAttendance(sessionId, records, user) {
        // Assert authorization: Only assigned teacher or authorized staff
        await this.policyService.assertCanAccessSession(user, sessionId);
        const session = await this.db.selectFrom('class_sessions').where('id', '=', sessionId).selectAll().executeTakeFirst();
        if (!session)
            throw new errors_1.NotFoundError('جلسه آموزشی یافت نشد.');
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        for (const item of records) {
            const existing = await this.db
                .selectFrom('attendance_records')
                .where('session_id', '=', sessionId)
                .where('student_id', '=', item.studentId)
                .selectAll()
                .executeTakeFirst();
            if (existing) {
                await this.db
                    .updateTable('attendance_records')
                    .set({
                    status: item.status,
                    note: item.note || null,
                    recorded_by_user_id: user.id,
                    updated_at: now
                })
                    .where('id', '=', existing.id)
                    .execute();
            }
            else {
                await this.db
                    .insertInto('attendance_records')
                    .values({
                    session_id: sessionId,
                    student_id: item.studentId,
                    status: item.status,
                    note: item.note || null,
                    recorded_by_user_id: user.id,
                    created_at: now,
                    updated_at: now
                })
                    .execute();
            }
        }
        // Mark session as 'held' if it was scheduled
        if (session.status === 'scheduled') {
            await this.db.updateTable('class_sessions').set({ status: 'held', updated_at: now }).where('id', '=', sessionId).execute();
        }
        if (this.auditService) {
            await this.auditService.log({
                userId: user.id,
                action: 'RECORD_ATTENDANCE',
                entityType: 'class_sessions',
                entityId: sessionId,
                newValues: { studentCount: records.length }
            });
        }
        return { message: 'حضور و غیاب با موفقیت ثبت شد.' };
    }
    async getClassAttendanceReport(classId, user) {
        await this.policyService.assertCanAccessClass(user, classId);
        const cls = await this.db.selectFrom('classes').where('id', '=', classId).selectAll().executeTakeFirst();
        if (!cls)
            throw new errors_1.NotFoundError('کلاس مورد نظر یافت نشد.');
        const sessions = await this.db
            .selectFrom('class_sessions')
            .where('class_id', '=', classId)
            .where('status', '=', 'held')
            .select('id')
            .execute();
        const heldSessionIds = sessions.map(s => s.id);
        const totalHeld = heldSessionIds.length;
        const enrollments = await this.db
            .selectFrom('enrollments')
            .innerJoin('students', 'enrollments.student_id', 'students.id')
            .innerJoin('users', 'students.user_id', 'users.id')
            .where('enrollments.class_id', '=', classId)
            .select([
            'students.id as student_id',
            'students.student_code',
            'users.full_name as student_name'
        ])
            .execute();
        if (totalHeld === 0) {
            return enrollments.map(e => ({
                studentId: e.student_id,
                studentName: e.student_name,
                studentCode: e.student_code,
                totalHeldSessions: 0,
                presentCount: 0,
                absentCount: 0,
                lateCount: 0,
                excusedCount: 0,
                attendancePercent: 100,
                hasExceededAbsenceLimit: false
            }));
        }
        const summaries = [];
        for (const enr of enrollments) {
            const studentId = enr.student_id;
            const records = await this.db
                .selectFrom('attendance_records')
                .where('student_id', '=', studentId)
                .where('session_id', 'in', heldSessionIds)
                .selectAll()
                .execute();
            let presentCount = 0;
            let absentCount = 0;
            let lateCount = 0;
            let excusedCount = 0;
            for (const r of records) {
                if (r.status === 'present')
                    presentCount++;
                else if (r.status === 'absent')
                    absentCount++;
                else if (r.status === 'late') {
                    lateCount++;
                    presentCount++; // Late counts as present with remark
                }
                else if (r.status === 'excused')
                    excusedCount++;
            }
            // Calculate attendance percent (excused does not penalize attendance)
            const countableSessions = Math.max(1, totalHeld - excusedCount);
            const attendancePercent = Math.min(100, Math.round((presentCount / countableSessions) * 100));
            // Check max allowed absences (default min attendance is 70%)
            const minPercent = cls.min_attendance_percent || 70;
            const hasExceeded = attendancePercent < minPercent;
            summaries.push({
                studentId,
                studentName: enr.student_name,
                studentCode: enr.student_code,
                totalHeldSessions: totalHeld,
                presentCount,
                absentCount,
                lateCount,
                excusedCount,
                attendancePercent,
                hasExceededAbsenceLimit: hasExceeded
            });
        }
        return summaries;
    }
    async getStudentPersonalAttendance(studentId, user) {
        // Assert authorization: only student themselves or staff
        await this.policyService.assertCanAccessStudent(user, studentId);
        const records = await this.db
            .selectFrom('attendance_records')
            .innerJoin('class_sessions', 'attendance_records.session_id', 'class_sessions.id')
            .innerJoin('classes', 'class_sessions.class_id', 'classes.id')
            .where('attendance_records.student_id', '=', studentId)
            .select([
            'attendance_records.id',
            'attendance_records.status',
            'attendance_records.note',
            'class_sessions.session_number',
            'class_sessions.session_date',
            'class_sessions.topic',
            'classes.id as class_id',
            'classes.title as class_title'
        ])
            .orderBy('class_sessions.session_date', 'desc')
            .execute();
        return records;
    }
}
exports.AttendanceService = AttendanceService;
