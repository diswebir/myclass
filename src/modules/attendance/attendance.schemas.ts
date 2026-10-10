import { z } from 'zod';

export const attendanceStatuses = ['present', 'absent', 'late', 'excused', 'unset'] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const markEntrySchema = z.object({
  studentId: z.coerce.number().int().positive(),
  status: z.enum(attendanceStatuses),
  note: z.string().max(1000).optional().or(z.literal('')),
});

export const markSessionSchema = z.object({
  entries: z.array(markEntrySchema).min(1).max(500),
});

export type MarkSessionInput = z.infer<typeof markSessionSchema>;
