import { z } from 'zod';

export const classSchema = z.object({
  courseId: z.coerce.number().int().positive().optional().nullable(),
  title: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  description: z.string().max(4000).optional().or(z.literal('')),
  type: z.string().max(64).optional().or(z.literal('')),
  category: z.string().max(128).optional().or(z.literal('')),
  level: z.string().max(64).optional().or(z.literal('')),
  capacity: z.coerce.number().int().min(1).max(100000).default(20),
  fee: z.string().regex(/^\d+$/, 'مبلغ باید عدد صحیح باشد').default('0'),
  startDate: z.string().optional().or(z.literal('')), // تاریخ شمسی — در سرویس اعتبارسنجی می‌شود
  endDate: z.string().optional().or(z.literal('')),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal('')),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal('')),
  location: z.string().max(191).optional().or(z.literal('')),
  status: z.enum(['draft', 'open', 'full', 'running', 'finished', 'cancelled']).default('draft'),
  preregEnabled: z.coerce.number().int().min(0).max(1).default(0),
  preregDeadline: z.string().optional().or(z.literal('')),
  prerequisites: z.string().max(2000).optional().or(z.literal('')),
  cancellationPolicy: z.string().max(2000).optional().or(z.literal('')),
});

export type ClassInput = z.infer<typeof classSchema>;

export const assignTeacherSchema = z.object({
  teacherId: z.coerce.number().int().positive(),
});

export const sessionSchema = z.object({
  sessionDate: z.string().min(1, 'تاریخ جلسه را وارد کنید'), // شمسی — در سرویس اعتبارسنجی می‌شود
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  topic: z.string().max(255).optional().or(z.literal('')),
  teacherId: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['held', 'cancelled', 'rescheduled']).default('held'),
  statusNote: z.string().max(1000).optional().or(z.literal('')),
});

export type SessionInput = z.infer<typeof sessionSchema>;
