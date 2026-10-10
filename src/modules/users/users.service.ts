import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { hashPassword, normalizeMobile, isValidIranianMobile } from '../../core/security';
import { ValidationError, ConflictError, NotFoundError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export class UsersService {
  constructor(private db: Kysely<DatabaseSchema>, private auditService?: AuditService) {}

  async listUsers(options: { search?: string; roleId?: number; status?: string; limit?: number; offset?: number }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = this.db
      .selectFrom('users')
      .innerJoin('roles', 'users.role_id', 'roles.id')
      .where('users.deleted_at', 'is', null);

    if (options.roleId) {
      query = query.where('users.role_id', '=', options.roleId);
    }

    if (options.status) {
      query = query.where('users.status', '=', options.status as any);
    }

    if (options.search) {
      const s = `%${options.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('users.full_name', 'like', s),
          eb('users.mobile', 'like', s),
          eb('users.email', 'like', s)
        ])
      );
    }

    const totalRes = await query.select(this.db.fn.count('users.id').as('count')).executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const users = await query
      .select([
        'users.id',
        'users.full_name',
        'users.mobile',
        'users.email',
        'users.role_id',
        'users.status',
        'users.avatar_path',
        'users.created_at',
        'roles.name as role_name',
        'roles.title_fa as role_title_fa'
      ])
      .orderBy('users.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return { users, total, limit, offset };
  }

  async getUserById(userId: number) {
    const user = await this.db
      .selectFrom('users')
      .innerJoin('roles', 'users.role_id', 'roles.id')
      .where('users.id', '=', userId)
      .where('users.deleted_at', 'is', null)
      .select([
        'users.id',
        'users.full_name',
        'users.mobile',
        'users.email',
        'users.role_id',
        'users.status',
        'users.avatar_path',
        'users.created_at',
        'roles.name as role_name',
        'roles.title_fa as role_title_fa'
      ])
      .executeTakeFirst();

    if (!user) throw new NotFoundError('کاربر مورد نظر یافت نشد.');
    return user;
  }

  async createUser(data: {
    fullName: string;
    mobile: string;
    email?: string;
    password: string;
    roleId: number;
    status?: 'active' | 'inactive' | 'suspended';
  }, actorUserId?: number) {
    const mobile = normalizeMobile(data.mobile);
    if (!isValidIranianMobile(mobile)) {
      throw new ValidationError('شماره همراه نامعتبر است (فرمت معتبر: ۰۹۱۲۳۴۵۶۷۸۹).');
    }

    if (!data.password || data.password.length < 8) {
      throw new ValidationError('رمز عبور باید حداقل ۸ کاراکتر باشد.');
    }

    const existingMobile = await this.db
      .selectFrom('users')
      .where('mobile', '=', mobile)
      .where('deleted_at', 'is', null)
      .select('id')
      .executeTakeFirst();

    if (existingMobile) {
      throw new ConflictError('کاربری با این شماره همراه قبلاً ثبت شده است.');
    }

    if (data.email) {
      const existingEmail = await this.db
        .selectFrom('users')
        .where('email', '=', data.email.trim().toLowerCase())
        .where('deleted_at', 'is', null)
        .select('id')
        .executeTakeFirst();

      if (existingEmail) {
        throw new ConflictError('کاربری با این آدرس ایمیل قبلاً ثبت شده است.');
      }
    }

    const passwordHash = await hashPassword(data.password);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const result = await this.db.insertInto('users').values({
      full_name: data.fullName.trim(),
      mobile,
      email: data.email ? data.email.trim().toLowerCase() : null,
      password_hash: passwordHash,
      role_id: data.roleId,
      status: data.status || 'active',
      avatar_path: null,
      must_change_password: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null
    }).execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CREATE_USER',
        entityType: 'users',
        entityId: Number(result[0]?.insertId || 0),
        newValues: { fullName: data.fullName, mobile, roleId: data.roleId }
      });
    }

    return result;
  }

  async updateUser(userId: number, data: {
    fullName?: string;
    mobile?: string;
    email?: string;
    roleId?: number;
    status?: 'active' | 'inactive' | 'suspended';
    password?: string;
  }, actorUserId?: number) {
    const user = await this.getUserById(userId);

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updates: any = { updated_at: now };

    if (data.fullName) updates.full_name = data.fullName.trim();

    if (data.mobile) {
      const mobile = normalizeMobile(data.mobile);
      if (!isValidIranianMobile(mobile)) {
        throw new ValidationError('شماره همراه نامعتبر است.');
      }
      if (mobile !== user.mobile) {
        const exist = await this.db.selectFrom('users').where('mobile', '=', mobile).where('id', '!=', userId).select('id').executeTakeFirst();
        if (exist) throw new ConflictError('این شماره همراه به کاربر دیگری اختصاص دارد.');
        updates.mobile = mobile;
      }
    }

    if (data.email !== undefined) {
      const cleanEmail = data.email ? data.email.trim().toLowerCase() : null;
      if (cleanEmail && cleanEmail !== user.email) {
        const exist = await this.db.selectFrom('users').where('email', '=', cleanEmail).where('id', '!=', userId).select('id').executeTakeFirst();
        if (exist) throw new ConflictError('این آدرس ایمیل به کاربر دیگری اختصاص دارد.');
      }
      updates.email = cleanEmail;
    }

    if (data.roleId) updates.role_id = data.roleId;
    if (data.status) updates.status = data.status;
    if (data.password && data.password.length >= 8) {
      updates.password_hash = await hashPassword(data.password);
    }

    await this.db.updateTable('users').set(updates).where('id', '=', userId).execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'UPDATE_USER',
        entityType: 'users',
        entityId: userId,
        oldValues: { fullName: user.full_name, mobile: user.mobile, roleId: user.role_id, status: user.status },
        newValues: updates
      });
    }
  }

  async deleteUser(userId: number, actorUserId?: number) {
    const user = await this.getUserById(userId);
    if (user.role_name === 'super_admin') {
      const adminCount = await this.db
        .selectFrom('users')
        .innerJoin('roles', 'users.role_id', 'roles.id')
        .where('roles.name', '=', 'super_admin')
        .where('users.deleted_at', 'is', null)
        .select(this.db.fn.count('users.id').as('count'))
        .executeTakeFirst();

      if (Number(adminCount?.count || 0) <= 1) {
        throw new ValidationError('نمی‌توان تنها مدیر اصلی سامانه را حذف کرد.');
      }
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await this.db.updateTable('users').set({ deleted_at: now }).where('id', '=', userId).execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'DELETE_USER',
        entityType: 'users',
        entityId: userId,
        oldValues: { mobile: user.mobile, fullName: user.full_name }
      });
    }
  }
}
