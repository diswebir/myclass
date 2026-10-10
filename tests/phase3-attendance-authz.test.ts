import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../src/core/db';
import { runMigrations } from '../src/core/migrator';
import { PolicyService } from '../src/core/policy';
import { UsersService } from '../src/modules/users/users.service';
import { TeachersService } from '../src/modules/teachers/teachers.service';
import { StudentsService } from '../src/modules/students/students.service';
import { CoursesService } from '../src/modules/courses/courses.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { EnrollmentService } from '../src/modules/enrollment/enrollment.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { AuthUser } from '../src/core/types';

describe('Phase 3: Attendance, Portals & Server-side Data Isolation (IDOR Protection)', () => {
  const db = getDb();
  const policyService = new PolicyService(db);
  const usersService = new UsersService(db);
  const teachersService = new TeachersService(db, usersService);
  const studentsService = new StudentsService(db, usersService);
  const coursesService = new CoursesService(db);
  const sessionsService = new SessionsService(db);
  const enrollmentService = new EnrollmentService(db, studentsService);
  const attendanceService = new AttendanceService(db, policyService);

  let teacher1User: AuthUser;
  let teacher2User: AuthUser;
  let student1User: AuthUser;
  let student2User: AuthUser;

  let classAId: number;
  let classBId: number;
  let session1Id: number;
  let session2Id: number;
  let student1Id: number;
  let student2Id: number;

  beforeAll(async () => {
    await runMigrations(db);

    // 1. Create Teacher 1
    const t1 = await teachersService.createTeacher({
      fullName: 'استاد اول',
      mobile: '09121000001',
      password: 'Password123!',
      internalCode: 'TCH-P3-1'
    });
    const t1DbUser = await usersService.getUserById(t1.userId);
    teacher1User = {
      id: t1.userId,
      full_name: t1DbUser.full_name,
      mobile: t1DbUser.mobile,
      email: null,
      role_id: t1DbUser.role_id,
      role_name: 'teacher',
      role_title_fa: 'استاد',
      permissions: ['teacher_portal.access', 'attendance.record', 'sessions.read'],
      status: 'active',
      avatar_path: null,
      teacher_id: t1.teacherId
    };

    // 2. Create Teacher 2 (unassigned to Class A)
    const t2 = await teachersService.createTeacher({
      fullName: 'استاد دوم',
      mobile: '09121000002',
      password: 'Password123!',
      internalCode: 'TCH-P3-2'
    });
    const t2DbUser = await usersService.getUserById(t2.userId);
    teacher2User = {
      id: t2.userId,
      full_name: t2DbUser.full_name,
      mobile: t2DbUser.mobile,
      email: null,
      role_id: t2DbUser.role_id,
      role_name: 'teacher',
      role_title_fa: 'استاد',
      permissions: ['teacher_portal.access', 'attendance.record', 'sessions.read'],
      status: 'active',
      avatar_path: null,
      teacher_id: t2.teacherId
    };

    // 3. Create Student 1
    const s1 = await studentsService.createStudent({
      fullName: 'دانشجو یک',
      mobile: '09122000001'
    });
    student1Id = s1.studentId;
    const s1DbUser = await usersService.getUserById(s1.userId);
    student1User = {
      id: s1.userId,
      full_name: s1DbUser.full_name,
      mobile: s1DbUser.mobile,
      email: null,
      role_id: s1DbUser.role_id,
      role_name: 'student',
      role_title_fa: 'فراگیر',
      permissions: ['student_portal.access'],
      status: 'active',
      avatar_path: null,
      student_id: s1.studentId
    };

    // 4. Create Student 2
    const s2 = await studentsService.createStudent({
      fullName: 'دانشجو دو',
      mobile: '09122000002'
    });
    student2Id = s2.studentId;
    const s2DbUser = await usersService.getUserById(s2.userId);
    student2User = {
      id: s2.userId,
      full_name: s2DbUser.full_name,
      mobile: s2DbUser.mobile,
      email: null,
      role_id: s2DbUser.role_id,
      role_name: 'student',
      role_title_fa: 'فراگیر',
      permissions: ['student_portal.access'],
      status: 'active',
      avatar_path: null,
      student_id: s2.studentId
    };

    // 5. Create Course & Class A (Teacher 1 assigned)
    const course = await coursesService.createCourse({
      title: 'دوره معماری',
      code: 'CRS-ARCH-01',
      category: 'مهندسی',
      level: 'پیشرفته'
    });

    classAId = await coursesService.createClass({
      courseId: course,
      title: 'کلاس معماری نرم‌افزار',
      code: 'CLS-ARCH-A',
      capacity: 30,
      tuitionFee: 4000000,
      startDate: '2026-10-20',
      endDate: '2026-12-20',
      scheduleDays: 'یکشنبه',
      startTime: '10:00',
      endTime: '12:00',
      location: 'سالن ۱',
      minAttendancePercent: 75,
      teacherIds: [{ teacherId: t1.teacherId, role: 'primary' }]
    });

    // Class B (Teacher 2 assigned)
    classBId = await coursesService.createClass({
      courseId: course,
      title: 'کلاس امنیت وب',
      code: 'CLS-SEC-B',
      capacity: 30,
      tuitionFee: 4500000,
      startDate: '2026-10-20',
      endDate: '2026-12-20',
      scheduleDays: 'سه‌شنبه',
      startTime: '14:00',
      endTime: '16:00',
      location: 'سالن ۲',
      teacherIds: [{ teacherId: t2.teacherId, role: 'primary' }]
    });

    // Enroll Student 1 and Student 2 in Class A
    await enrollmentService.enrollStudent({ studentId: student1Id, classId: classAId });
    await enrollmentService.enrollStudent({ studentId: student2Id, classId: classAId });

    // Create 2 sessions for Class A
    session1Id = await sessionsService.createSession({
      classId: classAId,
      sessionNumber: 1,
      sessionDate: '2026-10-20',
      startTime: '10:00',
      endTime: '12:00',
      topic: 'جلسه اول: کلیات',
      teacherId: t1.teacherId
    });

    session2Id = await sessionsService.createSession({
      classId: classAId,
      sessionNumber: 2,
      sessionDate: '2026-10-27',
      startTime: '10:00',
      endTime: '12:00',
      topic: 'جلسه دوم: الگوها',
      teacherId: t1.teacherId
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('1. Attendance Recording & Class Roster', () => {
    it('allows assigned Teacher 1 to get roster and record attendance for Session 1', async () => {
      const data = await attendanceService.getSessionAttendance(session1Id, teacher1User);
      expect(data.roster.length).toBe(2);

      // Record Student 1 = present, Student 2 = absent
      const res = await attendanceService.recordSessionAttendance(
        session1Id,
        [
          { studentId: student1Id, status: 'present' },
          { studentId: student2Id, status: 'absent', note: 'غیبت بدون اطلاع قبلی' }
        ],
        teacher1User
      );
      expect(res.message).toContain('موفقیت');

      // Verify updated roster
      const updated = await attendanceService.getSessionAttendance(session1Id, teacher1User);
      const s1 = updated.roster.find(r => r.studentId === student1Id);
      const s2 = updated.roster.find(r => r.studentId === student2Id);
      expect(s1?.status).toBe('present');
      expect(s2?.status).toBe('absent');
      expect(s2?.note).toBe('غیبت بدون اطلاع قبلی');
    });

    it('records Session 2 attendance to test percentage calculation', async () => {
      // Student 1 = present, Student 2 = absent again
      await attendanceService.recordSessionAttendance(
        session2Id,
        [
          { studentId: student1Id, status: 'present' },
          { studentId: student2Id, status: 'absent', note: 'غیبت دوم' }
        ],
        teacher1User
      );

      const summaries = await attendanceService.getClassAttendanceReport(classAId, teacher1User);
      expect(summaries.length).toBe(2);

      const s1Summary = summaries.find(s => s.studentId === student1Id);
      const s2Summary = summaries.find(s => s.studentId === student2Id);

      expect(s1Summary?.totalHeldSessions).toBe(2);
      expect(s1Summary?.attendancePercent).toBe(100);
      expect(s1Summary?.hasExceededAbsenceLimit).toBe(false);

      expect(s2Summary?.absentCount).toBe(2);
      expect(s2Summary?.attendancePercent).toBe(0);
      expect(s2Summary?.hasExceededAbsenceLimit).toBe(true); // Exceeded 75% min attendance limit!
    });
  });

  describe('2. Negative Authorization & IDOR Protection', () => {
    it('blocks Teacher 2 from recording attendance for Class A (IDOR rejection)', async () => {
      await expect(
        attendanceService.recordSessionAttendance(
          session1Id,
          [{ studentId: student1Id, status: 'present' }],
          teacher2User // Teacher 2 is NOT assigned to Class A
        )
      ).rejects.toThrow(/دسترسی به این جلسه آموزشی را ندارید/);
    });

    it('blocks Teacher 2 from accessing Class A attendance report', async () => {
      await expect(
        attendanceService.getClassAttendanceReport(classAId, teacher2User)
      ).rejects.toThrow(/دسترسی به این کلاس را ندارید/);
    });

    it('allows Student 1 to view their own personal attendance', async () => {
      const records = await attendanceService.getStudentPersonalAttendance(student1Id, student1User);
      expect(records.length).toBe(2);
      expect(records[0].status).toBe('present');
    });

    it('blocks Student 1 from accessing Student 2 personal attendance (IDOR rejection)', async () => {
      await expect(
        attendanceService.getStudentPersonalAttendance(student2Id, student1User) // Student 1 trying to access Student 2's ID
      ).rejects.toThrow(/دسترسی به اطلاعات این فراگیر را ندارید/);
    });
  });
});
