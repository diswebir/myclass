import { Kysely } from 'kysely';
import { DatabaseSchema } from '../../core/types';
import { ValidationError, NotFoundError } from '../../core/errors';
import { AuditService } from '../audit/audit.service';

export interface ScheduleConflict {
  type: 'teacher' | 'location';
  conflictingSessionId: number;
  classTitle: string;
  sessionDate: string;
  timeRange: string;
  message: string;
}

export class SessionsService {
  constructor(private db: Kysely<DatabaseSchema>, private auditService?: AuditService) {}

  async listSessionsByClass(classId: number) {
    return this.db
      .selectFrom('class_sessions')
      .leftJoin('teachers', 'class_sessions.teacher_id', 'teachers.id')
      .leftJoin('users', 'teachers.user_id', 'users.id')
      .where('class_sessions.class_id', '=', classId)
      .select([
        'class_sessions.id',
        'class_sessions.class_id',
        'class_sessions.session_number',
        'class_sessions.session_date',
        'class_sessions.start_time',
        'class_sessions.end_time',
        'class_sessions.topic',
        'class_sessions.teacher_id',
        'class_sessions.status',
        'class_sessions.notes',
        'users.full_name as teacher_name'
      ])
      .orderBy('class_sessions.session_date', 'asc')
      .orderBy('class_sessions.start_time', 'asc')
      .execute();
  }

  async getSessionById(sessionId: number) {
    const session = await this.db
      .selectFrom('class_sessions')
      .innerJoin('classes', 'class_sessions.class_id', 'classes.id')
      .leftJoin('teachers', 'class_sessions.teacher_id', 'teachers.id')
      .leftJoin('users', 'teachers.user_id', 'users.id')
      .where('class_sessions.id', '=', sessionId)
      .select([
        'class_sessions.id',
        'class_sessions.class_id',
        'class_sessions.session_number',
        'class_sessions.session_date',
        'class_sessions.start_time',
        'class_sessions.end_time',
        'class_sessions.topic',
        'class_sessions.teacher_id',
        'class_sessions.status',
        'class_sessions.notes',
        'classes.title as class_title',
        'classes.location as class_location',
        'users.full_name as teacher_name'
      ])
      .executeTakeFirst();

    if (!session) throw new NotFoundError('جلسه مورد نظر یافت نشد.');
    return session;
  }

  // Check time overlap: timeA_start < timeB_end AND timeA_end > timeB_start
  async checkConflicts(params: {
    sessionIdToIgnore?: number;
    teacherId?: number;
    classId: number;
    sessionDate: string;
    startTime: string;
    endTime: string;
  }): Promise<ScheduleConflict[]> {
    const conflicts: ScheduleConflict[] = [];

    // 1. Teacher conflict check
    if (params.teacherId) {
      const teacherSessions = await this.db
        .selectFrom('class_sessions')
        .innerJoin('classes', 'class_sessions.class_id', 'classes.id')
        .where('class_sessions.teacher_id', '=', params.teacherId)
        .where('class_sessions.session_date', '=', params.sessionDate)
        .where('class_sessions.status', '!=', 'cancelled')
        .select([
          'class_sessions.id',
          'class_sessions.start_time',
          'class_sessions.end_time',
          'classes.title as class_title'
        ])
        .execute();

      for (const s of teacherSessions) {
        if (params.sessionIdToIgnore && s.id === params.sessionIdToIgnore) continue;

        // Overlap check
        if (params.startTime < s.end_time && params.endTime > s.start_time) {
          conflicts.push({
            type: 'teacher',
            conflictingSessionId: s.id!,
            classTitle: s.class_title,
            sessionDate: params.sessionDate,
            timeRange: `${s.start_time} تا ${s.end_time}`,
            message: `استاد در این زمان در کلاس «${s.class_title}» دارای جلسه دیگری می‌باشد.`
          });
        }
      }
    }

    return conflicts;
  }

  async createSession(data: {
    classId: number;
    sessionNumber: number;
    sessionDate: string;
    startTime: string;
    endTime: string;
    topic?: string;
    teacherId?: number;
    notes?: string;
  }, actorUserId?: number) {
    // Conflict detection
    const conflicts = await this.checkConflicts({
      teacherId: data.teacherId,
      classId: data.classId,
      sessionDate: data.sessionDate,
      startTime: data.startTime,
      endTime: data.endTime
    });

    if (conflicts.length > 0) {
      throw new ValidationError(`تداخل زمانی: ${conflicts[0].message}`);
    }

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const res = await this.db.insertInto('class_sessions').values({
      class_id: data.classId,
      session_number: data.sessionNumber,
      session_date: data.sessionDate,
      start_time: data.startTime.trim(),
      end_time: data.endTime.trim(),
      topic: data.topic || null,
      teacher_id: data.teacherId || null,
      status: 'scheduled',
      notes: data.notes || null,
      created_at: now,
      updated_at: now
    }).execute();

    const sessionId = Number(res[0]?.insertId);
    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'CREATE_SESSION',
        entityType: 'class_sessions',
        entityId: sessionId,
        newValues: { classId: data.classId, sessionNumber: data.sessionNumber, date: data.sessionDate }
      });
    }

    return sessionId;
  }

  async updateSessionStatus(sessionId: number, status: 'scheduled' | 'held' | 'cancelled' | 'rescheduled', notes?: string, actorUserId?: number) {
    const session = await this.getSessionById(sessionId);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    await this.db
      .updateTable('class_sessions')
      .set({
        status,
        notes: notes !== undefined ? notes : session.notes,
        updated_at: now
      })
      .where('id', '=', sessionId)
      .execute();

    if (this.auditService) {
      await this.auditService.log({
        userId: actorUserId,
        action: 'UPDATE_SESSION_STATUS',
        entityType: 'class_sessions',
        entityId: sessionId,
        oldValues: { status: session.status },
        newValues: { status, notes }
      });
    }
  }
}
