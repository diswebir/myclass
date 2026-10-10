"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentsService = void 0;
const errors_1 = require("../../core/errors");
const security_1 = require("../../core/security");
class StudentsService {
    db;
    usersService;
    auditService;
    constructor(db, usersService, auditService) {
        this.db = db;
        this.usersService = usersService;
        this.auditService = auditService;
    }
    async generateStudentCode() {
        const year = new Date().getFullYear();
        const countRes = await this.db.selectFrom('students').select(this.db.fn.count('id').as('count')).executeTakeFirst();
        const nextNum = (Number(countRes?.count || 0) + 1).toString().padStart(4, '0');
        return `STD-${year}-${nextNum}`;
    }
    async listStudents(options) {
        const limit = options.limit || 20;
        const offset = options.offset || 0;
        let query = this.db
            .selectFrom('students')
            .innerJoin('users', 'students.user_id', 'users.id')
            .where('students.deleted_at', 'is', null)
            .where('users.deleted_at', 'is', null);
        if (options.status) {
            query = query.where('users.status', '=', options.status);
        }
        if (options.search) {
            const s = `%${options.search.trim()}%`;
            query = query.where((eb) => eb.or([
                eb('users.full_name', 'like', s),
                eb('users.mobile', 'like', s),
                eb('students.student_code', 'like', s),
                eb('students.national_id', 'like', s)
            ]));
        }
        const totalRes = await query.select(this.db.fn.count('students.id').as('count')).executeTakeFirst();
        const total = Number(totalRes?.count || 0);
        const students = await query
            .select([
            'students.id',
            'students.user_id',
            'students.student_code',
            'students.national_id',
            'students.emergency_contact',
            'students.parent_name',
            'students.parent_phone',
            'students.created_at',
            'users.full_name',
            'users.mobile',
            'users.email',
            'users.status as user_status'
        ])
            .orderBy('students.id', 'desc')
            .limit(limit)
            .offset(offset)
            .execute();
        return { students, total, limit, offset };
    }
    async getStudentById(studentId) {
        const student = await this.db
            .selectFrom('students')
            .innerJoin('users', 'students.user_id', 'users.id')
            .where('students.id', '=', studentId)
            .where('students.deleted_at', 'is', null)
            .select([
            'students.id',
            'students.user_id',
            'students.student_code',
            'students.national_id',
            'students.emergency_contact',
            'students.parent_name',
            'students.parent_phone',
            'students.address',
            'students.internal_notes',
            'students.created_at',
            'users.full_name',
            'users.mobile',
            'users.email',
            'users.status as user_status'
        ])
            .executeTakeFirst();
        if (!student)
            throw new errors_1.NotFoundError('فراگیر مورد نظر یافت نشد.');
        // Fetch enrolled classes
        const enrollments = await this.db
            .selectFrom('enrollments')
            .innerJoin('classes', 'enrollments.class_id', 'classes.id')
            .where('enrollments.student_id', '=', studentId)
            .select([
            'enrollments.id as enrollment_id',
            'enrollments.status as enrollment_status',
            'enrollments.tuition_agreed',
            'classes.id as class_id',
            'classes.title as class_title',
            'classes.code as class_code',
            'classes.start_date',
            'classes.end_date'
        ])
            .execute();
        return { ...student, enrollments };
    }
    async getStudentByUserId(userId) {
        const student = await this.db
            .selectFrom('students')
            .where('user_id', '=', userId)
            .where('deleted_at', 'is', null)
            .selectAll()
            .executeTakeFirst();
        return student || null;
    }
    async createStudent(data, actorUserId) {
        let studentCode = data.studentCode ? data.studentCode.trim() : await this.generateStudentCode();
        const existingCode = await this.db.selectFrom('students').where('student_code', '=', studentCode).select('id').executeTakeFirst();
        if (existingCode) {
            throw new errors_1.ConflictError('شماره فراگیر (کد دانشجویی) قبلاً ثبت شده است.');
        }
        const studentRole = await this.db.selectFrom('roles').where('name', '=', 'student').select('id').executeTakeFirst();
        if (!studentRole)
            throw new Error('نقش فراگیر در سیستم یافت نشد.');
        // Default password is phone number if not supplied
        const initialPass = data.password || (0, security_1.normalizeMobile)(data.mobile);
        const userRes = await this.usersService.createUser({
            fullName: data.fullName,
            mobile: data.mobile,
            email: data.email,
            password: initialPass,
            roleId: studentRole.id
        }, actorUserId);
        const userId = Number(userRes[0]?.insertId);
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const studentRes = await this.db.insertInto('students').values({
            user_id: userId,
            student_code: studentCode,
            national_id: data.nationalId ? (0, security_1.normalizeDigits)(data.nationalId) : null,
            emergency_contact: data.emergencyContact ? (0, security_1.normalizeMobile)(data.emergencyContact) : null,
            parent_name: data.parentName ? data.parentName.trim() : null,
            parent_phone: data.parentPhone ? (0, security_1.normalizeMobile)(data.parentPhone) : null,
            address: data.address || null,
            internal_notes: data.internalNotes || null,
            created_at: now,
            updated_at: now,
            deleted_at: null
        }).execute();
        const studentId = Number(studentRes[0]?.insertId);
        if (this.auditService) {
            await this.auditService.log({
                userId: actorUserId,
                action: 'CREATE_STUDENT',
                entityType: 'students',
                entityId: studentId,
                newValues: { fullName: data.fullName, studentCode }
            });
        }
        return { studentId, userId, studentCode };
    }
    async updateStudent(studentId, data, actorUserId) {
        const student = await this.getStudentById(studentId);
        if (data.fullName || data.mobile || data.email !== undefined) {
            await this.usersService.updateUser(student.user_id, {
                fullName: data.fullName,
                mobile: data.mobile,
                email: data.email
            }, actorUserId);
        }
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const updates = { updated_at: now };
        if (data.nationalId !== undefined)
            updates.national_id = data.nationalId ? (0, security_1.normalizeDigits)(data.nationalId) : null;
        if (data.emergencyContact !== undefined)
            updates.emergency_contact = data.emergencyContact ? (0, security_1.normalizeMobile)(data.emergencyContact) : null;
        if (data.parentName !== undefined)
            updates.parent_name = data.parentName ? data.parentName.trim() : null;
        if (data.parentPhone !== undefined)
            updates.parent_phone = data.parentPhone ? (0, security_1.normalizeMobile)(data.parentPhone) : null;
        if (data.address !== undefined)
            updates.address = data.address;
        if (data.internalNotes !== undefined)
            updates.internal_notes = data.internalNotes;
        await this.db.updateTable('students').set(updates).where('id', '=', studentId).execute();
        if (this.auditService) {
            await this.auditService.log({
                userId: actorUserId,
                action: 'UPDATE_STUDENT',
                entityType: 'students',
                entityId: studentId,
                newValues: updates
            });
        }
    }
    async importStudentsFromCsv(csvContent, actorUserId) {
        const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length <= 1) {
            throw new errors_1.ValidationError('فایل CSV خالی است یا فقط حاوی سربرگ می‌باشد.');
        }
        const header = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        // Expected header: fullName,mobile,nationalId,parentPhone
        const result = {
            totalRows: lines.length - 1,
            importedCount: 0,
            failedCount: 0,
            errors: []
        };
        for (let i = 1; i < lines.length; i++) {
            const rowLine = lines[i];
            const cols = rowLine.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
            const fullName = cols[0] || '';
            const mobile = (0, security_1.normalizeMobile)(cols[1]);
            const nationalId = cols[2] ? (0, security_1.normalizeDigits)(cols[2]) : undefined;
            const parentPhone = cols[3] ? (0, security_1.normalizeMobile)(cols[3]) : undefined;
            if (!fullName) {
                result.failedCount++;
                result.errors.push({ row: i + 1, mobile: cols[1] || '', message: 'نام و نام‌خانوادگی خالی است' });
                continue;
            }
            if (!(0, security_1.isValidIranianMobile)(mobile)) {
                result.failedCount++;
                result.errors.push({ row: i + 1, mobile: cols[1] || '', message: 'شماره همراه نامعتبر است' });
                continue;
            }
            try {
                await this.createStudent({
                    fullName,
                    mobile,
                    nationalId,
                    parentPhone
                }, actorUserId);
                result.importedCount++;
            }
            catch (err) {
                result.failedCount++;
                result.errors.push({ row: i + 1, mobile, message: err.message || 'خطا در ثبت' });
            }
        }
        return result;
    }
}
exports.StudentsService = StudentsService;
