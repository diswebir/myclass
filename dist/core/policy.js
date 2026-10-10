"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyService = void 0;
const errors_1 = require("./errors");
class PolicyService {
    db;
    constructor(db) {
        this.db = db;
    }
    // Check if user has permission string (e.g. 'classes.read', 'classes.*', or '*')
    hasPermission(user, requiredPermission) {
        if (user.permissions.includes('*'))
            return true;
        if (user.permissions.includes(requiredPermission))
            return true;
        // Support wildcard matching e.g. "classes.*" matches "classes.read"
        const [reqModule] = requiredPermission.split('.');
        if (user.permissions.includes(`${reqModule}.*`))
            return true;
        return false;
    }
    // Teacher Class Access Policy
    async canAccessClass(user, classId, requiredPermission = 'classes.read') {
        // If user is a teacher, they can ONLY access classes assigned to them
        if (user.role_name === 'teacher') {
            const teacher = await this.db
                .selectFrom('teachers')
                .where('user_id', '=', user.id)
                .select('id')
                .executeTakeFirst();
            if (!teacher || !teacher.id)
                return false;
            const assignment = await this.db
                .selectFrom('class_teachers')
                .where('class_id', '=', classId)
                .where('teacher_id', '=', teacher.id)
                .select('id')
                .executeTakeFirst();
            return !!assignment;
        }
        if (user.permissions.includes('*') || this.hasPermission(user, requiredPermission)) {
            return true;
        }
        return false;
    }
    // Student Access Policy: A student may only access resources belonging to their student profile
    async canAccessStudent(user, studentId) {
        if (user.role_name === 'student') {
            const student = await this.db
                .selectFrom('students')
                .where('user_id', '=', user.id)
                .select('id')
                .executeTakeFirst();
            return student?.id === studentId;
        }
        if (this.hasPermission(user, 'students.read') || user.permissions.includes('*')) {
            return true;
        }
        return false;
    }
    // Enrollment Access Policy
    async canAccessEnrollment(user, enrollmentId) {
        const enrollment = await this.db
            .selectFrom('enrollments')
            .where('id', '=', enrollmentId)
            .select(['student_id', 'class_id'])
            .executeTakeFirst();
        if (!enrollment)
            return false;
        if (user.role_name === 'student') {
            return this.canAccessStudent(user, enrollment.student_id);
        }
        if (user.role_name === 'teacher') {
            return this.canAccessClass(user, enrollment.class_id);
        }
        if (this.hasPermission(user, 'enrollment.read') || user.permissions.includes('*')) {
            return true;
        }
        return false;
    }
    // Session Access Policy (for recording attendance, viewing logs)
    async canAccessSession(user, sessionId) {
        const session = await this.db
            .selectFrom('class_sessions')
            .where('id', '=', sessionId)
            .select('class_id')
            .executeTakeFirst();
        if (!session)
            return false;
        if (user.role_name === 'teacher') {
            return this.canAccessClass(user, session.class_id);
        }
        if (this.hasPermission(user, 'sessions.read') || user.permissions.includes('*')) {
            return true;
        }
        return false;
    }
    // Guard assertions that throw AuthorizationError if false
    async assertCanAccessClass(user, classId, permission = 'classes.read') {
        const allowed = await this.canAccessClass(user, classId, permission);
        if (!allowed) {
            throw new errors_1.AuthorizationError('شما دسترسی به این کلاس را ندارید.');
        }
    }
    async assertCanAccessStudent(user, studentId) {
        const allowed = await this.canAccessStudent(user, studentId);
        if (!allowed) {
            throw new errors_1.AuthorizationError('شما دسترسی به اطلاعات این فراگیر را ندارید.');
        }
    }
    async assertCanAccessEnrollment(user, enrollmentId) {
        const allowed = await this.canAccessEnrollment(user, enrollmentId);
        if (!allowed) {
            throw new errors_1.AuthorizationError('شما دسترسی به این پرونده ثبت‌نام را ندارید.');
        }
    }
    async assertCanAccessSession(user, sessionId) {
        const allowed = await this.canAccessSession(user, sessionId);
        if (!allowed) {
            throw new errors_1.AuthorizationError('شما دسترسی به این جلسه آموزشی را ندارید.');
        }
    }
    assertPermission(user, permission) {
        if (!this.hasPermission(user, permission)) {
            throw new errors_1.AuthorizationError(`دسترسی لازم برای عملیات (${permission}) را ندارید.`);
        }
    }
}
exports.PolicyService = PolicyService;
