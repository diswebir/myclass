import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { UsersService } from '../src/modules/users/users.service';
import { TeachersService } from '../src/modules/teachers/teachers.service';
import { StudentsService } from '../src/modules/students/students.service';
import { CoursesService } from '../src/modules/courses/courses.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { PreregistrationService } from '../src/modules/preregistration/preregistration.service';
import { EnrollmentService } from '../src/modules/enrollment/enrollment.service';
import { AuditService } from '../src/modules/audit/audit.service';

describe('Phase 2: Teachers, Students, Courses, Sessions, Pre-registration & Enrollment', () => {
  const db = getDb();
  const auditService = new AuditService(db);
  const usersService = new UsersService(db, auditService);
  const teachersService = new TeachersService(db, usersService, auditService);
  const studentsService = new StudentsService(db, usersService, auditService);
  const coursesService = new CoursesService(db, auditService);
  const sessionsService = new SessionsService(db, auditService);
  const preregService = new PreregistrationService(db, auditService);
  const enrollmentService = new EnrollmentService(db, studentsService, auditService);

  let teacher1Id: number;
  let teacher2Id: number;
  let student1Id: number;
  let courseId: number;
  let classId: number;

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('1. Teachers Management', () => {
    it('creates teacher with internal code and user account', async () => {
      const res = await teachersService.createTeacher({
        fullName: 'دکتر علیرضا محمدی',
        mobile: '09121234567',
        password: 'Password123!',
        internalCode: 'TCH-101',
        specialties: 'برنامه‌نویسی پایتون و وب',
        contractStatus: 'active'
      });

      expect(res.teacherId).toBeDefined();
      teacher1Id = res.teacherId;

      const profile = await teachersService.getTeacherById(teacher1Id);
      expect(profile.full_name).toBe('دکتر علیرضا محمدی');
      expect(profile.internal_code).toBe('TCH-101');
    });

    it('creates second teacher for multi-teacher assignment', async () => {
      const res = await teachersService.createTeacher({
        fullName: 'مهندس سارا احمدی',
        mobile: '09127654321',
        password: 'Password123!',
        internalCode: 'TCH-102',
        specialties: 'طراحی رابط کاربری و فرانت‌اند'
      });
      teacher2Id = res.teacherId;
      expect(teacher2Id).toBeDefined();
    });

    it('prevents duplicate internal codes for teachers', async () => {
      await expect(
        teachersService.createTeacher({
          fullName: 'استاد تکراری',
          mobile: '09129998877',
          password: 'Password123!',
          internalCode: 'TCH-101'
        })
      ).rejects.toThrow(/کد داخلی استاد قبلاً ثبت شده است/);
    });
  });

  describe('2. Students Management & CSV Batch Import', () => {
    it('creates a student with auto-generated student code', async () => {
      const res = await studentsService.createStudent({
        fullName: 'رضا حسینی',
        mobile: '09123334455',
        parentName: 'حسین حسینی',
        parentPhone: '09121112233'
      });

      expect(res.studentId).toBeDefined();
      expect(res.studentCode).toContain('STD-');
      student1Id = res.studentId;

      const details = await studentsService.getStudentById(student1Id);
      expect(details.full_name).toBe('رضا حسینی');
      expect(details.parent_name).toBe('حسین حسینی');
    });

    it('imports students from CSV with row-level validation', async () => {
      const csv = `fullName,mobile,nationalId,parentPhone
مریم رضایی,09124445566,0012345678,09127778899
علی اکبر تهرانی,09125556677,0023456789,09128889900
کاربر با موبایل نامعتبر,123456,0034567890,
`;

      const result = await studentsService.importStudentsFromCsv(csv);
      expect(result.totalRows).toBe(3);
      expect(result.importedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.errors[0].row).toBe(4);
      expect(result.errors[0].message).toContain('شماره همراه نامعتبر');
    });
  });

  describe('3. Courses, Classes & Multi-teacher Assignment', () => {
    it('creates a course and an educational class', async () => {
      courseId = await coursesService.createCourse({
        title: 'دوره جامع Node.js و TypeScript',
        code: 'CRS-NODE-01',
        category: 'برنامه‌نویسی وب',
        level: 'پیشرفته',
        description: 'آموزش جامع معماری نرم‌افزار با فریم‌ورک Express و Kysely'
      });

      expect(courseId).toBeGreaterThan(0);

      classId = await coursesService.createClass({
        courseId,
        title: 'کلاس پاییزه Node.js - گروه A',
        code: 'CLS-NODE-FALL-A',
        capacity: 2, // small capacity to test limit
        tuitionFee: 3500000, // 3,500,000 Tomans
        startDate: '2026-10-15',
        endDate: '2026-12-15',
        scheduleDays: 'شنبه، دوشنبه',
        startTime: '16:00',
        endTime: '18:00',
        location: 'کلاس آنلاین شماره ۱',
        status: 'enrolling',
        preregEnabled: true,
        teacherIds: [{ teacherId: teacher1Id, role: 'primary' }]
      });

      expect(classId).toBeGreaterThan(0);

      const cls = await coursesService.getClassById(classId);
      expect(cls.capacity).toBe(2);
      expect(cls.teachers.length).toBe(1);
      expect(cls.teachers[0].id).toBe(teacher1Id);
    });

    it('assigns multiple teachers to the same class without issue', async () => {
      await coursesService.assignTeacherToClass(classId, teacher2Id, 'co_teacher');
      const cls = await coursesService.getClassById(classId);
      expect(cls.teachers.length).toBe(2);
    });
  });

  describe('4. Sessions Scheduling & Conflict Detection', () => {
    it('creates a valid class session', async () => {
      const sessId = await sessionsService.createSession({
        classId,
        sessionNumber: 1,
        sessionDate: '2026-10-15',
        startTime: '16:00',
        endTime: '18:00',
        topic: 'مفاهیم اولیه معماری',
        teacherId: teacher1Id
      });

      expect(sessId).toBeGreaterThan(0);
      const list = await sessionsService.listSessionsByClass(classId);
      expect(list.length).toBe(1);
      expect(list[0].topic).toBe('مفاهیم اولیه معماری');
    });

    it('detects and prohibits schedule conflict for the same teacher', async () => {
      // Create a second class for another course
      const course2 = await coursesService.createCourse({
        title: 'دوره پایتون',
        code: 'CRS-PY-01',
        category: 'برنامه‌نویسی',
        level: 'مقدماتی'
      });

      const class2 = await coursesService.createClass({
        courseId: course2,
        title: 'پایتون گروه B',
        code: 'CLS-PY-B',
        capacity: 10,
        tuitionFee: 2000000,
        startDate: '2026-10-15',
        endDate: '2026-12-15',
        scheduleDays: 'شنبه',
        startTime: '17:00',
        endTime: '19:00',
        location: 'کلاس ۲'
      });

      // Attempt to schedule teacher1 at overlapping time (17:00-19:00 overlaps with 16:00-18:00 on 2026-10-15)
      await expect(
        sessionsService.createSession({
          classId: class2,
          sessionNumber: 1,
          sessionDate: '2026-10-15',
          startTime: '17:00',
          endTime: '19:00',
          topic: 'تداخل زمانی',
          teacherId: teacher1Id
        })
      ).rejects.toThrow(/تداخل زمانی/);
    });
  });

  describe('5. Pre-registration & Controlled Conversion to Enrollment', () => {
    let trackingCode: string;
    let preregId: number;

    it('submits a pre-registration request and yields a tracking code', async () => {
      const res = await preregService.submitPreregistration({
        classId,
        fullName: 'نوید صبوری',
        mobile: '09128887766',
        email: 'navid@example.com'
      });

      expect(res.trackingCode).toBeDefined();
      expect(res.trackingCode.startsWith('PR-')).toBe(true);
      trackingCode = res.trackingCode;
      preregId = res.id;

      const queryRes = await preregService.getByTrackingCode(trackingCode);
      expect(queryRes.full_name).toBe('نوید صبوری');
      expect(queryRes.status).toBe('pending');
    });

    it('converts pre-registration to confirmed enrollment creating student user automatically', async () => {
      const result = await enrollmentService.convertPreregistrationToEnrollment(preregId);
      expect(result.enrollmentId).toBeDefined();
      expect(result.studentId).toBeDefined();

      const enrs = await enrollmentService.listEnrollmentsByClass(classId);
      const enr = enrs.find(e => e.student_id === result.studentId);
      expect(enr).toBeDefined();
      expect(enr?.full_name).toBe('نوید صبوری');

      // Verify preregistration is marked approved
      const updatedPrereg = await preregService.getByTrackingCode(trackingCode);
      expect(updatedPrereg.status).toBe('approved');
    });

    it('enforces class capacity limits', async () => {
      // Current enrollments in class: 1 (Navid). Capacity is 2.
      // Enroll student1 (Reza) -> reaches 2 (capacity full)
      await enrollmentService.enrollStudent({
        studentId: student1Id,
        classId
      });

      const cls = await coursesService.getClassById(classId);
      expect(cls.enrolledCount).toBe(2);

      // Attempt to enroll 3rd student -> should fail with capacity error
      const student3 = await studentsService.createStudent({
        fullName: 'دانشجوی سوم مازاد',
        mobile: '09120003333'
      });

      await expect(
        enrollmentService.enrollStudent({
          studentId: student3.studentId,
          classId
        })
      ).rejects.toThrow(/ظرفیت کلاس .* تکمیل شده است/);
    });

    it('prohibits duplicate active enrollment of the same student', async () => {
      await expect(
        enrollmentService.enrollStudent({
          studentId: student1Id,
          classId
        })
      ).rejects.toThrow(/این فراگیر هم‌اکنون در این کلاس ثبت‌نام فعال دارد/);
    });
  });
});
