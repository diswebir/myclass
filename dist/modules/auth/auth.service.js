"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const security_1 = require("../../core/security");
const errors_1 = require("../../core/errors");
const logger_1 = require("../../core/logger");
class AuthService {
    db;
    constructor(db) {
        this.db = db;
    }
    async login(identifier, plainTextPassword, ipAddress, userAgent) {
        const isEmail = identifier.includes('@');
        const normalizedMobile = (0, security_1.normalizeMobile)(identifier);
        let query = this.db
            .selectFrom('users')
            .innerJoin('roles', 'users.role_id', 'roles.id')
            .where('users.deleted_at', 'is', null);
        if (isEmail) {
            query = query.where('users.email', '=', identifier.trim().toLowerCase());
        }
        else {
            query = query.where('users.mobile', '=', normalizedMobile);
        }
        const userRecord = await query
            .select([
            'users.id',
            'users.full_name',
            'users.mobile',
            'users.email',
            'users.password_hash',
            'users.role_id',
            'users.status',
            'users.avatar_path',
            'roles.name as role_name',
            'roles.title_fa as role_title_fa',
            'roles.permissions_json'
        ])
            .executeTakeFirst();
        if (!userRecord) {
            throw new errors_1.AuthenticationError('اطلاعات ورود (شماره همراه/ایمیل یا رمز عبور) صحیح نمی‌باشد.');
        }
        if (userRecord.status !== 'active') {
            throw new errors_1.AuthenticationError('حساب کاربری شما غیرفعال یا معلق شده است. لطفاً با مدیر تماس بگیرید.');
        }
        const passwordValid = await (0, security_1.verifyPassword)(plainTextPassword, userRecord.password_hash);
        if (!passwordValid) {
            throw new errors_1.AuthenticationError('اطلاعات ورود (شماره همراه/ایمیل یا رمز عبور) صحیح نمی‌باشد.');
        }
        // Generate secure session token
        const sessionToken = crypto_1.default.randomBytes(32).toString('hex');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days
        await this.db.insertInto('sessions').values({
            id: sessionToken,
            user_id: userRecord.id,
            ip_address: ipAddress || '127.0.0.1',
            user_agent: userAgent || 'Unknown',
            expires_at: expiresAt.toISOString().replace('T', ' ').substring(0, 19),
            created_at: now.toISOString().replace('T', ' ').substring(0, 19)
        }).execute();
        let permissions = [];
        try {
            permissions = JSON.parse(userRecord.permissions_json);
        }
        catch {
            permissions = [];
        }
        // Check teacher or student profile
        let teacherId;
        let studentId;
        if (userRecord.role_name === 'teacher') {
            const teacher = await this.db.selectFrom('teachers').where('user_id', '=', userRecord.id).select('id').executeTakeFirst();
            teacherId = teacher?.id;
        }
        else if (userRecord.role_name === 'student') {
            const student = await this.db.selectFrom('students').where('user_id', '=', userRecord.id).select('id').executeTakeFirst();
            studentId = student?.id;
        }
        const authUser = {
            id: userRecord.id,
            full_name: userRecord.full_name,
            mobile: userRecord.mobile,
            email: userRecord.email,
            role_id: userRecord.role_id,
            role_name: userRecord.role_name,
            role_title_fa: userRecord.role_title_fa,
            permissions,
            status: userRecord.status,
            avatar_path: userRecord.avatar_path,
            teacher_id: teacherId,
            student_id: studentId
        };
        logger_1.logger.info(`User logged in: ${authUser.mobile} (Role: ${authUser.role_name})`);
        return { sessionToken, user: authUser };
    }
    async validateSession(sessionToken) {
        if (!sessionToken)
            return null;
        const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const session = await this.db
            .selectFrom('sessions')
            .where('id', '=', sessionToken)
            .where('expires_at', '>', nowStr)
            .selectAll()
            .executeTakeFirst();
        if (!session)
            return null;
        const userRecord = await this.db
            .selectFrom('users')
            .innerJoin('roles', 'users.role_id', 'roles.id')
            .where('users.id', '=', session.user_id)
            .where('users.deleted_at', 'is', null)
            .where('users.status', '=', 'active')
            .select([
            'users.id',
            'users.full_name',
            'users.mobile',
            'users.email',
            'users.role_id',
            'users.status',
            'users.avatar_path',
            'roles.name as role_name',
            'roles.title_fa as role_title_fa',
            'roles.permissions_json'
        ])
            .executeTakeFirst();
        if (!userRecord)
            return null;
        let permissions = [];
        try {
            permissions = JSON.parse(userRecord.permissions_json);
        }
        catch {
            permissions = [];
        }
        let teacherId;
        let studentId;
        if (userRecord.role_name === 'teacher') {
            const teacher = await this.db.selectFrom('teachers').where('user_id', '=', userRecord.id).select('id').executeTakeFirst();
            teacherId = teacher?.id;
        }
        else if (userRecord.role_name === 'student') {
            const student = await this.db.selectFrom('students').where('user_id', '=', userRecord.id).select('id').executeTakeFirst();
            studentId = student?.id;
        }
        return {
            id: userRecord.id,
            full_name: userRecord.full_name,
            mobile: userRecord.mobile,
            email: userRecord.email,
            role_id: userRecord.role_id,
            role_name: userRecord.role_name,
            role_title_fa: userRecord.role_title_fa,
            permissions,
            status: userRecord.status,
            avatar_path: userRecord.avatar_path,
            teacher_id: teacherId,
            student_id: studentId
        };
    }
    async logout(sessionToken) {
        if (sessionToken) {
            await this.db.deleteFrom('sessions').where('id', '=', sessionToken).execute();
        }
    }
    async logoutAllUserSessions(userId) {
        await this.db.deleteFrom('sessions').where('user_id', '=', userId).execute();
    }
    async changePassword(userId, currentPass, newPass) {
        if (!newPass || newPass.length < 8) {
            throw new errors_1.ValidationError('رمز عبور جدید باید حداقل ۸ کاراکتر باشد.');
        }
        const user = await this.db.selectFrom('users').where('id', '=', userId).selectAll().executeTakeFirst();
        if (!user)
            throw new errors_1.NotFoundError('کاربر یافت نشد.');
        const valid = await (0, security_1.verifyPassword)(currentPass, user.password_hash);
        if (!valid)
            throw new errors_1.ValidationError('رمز عبور فعلی نادرست است.');
        const newHash = await (0, security_1.hashPassword)(newPass);
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        await this.db
            .updateTable('users')
            .set({ password_hash: newHash, must_change_password: 0, updated_at: now })
            .where('id', '=', userId)
            .execute();
        // Expire other sessions for safety
        await this.logoutAllUserSessions(userId);
    }
}
exports.AuthService = AuthService;
