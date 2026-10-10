import { z } from 'zod';

export const teacherSchema = z.object({
  code: z.string().min(1).max(64),
  firstName: z.string().min(1).max(191),
  lastName: z.string().min(1).max(191),
  phone: z.string().min(1).max(32),
  email: z.string().email().max(191).optional().or(z.literal('')),
  specialties: z.array(z.string().max(64)).default([]),
  status: z.enum(['active', 'inactive', 'on_leave']).default('active'),
  startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type TeacherInput = z.infer<typeof teacherSchema>;
