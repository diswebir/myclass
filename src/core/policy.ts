import { Kysely } from 'kysely';
import { DatabaseSchema, AuthUser } from './types';
import { AuthorizationError } from './errors';

export class PolicyService {
  constructor(private db: Kysely<DatabaseSchema>) {}

  // Check if user has permission string (e.g. 'classes.read', 'classes.*', or '*')
  hasPermission(user: AuthUser, requiredPermission: string): boolean {
    if (user.permissions.includes('*')) return true;
    if (user.permissions.includes(requiredPermission)) return true;

    // Support wildcard matching e.g. "classes.*" matches "classes.read"
    const [reqModule] = requiredPermission.split('.');
    if (user.permissions.includes(`${reqModule}.*`)) return true;

    return false;
  }

  // Teacher Class Access Policy
  async canAccessClass(user: AuthUser, classId: number, requiredPermission = 'classes.read'): Promise<boolean> {
    // If user is a teacher, they can ONLY access classes assigned to them
    if (user.role_name === 'teacher') {
      const teacher = await this.db
        .selectFrom('teachers')
        .where('user_id', '=', user.id)
        .select('id')
        .executeTakeFirst();

      if (!teacher || !teacher.id) return false;

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
  async canAccessStudent(user: AuthUser, studentId: number): Promise<boolean> {
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
  async canAccessEnrollment(user: AuthUser, enrollmentId: number): Promise<boolean> {
    const enrollment = await this.db
      .selectFrom('enrollments')
      .where('id', '=', enrollmentId)
      .select(['student_id', 'class_id'])
      .executeTakeFirst();

    if (!enrollment) return false;

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
  async canAccessSession(user: AuthUser, sessionId: number): Promise<boolean> {
    const session = await this.db
      .selectFrom('class_sessions')
      .where('id', '=', sessionId)
      .select('class_id')
      .executeTakeFirst();

    if (!session) return false;

    if (user.role_name === 'teacher') {
      return this.canAccessClass(user, session.class_id);
    }

    if (this.hasPermission(user, 'sessions.read') || user.permissions.includes('*')) {
      return true;
    }

    return false;
  }

  // Guard assertions that throw AuthorizationError if false
  async assertCanAccessClass(user: AuthUser, classId: number, permission = 'classes.read'): Promise<void> {
    const allowed = await this.canAccessClass(user, classId, permission);
    if (!allowed) {
      throw new AuthorizationError('شما دسترسی به این کلاس را ندارید.');
    }
  }

  async assertCanAccessStudent(user: AuthUser, studentId: number): Promise<void> {
    const allowed = await this.canAccessStudent(user, studentId);
    if (!allowed) {
      throw new AuthorizationError('شما دسترسی به اطلاعات این فراگیر را ندارید.');
    }
  }

  async assertCanAccessEnrollment(user: AuthUser, enrollmentId: number): Promise<void> {
    const allowed = await this.canAccessEnrollment(user, enrollmentId);
    if (!allowed) {
      throw new AuthorizationError('شما دسترسی به این پرونده ثبت‌نام را ندارید.');
    }
  }

  async assertCanAccessSession(user: AuthUser, sessionId: number): Promise<void> {
    const allowed = await this.canAccessSession(user, sessionId);
    if (!allowed) {
      throw new AuthorizationError('شما دسترسی به این جلسه آموزشی را ندارید.');
    }
  }

  assertPermission(user: AuthUser, permission: string): void {
    if (!this.hasPermission(user, permission)) {
      throw new AuthorizationError(`دسترسی لازم برای عملیات (${permission}) را ندارید.`);
    }
  }
}
