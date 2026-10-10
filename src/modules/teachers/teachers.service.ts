import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { UsersService } from '../users/users.service';
import { ValidationError, NotFoundError, ConflictError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export class TeachersService {
  constructor(
    private db: Kysely<DatabaseSchema>,
    private usersService: UsersService,
    private auditService?: AuditService
  ) {}

  async listTeachers(options: { search?: string; status?: string; limit?: number; offset?: number }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = this.db
      .selectFrom('teachers')
      .innerJoin('users', 'teachers.user_id', 'users.id')
      .where('users.deleted_at', 'is', null);

    if (options.status) {
      query = query.where('teachers.contract_status', '=', options.status as any);
    }

    if (options.search) {
      const s = `%${options.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('users.full_name', 'like', s),
          eb('users.mobile', 'like', s),
          eb('teachers.internal_code', 'like', s),
          eb('teachers.specialties', 'like', s)
        ])
      );
    }

    const countRes = await query.select(this.db.fn.count('teachers.id').as('count')).executeTakeFirst();
    const total = Number(countRes?.count || 0);

    const teachers = await query
      .select([
        'teachers.id',
        'teachers.user_id',
        'teachers.internal_code',
        'teachers.specialties',
        'teachers.bio',
        'teachers.contract_status',
        'teachers.contract_start_date',
        'users.full_name',
        'users.mobile',
        'users.email',
        'users.status as user_status'
      ])
      .orderBy('teachers.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Attach active classes count for each teacher
    const teachersWithClassCount = await Promise.all(
      teachers.map(async (t) => {
        const cRes = await this.db
          .selectFrom('class_teachers')
          .where('teacher_id', '=', t.id!)
          .select(this.db.fn.count('id').as('count'))
          .executeTakeFirst();
        return {
          ...t,
          assignedClassesCount: Number(cRes?.count || 0)
        };
      })
    );

    return { teachers: teachersWithClassCount, total, limit, offset };
  }

  async getTeacherById(teacherId: number) {
    const teacher = await this.db
      .selectFrom('teachers')
      .innerJoin('users', 'teachers.user_id', 'users.id')
      .where('teachers.id', '=', teacherId)
      .where('users.deleted_at', 'is', null)
      .select([
        'teachers.id',
        'teachers.user_id',
        'teachers.internal_code',
        'teachers.specialties',
        'teachers.bio',
        'teachers.contract_status',
        'teachers.contract_start_date',
        'teachers.management_notes',
        'users.full_name',
        'users.mobile',
        'users.email',
        'users.status as user_status'
      ])
      .executeTakeFirst();

    if (!teacher) throw new NotFoundError('استاد مورد نظر یافت نشد.');

    const assignedClasses = await this.db
      .selectFrom('class_teachers')
      .innerJoin('classes', 'class_teachers.class_id', 'classes.id')
      .where('class_teachers.teacher_id', '=', teacherId)
      .where('classes.deleted_at', 'is', null)
      .select([
        'classes.id as class_id',
        'classes.title as class_title',
        'classes.code as class_code',
        'classes.status as class_status',
        'classes.start_date',
        'classes.end_date',
        'class_teachers.role_in_class'
      ])
      .execute();

    return { ...teacher, assignedClasses };
  }

  async getTeacherByUserId(userId: number) {
    const teacher = await this.db
      .selectFrom('teachers')
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst();
    return teacher || null;
  }

  async createTeacher(data: {
    fullName: string;
    mobile: string;
    email?: string;
    password: string;
    internalCode: string;
    specialties?: string;
    bio?: string;
    contractStatus?: 'active' | 'on_leave' | 'terminated';
    contractStartDate?: string;
    managementNotes?: string;
  }, actorUserId?: number) {
    // 1. Check internal code uniqueness
    const code = data.internalCode.trim();
    const existingCode = await this.db.selectFrom('teachers').where('internal_code', '=', code).select('id').executeTakeFirst();
    if (existingCode) {
      throw new ConflictError('کد داخلی استاد قبلاً ثبت شده است.');
    }

    // 2. Fetch role_id for teacher
    const teacherRole = await this.db.selectFrom('roles').where('name', '=', 'teacher').select('id').executeTakeFirst();
    if (!teacherRole) throw new Error('نقش استاد در سامانه تعریف نشده است.');

    // 3. Create user account
    const userRes = await this.usersService.createUser({
      fullName: data.fullName,
      mobile: data.mobile,
      email: data.email,
      password: data.password,
      roleId: teacherRole.id!
    }, actorUserId);

    const userId = Number(userRes[0]?.insertId);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // 4. Create teacher profile
    const teacherRes = await this.db.insertInto('teachers').values({
      user_id: userId,
      internal_code: code,
      specialties: data.specialties || null,
      bio: data.bio || null,
      contract_status: data.contractStatus || 'active',
      contract_start_date: data.contractStartDate || null,
      management_notes: data.managementNotes || null,
      created_at: now,
      updated_at: now
    }).execute();

    const teacherId = Number(teacherRes[0]?.insertId);

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CREATE_TEACHER',
        entityType: 'teachers',
        entityId: teacherId,
        newValues: { fullName: data.fullName, internalCode: code }
      });
    }

    return { teacherId, userId };
  }

  async updateTeacher(teacherId: number, data: {
    fullName?: string;
    mobile?: string;
    email?: string;
    specialties?: string;
    bio?: string;
    contractStatus?: 'active' | 'on_leave' | 'terminated';
    contractStartDate?: string;
    managementNotes?: string;
  }, actorUserId?: number) {
    const teacher = await this.getTeacherById(teacherId);

    // Update user info if name, mobile or email changed
    if (data.fullName || data.mobile || data.email !== undefined) {
      await this.usersService.updateUser(teacher.user_id, {
        fullName: data.fullName,
        mobile: data.mobile,
        email: data.email
      }, actorUserId);
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updates: any = { updated_at: now };
    if (data.specialties !== undefined) updates.specialties = data.specialties;
    if (data.bio !== undefined) updates.bio = data.bio;
    if (data.contractStatus) updates.contract_status = data.contractStatus;
    if (data.contractStartDate !== undefined) updates.contract_start_date = data.contractStartDate;
    if (data.managementNotes !== undefined) updates.management_notes = data.managementNotes;

    await this.db.updateTable('teachers').set(updates).where('id', '=', teacherId).execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'UPDATE_TEACHER',
        entityType: 'teachers',
        entityId: teacherId,
        newValues: updates
      });
    }
  }
}
